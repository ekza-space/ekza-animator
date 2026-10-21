// Triangle queries, reference implementation (M6B-SPEC §4.2; C0): brute force over every triangle, float64, the
// results C2's BVH must reproduce exactly (same hits, same order, same ties). Rays use the Möller–Trumbore test with
// inclusive edges (a ray through a shared edge hits both triangles, reported in triangle order); `t` is in units of
// `dir` (not normalized). Closest points use Ericson's region test (Real-Time Collision Detection §5.1.5). No
// `Math.random`, no float-keyed maps: Node, a Worker and Chromium give the same answers (§3 rule 8).
import type { ReadonlyVec3 } from '@ekza-studio/anim-core';
import type { RayHit, TriangleQueries } from '../skin/types';

export class TriangleBvh implements TriangleQueries {
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
      const hit = this.intersect(tri, origin, dir);
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
      const hit = this.intersect(tri, origin, dir);
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
      const { bary, d2 } = this.closestOn(tri, p);
      if (d2 > limit) continue;
      if (best === null || d2 < best.d2) best = { tri, bary, d2 };
    }
    return best === null ? null : { tri: best.tri, bary: best.bary, distance: Math.sqrt(best.d2) };
  }

  private vertex(tri: number, corner: 0 | 1 | 2): number {
    return 3 * (this.tris[3 * tri + corner] as number);
  }

  /** Möller–Trumbore with inclusive edges; null when the ray is parallel to the plane or misses. */
  private intersect(tri: number, o: ReadonlyVec3, d: ReadonlyVec3): RayHit | null {
    const P = this.positions;
    const a = this.vertex(tri, 0);
    const b = this.vertex(tri, 1);
    const c = this.vertex(tri, 2);
    const ax = P[a] as number;
    const ay = P[a + 1] as number;
    const az = P[a + 2] as number;
    const e1x = (P[b] as number) - ax;
    const e1y = (P[b + 1] as number) - ay;
    const e1z = (P[b + 2] as number) - az;
    const e2x = (P[c] as number) - ax;
    const e2y = (P[c + 1] as number) - ay;
    const e2z = (P[c + 2] as number) - az;
    const dx = d[0];
    const dy = d[1];
    const dz = d[2];
    // p = d × e2
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det === 0 || !Number.isFinite(det)) return null;
    const inv = 1 / det;
    const sx = o[0] - ax;
    const sy = o[1] - ay;
    const sz = o[2] - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return null;
    // q = s × e1
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return null;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    // n = e1 × e2; front: dot(dir, n) < 0 (equivalently det > 0, since det = −dot(dir, n)).
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    return { t, tri, front: dx * nx + dy * ny + dz * nz < 0 };
  }

  /** Ericson's closest point on a triangle: barycentrics (a, b, c) and the squared distance. */
  private closestOn(tri: number, p: ReadonlyVec3): { bary: [number, number, number]; d2: number } {
    const P = this.positions;
    const ia = this.vertex(tri, 0);
    const ib = this.vertex(tri, 1);
    const ic = this.vertex(tri, 2);
    const a = [P[ia] as number, P[ia + 1] as number, P[ia + 2] as number] as const;
    const b = [P[ib] as number, P[ib + 1] as number, P[ib + 2] as number] as const;
    const c = [P[ic] as number, P[ic + 1] as number, P[ic + 2] as number] as const;
    const sub = (x: readonly number[], y: readonly number[]) => [
      (x[0] as number) - (y[0] as number),
      (x[1] as number) - (y[1] as number),
      (x[2] as number) - (y[2] as number),
    ];
    const dot = (x: readonly number[], y: readonly number[]) =>
      (x[0] as number) * (y[0] as number) + (x[1] as number) * (y[1] as number) + (x[2] as number) * (y[2] as number);
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ap = sub(p, a);
    const result = (u: number, v: number, w: number) => {
      const qx = u * a[0] + v * b[0] + w * c[0];
      const qy = u * a[1] + v * b[1] + w * c[1];
      const qz = u * a[2] + v * b[2] + w * c[2];
      const ex = p[0] - qx;
      const ey = p[1] - qy;
      const ez = p[2] - qz;
      return { bary: [u, v, w] as [number, number, number], d2: ex * ex + ey * ey + ez * ez };
    };
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return result(1, 0, 0);
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return result(0, 1, 0);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      return result(1 - v, v, 0);
    }
    const cp = sub(p, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return result(0, 0, 1);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      return result(1 - w, 0, w);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      return result(0, 1 - w, w);
    }
    const denom = va + vb + vc;
    if (denom === 0) return result(1, 0, 0); // degenerate triangle: its first vertex
    const v = vb / denom;
    const w = vc / denom;
    return result(1 - v - w, v, w);
  }
}
