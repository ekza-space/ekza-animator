// C4 bind benches (M6B-SPEC §5.25, §9.0 C4 DoD; report-only budgets): `auto-lowpoly` and `heat` at 10k points ×
// 60 joints (≤ 1 s, the worker budget) and a 3k-point low-poly character with 34 joints (≤ 200 ms). The geometry
// (partner map, triangulation) is built once outside the timed body, as the skin service caches it per revision.
// Run: pnpm --filter @ekza-studio/mesh-core bench
import { bench, describe } from 'vitest';
import { bindSkin, type SkinBindArgs, setKernelDebug, skinGeometryOf } from '../src';
import { tubeCharacter, worm } from '../test/m6b-bind/fixtures';

setKernelDebug(false);

const ARGS: SkinBindArgs & { readonly symmetrize: boolean } = {
  method: 'auto-lowpoly',
  joints: null,
  points: null,
  hierarchy: true,
  dropoff: 4,
  stiffness: 1,
  pruneBelow: 0.025,
  rigidifyAbove: null,
  symmetrize: true,
};

const big = worm(100, 100, 60); // 10,000 points, one island, 60 joints
const bigGeom = skinGeometryOf(big.mesh, big.skeleton.height);
const lowpoly = tubeCharacter(); // ≈ 3k points, 9 islands, 34 joints
const lowGeom = skinGeometryOf(lowpoly.mesh, lowpoly.skeleton.height);

describe('C4 bind (§5.25)', () => {
  bench('auto-lowpoly, 10k points × 60 joints (≤ 1 s)', () => {
    bindSkin(bigGeom, big.skeleton, ARGS, null);
  });
  bench('heat, 10k points × 60 joints (≤ 1 s)', () => {
    bindSkin(bigGeom, big.skeleton, { ...ARGS, method: 'heat' }, null);
  });
  bench('auto-lowpoly, 3k-point low-poly character × 34 joints (≤ 200 ms)', () => {
    bindSkin(lowGeom, lowpoly.skeleton, ARGS, null);
  });
});
