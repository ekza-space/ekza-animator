// B0a stub of B2's soft selection (M6A-SPEC §4.3, §5.15): throws until B2 lands `src/soft/**`.
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import type { BitSet } from '../bitset';
import { notImplemented } from '../kernel';
import type { EditMesh, HiddenSet, SoftContext } from '../types';

export function softWeights(
  _m: EditMesh,
  _seeds: BitSet,
  _ctx: SoftContext & { readonly placement: ReadonlyXf; readonly hidden?: HiddenSet | null },
  _out?: Float32Array,
): Float32Array {
  throw notImplemented('softWeights');
}
