// C4 (auto-skin; M6B-SPEC §4.2, §5.9): Bind Skin's pipeline over the welded points of one mesh — candidates and bone
// segments, islands, visibility, the four methods (`auto-lowpoly` with the island rule, `heat`, `rigid-islands`,
// `closest`), the point and joint masks, post-processing and the palette rules. Pure and deterministic (§3 rule 8):
// float64, typed arrays, no `Math.random`, ties to the smaller joint (palette) index, then the smaller point index.
import { EkzaError } from '@ekza-studio/anim-core';
import { closestWeights } from '../closest';
import { pointGraph, pointTriangles } from '../geometry/adjacency';
import { solveHeatIsland } from '../heat';
import { type Islands, skinIslands } from '../islands';
import { cotLaplacian } from '../laplacian';
import {
  keepLargest,
  MAX_INFLUENCES,
  type MirrorOrder,
  prune,
  rigidify,
  sortEntries,
  symmetrized,
  toFloat32,
  type WeightVector,
} from '../post';
import type {
  BindReport,
  CsrMatrix,
  SkinBindArgs,
  SkinGeometry,
  SkinPaletteEntry,
  SkinSkeleton,
  SkinWeights,
} from '../types';
import { boneSegments, nearestSegments, Occluder, type Segments, segmentClosest } from '../visibility';

/** §5.9 auto-lowpoly island rule thresholds (calibrated by C4's spike; docs/wp-notes/m6b-auto-skin.md). */
export const ISLAND_RULE: {
  /** Every vote within this tree distance of c … */
  readonly voteDistance: number;
  /** … and the island's extent along c's bone ≤ this × the bone length … */
  readonly extent: number;
  /** … or the island holds ≤ this fraction of the mesh's points. */
  readonly smallFraction: number;
} = Object.freeze({ voteDistance: 1, extent: 1.25, smallFraction: 0.02 });

/** Segments whose visibility is tested per point (§5.9 "Visibility"). */
const VISIBLE_TESTED = 3;

const now = (): number => globalThis.performance?.now() ?? Date.now();

/** Everything the methods share for one run. */
interface Context {
  readonly geom: SkinGeometry;
  readonly skeleton: SkinSkeleton;
  readonly P: number;
  readonly J: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly candidates: readonly number[];
  readonly children: readonly (readonly number[])[];
  readonly segs: Segments;
  /** Segment range per joint: `segStart[j]…segStart[j+1]`. */
  readonly segStart: Int32Array;
  readonly islands: Islands;
  /** Per point (3 slots): the nearest segments, their squared distances and visibility; −1 = none. */
  readonly near: Int32Array;
  readonly nearD2: Float64Array;
  readonly visible: Uint8Array;
  /** 1 once the point's queries ran. */
  readonly queried: Uint8Array;
  occluder: Occluder | null;
  incident: ReturnType<typeof pointTriangles> | null;
}

function makeContext(geom: SkinGeometry, skeleton: SkinSkeleton, candidate: Uint8Array): Context {
  const P = Math.floor(geom.positions.length / 3);
  const J = skeleton.keys.length;
  const height = skeleton.height > 0 && Number.isFinite(skeleton.height) ? skeleton.height : 1;
  const children: number[][] = Array.from({ length: J }, () => []);
  for (let j = 0; j < J; j++) {
    const p = skeleton.parent[j] as number;
    if (p >= 0 && p < J) (children[p] as number[]).push(j);
  }
  const candidates: number[] = [];
  for (let j = 0; j < J; j++) if (candidate[j] === 1) candidates.push(j);
  const segs = boneSegments(skeleton, candidate);
  const segStart = new Int32Array(J + 1);
  for (let s = 0; s < segs.count; s++) {
    const at = (segs.owner[s] as number) + 1;
    segStart[at] = (segStart[at] as number) + 1;
  }
  for (let j = 0; j < J; j++) segStart[j + 1] = (segStart[j + 1] as number) + (segStart[j] as number);
  return {
    geom,
    skeleton,
    P,
    J,
    height,
    candidate,
    candidates,
    children,
    segs,
    segStart,
    islands: skinIslands(geom),
    near: new Int32Array(VISIBLE_TESTED * P).fill(-1),
    nearD2: new Float64Array(VISIBLE_TESTED * P),
    visible: new Uint8Array(VISIBLE_TESTED * P),
    queried: new Uint8Array(P),
    occluder: null,
    incident: null,
  };
}

const scratchQ = new Float64Array(3);

/** Runs the nearest-segment and visibility queries of point v once. */
function query(ctx: Context, v: number): void {
  if (ctx.queried[v] === 1) return;
  ctx.queried[v] = 1;
  const p = ctx.geom.positions;
  const px = p[3 * v] as number;
  const py = p[3 * v + 1] as number;
  const pz = p[3 * v + 2] as number;
  const index = ctx.near.subarray(VISIBLE_TESTED * v, VISIBLE_TESTED * v + VISIBLE_TESTED);
  const d2 = ctx.nearD2.subarray(VISIBLE_TESTED * v, VISIBLE_TESTED * v + VISIBLE_TESTED);
  const n = nearestSegments(ctx.segs, px, py, pz, VISIBLE_TESTED, index, d2, scratchQ);
  ctx.occluder ??= new Occluder(ctx.geom);
  ctx.incident ??= pointTriangles(ctx.geom);
  const nrm = ctx.geom.normals;
  const off = 1e-4 * ctx.height;
  const ox = px + off * (nrm[3 * v] as number);
  const oy = py + off * (nrm[3 * v + 1] as number);
  const oz = pz + off * (nrm[3 * v + 2] as number);
  for (let k = 0; k < n; k++) {
    segmentClosest(ctx.segs, index[k] as number, px, py, pz, scratchQ);
    const hidden = ctx.occluder.occluded(
      ox,
      oy,
      oz,
      (scratchQ[0] as number) - ox,
      (scratchQ[1] as number) - oy,
      (scratchQ[2] as number) - oz,
      ctx.incident.tris,
      ctx.incident.start[v] as number,
      ctx.incident.start[v + 1] as number,
    );
    ctx.visible[VISIBLE_TESTED * v + k] = hidden ? 0 : 1;
  }
}

/** The joint of v's nearest visible segment, else of its nearest segment (the auto-lowpoly vote, closest's j*). */
function vote(ctx: Context, v: number): number {
  query(ctx, v);
  const base = VISIBLE_TESTED * v;
  for (let k = 0; k < VISIBLE_TESTED; k++) {
    const s = ctx.near[base + k] as number;
    if (s < 0) break;
    if (ctx.visible[base + k] === 1) return ctx.segs.owner[s] as number;
  }
  return ctx.segs.owner[ctx.near[base] as number] as number;
}

/** True when v sees at least one of its tested segments. */
function seesAny(ctx: Context, v: number): boolean {
  query(ctx, v);
  for (let k = 0; k < VISIBLE_TESTED; k++) if (ctx.visible[VISIBLE_TESTED * v + k] === 1) return true;
  return false;
}

/** Distance from a position to joint j's nearest segment (∞ for a joint without segments). */
function jointDistance(ctx: Context, j: number, x: number, y: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let s = ctx.segStart[j] as number; s < (ctx.segStart[j + 1] as number); s++) {
    const d2 = segmentClosest(ctx.segs, s, x, y, z, scratchQ);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** The candidate joint whose segment is nearest a position (ties: smaller joint index). */
function nearestJoint(ctx: Context, x: number, y: number, z: number): number {
  let best = -1;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (let s = 0; s < ctx.segs.count; s++) {
    const d2 = segmentClosest(ctx.segs, s, x, y, z, scratchQ);
    const owner = ctx.segs.owner[s] as number;
    if (d2 < bestD2 || (d2 === bestD2 && owner < best)) {
      bestD2 = d2;
      best = owner;
    }
  }
  return best;
}

function islandCentreJoint(ctx: Context, island: number): number {
  const c = ctx.islands.centroid;
  return nearestJoint(ctx, c[3 * island] as number, c[3 * island + 1] as number, c[3 * island + 2] as number);
}

/** Edges between two joints of the skeleton tree (∞ across roots). */
function treeDistance(parent: Int32Array, a: number, b: number): number {
  if (a === b) return 0;
  const depth = new Map<number, number>();
  for (let j = a, d = 0; j >= 0 && d <= parent.length; j = parent[j] as number, d++) depth.set(j, d);
  for (let j = b, d = 0; j >= 0 && d <= parent.length; j = parent[j] as number, d++) {
    const up = depth.get(j);
    if (up !== undefined) return up + d;
  }
  return Number.POSITIVE_INFINITY;
}

/** §5.9 auto-lowpoly: rigid on c when every vote is within tree distance 1 of c and the island is short or small. */
function islandIsRigid(ctx: Context, island: number, c: number): boolean {
  const { start, points } = ctx.islands;
  const s = start[island] as number;
  const e = start[island + 1] as number;
  const parent = ctx.skeleton.parent;
  for (let k = s; k < e; k++) {
    const v = vote(ctx, points[k] as number);
    if (treeDistance(parent, v, c) > ISLAND_RULE.voteDistance) return false;
  }
  if (e - s <= ISLAND_RULE.smallFraction * ctx.P) return true;
  const h = ctx.skeleton.head;
  const t = ctx.skeleton.tail;
  const dx = (t[3 * c] as number) - (h[3 * c] as number);
  const dy = (t[3 * c + 1] as number) - (h[3 * c + 1] as number);
  const dz = (t[3 * c + 2] as number) - (h[3 * c + 2] as number);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 0)) return false;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const p = ctx.geom.positions;
  for (let k = s; k < e; k++) {
    const v = points[k] as number;
    const proj = ((p[3 * v] as number) * dx + (p[3 * v + 1] as number) * dy + (p[3 * v + 2] as number) * dz) / len;
    if (proj < lo) lo = proj;
    if (proj > hi) hi = proj;
  }
  return hi - lo <= ISLAND_RULE.extent * len;
}

/** Heat sources of a point the solve re-weights: C(v), H_vv (unscaled) — §5.9 `heat`. */
function heatSource(
  ctx: Context,
  v: number,
  stiffness: number,
): { readonly h: number; readonly joints: number[]; readonly values: number[] } {
  query(ctx, v);
  const p = ctx.geom.positions;
  const nrm = ctx.geom.normals;
  const px = p[3 * v] as number;
  const py = p[3 * v + 1] as number;
  const pz = p[3 * v + 2] as number;
  const base = VISIBLE_TESTED * v;
  // Modified distance per visible segment, min per joint.
  const joints: number[] = [];
  const dists: number[] = [];
  for (let k = 0; k < VISIBLE_TESTED; k++) {
    const s = ctx.near[base + k] as number;
    if (s < 0) break;
    if (ctx.visible[base + k] !== 1) continue;
    const d2 = segmentClosest(ctx.segs, s, px, py, pz, scratchQ);
    const d = Math.sqrt(d2);
    let cos = 1;
    if (d > 0) {
      cos =
        ((px - (scratchQ[0] as number)) * (nrm[3 * v] as number) +
          (py - (scratchQ[1] as number)) * (nrm[3 * v + 1] as number) +
          (pz - (scratchQ[2] as number)) * (nrm[3 * v + 2] as number)) /
        d;
    }
    const dm = d / (0.5 * (cos + 1.001));
    const owner = ctx.segs.owner[s] as number;
    const at = joints.indexOf(owner);
    if (at < 0) {
      joints.push(owner);
      dists.push(dm);
    } else if (dm < (dists[at] as number)) dists[at] = dm;
  }
  if (joints.length === 0) return { h: 0, joints: [], values: [] };
  let min = Number.POSITIVE_INFINITY;
  for (const d of dists) if (d < min) min = d;
  const chosen: number[] = [];
  for (let k = 0; k < joints.length; k++)
    if ((dists[k] as number) <= min * (1 + 1e-4)) chosen.push(joints[k] as number);
  chosen.sort((a, b) => a - b);
  const floor = 1e-4 * ctx.height;
  const m = Math.max(min, floor);
  return { h: (chosen.length * stiffness) / (m * m), joints: chosen, values: chosen.map(() => 1 / chosen.length) };
}

/** The dominant joint of a vector (largest weight; ties: smaller rank), or −1. */
function dominant(vec: WeightVector | null, rank: ArrayLike<number>): number {
  if (vec === null || vec.joints.length === 0) return -1;
  let best = 0;
  for (let k = 1; k < vec.joints.length; k++) {
    const w = vec.weights[k] as number;
    const bw = vec.weights[best] as number;
    if (
      w > bw ||
      (w === bw && (rank[vec.joints[k] as number] as number) < (rank[vec.joints[best] as number] as number))
    ) {
      best = k;
    }
  }
  return vec.joints[best] as number;
}

/** Pure and deterministic; runs in the skin worker (browser) or synchronously (Node). `previous` supplies the weights
 *  of points outside `args.points`. A full run's palette lists only joints with weight, in skeleton order; a masked
 *  run keeps `previous`'s palette and appends new joints (palette order rule above). `args.symmetrize` is a boolean. */
export function bindSkin(
  geom: SkinGeometry,
  skeleton: SkinSkeleton,
  args: SkinBindArgs & { readonly symmetrize: boolean },
  previous: SkinWeights | null,
): { readonly skin: SkinWeights; readonly report: BindReport } {
  const started = now();
  const P = Math.floor(geom.positions.length / 3);
  const J = skeleton.keys.length;
  if (previous !== null && previous.points !== P) {
    throw new EkzaError('invalid-input', `bindSkin: previous has ${previous.points} points, the mesh ${P}`);
  }
  const masked = args.points !== null;
  const solve = new Uint8Array(P);
  if (args.points === null) solve.fill(1);
  else for (const v of args.points) if (Number.isInteger(v) && v >= 0 && v < P) solve[v] = 1;

  // ---------- candidates ----------
  const keyIndex = new Map<string, number>();
  skeleton.keys.forEach((key, j) => {
    if (!keyIndex.has(key)) keyIndex.set(key, j);
  });
  const candidate = new Uint8Array(J);
  if (args.joints === null) for (let j = 0; j < J; j++) candidate[j] = skeleton.deform[j] === 1 ? 1 : 0;
  else {
    for (const key of args.joints) {
      const j = keyIndex.get(key);
      if (j !== undefined) candidate[j] = 1;
    }
  }
  if (!candidate.includes(1)) {
    throw new EkzaError('skin.empty-mask', 'Bind Skin needs at least one joint to bind to');
  }

  // ---------- the joint space: the skeleton's joints, then the previous palette's other keys ----------
  const prevPalette: readonly SkinPaletteEntry[] = masked && previous !== null ? previous.palette : [];
  const extKeys = [...skeleton.keys];
  const prevToExt = prevPalette.map((entry) => {
    const j = keyIndex.get(entry.key);
    if (j !== undefined) return j;
    extKeys.push(entry.key);
    return extKeys.length - 1;
  });
  const E = extKeys.length;
  const mirror = new Int32Array(E);
  for (let j = 0; j < E; j++) {
    const m = j < J ? (skeleton.mirror[j] as number) : -1;
    mirror[j] = m >= 0 && m < J ? m : j;
  }
  // Ties go to the smaller palette index: a full run's palette is in skeleton order; a masked run's is the previous
  // palette, then the appended joints in skeleton order.
  const rank = new Float64Array(E);
  if (!masked) for (let j = 0; j < E; j++) rank[j] = j;
  else {
    for (let j = 0; j < E; j++) rank[j] = prevPalette.length + j;
    prevToExt.forEach((ext, i) => {
      if (rank[ext] === prevPalette.length + ext) rank[ext] = i;
    });
  }
  const prevVector = (v: number): WeightVector | null => {
    if (!masked || previous === null) return null;
    const joints: number[] = [];
    const weights: number[] = [];
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const w = previous.weights[4 * v + k] as number;
      if (!(w > 0)) continue;
      const ext = prevToExt[previous.joints[4 * v + k] as number];
      if (ext === undefined) continue;
      joints.push(ext);
      weights.push(w);
    }
    return { joints, weights };
  };

  const ctx = makeContext(geom, skeleton, candidate);
  const { islands } = ctx;
  const raw: (WeightVector | null)[] = Array.from({ length: P }, () => null);
  const unreachable: number[] = [];
  let rigidIslands = 0;
  let heatIslands = 0;
  let cgIterations = 0;
  let laplacian: CsrMatrix | null = null;
  let local: Int32Array | null = null;

  const rigidOn = (island: number, joint: number): void => {
    for (let k = islands.start[island] as number; k < (islands.start[island + 1] as number); k++) {
      const v = islands.points[k] as number;
      if (solve[v] === 1) raw[v] = { joints: [joint], weights: [1] };
    }
  };

  const heat = (island: number): boolean => {
    laplacian ??= cotLaplacian(geom, { clamp: true });
    local ??= new Int32Array(P).fill(-1);
    const s = islands.start[island] as number;
    const e = islands.start[island + 1] as number;
    const pts = islands.points.subarray(s, e);
    const n = e - s;
    const h = new Float64Array(n);
    const joints: number[][] = [];
    const values: number[][] = [];
    for (let i = 0; i < n; i++) {
      const v = pts[i] as number;
      if (solve[v] === 1) {
        const src = heatSource(ctx, v, args.stiffness);
        h[i] = src.h;
        joints.push(src.joints);
        values.push(src.values);
        continue;
      }
      // §5.9 step 4: a point outside the mask is a source of value 1 on its dominant joint.
      const d = dominant(prevVector(v), rank);
      if (d < 0) {
        joints.push([]);
        values.push([]);
        continue;
      }
      const p = geom.positions;
      const x = p[3 * v] as number;
      const y = p[3 * v + 1] as number;
      const z = p[3 * v + 2] as number;
      query(ctx, v);
      let dist =
        d < J && candidate[d] === 1
          ? jointDistance(ctx, d, x, y, z)
          : Math.sqrt(ctx.nearD2[VISIBLE_TESTED * v] as number);
      if (!Number.isFinite(dist)) dist = 0;
      const m = Math.max(dist, 1e-4 * ctx.height);
      h[i] = args.stiffness / (m * m);
      joints.push([d]);
      values.push([1]);
    }
    const result = solveHeatIsland(pts, laplacian, { h, joints, values }, local);
    if (result === null) return false;
    cgIterations += result.iterations;
    const k = result.joints.length;
    for (let i = 0; i < n; i++) {
      const v = pts[i] as number;
      if (solve[v] !== 1) continue;
      const vec: WeightVector = { joints: [], weights: [] };
      for (let c = 0; c < k; c++) {
        const w = result.w[i * k + c] as number;
        if (w > 0) {
          vec.joints.push(result.joints[c] as number);
          vec.weights.push(w);
        }
      }
      raw[v] = vec.joints.length > 0 ? vec : { joints: [vote(ctx, v)], weights: [1] };
    }
    return true;
  };

  const single = ctx.candidates.length === 1 ? (ctx.candidates[0] as number) : -1;
  for (let island = 0; island < islands.count; island++) {
    const s = islands.start[island] as number;
    const e = islands.start[island + 1] as number;
    let any = false;
    for (let k = s; k < e; k++) if (solve[islands.points[k] as number] === 1) any = true;
    if (!any) continue;
    if (single >= 0) {
      // One joint = rigid attach (§5.9: hats, helmets, props).
      rigidOn(island, single);
      rigidIslands++;
      continue;
    }
    switch (args.method) {
      case 'rigid-islands':
        rigidOn(island, islandCentreJoint(ctx, island));
        rigidIslands++;
        break;
      case 'closest': {
        const p = geom.positions;
        for (let k = s; k < e; k++) {
          const v = islands.points[k] as number;
          if (solve[v] !== 1) continue;
          const x = p[3 * v] as number;
          const y = p[3 * v + 1] as number;
          const z = p[3 * v + 2] as number;
          raw[v] = closestWeights({
            best: vote(ctx, v),
            distance: (j) => jointDistance(ctx, j, x, y, z),
            candidates: ctx.candidates,
            parent: skeleton.parent,
            children: ctx.children,
            isCandidate: candidate,
            hierarchy: args.hierarchy,
            dropoff: args.dropoff,
            floor: 1e-4 * ctx.height,
          });
        }
        break;
      }
      case 'heat':
      case 'auto-lowpoly': {
        const c = islandCentreJoint(ctx, island);
        if (args.method === 'auto-lowpoly' && islandIsRigid(ctx, island, c)) {
          rigidOn(island, c);
          rigidIslands++;
          break;
        }
        let sees = false;
        for (let k = s; k < e && !sees; k++) sees = seesAny(ctx, islands.points[k] as number);
        if (sees && heat(island)) {
          heatIslands++;
          break;
        }
        // An island that sees no joint: rigid on the nearest-centroid joint, reported (skin.unreachable-island).
        rigidOn(island, c);
        rigidIslands++;
        for (let k = s; k < e; k++) unreachable.push(islands.points[k] as number);
        break;
      }
    }
  }

  // ---------- post-processing (§5.9 step 3) ----------
  const stage1: (WeightVector | null)[] = Array.from({ length: P }, () => null);
  for (let v = 0; v < P; v++) {
    if (solve[v] !== 1) {
      stage1[v] = prevVector(v);
      continue;
    }
    const input = raw[v] as WeightVector;
    const vec: WeightVector = { joints: [...input.joints], weights: [...input.weights] };
    prune(vec, args.pruneBelow);
    if (!keepLargest(vec, rank)) {
      // Everything pruned (many tiny heat weights): the largest raw weight alone.
      const sorted: WeightVector = { joints: [...input.joints], weights: [...input.weights] };
      sortEntries(sorted, rank);
      vec.joints = [sorted.joints[0] as number];
      vec.weights = [1];
    }
    stage1[v] = vec;
  }
  const final: (WeightVector | null)[] = stage1.slice();
  // P-S4: a symmetrized point orders, cuts, rigidifies and rounds mirror-aware; v and p(v) take opposite sides.
  const orders: (MirrorOrder | undefined)[] = Array.from({ length: P }, () => undefined);
  if (args.symmetrize) {
    for (let v = 0; v < P; v++) {
      if (solve[v] !== 1) continue;
      const u = geom.partner[v] as number;
      if (u < 0 || u >= P) continue;
      const own = stage1[v] as WeightVector;
      const other = stage1[u] ?? { joints: [], weights: [] };
      const sym = symmetrized(own, other, mirror);
      const order: MirrorOrder = { mirror, flip: u < v, seam: u === v };
      if (keepLargest(sym, rank, order)) {
        final[v] = sym;
        orders[v] = order;
      }
    }
  }

  // ---------- write: rigidify, f32, palette ----------
  const out: { joints: number[]; weights: number[] }[] = [];
  const used = new Uint8Array(E);
  for (let v = 0; v < P; v++) {
    if (solve[v] !== 1) {
      out.push({ joints: [], weights: [] });
      continue;
    }
    const vec = final[v] as WeightVector;
    const order = orders[v];
    sortEntries(vec, rank, order);
    rigidify(vec, args.rigidifyAbove, order);
    const weights = toFloat32(vec, order);
    out.push({ joints: vec.joints, weights });
    for (const j of vec.joints) used[j] = 1;
  }
  let palette: SkinPaletteEntry[];
  const paletteIndex = new Int32Array(E).fill(-1);
  const entryOf = (j: number): SkinPaletteEntry => {
    const parent = skeleton.parent[j] as number;
    const m = skeleton.mirror[j] as number;
    return {
      key: skeleton.keys[j] as string,
      parent: parent >= 0 && parent < J ? (skeleton.keys[parent] as string) : null,
      mirror: m >= 0 && m < J && m !== j ? (skeleton.keys[m] as string) : null,
    };
  };
  if (!masked) {
    palette = [];
    for (let j = 0; j < J; j++) {
      if (used[j] !== 1) continue;
      paletteIndex[j] = palette.length;
      palette.push(entryOf(j));
    }
  } else {
    palette = [...prevPalette];
    prevToExt.forEach((ext, i) => {
      if (paletteIndex[ext] === -1) paletteIndex[ext] = i;
    });
    for (let j = 0; j < J; j++) {
      if (used[j] !== 1 || paletteIndex[j] !== -1) continue;
      paletteIndex[j] = palette.length;
      palette.push(entryOf(j));
    }
  }
  const jointsOut = new Uint16Array(4 * P);
  const weightsOut = new Float32Array(4 * P);
  for (let v = 0; v < P; v++) {
    if (solve[v] !== 1) {
      if (previous !== null) {
        for (let k = 0; k < 4; k++) {
          jointsOut[4 * v + k] = previous.joints[4 * v + k] as number;
          weightsOut[4 * v + k] = previous.weights[4 * v + k] as number;
        }
      }
      continue;
    }
    const row = out[v] as { joints: number[]; weights: number[] };
    const entries = row.joints.map((j, k) => ({ index: paletteIndex[j] as number, w: row.weights[k] as number }));
    entries.sort((a, b) => b.w - a.w || a.index - b.index);
    entries.forEach((entry, k) => {
      jointsOut[4 * v + k] = entry.index;
      weightsOut[4 * v + k] = entry.w;
    });
  }
  return {
    skin: { points: P, palette, joints: jointsOut, weights: weightsOut },
    report: {
      islands: islands.count,
      rigidIslands,
      heatIslands,
      unreachable: Uint32Array.from(unreachable.sort((a, b) => a - b)),
      cgIterations,
      solveMs: now() - started,
    },
  };
}

/** Auto Weights for Selected Joints (§5.9 "Adding influences"): the points to re-solve for `joints` — points whose
 *  nearest visible segment, over every deforming joint plus `joints`, belongs to one of `joints`, grown by one ring of
 *  the point graph; ascending. */
export function autoWeightPoints(geom: SkinGeometry, skeleton: SkinSkeleton, joints: readonly string[]): Uint32Array {
  const J = skeleton.keys.length;
  const P = Math.floor(geom.positions.length / 3);
  const wanted = new Uint8Array(J);
  const candidate = new Uint8Array(J);
  for (let j = 0; j < J; j++) candidate[j] = skeleton.deform[j] === 1 ? 1 : 0;
  const keys = new Set(joints);
  for (let j = 0; j < J; j++) {
    if (keys.has(skeleton.keys[j] as string)) {
      wanted[j] = 1;
      candidate[j] = 1;
    }
  }
  if (!wanted.includes(1) || P === 0) return new Uint32Array(0);
  const ctx = makeContext(geom, skeleton, candidate);
  const hit = new Uint8Array(P);
  for (let v = 0; v < P; v++) if (wanted[vote(ctx, v)] === 1) hit[v] = 1;
  const graph = pointGraph(geom);
  const grown = hit.slice();
  for (let v = 0; v < P; v++) {
    if (hit[v] !== 1) continue;
    for (let k = graph.start[v] as number; k < (graph.start[v + 1] as number); k++) grown[graph.next[k] as number] = 1;
  }
  const out: number[] = [];
  for (let v = 0; v < P; v++) if (grown[v] === 1) out.push(v);
  return Uint32Array.from(out);
}
