// C5 (weights kernel; deferred after the MVP, M6B-SPEC §0.3): weight inpainting (§5.14). C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { SkinReview, SkinWeights, WeightContext } from '../types';

/** Inpaints points with Σ = 0 from the weighted points of the same mesh (§5.14); null when none is missing. */
export function fillMissingWeights(
  _skin: SkinWeights,
  _ctx: WeightContext,
): { readonly skin: SkinWeights; readonly review: SkinReview } | null {
  throw new EkzaError('not-implemented', 'mesh-core.fillMissingWeights');
}
