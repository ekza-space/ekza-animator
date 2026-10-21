// C5 (weights kernel; deferred after the MVP, M6B-SPEC §0.3): Copy Skin Weights between meshes (§5.14). C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { SkinGeometry, SkinReview, SkinWeights, TransferArgs, WeightContext } from '../types';

export function transferWeights(
  _target: SkinGeometry,
  _source: { readonly geometry: SkinGeometry; readonly skin: SkinWeights },
  _args: TransferArgs,
  _ctx: Omit<WeightContext, 'geometry'>,
): { readonly skin: SkinWeights; readonly review: SkinReview } {
  throw new EkzaError('not-implemented', 'mesh-core.transferWeights');
}
