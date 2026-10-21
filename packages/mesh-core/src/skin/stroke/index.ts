// C6 (M6B-SPEC §4.2, §5.11): the incremental paint stroke. C0 stub.
import { EkzaError } from '@ekza-studio/anim-core';
import type { PaintOp, SkinWeights, StrokeSession, WeightContext } from '../types';

export function beginStroke(
  _skin: SkinWeights,
  _ctx: WeightContext,
  _opts: { readonly joint: string; readonly op: PaintOp; readonly value: number; readonly mirror: boolean },
): StrokeSession {
  throw new EkzaError('not-implemented', 'mesh-core.beginStroke');
}
