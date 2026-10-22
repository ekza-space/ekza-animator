// M6B-SPEC §4.2, §9.0 C2 DoD "BVH ≡ reference on random meshes and rays": the median-split `TriangleBvh` returns
// exactly what the brute-force `ReferenceTriangleBvh` returns — `raycastAll` (hits, order, ties), `raycast` (with
// minT/maxT/ignore) and `closestPoint` (triangle, barycentrics, distance, maxDistance) — on random triangle soups, on
// primitives with grid-aligned rays through their vertices and edges, and on the three Quick Rig fixtures.
import { primitive, ReferenceTriangleBvh, TriangleBvh } from '@ekza-studio/mesh-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cubeLad, generatedBody, meshTriangles, polybotTPose, type Triangles, type V3 } from './support';

/** Every query the BVH answers differently from the reference, as `[query, input]` rows ([] = identical). */
function differences(t: Triangles, rays: readonly (readonly [V3, V3])[], points: readonly V3[]): unknown[] {
  const bvh = new TriangleBvh(t.positions, t.tris);
  const ref = new ReferenceTriangleBvh(t.positions, t.tris);
  const out: unknown[] = [];
  const check = (query: string, input: unknown, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push([query, input, a, b]);
  };
  for (const [o, d] of rays) {
    check('raycastAll', [o, d], bvh.raycastAll(o, d), ref.raycastAll(o, d));
    check('raycastAll maxT', [o, d], bvh.raycastAll(o, d, 1.5), ref.raycastAll(o, d, 1.5));
    check('raycast', [o, d], bvh.raycast(o, d, 0, Number.POSITIVE_INFINITY), ref.raycast(o, d, 0, Infinity));
    const all = ref.raycastAll(o, d);
    const mid = all[Math.floor(all.length / 2)];
    const minT = mid?.t ?? 0;
    check('raycast minT', [o, d, minT], bvh.raycast(o, d, minT, 10), ref.raycast(o, d, minT, 10));
    const ignore = new Set([mid?.tri ?? -1, all[0]?.tri ?? -1]);
    check('raycast ignore', [o, d], bvh.raycast(o, d, 0, 10, ignore), ref.raycast(o, d, 0, 10, ignore));
  }
  for (const p of points) {
    check('closestPoint', p, bvh.closestPoint(p), ref.closestPoint(p));
    check('closestPoint max', p, bvh.closestPoint(p, 0.05), ref.closestPoint(p, 0.05));
  }
  return out;
}

const coord = fc.integer({ min: -1000, max: 1000 }).map((n) => n / 1000);
const vec = fc.tuple(coord, coord, coord) as fc.Arbitrary<V3>;

describe('TriangleBvh ≡ ReferenceTriangleBvh', () => {
  it('random soups (up to 200 triangles), random rays and points', () => {
    const soup = fc.array(fc.tuple(vec, vec, vec), { minLength: 0, maxLength: 200 }).map((triangles) => ({
      positions: new Float64Array(triangles.flatMap(([a, b, c]) => [...a, ...b, ...c])),
      tris: Uint32Array.from(triangles.flatMap((_, i) => [3 * i, 3 * i + 1, 3 * i + 2])),
    }));
    fc.assert(
      fc.property(
        soup,
        fc.array(fc.tuple(vec, vec), { minLength: 1, maxLength: 8 }),
        fc.array(vec, { minLength: 1, maxLength: 8 }),
        (t, rays, points) => {
          expect(differences(t, rays, points)).toEqual([]);
        },
      ),
      { seed: 6201, numRuns: 150 },
    );
  });

  it('shared vertices: primitives with axis-aligned rays through vertices, edges and faces (exact ties)', () => {
    const meshes = [
      meshTriangles(primitive('cube', {})),
      meshTriangles(primitive('sphere', { subdivisionsAxis: 16, subdivisionsHeight: 12 })),
      meshTriangles(primitive('plane', { width: 2, height: 2, subdivisionsWidth: 8, subdivisionsHeight: 8 })),
      meshTriangles(primitive('torus', {})),
    ];
    const rays: [V3, V3][] = [];
    for (let i = -8; i <= 8; i++) {
      for (let j = -8; j <= 8; j++) {
        const a = i / 8;
        const b = j / 8;
        rays.push([
          [a, b, 5],
          [0, 0, -1],
        ]);
        rays.push([
          [5, a, b],
          [-1, 0, 0],
        ]);
        rays.push([
          [a, 5, b],
          [0, -2, 0],
        ]);
        rays.push([
          [a, b, -5],
          [0.1, 0.05, 1],
        ]);
      }
    }
    const points: V3[] = [];
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) points.push([i / 4, j / 4, (i * j) / 16]);
    for (const t of meshes) expect(differences(t, rays, points)).toEqual([]);
  });

  it('the Quick Rig fixtures: front and side rays on a grid, closest points on a grid', () => {
    for (const f of [cubeLad(), polybotTPose(), generatedBody('smooth'), generatedBody('segmented')]) {
      const [lo, hi] = f.bounds;
      const rays: [V3, V3][] = [];
      const points: V3[] = [];
      for (let i = 0; i <= 24; i++) {
        for (let j = 0; j <= 24; j++) {
          const x = lo[0] + ((hi[0] - lo[0]) * i) / 24;
          const y = lo[1] + ((hi[1] - lo[1]) * j) / 24;
          const z = lo[2] + ((hi[2] - lo[2]) * i) / 24;
          rays.push([
            [x, y, hi[2] + 1],
            [0, 0, -1],
          ]);
          rays.push([
            [hi[0] + 1, y, z],
            [-1, 0, 0],
          ]);
          points.push([x, y, z]);
        }
      }
      expect(differences(f.triangles, rays, points)).toEqual([]);
    }
  });

  it('bounds() are the points’ bounds; an empty set answers nothing', () => {
    const f = cubeLad();
    expect(f.bvh.bounds()).toEqual(f.bounds);
    const empty = new TriangleBvh(new Float64Array(0), new Uint32Array(0));
    expect(empty.raycastAll([0, 0, 1], [0, 0, -1])).toEqual([]);
    expect(empty.raycast([0, 0, 1], [0, 0, -1], 0, 10)).toBeNull();
    expect(empty.closestPoint([0, 0, 0])).toBeNull();
  });
});
