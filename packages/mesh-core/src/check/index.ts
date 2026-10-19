// Mesh Check (M6A-SPEC §5.25, §4.3 `checkMesh`): diagnostics over the visible elements of a mesh, one `MeshProblem` per
// code (two for `loose-geometry`: its vertices and its wire edges), codes in the §5.25 table order, elements ascending.
//
// | code | detection | domain |
// |---|---|---|
// | non-manifold-edge | an edge with more than two faces | edge |
// | non-manifold-vertex | a vertex whose faces do not form one fan (disc or half-disc) across two-face edges, or whose fan touches a wire edge; vertices of a non-manifold edge are that code's | point |
// | lamina | faces over the same vertex set: every face of such a group but the smallest index (the ones the fix deletes) | face |
// | zero-length-edge | length ≤ 1e-6 × the bounding-box diagonal | edge |
// | zero-area-face | height (2 × area / longest edge) or longest edge ≤ 1e-6 × the diagonal | face |
// | inconsistent-winding | a two-face edge both faces traverse in the same direction | edge |
// | nonplanar-ngon | an n-gon (n ≥ 5) whose farthest corner from its Newell plane is > 1 % of its size (bounding-box diagonal) | face |
// | concave-ngon | an n-gon (n ≥ 5) with a reflex corner on its plane | face |
// | ngon-degenerate | an n-gon earcut cannot triangulate (the fan fallback of §5.4) | face |
// | stray-vertex | a valence-2 vertex whose edges are collinear within 1° | point |
// | loose-geometry | vertices without edges; edges without faces | point; edge |
// | open-border | a border edge, when the caller expects a closed mesh | edge |
// | duplicate-slot | faces painted with a palette slot two live swatches share (`duplicateSlots`) | face |
//
// Quads are never "n-gons" here: their split is the one triangulation's shorter diagonal (concave quads take the
// other), so warped or concave quads draw predictably. Element lists are what "select matching" selects; the
// `mesh.cleanup` fixes (../ops/cleanup) read the same lists.
import { isEditMesh } from '../core/access';
import { editMeshFrom } from '../core/edit';
import { kernelError } from '../kernel';
import { isDegenerateNgon } from '../triangulate/triangulate';
import type { CheckCode, Domain, EditMesh, HiddenSet, MeshData, MeshProblem } from '../types';

export interface CheckOptions {
  readonly hidden?: HiddenSet | null;
  readonly closedExpected?: boolean;
  readonly duplicateSlots?: ReadonlySet<number>;
}

const STRAY_COS = Math.cos((179 * Math.PI) / 180);

/** 1e-6 × the bounding-box diagonal of the mesh (0 for an empty or single-point mesh). */
export function checkThreshold(m: EditMesh): number {
  const p = m.position;
  const n = m.counts.points;
  if (n === 0) return 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = p[3 * i] as number;
    const y = p[3 * i + 1] as number;
    const z = p[3 * i + 2] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return 1e-6 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

function faceCorners(m: EditMesh, f: number, out: number[]): number[] {
  out.length = 0;
  const start = m.faceCorner(f);
  let c = start;
  let guard = 0;
  do {
    out.push(c);
    c = m.cornerNext(c);
  } while (c !== start && ++guard <= m.counts.corners);
  return out;
}

const NORMAL = new Float64Array(3);

/** Newell normal (not normalized) of the corner list, into NORMAL; returns its length. */
function newellOf(m: EditMesh, corners: readonly number[]): number {
  const p = m.position;
  let x = 0;
  let y = 0;
  let z = 0;
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const a = 3 * m.cornerVert(corners[i] as number);
    const b = 3 * m.cornerVert(corners[(i + 1) % n] as number);
    x += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
    y += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
    z += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
  }
  NORMAL[0] = x;
  NORMAL[1] = y;
  NORMAL[2] = z;
  return Math.hypot(x, y, z);
}

function distance(m: EditMesh, a: number, b: number): number {
  const p = m.position;
  return Math.hypot(
    (p[3 * b] as number) - (p[3 * a] as number),
    (p[3 * b + 1] as number) - (p[3 * a + 1] as number),
    (p[3 * b + 2] as number) - (p[3 * a + 2] as number),
  );
}

/** Whether the face's corners are all on its Newell plane within 1 % of its size. */
function isPlanar(m: EditMesh, corners: readonly number[]): boolean {
  const length = newellOf(m, corners);
  if (!(length > 0)) return true;
  const nx = (NORMAL[0] as number) / length;
  const ny = (NORMAL[1] as number) / length;
  const nz = (NORMAL[2] as number) / length;
  const p = m.position;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (const c of corners) {
    const v = 3 * m.cornerVert(c);
    const x = p[v] as number;
    const y = p[v + 1] as number;
    const z = p[v + 2] as number;
    cx += x / corners.length;
    cy += y / corners.length;
    cz += z / corners.length;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
    z1 = Math.max(z1, z);
  }
  const size = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  let worst = 0;
  for (const c of corners) {
    const v = 3 * m.cornerVert(c);
    const d = Math.abs(
      ((p[v] as number) - cx) * nx + ((p[v + 1] as number) - cy) * ny + ((p[v + 2] as number) - cz) * nz,
    );
    worst = Math.max(worst, d);
  }
  return worst <= 0.01 * size;
}

/** Whether a corner of the face turns against the face's Newell normal (a reflex corner on its plane). */
function hasReflexCorner(m: EditMesh, corners: readonly number[]): boolean {
  const length = newellOf(m, corners);
  if (!(length > 0)) return false;
  const nx = NORMAL[0] as number;
  const ny = NORMAL[1] as number;
  const nz = NORMAL[2] as number;
  const p = m.position;
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    const a = 3 * m.cornerVert(corners[(i + n - 1) % n] as number);
    const b = 3 * m.cornerVert(corners[i] as number);
    const c = 3 * m.cornerVert(corners[(i + 1) % n] as number);
    const ux = (p[b] as number) - (p[a] as number);
    const uy = (p[b + 1] as number) - (p[a + 1] as number);
    const uz = (p[b + 2] as number) - (p[a + 2] as number);
    const wx = (p[c] as number) - (p[b] as number);
    const wy = (p[c + 1] as number) - (p[b + 1] as number);
    const wz = (p[c + 2] as number) - (p[b + 2] as number);
    const turn = (uy * wz - uz * wy) * nx + (uz * wx - ux * wz) * ny + (ux * wy - uy * wx) * nz;
    // A straight corner (collinear) is not reflex: the tolerance is relative to the two edges and the normal.
    const scale = Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz) * length;
    if (turn < -1e-9 * scale) return true;
  }
  return false;
}

/** The fan test of `EditMesh.isManifoldVert`, without the vertices of non-manifold edges (that code's own). */
function vertexProblem(m: EditMesh, v: number): boolean {
  const start = m.vertEdge(v);
  if (start === -1) return false;
  let e = start;
  let guard = 0;
  do {
    if (m.edgeFaceCount(e) > 2) return false;
    e = m.edgeDiskNext(e, v);
  } while (e !== start && ++guard <= m.counts.edges);
  return !m.isManifoldVert(v);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const MESSAGES: Readonly<Record<CheckCode, (n: number, domain: Domain) => string>> = {
  'non-manifold-edge': (n) => `${plural(n, 'edge has', 'edges have')} more than two faces`,
  'non-manifold-vertex': (n) => `${plural(n, 'vertex joins', 'vertices join')} faces that are not one fan`,
  lamina: (n) => `${plural(n, 'face duplicates', 'faces duplicate')} another face's vertices`,
  'zero-length-edge': (n) => `${plural(n, 'edge has', 'edges have')} no length`,
  'zero-area-face': (n) => `${plural(n, 'face has', 'faces have')} no area`,
  'inconsistent-winding': (n) =>
    `${plural(n, 'edge is', 'edges are')} walked the same way by both faces (inconsistent winding)`,
  'nonplanar-ngon': (n) => `${plural(n, 'n-gon is', 'n-gons are')} not planar`,
  'concave-ngon': (n) => `${plural(n, 'n-gon is', 'n-gons are')} concave`,
  'ngon-degenerate': (n) => `${plural(n, 'n-gon does', 'n-gons do')} not triangulate cleanly`,
  'stray-vertex': (n) => `${plural(n, 'vertex lies', 'vertices lie')} on a straight edge`,
  'loose-geometry': (n, domain) =>
    domain === 'point'
      ? `${plural(n, 'vertex has', 'vertices have')} no edges`
      : `${plural(n, 'edge has', 'edges have')} no faces`,
  'open-border': (n) => `${plural(n, 'border edge', 'border edges')} on a mesh that should be closed`,
  'duplicate-slot': (n) => `${plural(n, 'face uses', 'faces use')} a palette slot two swatches share`,
};
const ORDER: readonly CheckCode[] = [
  'non-manifold-edge',
  'non-manifold-vertex',
  'lamina',
  'zero-length-edge',
  'zero-area-face',
  'inconsistent-winding',
  'nonplanar-ngon',
  'concave-ngon',
  'ngon-degenerate',
  'stray-vertex',
  'loose-geometry',
  'open-border',
  'duplicate-slot',
];

/** §5.25 diagnostics; problems carry `code: CheckCode` and the matching elements. Visible elements only. */
export function checkMesh(input: EditMesh | MeshData, opts: CheckOptions = {}): readonly MeshProblem[] {
  if (input === null || typeof input !== 'object') throw kernelError('invalid-argument', 'checkMesh: no mesh');
  const m = isEditMesh(input) ? input : editMeshFrom(input);
  const hidden = opts.hidden ?? null;
  const visibleVert = (v: number): boolean => hidden === null || !hidden.verts.has(v);
  const visibleEdge = (e: number): boolean => hidden === null || !hidden.edges.has(e);
  const visibleFace = (f: number): boolean => hidden === null || !hidden.faces.has(f);
  const { points: P, edges: E, faces: F } = m.counts;
  const threshold = checkThreshold(m);
  const found = new Map<CheckCode, { domain: Domain; elements: number[] }[]>();
  const add = (code: CheckCode, domain: Domain, element: number): void => {
    const list = found.get(code) ?? [];
    let entry = list.find((x) => x.domain === domain);
    if (entry === undefined) {
      entry = { domain, elements: [] };
      list.push(entry);
      found.set(code, list);
    }
    entry.elements.push(element);
  };

  for (let e = 0; e < E; e++) {
    if (!visibleEdge(e)) continue;
    const faces = m.edgeFaceCount(e);
    if (faces > 2) add('non-manifold-edge', 'edge', e);
  }
  for (let v = 0; v < P; v++) if (visibleVert(v) && vertexProblem(m, v)) add('non-manifold-vertex', 'point', v);

  const corners: number[] = [];
  const groups = new Map<string, number[]>();
  for (let f = 0; f < F; f++) {
    if (!visibleFace(f)) continue;
    faceCorners(m, f, corners);
    const key = corners
      .map((c) => m.cornerVert(c))
      .sort((a, b) => a - b)
      .join(',');
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [f]);
    else group.push(f);
  }
  for (const group of groups.values()) for (const f of group.slice(1)) add('lamina', 'face', f);

  for (let e = 0; e < E; e++) {
    if (visibleEdge(e) && distance(m, m.edgeVert(e, 0), m.edgeVert(e, 1)) <= threshold)
      add('zero-length-edge', 'edge', e);
  }
  for (let f = 0; f < F; f++) {
    if (!visibleFace(f)) continue;
    faceCorners(m, f, corners);
    let longest = 0;
    for (let i = 0; i < corners.length; i++) {
      longest = Math.max(
        longest,
        distance(m, m.cornerVert(corners[i] as number), m.cornerVert(corners[(i + 1) % corners.length] as number)),
      );
    }
    const area = newellOf(m, corners) / 2;
    if (longest <= threshold || (2 * area) / longest <= threshold) add('zero-area-face', 'face', f);
  }
  for (let e = 0; e < E; e++) {
    if (!visibleEdge(e) || m.edgeFaceCount(e) !== 2) continue;
    const c = m.edgeCorner(e);
    if (m.cornerVert(c) === m.cornerVert(m.cornerRadialNext(c))) add('inconsistent-winding', 'edge', e);
  }
  for (let f = 0; f < F; f++) {
    if (!visibleFace(f) || m.faceLen(f) < 5) continue;
    faceCorners(m, f, corners);
    if (!isPlanar(m, corners)) add('nonplanar-ngon', 'face', f);
  }
  for (let f = 0; f < F; f++) {
    if (!visibleFace(f) || m.faceLen(f) < 5) continue;
    faceCorners(m, f, corners);
    if (hasReflexCorner(m, corners)) add('concave-ngon', 'face', f);
  }
  for (let f = 0; f < F; f++) {
    if (visibleFace(f) && m.faceLen(f) >= 5 && isDegenerateNgon(m, f)) add('ngon-degenerate', 'face', f);
  }
  const p = m.position;
  for (let v = 0; v < P; v++) {
    if (!visibleVert(v) || m.vertValence(v) !== 2) continue;
    const e0 = m.vertEdge(v);
    const e1 = m.edgeDiskNext(e0, v);
    const a = m.edgeOther(e0, v);
    const b = m.edgeOther(e1, v);
    const la = distance(m, v, a);
    const lb = distance(m, v, b);
    if (!(la > 0 && lb > 0)) continue;
    const dot =
      ((p[3 * a] as number) - (p[3 * v] as number)) * ((p[3 * b] as number) - (p[3 * v] as number)) +
      ((p[3 * a + 1] as number) - (p[3 * v + 1] as number)) * ((p[3 * b + 1] as number) - (p[3 * v + 1] as number)) +
      ((p[3 * a + 2] as number) - (p[3 * v + 2] as number)) * ((p[3 * b + 2] as number) - (p[3 * v + 2] as number));
    if (dot / (la * lb) <= STRAY_COS) add('stray-vertex', 'point', v);
  }
  for (let v = 0; v < P; v++) if (visibleVert(v) && m.vertEdge(v) === -1) add('loose-geometry', 'point', v);
  for (let e = 0; e < E; e++) if (visibleEdge(e) && m.edgeFaceCount(e) === 0) add('loose-geometry', 'edge', e);
  if (opts.closedExpected === true) {
    for (let e = 0; e < E; e++) if (visibleEdge(e) && m.edgeFaceCount(e) === 1) add('open-border', 'edge', e);
  }
  const slots = opts.duplicateSlots;
  if (slots !== undefined && slots.size > 0) {
    const paint = m.layer('paint');
    for (let f = 0; f < F; f++) {
      if (!visibleFace(f)) continue;
      const slot = paint === undefined ? 0 : paint.get(f, 0);
      if (slots.has(slot)) add('duplicate-slot', 'face', f);
    }
  }

  const problems: MeshProblem[] = [];
  for (const code of ORDER) {
    for (const { domain, elements } of found.get(code) ?? []) {
      elements.sort((a, b) => a - b);
      problems.push({
        code,
        message: MESSAGES[code](elements.length, domain),
        elements: Uint32Array.from(elements),
        domain,
      });
    }
  }
  return problems;
}
