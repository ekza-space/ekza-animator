// C6 (M6B-SPEC §4.2, §5.13): Mirror Skin Weights. C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { SkinWeights, WeightContext } from '../types';

export function mirrorWeights(
  _skin: SkinWeights,
  _args: {
    readonly direction: 'positive-to-negative' | 'negative-to-positive';
    readonly surface: 'partners' | 'closest-point';
    readonly points: ArrayLike<number> | null;
  },
  _ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  throw new EkzaError('not-implemented', 'mesh-core.mirrorWeights');
}
