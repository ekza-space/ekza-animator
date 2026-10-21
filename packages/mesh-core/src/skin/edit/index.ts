// C6 (skin-ui with the C5 MVP subset; M6B-SPEC §4.2, §5.10–§5.13): weight edits under the normalization contract.
// C0 stubs.
import { EkzaError } from '@ekza-studio/anim-core';
import type { DirtySet } from '../../types';
import type { SkinWeights, WeightContext, WeightEdit } from '../types';

/** Applies one edit under the §5.10 contract; returns a new value object (inputs untouched) and the changed points. */
export function editWeights(
  _skin: SkinWeights,
  _edit: WeightEdit,
  _ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  throw new EkzaError('not-implemented', 'mesh-core.editWeights');
}

/** Dirty set of a skin change, for `writeData(…, { dirty })` (CR-1). */
export function skinDirty(_before: SkinWeights | null, _after: SkinWeights | null): DirtySet {
  throw new EkzaError('not-implemented', 'mesh-core.skinDirty');
}
