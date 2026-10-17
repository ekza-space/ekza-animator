// WP-3 stub: final signature (MVP-SPEC §7 WP-3; research 07 §9.2); throws until the solver lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { TwoBoneIkInput, TwoBoneIkOutput } from '../types';

export function solveTwoBoneIk(_input: TwoBoneIkInput, _out: TwoBoneIkOutput): void {
  throw new EkzaError('not-implemented', 'rig.solveTwoBoneIk');
}
