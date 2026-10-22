// Triangle queries over a bounding volume hierarchy (M6B-SPEC §4.2; C2): a median-split AABB tree whose answers are
// **identical** to the brute-force reference (`reference.ts`) — the same hits in the same order with the same ties,
// the same closest triangle, barycentrics and distance — because every triangle test is the reference's own
// (`triangle.ts`) and the tree only prunes. Node boxes are padded by a small relative margin so the float slab test
// never rejects a box whose triangle the exact test hits. Deterministic build (ties of the median sort by triangle
// index), no `Math.random`, no float-keyed maps (§3 rule 8).
import type { ReadonlyVec3 } from '@ekza-studio/anim-core';
import type { RayHit, TriangleQueries } from '../skin/types';
import { closestOnTriangle, intersectTriangle } from './triangle';

/** Triangles per leaf. */
const LEAF = 4;

type Closest = { readonly tri: number; readonly bary: readonly [number, number, number]; readonly distance: number };

export class TriangleBvh implements TriangleQueries {
  /** Character-space positions (3 per point) and triangles (point indices × 3), as given (never copied). */
  readonly positions: Float64Array;
  readonly tris: Uint32Array;
  readonly triangles: number;
  /** Triangle indices in leaf order. */
  private readonly order: Uint32Array;
  /** Six numbers per node (min xyz, max xyz), padded. */
  private readonly boxes: Float64Array;
  /** Inner node: the right child (the left child is node + 1). Leaf: the first index into `order`. */
  private readonly first: Int32Array;
  /** Leaf: its triangle count (> 0). Inner node: 0. */
  private readonly count: Int32Array;
  private readonly nodeCount: number;
  private readonly min: readonly [number, number, number];
  private readonly max: readonly [number, number, number];

  constructor(positions: Float64Array, tris: Uint32Array) {
    this.positions = positions;
    this.tris = tris;
    const n = Math.floor(tris.length / 3);
    this.triangles = n;
    // Per-triangle boxes and centroids.
    const tb = new Float64Array(6 * n);
    const centroid = new Float64Array(3 * n);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < n; t++) {
      for (let axis = 0; axis < 3; axis++) {
        const a = positions[3 * (tris[3 * t] as number) + axis] as number;
        const b = positions[3 * (tris[3 * t + 1] as number) + axis] as number;
        const c = positions[3 * (tris[3 * t + 2] as number) + axis] as number;
        const mn = Math.min(a, b, c);
        const mx = Math.max(a, b, c);
        tb[6 * t + axis] = mn;
        tb[6 * t + 3 + axis] = mx;
        centroid[3 * t + axis] = (a + b + c) / 3;
        if (mn < (lo[axis] as number)) lo[axis] = mn;
        if (mx > (hi[axis] as number)) hi[axis] = mx;
      }
    }
    this.min = n === 0 ? [0, 0, 0] : [lo[0] as number, lo[1] as number, lo[2] as number];
    this.max = n === 0 ? [0, 0, 0] : [hi[0] as number, hi[1] as number, hi[2] as number];
    let scale = 0;
    for (let axis = 0; axis < 3; axis++) {
      scale = Math.max(scale, Math.abs(this.min[axis] as number), Math.abs(this.max[axis] as number));
    }
    const pad = 1e-7 * (Number.isFinite(scale) ? scale : 0) + 1e-30;

    const order = new Uint32Array(n);
    for (let t = 0; t < n; t++) order[t] = t;
    const capacity = Math.max(1, 2 * Math.ceil(n / LEAF) + 1);
    let boxes = new Float64Array(6 * capacity);
    let first = new Int32Array(capacity);
    let count = new Int32Array(capacity);
    let nodes = 0;
    const grow = (): void => {
      const next = boxes.length / 3;
      const b = new Float64Array(next * 6);
      b.set(boxes);
      boxes = b;
      const f = new Int32Array(next);
      f.set(first);
      first = f;
      const c = new Int32Array(next);
      c.set(count);
      count = c;
    };
    // Preorder build (recursion depth ≈ log2(n / LEAF)): the left child follows its parent, the right is recorded.
    const build = (start: number, end: number): number => {
      if (nodes >= first.length) grow();
      const node = nodes++;
      // Node box: union of its triangles' boxes, padded.
      const bmin = [Infinity, Infinity, Infinity];
      const bmax = [-Infinity, -Infinity, -Infinity];
      const cmin = [Infinity, Infinity, Infinity];
      const cmax = [-Infinity, -Infinity, -Infinity];
      for (let i = start; i < end; i++) {
        const t = order[i] as number;
        for (let axis = 0; axis < 3; axis++) {
          bmin[axis] = Math.min(bmin[axis] as number, tb[6 * t + axis] as number);
          bmax[axis] = Math.max(bmax[axis] as number, tb[6 * t + 3 + axis] as number);
          const c = centroid[3 * t + axis] as number;
          cmin[axis] = Math.min(cmin[axis] as number, c);
          cmax[axis] = Math.max(cmax[axis] as number, c);
        }
      }
      for (let axis = 0; axis < 3; axis++) {
        boxes[6 * node + axis] = (bmin[axis] as number) - pad;
        boxes[6 * node + 3 + axis] = (bmax[axis] as number) + pad;
      }
      let axis = 0;
      let extent = -1;
      for (let a = 0; a < 3; a++) {
        const e = (cmax[a] as number) - (cmin[a] as number);
        if (e > extent) {
          extent = e;
          axis = a;
        }
      }
      if (end - start <= LEAF || !(extent > 0)) {
        first[node] = start;
        count[node] = end - start;
        return node;
      }
      const slice = Array.from(order.subarray(start, end));
      slice.sort((a, b) => (centroid[3 * a + axis] as number) - (centroid[3 * b + axis] as number) || a - b);
      order.set(slice, start);
      const mid = start + ((end - start) >> 1);
      build(start, mid);
      // Read the arrays after the recursion: a child may have grown (replaced) them.
      const right = build(mid, end);
      count[node] = 0;
      first[node] = right;
      return node;
    };
    if (n > 0) build(0, n);
    this.order = order;
    this.boxes = boxes;
    this.first = first;
    this.count = count;
    this.nodeCount = nodes;
  }

  /** Bounds of the triangles' points (unpadded); zeros for an empty set. */
  bounds(): readonly [readonly [number, number, number], readonly [number, number, number]] {
    return [this.min, this.max];
  }

  /** Every hit with 0 < t ≤ maxT, t ascending (ties by triangle index). */
  raycastAll(origin: ReadonlyVec3, dir: ReadonlyVec3, maxT = Number.POSITIVE_INFINITY): readonly RayHit[] {
    const hits: RayHit[] = [];
    if (this.nodeCount === 0) return hits;
    const stack = [0];
    const span: [number, number] = [0, 0];
    while (stack.length > 0) {
      const node = stack.pop() as number;
      if (!this.slab(node, origin, dir, span)) continue;
      if (span[1] < 0 || span[0] > maxT) continue;
      const c = this.count[node] as number;
      if (c > 0) {
        const s = this.first[node] as number;
        for (let i = s; i < s + c; i++) {
          const hit = intersectTriangle(this.positions, this.tris, this.order[i] as number, origin, dir);
          if (hit !== null && hit.t > 0 && hit.t <= maxT) hits.push(hit);
        }
      } else {
        stack.push(this.first[node] as number, node + 1);
      }
    }
    return hits.sort((a, b) => a.t - b.t || a.tri - b.tri);
  }

  /** The nearest hit with minT < t ≤ maxT outside `ignore` (ties by triangle index), or null. */
  raycast(
    origin: ReadonlyVec3,
    dir: ReadonlyVec3,
    minT: number,
    maxT: number,
    ignore?: ReadonlySet<number>,
  ): RayHit | null {
    let best: RayHit | null = null;
    if (this.nodeCount === 0) return best;
    const stack = [0];
    const span: [number, number] = [0, 0];
    while (stack.length > 0) {
      const node = stack.pop() as number;
      if (!this.slab(node, origin, dir, span)) continue;
      if (span[1] < minT || span[0] > maxT || (best !== null && span[0] > best.t)) continue;
      const c = this.count[node] as number;
      if (c > 0) {
        const s = this.first[node] as number;
        for (let i = s; i < s + c; i++) {
          const tri = this.order[i] as number;
          if (ignore?.has(tri) === true) continue;
          const hit = intersectTriangle(this.positions, this.tris, tri, origin, dir);
          if (hit === null || hit.t <= minT || hit.t > maxT) continue;
          if (best === null || hit.t < best.t || (hit.t === best.t && hit.tri < best.tri)) best = hit;
        }
      } else {
        // Visit the nearer child first (pushed last).
        const left = node + 1;
        const right = this.first[node] as number;
        const dl = this.slab(left, origin, dir, span) ? span[0] : Infinity;
        const dr = this.slab(right, origin, dir, span) ? span[0] : Infinity;
        if (dl <= dr) stack.push(right, left);
        else stack.push(left, right);
      }
    }
    return best;
  }

  /** The closest surface point within `maxDistance` (ties by triangle index): its triangle, barycentrics, distance. */
  closestPoint(p: ReadonlyVec3, maxDistance = Number.POSITIVE_INFINITY): Closest | null {
    if (this.nodeCount === 0) return null;
    const limit = maxDistance * maxDistance;
    let best: { tri: number; bary: [number, number, number]; d2: number } | null = null;
    const stack = [0];
    while (stack.length > 0) {
      const node = stack.pop() as number;
      const boxD2 = this.boxDistance2(node, p);
      if (boxD2 > limit || (best !== null && boxD2 > best.d2)) continue;
      const c = this.count[node] as number;
      if (c > 0) {
        const s = this.first[node] as number;
        for (let i = s; i < s + c; i++) {
          const tri = this.order[i] as number;
          const { bary, d2 } = closestOnTriangle(this.positions, this.tris, tri, p);
          if (d2 > limit) continue;
          if (best === null || d2 < best.d2 || (d2 === best.d2 && tri < best.tri)) best = { tri, bary, d2 };
        }
      } else {
        const left = node + 1;
        const right = this.first[node] as number;
        if (this.boxDistance2(left, p) <= this.boxDistance2(right, p)) stack.push(right, left);
        else stack.push(left, right);
      }
    }
    return best === null ? null : { tri: best.tri, bary: best.bary, distance: Math.sqrt(best.d2) };
  }

  /** Slab test: writes the ray's [tNear, tFar] through the node box into `out`; false when it misses. */
  private slab(node: number, o: ReadonlyVec3, d: ReadonlyVec3, out: [number, number]): boolean {
    let near = -Infinity;
    let far = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const lo = this.boxes[6 * node + axis] as number;
      const hi = this.boxes[6 * node + 3 + axis] as number;
      const oa = o[axis] as number;
      const da = d[axis] as number;
      if (da === 0) {
        if (oa < lo || oa > hi) return false;
        continue;
      }
      let t1 = (lo - oa) / da;
      let t2 = (hi - oa) / da;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > near) near = t1;
      if (t2 < far) far = t2;
      if (!(near <= far)) return false;
    }
    out[0] = near;
    out[1] = far;
    return true;
  }

  private boxDistance2(node: number, p: ReadonlyVec3): number {
    let d2 = 0;
    for (let axis = 0; axis < 3; axis++) {
      const lo = this.boxes[6 * node + axis] as number;
      const hi = this.boxes[6 * node + 3 + axis] as number;
      const v = p[axis] as number;
      const e = v < lo ? lo - v : v > hi ? v - hi : 0;
      d2 += e * e;
    }
    return d2;
  }
}
