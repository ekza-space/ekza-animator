// C2 skeleton-kernel benches (report only; M6B-SPEC §0.4.2 "guess ≤ 50 ms at 10k triangles", §5.25): the One-Click
// guess, the fit (one preview frame), the start checks and the BVH build on the Cube Lad, T-posed Polybot and the
// generated body subdivided to ≈ 8k and ≈ 32k triangles. Run: pnpm --filter @ekza-studio/rig exec vitest bench --run
import { TriangleBvh } from '@ekza-studio/mesh-core';
import { bench, describe } from 'vitest';
import { DEFAULT_FLEXION, fitQuickRig, guessMarkers, quickRigStartChecks } from '../src';
import { boundsOf, cubeLad, generatedBody, polybotTPose, type Triangles } from '../test/m6b-skeleton/support';

/** Midpoint subdivision (4 triangles per triangle, shared edge midpoints), `levels` times. */
function subdivide(t: Triangles, levels: number): Triangles {
  let positions = Array.from(t.positions);
  let tris = Array.from(t.tris);
  for (let level = 0; level < levels; level++) {
    const mid = new Map<string, number>();
    const at = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const found = mid.get(key);
      if (found !== undefined) return found;
      const index = positions.length / 3;
      for (let k = 0; k < 3; k++)
        positions.push(((positions[3 * a + k]) + (positions[3 * b + k])) / 2);
      mid.set(key, index);
      return index;
    };
    const next: number[] = [];
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
      const ab = at(a, b);
      const bc = at(b, c);
      const ca = at(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    tris = next;
    positions = [...positions];
  }
  return { positions: Float64Array.from(positions), tris: Uint32Array.from(tris) };
}

const body = generatedBody('smooth');
const cases = [
  ['Cube Lad', cubeLad().triangles],
  ['Polybot T-pose', polybotTPose().triangles],
  ['generated body ×16', subdivide(body.triangles, 2)],
  ['generated body ×64', subdivide(body.triangles, 3)],
] as const;

for (const [name, t] of cases) {
  describe(`Quick Rig kernel, ${name} (${t.tris.length / 3} triangles)`, () => {
    const bvh = new TriangleBvh(t.positions, t.tris);
    const bounds = boundsOf(t);
    const guess = guessMarkers(bvh, bounds);
    bench('TriangleBvh build', () => {
      new TriangleBvh(t.positions, t.tris);
    });
    bench('guessMarkers (budget ≤ 50 ms at 10k)', () => {
      guessMarkers(bvh, bounds);
    });
    bench('quickRigStartChecks', () => {
      quickRigStartChecks(bounds, bvh);
    });
    bench('fitQuickRig (one preview frame)', () => {
      fitQuickRig('standard33', guess?.markers ?? {}, bvh, { ground: bounds[0][1], flexion: DEFAULT_FLEXION });
    });
  });
}
