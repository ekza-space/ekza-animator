// ① parts of a multi-mesh model (AUTORIG-SPEC §6.1 "Several meshes"; AR-D10-1; moved from Auto-Rig ① by T5b). Every
// mesh that touches the body — the tallest mesh — directly or through other parts is "Part of the character" by
// default: a hand that overlaps its forearm, a shoe on an ankle, an eye on the face (a low-poly game character is often
// 30+ separate parts, most of which never touch the torso). A mesh that touches none of them (a weapon lying on the
// floor) "Looks separate" and starts unticked. Two meshes touch when their surfaces come within one cell of a grid of
// 1/96 of the model's height (their world-space faces are sampled into the grid; data without faces falls back to the
// bounds). The shell keeps the ticks; the flow takes the default parts with the intake (`./intake`) and measures the
// fixes on the ticked ones (`./fixes`). Reading mesh data is reading a service.
import { quatRotateVec3 } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import type { EditorApp } from '../types';
import type { AutoRigFlowState } from './host';

type Box = readonly [readonly [number, number, number], readonly [number, number, number]];
type Vec = [number, number, number];

/** The cells along the model's height of the contact grid. */
export const CONTACT_GRID = 96;
/** The most samples along a triangle edge (a huge face is sampled coarser rather than without end). */
const MAX_STEPS = 64;
/** Cells per axis of the key space (2^17: the keys stay exact doubles). */
const AXIS = 131_072;

interface Placed {
  readonly world: (x: number, y: number, z: number) => Vec;
  readonly position: Float32Array;
  readonly faces: { readonly corner: Uint32Array; readonly next: Uint32Array; readonly vert: Uint32Array } | null;
}

function placed(app: EditorApp, id: MeshId): Placed | null {
  const record = app.store.get('meshes', id);
  const data = app.meshes.get(id)?.data() ?? null;
  if (record === undefined || data === null || data.position.length === 0) return null;
  const { t, q, s } = record.placement;
  const world = (x: number, y: number, z: number): Vec => {
    const w = quatRotateVec3(q, [x * s[0], y * s[1], z * s[2]]);
    return [w[0] + t[0], w[1] + t[1], w[2] + t[2]];
  };
  const faces =
    data.faceCorner !== undefined && data.cornerNext !== undefined && data.cornerVert !== undefined
      ? { corner: data.faceCorner, next: data.cornerNext, vert: data.cornerVert }
      : null;
  return { world, position: data.position, faces: faces !== null && faces.corner.length > 0 ? faces : null };
}

/** World bounds of a top-level scene mesh from its resident data and placement; null while not resident. */
export function meshBounds(app: EditorApp, id: MeshId): Box | null {
  const mesh = placed(app, id);
  return mesh === null ? null : boundsOf(mesh);
}

function boundsOf(mesh: Placed): Box {
  const lo: Vec = [Infinity, Infinity, Infinity];
  const hi: Vec = [-Infinity, -Infinity, -Infinity];
  const p = mesh.position;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const w = mesh.world(p[i] as number, p[i + 1] as number, p[i + 2] as number);
    for (let k = 0 as 0 | 1 | 2; k < 3; k = (k + 1) as 0 | 1 | 2) {
      if (w[k] < lo[k]) lo[k] = w[k];
      if (w[k] > hi[k]) hi[k] = w[k];
    }
  }
  return [lo, hi];
}

const overlaps = (a: Box, b: Box, tol: number): boolean =>
  ([0, 1, 2] as const).every((k) => a[0][k] - tol <= b[1][k] && b[0][k] - tol <= a[1][k]);

/** The grid cells a mesh's surface passes through (its faces sampled at half a cell; its points without faces). */
function surfaceCells(mesh: Placed, origin: readonly number[], cell: number): Set<number> {
  const cells = new Set<number>();
  const add = (w: Vec): void => {
    const ix = Math.min(AXIS - 1, Math.max(0, Math.floor((w[0] - (origin[0] as number)) / cell)));
    const iy = Math.min(AXIS - 1, Math.max(0, Math.floor((w[1] - (origin[1] as number)) / cell)));
    const iz = Math.min(AXIS - 1, Math.max(0, Math.floor((w[2] - (origin[2] as number)) / cell)));
    cells.add((ix * AXIS + iy) * AXIS + iz);
  };
  const p = mesh.position;
  const points: Vec[] = [];
  for (let i = 0; i + 2 < p.length; i += 3)
    points.push(mesh.world(p[i] as number, p[i + 1] as number, p[i + 2] as number));
  for (const w of points) add(w);
  const faces = mesh.faces;
  if (faces === null) return cells;
  const half = cell / 2;
  for (let f = 0; f < faces.corner.length; f++) {
    // a fan over the face's corners
    const first = faces.corner[f] as number;
    const a = points[faces.vert[first] as number];
    let c1 = faces.next[first] as number;
    for (let guard = 0; guard < 1024; guard++) {
      const c2 = faces.next[c1] as number;
      if (c2 === first || c2 === undefined) break;
      const b = points[faces.vert[c1] as number];
      const c = points[faces.vert[c2] as number];
      if (a !== undefined && b !== undefined && c !== undefined) {
        const longest = Math.max(dist(a, b), dist(b, c), dist(c, a));
        const n = Math.min(MAX_STEPS, Math.max(1, Math.ceil(longest / half)));
        for (let i = 0; i <= n; i++) {
          for (let j = 0; i + j <= n; j++) {
            const u = i / n;
            const v = j / n;
            add([
              a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v,
              a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v,
              a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v,
            ]);
          }
        }
      }
      c1 = c2;
    }
  }
  return cells;
}

const dist = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Whether a cell of `b` lies in or next to a cell of `a` (the 27 neighbours). */
function touching(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const key of small) {
    const iz = key % AXIS;
    const iy = Math.floor(key / AXIS) % AXIS;
    const ix = Math.floor(key / (AXIS * AXIS));
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (large.has(((ix + dx) * AXIS + iy + dy) * AXIS + iz + dz)) return true;
        }
      }
    }
  }
  return false;
}

/** The last answer, kept while the meshes' records and data are the same objects (the report reads it per change). */
let cache: { readonly keys: readonly unknown[]; readonly separate: MeshId[] } | null = null;

function cacheKeys(app: EditorApp, meshes: readonly MeshId[]): unknown[] {
  const keys: unknown[] = [];
  for (const id of meshes) keys.push(id, app.store.get('meshes', id), app.meshes.get(id)?.data() ?? null);
  return keys;
}

/** The meshes that touch neither the body (the tallest mesh) nor a part touching it; [] when data is not resident. */
export function separateMeshes(app: EditorApp, meshes: readonly MeshId[]): MeshId[] {
  if (meshes.length < 2) return [];
  const keys = cacheKeys(app, meshes);
  if (cache !== null && cache.keys.length === keys.length && cache.keys.every((key, i) => key === keys[i])) {
    return [...cache.separate];
  }
  const separate = classify(app, meshes);
  if (separate !== null) cache = { keys, separate };
  return separate === null ? [] : [...separate];
}

function classify(app: EditorApp, meshes: readonly MeshId[]): MeshId[] | null {
  const parts: Placed[] = [];
  for (const id of meshes) {
    const mesh = placed(app, id);
    if (mesh === null) return null;
    parts.push(mesh);
  }
  const boxes = parts.map(boundsOf);
  let body = -1;
  let lo = Infinity;
  let hi = -Infinity;
  boxes.forEach((box, i) => {
    lo = Math.min(lo, box[0][1]);
    hi = Math.max(hi, box[1][1]);
    const tallest = boxes[body];
    if (tallest === undefined || box[1][1] - box[0][1] > tallest[1][1] - tallest[0][1]) body = i;
  });
  const height = hi - lo;
  if (body < 0 || !(height > 0) || !Number.isFinite(height)) return [];
  const cell = height / CONTACT_GRID;
  const origin = [0, 1, 2].map((k) => Math.min(...boxes.map((box) => box[0][k] as number)) - 2 * cell);
  const cells = new Map<number, Set<number>>();
  const cellsOf = (i: number): Set<number> => {
    let found = cells.get(i);
    if (found === undefined) {
      found = surfaceCells(parts[i] as Placed, origin, cell);
      cells.set(i, found);
    }
    return found;
  };
  const withFaces = (i: number): boolean => (parts[i] as Placed).faces !== null;
  const reached = new Set<number>([body]);
  const queue = [body];
  while (queue.length > 0) {
    const at = queue.shift() as number;
    for (let i = 0; i < parts.length; i++) {
      if (reached.has(i) || !overlaps(boxes[at] as Box, boxes[i] as Box, 2 * cell)) continue;
      // without faces (points only) the bounds decide; with faces the surfaces must come within a cell
      if (withFaces(at) && withFaces(i) && !touching(cellsOf(at), cellsOf(i))) continue;
      reached.add(i);
      queue.push(i);
    }
  }
  return meshes.filter((_, i) => !reached.has(i));
}

/** The default ticked parts (§6.1): every mesh but the ones that look separate. */
export function defaultParts(app: EditorApp, meshes: readonly MeshId[]): MeshId[] {
  const separate = new Set(separateMeshes(app, meshes));
  return meshes.filter((id) => !separate.has(id));
}

/** The scene meshes of the loaded model left out of the character (the unticked parts that still exist). */
export function leftOutParts(app: EditorApp, state: Pick<AutoRigFlowState, 'parts' | 'intake'>): MeshId[] {
  const parts = state.parts;
  if (parts === null || state.intake === null) return [];
  const ticked = new Set(parts);
  return state.intake.meshes.filter((id) => !ticked.has(id) && app.store.get('meshes', id) !== undefined);
}
