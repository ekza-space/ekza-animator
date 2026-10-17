// WP-3 stub: final signature (MVP-SPEC §7 WP-3); throws until the rig compiler lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { RigDefinition, RigProgram, SkeletonDesc } from '../types';

export function compileRig(_def: RigDefinition, _skeleton: SkeletonDesc): RigProgram {
  throw new EkzaError('not-implemented', 'rig.compileRig');
}
