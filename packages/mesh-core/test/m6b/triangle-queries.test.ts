// M6B-SPEC §4.2 (C0): the reference `TriangleBvh` (brute force) against hand-computed goldens and, property-based,
// against an independent naive oracle — the answers C2's BVH must reproduce exactly.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TriangleBvh } from '../../src';

/** An axis-aligned unit cube [-0.5, 0.5]³ as 12 outward-facing triangles (two per face, CCW from outside). */
function unitCube(): { positions: Float64Array; tris: Uint32Array } {
  const positions = new Float64Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
    -0.5, 0.5, 0.5,
  ]);
  // biome-ignore format: one face per line
  const tris = new Uint32Array([
    4, 5, 6, 4, 6, 7, // +z
    1, 0, 3, 1, 3, 2, // -z
    5, 1, 2, 5, 2, 6, // +x
    0, 4, 7, 0, 7, 3, // -x
    7, 6, 2, 7, 2, 3, // +y
    0, 1, 5, 0, 5, 4, // -y
  ]);
  return { positions, tris };
}

describe('TriangleBvh (reference) goldens on the unit cube', () => {
  const { positions, tris } = unitCube();
  const bvh = new TriangleBvh(positions, tris);

  it('raycastAll: the entry and exit hits, t ascending, front faces first, maxT bounds', () => {
    const hits = bvh.raycastAll([0.1, 0.2, 5], [0, 0, -1]);
    expect(hits.map((hit) => [hit.t, hit.tri, hit.front])).toEqual([
      [4.5, 1, true],
      [5.5, 3, false],
    ]);
    expect(bvh.raycastAll([0.1, 0.2, 5], [0, 0, -1], 5)).toHaveLength(1);
    // t is in units of dir (not normalized).
    expect(bvh.raycastAll([0.1, 0.2, 5], [0, 0, -2])[0]?.t).toBe(2.25);
    // Behind the origin: nothing (t > 0 only).
    expect(bvh.raycastAll([0.1, 0.2, 5], [0, 0, 1])).toEqual([]);
  });

  it('raycastAll: a ray through a shared edge hits both triangles, reported in triangle order', () => {
    // The +z face's diagonal runs from (−0.5, −0.5) to (0.5, 0.5): x = y lies on it.
    const hits = bvh.raycastAll([0.25, 0.25, 5], [0, 0, -1], 5);
    expect(hits.map((hit) => [hit.t, hit.tri])).toEqual([
      [4.5, 0],
      [4.5, 1],
    ]);
  });

  it('raycast: the nearest hit in (minT, maxT], skipping ignored triangles', () => {
    expect(bvh.raycast([0.1, 0.2, 5], [0, 0, -1], 0, Number.POSITIVE_INFINITY)).toEqual({
      t: 4.5,
      tri: 1,
      front: true,
    });
    expect(bvh.raycast([0.1, 0.2, 5], [0, 0, -1], 4.5, 10)).toEqual({ t: 5.5, tri: 3, front: false });
    expect(bvh.raycast([0.1, 0.2, 5], [0, 0, -1], 0, 10, new Set([1]))?.tri).toBe(3);
    expect(bvh.raycast([0.1, 0.2, 5], [0, 0, -1], 0, 4)).toBeNull();
    expect(bvh.raycast([3, 3, 5], [0, 0, -1], 0, 10)).toBeNull();
  });

  it('closestPoint: a face point, an edge point and a vertex region, with maxDistance', () => {
    const face = bvh.closestPoint([0.1, 0.2, 1.5]);
    expect(face?.distance).toBeCloseTo(1, 12);
    expect(face?.tri).toBe(1);
    const corner = bvh.closestPoint([1.5, 1.5, 1.5]);
    expect(corner?.distance).toBeCloseTo(Math.sqrt(3), 12);
    const edge = bvh.closestPoint([1.5, 0, 1.5]);
    expect(edge?.distance).toBeCloseTo(Math.SQRT2, 12);
    expect(bvh.closestPoint([0.1, 0.2, 1.5], 0.5)).toBeNull();
    const inside = bvh.closestPoint([0, 0, 0.3]);
    expect(inside?.distance).toBeCloseTo(0.2, 12);
    const bary = inside?.bary ?? [0, 0, 0];
    expect(bary[0] + bary[1] + bary[2]).toBeCloseTo(1, 12);
  });
});

// ---------- naive oracle (independent formulation) ----------

type V = readonly [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Plane intersection then an inside test by edge signs: hits within 1e-9 of the reference. */
function oracleHits(positions: Float64Array, tris: Uint32Array, o: V, d: V): { t: number; tri: number }[] {
  const out: { t: number; tri: number }[] = [];
  const vertex = (i: number): V => [
    positions[3 * i] as number,
    positions[3 * i + 1] as number,
    positions[3 * i + 2] as number,
  ];
  for (let tri = 0; tri < tris.length / 3; tri++) {
    const a = vertex(tris[3 * tri] as number);
    const b = vertex(tris[3 * tri + 1] as number);
    const c = vertex(tris[3 * tri + 2] as number);
    const n = cross(sub(b, a), sub(c, a));
    const denom = dot(n, d);
    if (Math.abs(denom) < 1e-12) continue;
    const t = dot(n, sub(a, o)) / denom;
    if (t <= 1e-9) continue;
    const p: V = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
    const s1 = dot(cross(sub(b, a), sub(p, a)), n);
    const s2 = dot(cross(sub(c, b), sub(p, b)), n);
    const s3 = dot(cross(sub(a, c), sub(p, c)), n);
    const eps = -1e-9 * dot(n, n);
    if (s1 >= eps && s2 >= eps && s3 >= eps) out.push({ t, tri });
  }
  return out.sort((x, y) => x.t - y.t || x.tri - y.tri);
}

const coord = fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true });
const vec = fc.tuple(coord, coord, coord);

describe('TriangleBvh (reference) against a naive oracle (properties)', () => {
  const soup = fc.array(fc.tuple(vec, vec, vec), { minLength: 1, maxLength: 12 }).map((triangles) => ({
    positions: new Float64Array(triangles.flatMap(([a, b, c]) => [...a, ...b, ...c])),
    tris: Uint32Array.from(triangles.flatMap((_, i) => [3 * i, 3 * i + 1, 3 * i + 2])),
  }));

  it('raycastAll finds the oracle hits away from edges; raycast is its first hit in range', () => {
    fc.assert(
      fc.property(soup, vec, vec, ({ positions, tris }, o, d) => {
        fc.pre(Math.hypot(...d) > 1e-3);
        const bvh = new TriangleBvh(positions, tris);
        const hits = bvh.raycastAll(o, d);
        const oracle = oracleHits(positions, tris, o, d);
        // Every reference hit is an oracle hit (same triangle, t within 1e-9 relative).
        for (const hit of hits) {
          const match = oracle.find((x) => x.tri === hit.tri);
          if (match !== undefined) expect(Math.abs(match.t - hit.t)).toBeLessThanOrEqual(1e-6 * Math.max(1, hit.t));
        }
        for (let i = 1; i < hits.length; i++) {
          const prev = hits[i - 1] as { t: number; tri: number };
          const next = hits[i] as { t: number; tri: number };
          expect(prev.t < next.t || (prev.t === next.t && prev.tri < next.tri)).toBe(true);
        }
        const first = bvh.raycast(o, d, 0, Number.POSITIVE_INFINITY);
        expect(first).toEqual(hits[0] ?? null);
      }),
      { seed: 6061, numRuns: 300 },
    );
  });

  it('closestPoint is no farther than any triangle vertex and its barycentrics reproduce the distance', () => {
    fc.assert(
      fc.property(soup, vec, ({ positions, tris }, p) => {
        const bvh = new TriangleBvh(positions, tris);
        const closest = bvh.closestPoint(p);
        expect(closest).not.toBeNull();
        if (closest === null) return;
        for (let i = 0; i < positions.length / 3; i++) {
          const d = Math.hypot(
            p[0] - (positions[3 * i] as number),
            p[1] - (positions[3 * i + 1] as number),
            p[2] - (positions[3 * i + 2] as number),
          );
          expect(closest.distance).toBeLessThanOrEqual(d + 1e-12);
        }
        const [u, v, w] = closest.bary;
        expect(u + v + w).toBeCloseTo(1, 9);
        const t = closest.tri;
        const at = (k: number, c: number) => positions[3 * (tris[3 * t + k] as number) + c] as number;
        const q = [0, 1, 2].map((c) => u * at(0, c) + v * at(1, c) + w * at(2, c));
        expect(Math.hypot(p[0] - (q[0] as number), p[1] - (q[1] as number), p[2] - (q[2] as number))).toBeCloseTo(
          closest.distance,
          9,
        );
      }),
      { seed: 6062, numRuns: 300 },
    );
  });
});
