// READY gates of B5's tests (M6A-SPEC §3 rule 4): probes of what sibling kernel packages provide, so a gated case
// turns on by itself when its package merges (INT turns every gate into a failure). Kept inside B5's own test tree so
// it does not collide with the other packages' `test/ready.ts` (INT folds the probes together).
// - b2: B2's symmetry maps (`buildSymmetryMap`; the B0a stub throws `not-implemented`) — P10 with the real map.
import { EkzaError } from '@ekza-animator/anim-core';
import { buildSymmetryMap, editMeshFrom, isRefusal, primitive } from '../../../src';

function probe(fn: () => unknown): boolean {
  try {
    const out = fn();
    return !(isRefusal(out) && out.code === 'not-implemented');
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  }
}

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

export const READY = {
  b2: probe(() =>
    buildSymmetryMap(editMeshFrom(primitive('cube', {})), {
      axis: 'x',
      space: 'object',
      placement: IDENTITY,
      tolerance: 0.001,
    }),
  ),
} as const;
