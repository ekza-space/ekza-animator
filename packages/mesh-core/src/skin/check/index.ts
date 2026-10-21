// C6 (M6B-SPEC §4.2, §5.21): the skin.* problems. C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { SkinProblem, SkinReview, SkinWeights, WeightContext } from '../types';

export function checkSkin(
  _skin: SkinWeights | null,
  _ctx: Pick<WeightContext, 'skeleton'> & {
    readonly review: SkinReview | null;
    readonly unreachable: Uint32Array | null;
  },
): readonly SkinProblem[] {
  throw new EkzaError('not-implemented', 'mesh-core.checkSkin');
}
