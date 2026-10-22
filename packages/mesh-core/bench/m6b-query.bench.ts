// C2 triangle-query benches (report only; M6B-SPEC §4.2, §5.25): the median-split TriangleBvh against the brute-force
// reference — build, raycastAll, raycast and closestPoint over a 10k-triangle sphere and a 25k-triangle torus.
// Run: pnpm --filter @ekza-studio/mesh-core exec vitest bench --run bench/m6b-query.bench.ts
import { bench, describe } from 'vitest';
import { type MeshData, primitive, ReferenceTriangleBvh, TriangleBvh, triangulate } from '../src';

function triangles(data: MeshData): { positions: Float64Array; tris: Uint32Array } {
  const positions = Float64Array.from(data.position);
  const corners = triangulate(data).tris;
  const tris = new Uint32Array(corners.length);
  for (let i = 0; i < corners.length; i++) tris[i] = data.cornerVert[corners[i] as number] as number;
  return { positions, tris };
}

const sphere10k = triangles(primitive('sphere', { subdivisionsAxis: 100, subdivisionsHeight: 50 }));
const torus25k = triangles(primitive('torus', { subdivisionsAxis: 250, subdivisionsHeight: 100 }));

const rays: [readonly [number, number, number], readonly [number, number, number]][] = [];
for (let i = 0; i < 64; i++) {
  const a = (i / 64) * Math.PI * 2;
  rays.push([
    [Math.cos(a) * 3, Math.sin(a * 0.5), Math.sin(a) * 3],
    [-Math.cos(a), -0.1, -Math.sin(a)],
  ]);
}
const points: (readonly [number, number, number])[] = rays.map(([o]) => [o[0] / 2, o[1], o[2] / 2]);

for (const [name, t] of [
  ['sphere 10k', sphere10k],
  ['torus 25k', torus25k],
] as const) {
  describe(`TriangleBvh vs reference, ${name} (${t.tris.length / 3} triangles)`, () => {
    const bvh = new TriangleBvh(t.positions, t.tris);
    const ref = new ReferenceTriangleBvh(t.positions, t.tris);
    bench('build', () => {
      new TriangleBvh(t.positions, t.tris);
    });
    bench('64 × raycastAll (BVH)', () => {
      for (const [o, d] of rays) bvh.raycastAll(o, d);
    });
    bench('64 × raycastAll (reference)', () => {
      for (const [o, d] of rays) ref.raycastAll(o, d);
    });
    bench('64 × raycast (BVH)', () => {
      for (const [o, d] of rays) bvh.raycast(o, d, 0, Number.POSITIVE_INFINITY);
    });
    bench('64 × closestPoint (BVH)', () => {
      for (const p of points) bvh.closestPoint(p);
    });
    bench('64 × closestPoint (reference)', () => {
      for (const p of points) ref.closestPoint(p);
    });
  });
}
