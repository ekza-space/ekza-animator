// C6 weight-kernel benches (M6B-SPEC §5.25; report-only): the kernel part of a paint frame at 10k points — one stamp
// of a stroke session (≈ 300 points, the brush at 40 px on a body-sized mesh) with and without the X-mirror — the
// stroke commit (finish + `skinDirty`) and the utilities on every point (smooth, normalize, compact, mirror). The pick,
// the surface flood and the partial upload of a full paint frame are measured by the browser bench
// (`apps/web/e2e/bench/m6b-paint.bench.ts`).
// Run: pnpm --filter @ekza-studio/mesh-core bench
import { bench, describe } from 'vitest';
import {
  beginStroke,
  bindSkin,
  editWeights,
  mirrorWeights,
  type SkinBindArgs,
  setKernelDebug,
  skinDirty,
  skinGeometryOf,
  type StrokeStamp,
  type WeightContext,
} from '../src';
import { worm } from '../test/m6b-bind/fixtures';

setKernelDebug(false);

const ARGS: SkinBindArgs & { readonly symmetrize: boolean } = {
  method: 'closest',
  joints: null,
  points: null,
  hierarchy: true,
  dropoff: 4,
  stiffness: 1,
  pruneBelow: 0.025,
  rigidifyAbove: null,
  symmetrize: false,
};

const big = worm(100, 100, 60); // 10,000 points, 60 joints
const geometry = skinGeometryOf(big.mesh, big.skeleton.height);
const { skin } = bindSkin(geometry, big.skeleton, ARGS, null);
const ctx: WeightContext = { skeleton: big.skeleton, geometry, holds: new Set(['seg0']) };
const all = Array.from({ length: skin.points }, (_, v) => v);

/** A stamp of the ≈ 300 points within 0.1 m of a point on the worm's surface, smooth falloff. */
function stampAt(y: number): StrokeStamp {
  const points: number[] = [];
  const strength: number[] = [];
  for (let v = 0; v < skin.points; v++) {
    const dx = (geometry.positions[3 * v] as number) - 0.12;
    const dy = (geometry.positions[3 * v + 1] as number) - y;
    const dz = geometry.positions[3 * v + 2] as number;
    const d = Math.hypot(dx, dy, dz) / 0.1;
    if (d >= 1) continue;
    points.push(v);
    strength.push(1 - 3 * d * d + 2 * d * d * d);
  }
  return { points: Uint32Array.from(points), strength: Float32Array.from(strength) };
}
const stamps = Array.from({ length: 20 }, (_, i) => stampAt(1 + 0.025 * i));

describe('C6 paint kernel (§5.25, ≤ 4 ms per pointer frame at 10k points incl. pick and upload)', () => {
  for (const op of ['replace', 'smooth'] as const) {
    for (const mirror of [false, true]) {
      bench(`one stamp per frame, ${op}${mirror ? ', X-mirror' : ''} (a whole 20-stamp stroke)`, () => {
        const session = beginStroke(skin, ctx, { joint: 'seg20', op, value: 1, mirror });
        for (const stamp of stamps) session.addStamp(stamp);
      });
    }
  }
  bench('stroke commit: finish + skinDirty (≤ 5 ms with the write path)', () => {
    const session = beginStroke(skin, ctx, { joint: 'seg20', op: 'replace', value: 1, mirror: false });
    session.addStamp(stamps[0] as StrokeStamp);
    const out = session.finish();
    skinDirty(skin, out.skin);
  });
});

describe('C6 weight utilities on 10k points (report)', () => {
  bench('smooth, every point, 1 iteration', () => {
    editWeights(skin, { kind: 'smooth', points: all, factor: 0.5, iterations: 1, expand: 0 }, ctx);
  });
  bench('normalize, every point', () => {
    editWeights(skin, { kind: 'normalize', points: null, lockActive: null }, ctx);
  });
  bench('compact', () => {
    editWeights(skin, { kind: 'compact' }, ctx);
  });
  bench('mirror (partners)', () => {
    mirrorWeights(skin, { direction: 'positive-to-negative', surface: 'partners', points: null }, ctx);
  });
});
