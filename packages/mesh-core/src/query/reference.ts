// Triangle queries, reference implementation (M6B-SPEC §4.2; C0, kept by C2 as the oracle of the BVH): brute force
// over every triangle, float64, the results the BVH (`bvh.ts`) must reproduce exactly (same hits, same order, same
// ties). Rays use the Möller–Trumbore test with inclusive edges (a ray through a shared edge hits both triangles,
// reported in triangle order); `t` is in units of `dir` (not normalized). Closest points use Ericson's region test
// (Real-Time Collision Detection §5.1.5). No `Math.random`, no float-keyed maps: Node, a Worker and Chromium give the
// same answers (§3 rule 8).
import type { ReadonlyVec3 } from '@ekza-studio/anim-core';
import type { RayHit, TriangleQueries } from '../skin/types';
import { closestOnTriangle, intersectTriangle } from './triangle';

export class ReferenceTriangleBvh implements TriangleQueries {
  private readonly positions: Float64Array;
  private readonly tris: Uint32Array;
  readonly triangles: number;

  constructor(positions: Float64Array, tris: Uint32Array) {
    this.positions = positions;
    this.tris = tris;
    this.triangles = Math.floor(tris.length / 3);
  }

  /** Every hit with 0 < t ≤ maxT, t ascending (ties by triangle index). */
  raycastAll(origin: ReadonlyVec3, dir: ReadonlyVec3, maxT = Number.POSITIVE_INFINITY): readonly RayHit[] {
    const hits: RayHit[] = [];
    for (let tri = 0; tri < this.triangles; tri++) {
      const hit = intersectTriangle(this.positions, this.tris, tri, origin, dir);
      if (hit !== null && hit.t > 0 && hit.t <= maxT) hits.push(hit);
    }
    // Stable sort: equal t keep triangle order.
    return hits.sort((a, b) => a.t - b.t);
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
    for (let tri = 0; tri < this.triangles; tri++) {
      if (ignore?.has(tri) === true) continue;
      const hit = intersectTriangle(this.positions, this.tris, tri, origin, dir);
      if (hit === null || hit.t <= minT || hit.t > maxT) continue;
      if (best === null || hit.t < best.t) best = hit;
    }
    return best;
  }

  /** The closest surface point within `maxDistance` (ties by triangle index): its triangle, barycentrics, distance. */
  closestPoint(
    p: ReadonlyVec3,
    maxDistance = Number.POSITIVE_INFINITY,
  ): { readonly tri: number; readonly bary: readonly [number, number, number]; readonly distance: number } | null {
    let best: { tri: number; bary: [number, number, number]; d2: number } | null = null;
    const limit = maxDistance * maxDistance;
    for (let tri = 0; tri < this.triangles; tri++) {
      const { bary, d2 } = closestOnTriangle(this.positions, this.tris, tri, p);
      if (d2 > limit) continue;
      if (best === null || d2 < best.d2) best = { tri, bary, d2 };
    }
    return best === null ? null : { tri: best.tri, bary: best.bary, distance: Math.sqrt(best.d2) };
  }
}
