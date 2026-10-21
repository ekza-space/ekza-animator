// C4 (auto-skin; M6B-SPEC §4.2, §5.9): Bind Skin's solvers. C0 stubs.
import { EkzaError } from '@ekza-studio/anim-core';
import type { BindReport, SkinBindArgs, SkinGeometry, SkinSkeleton, SkinWeights } from '../types';

/** Pure and deterministic; runs in the skin worker (browser) or synchronously (Node). `previous` supplies the weights
 *  of points outside `args.points`. A full run's palette lists only joints with weight, in skeleton order; a masked
 *  run keeps `previous`'s palette and appends new joints (palette order rule above). `args.symmetrize` is a boolean. */
export function bindSkin(
  _geom: SkinGeometry,
  _skeleton: SkinSkeleton,
  _args: SkinBindArgs & { readonly symmetrize: boolean },
  _previous: SkinWeights | null,
): { readonly skin: SkinWeights; readonly report: BindReport } {
  throw new EkzaError('not-implemented', 'mesh-core.bindSkin');
}

/** Auto Weights for Selected Joints (§5.9 "Adding influences"): the points to re-solve for `joints` — points whose
 *  nearest visible segment, over every deforming joint plus `joints`, belongs to one of `joints`, grown by one ring of
 *  the point graph; ascending. */
export function autoWeightPoints(
  _geom: SkinGeometry,
  _skeleton: SkinSkeleton,
  _joints: readonly string[],
): Uint32Array {
  throw new EkzaError('not-implemented', 'mesh-core.autoWeightPoints');
}
