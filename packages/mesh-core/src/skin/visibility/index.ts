// C4 (auto-skin; M6B-SPEC §5.9 step 2 "Visibility"): the bone segments of the candidate joints, point-to-segment
// queries and the occlusion test — a point sees a segment when the ray from `v + 1e-4 H · n` to the closest point on
// the segment hits no triangle of the mesh except the triangles incident to `v`.
//
// The occlusion test is an any-hit query over a private bounding-volume hierarchy with the reference TriangleBvh's
// Möller–Trumbore predicate (inclusive edges, 0 < t ≤ 1): a boolean answer, so it equals `TriangleBvh.raycast(…, 0,
// 1, ignore) !== null` of the reference (and of C2's BVH, which reproduces it) whatever the traversal order (§3 rule 8).
// It is private because the solvers need only the boolean and the reference is O(triangles) per ray (the bind
// benches cast 30k rays).
import type { SkinGeometry, SkinSkeleton } from '../types';

/** Bone segments of the candidate joints: joint head → each child head; a leaf: head → tail (§5.9 step 1). */
export interface Segments {
  readonly count: number;
  /** Skeleton index of the joint owning each segment. */
  readonly owner: Int32Array;
  readonly a: Float64Array;
  readonly b: Float64Array;
}

/** `candidate[j]` = 1 for the joints whose segments count. Segments follow joint order, then child order. */
export function boneSegments(skeleton: SkinSkeleton, candidate: Uint8Array): Segments {
  const J = skeleton.keys.length;
  const children: number[][] = Array.from({ length: J }, () => []);
  for (let j = 0; j < J; j++) {
    const p = skeleton.parent[j] as number;
    if (p >= 0 && p < J) (children[p] as number[]).push(j);
  }
  const owner: number[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const head = skeleton.head;
  for (let j = 0; j < J; j++) {
    if (candidate[j] !== 1) continue;
    const kids = children[j] as number[];
    const ends: (readonly [number, number, number])[] =
      kids.length > 0
        ? kids.map((c) => [head[3 * c] as number, head[3 * c + 1] as number, head[3 * c + 2] as number] as const)
        : [[skeleton.tail[3 * j] as number, skeleton.tail[3 * j + 1] as number, skeleton.tail[3 * j + 2] as number]];
    for (const end of ends) {
      owner.push(j);
      a.push(head[3 * j] as number, head[3 * j + 1] as number, head[3 * j + 2] as number);
      b.push(end[0], end[1], end[2]);
    }
  }
  return { count: owner.length, owner: Int32Array.from(owner), a: Float64Array.from(a), b: Float64Array.from(b) };
}

/** Squared distance from p to segment s and the closest point (written to `out`). */
export function segmentClosest(
  seg: Segments,
  s: number,
  px: number,
  py: number,
  pz: number,
  out: Float64Array,
): number {
  const ax = seg.a[3 * s] as number;
  const ay = seg.a[3 * s + 1] as number;
  const az = seg.a[3 * s + 2] as number;
  const dx = (seg.b[3 * s] as number) - ax;
  const dy = (seg.b[3 * s + 1] as number) - ay;
  const dz = (seg.b[3 * s + 2] as number) - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  const qz = az + t * dz;
  out[0] = qx;
  out[1] = qy;
  out[2] = qz;
  const ex = px - qx;
  const ey = py - qy;
  const ez = pz - qz;
  return ex * ex + ey * ey + ez * ez;
}

/** The `count` nearest segments of a point by distance (ties: smaller segment index), written to `out`. */
export function nearestSegments(
  seg: Segments,
  px: number,
  py: number,
  pz: number,
  count: number,
  outIndex: Int32Array,
  outD2: Float64Array,
  scratch: Float64Array,
): number {
  let n = 0;
  for (let s = 0; s < seg.count; s++) {
    const d2 = segmentClosest(seg, s, px, py, pz, scratch);
    // insertion into the sorted top list (strictly smaller wins, so earlier segments win ties)
    if (n === count && d2 >= (outD2[n - 1] as number)) continue;
    let k = n < count ? n++ : n - 1;
    while (k > 0 && d2 < (outD2[k - 1] as number)) {
      outD2[k] = outD2[k - 1] as number;
      outIndex[k] = outIndex[k - 1] as number;
      k--;
    }
    outD2[k] = d2;
    outIndex[k] = s;
  }
  return n;
}

// ---------- occlusion ----------

const LEAF = 4;

/**
 * The far end of the visibility ray is open: a triangle through the bone point itself (a box face flush with the
 * bone, e.g. a limb box abutting the torso at the shoulder) does not hide the bone (M6B-C4-4).
 */
const VISIBLE_END = 1 - 1e-6;

/** Clips the parameter interval `span` = [t0, t1] to one slab of a box; false when it becomes empty. */
function slab(span: Float64Array, lo: number, hi: number, origin: number, inv: number): boolean {
  if (!Number.isFinite(inv)) return origin >= lo && origin <= hi;
  let a = (lo - origin) * inv;
  let c = (hi - origin) * inv;
  if (a > c) {
    const s = a;
    a = c;
    c = s;
  }
  // Slack so a hit on the box boundary (inclusive triangle edges) is never culled.
  const eps = 1e-9 * (Math.abs(a) + Math.abs(c) + 1);
  if (a - eps > (span[0] as number)) span[0] = a - eps;
  if (c + eps < (span[1] as number)) span[1] = c + eps;
  return (span[0] as number) <= (span[1] as number);
}

/** Any-hit ray queries over the mesh's triangles (see the file header). */
export class Occluder {
  private readonly p: Float64Array;
  private readonly tris: Uint32Array;
  /** Node boxes (6 per node: min xyz, max xyz). */
  private readonly box: Float64Array;
  /** Per node: left child (inner) or −(first leaf slot + 1) (leaf). */
  private readonly left: Int32Array;
  private readonly right: Int32Array;
  /** Leaf triangle order. */
  private readonly order: Int32Array;
  private readonly leafCount: Int32Array;

  constructor(geom: SkinGeometry) {
    this.p = geom.positions;
    this.tris = geom.tris;
    const T = Math.floor(geom.tris.length / 3);
    const centre = new Float64Array(3 * T);
    const tb = new Float64Array(6 * T);
    for (let t = 0; t < T; t++) {
      for (let d = 0; d < 3; d++) {
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        for (let k = 0; k < 3; k++) {
          const v = this.p[3 * (geom.tris[3 * t + k] as number) + d] as number;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        tb[6 * t + d] = lo;
        tb[6 * t + 3 + d] = hi;
        centre[3 * t + d] = (lo + hi) / 2;
      }
    }
    const order = new Int32Array(T);
    for (let t = 0; t < T; t++) order[t] = t;
    const maxNodes = Math.max(1, 2 * Math.ceil(T / LEAF) + 1);
    const box = new Float64Array(6 * maxNodes * 2);
    const left = new Int32Array(maxNodes * 2);
    const right = new Int32Array(maxNodes * 2);
    const leafCount = new Int32Array(maxNodes * 2);
    let nodes = 0;
    const build = (lo: number, hi: number): number => {
      const node = nodes++;
      let minx = Number.POSITIVE_INFINITY;
      let miny = Number.POSITIVE_INFINITY;
      let minz = Number.POSITIVE_INFINITY;
      let maxx = Number.NEGATIVE_INFINITY;
      let maxy = Number.NEGATIVE_INFINITY;
      let maxz = Number.NEGATIVE_INFINITY;
      let cminx = Number.POSITIVE_INFINITY;
      let cminy = Number.POSITIVE_INFINITY;
      let cminz = Number.POSITIVE_INFINITY;
      let cmaxx = Number.NEGATIVE_INFINITY;
      let cmaxy = Number.NEGATIVE_INFINITY;
      let cmaxz = Number.NEGATIVE_INFINITY;
      for (let i = lo; i < hi; i++) {
        const t = order[i] as number;
        minx = Math.min(minx, tb[6 * t] as number);
        miny = Math.min(miny, tb[6 * t + 1] as number);
        minz = Math.min(minz, tb[6 * t + 2] as number);
        maxx = Math.max(maxx, tb[6 * t + 3] as number);
        maxy = Math.max(maxy, tb[6 * t + 4] as number);
        maxz = Math.max(maxz, tb[6 * t + 5] as number);
        cminx = Math.min(cminx, centre[3 * t] as number);
        cminy = Math.min(cminy, centre[3 * t + 1] as number);
        cminz = Math.min(cminz, centre[3 * t + 2] as number);
        cmaxx = Math.max(cmaxx, centre[3 * t] as number);
        cmaxy = Math.max(cmaxy, centre[3 * t + 1] as number);
        cmaxz = Math.max(cmaxz, centre[3 * t + 2] as number);
      }
      box.set([minx, miny, minz, maxx, maxy, maxz], 6 * node);
      if (hi - lo <= LEAF) {
        left[node] = -(lo + 1);
        leafCount[node] = hi - lo;
        return node;
      }
      const ex = cmaxx - cminx;
      const ey = cmaxy - cminy;
      const ez = cmaxz - cminz;
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const slice = Array.from(order.subarray(lo, hi));
      slice.sort((u, v) => (centre[3 * u + axis] as number) - (centre[3 * v + axis] as number) || u - v);
      order.set(slice, lo);
      const mid = (lo + hi) >> 1;
      const l = build(lo, mid);
      const r = build(mid, hi);
      left[node] = l;
      right[node] = r;
      return node;
    };
    if (T > 0) build(0, T);
    this.box = box;
    this.left = left;
    this.right = right;
    this.order = order;
    this.leafCount = leafCount;
  }

  /**
   * True when the segment o → o + dir (0 < t ≤ 1) hits a triangle outside `ignore` (incident triangles of the ray's
   * point: `ignore[start…end]`, any order).
   */
  occluded(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    ignore: Int32Array,
    start: number,
    end: number,
  ): boolean {
    if (this.order.length === 0) return false;
    const ix = 1 / dx;
    const iy = 1 / dy;
    const iz = 1 / dz;
    const stack: number[] = [0];
    while (stack.length > 0) {
      const node = stack.pop() as number;
      if (!this.hitsBox(node, ox, oy, oz, ix, iy, iz)) continue;
      const l = this.left[node] as number;
      if (l < 0) {
        const first = -l - 1;
        const n = this.leafCount[node] as number;
        for (let i = first; i < first + n; i++) {
          const tri = this.order[i] as number;
          let skip = false;
          for (let k = start; k < end; k++) {
            if (ignore[k] === tri) {
              skip = true;
              break;
            }
          }
          if (!skip && this.hits(tri, ox, oy, oz, dx, dy, dz)) return true;
        }
        continue;
      }
      stack.push(this.right[node] as number, l);
    }
    return false;
  }

  private hitsBox(node: number, ox: number, oy: number, oz: number, ix: number, iy: number, iz: number): boolean {
    const b = this.box;
    const o = 6 * node;
    const span = this.slab;
    span[0] = 0;
    span[1] = 1;
    return (
      slab(span, b[o] as number, b[o + 3] as number, ox, ix) &&
      slab(span, b[o + 1] as number, b[o + 4] as number, oy, iy) &&
      slab(span, b[o + 2] as number, b[o + 5] as number, oz, iz)
    );
  }

  private readonly slab = new Float64Array(2);

  /** The reference Möller–Trumbore test (inclusive edges) restricted to 0 < t ≤ 1. */
  private hits(tri: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
    const P = this.p;
    const a = 3 * (this.tris[3 * tri] as number);
    const b = 3 * (this.tris[3 * tri + 1] as number);
    const c = 3 * (this.tris[3 * tri + 2] as number);
    const ax = P[a] as number;
    const ay = P[a + 1] as number;
    const az = P[a + 2] as number;
    const e1x = (P[b] as number) - ax;
    const e1y = (P[b + 1] as number) - ay;
    const e1z = (P[b + 2] as number) - az;
    const e2x = (P[c] as number) - ax;
    const e2y = (P[c + 1] as number) - ay;
    const e2z = (P[c + 2] as number) - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det === 0 || !Number.isFinite(det)) return false;
    const inv = 1 / det;
    const sx = ox - ax;
    const sy = oy - ay;
    const sz = oz - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return false;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return false;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 0 && t < VISIBLE_END;
  }
}
