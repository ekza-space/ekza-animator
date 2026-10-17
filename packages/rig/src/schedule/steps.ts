// WP-3 stub: final signature (MVP-SPEC §7 WP-3, §4.11.10); throws until the bake step schedule lands.
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { ClipSampler, RigProgram, TrackKey } from '../types';

export function computeStepSchedule(
  _program: RigProgram,
  _sampler: ClipSampler,
  _range: { readonly start: Frame; readonly end: Frame },
  _target: 'raw' | 'humanoid',
): ReadonlyMap<TrackKey, readonly Frame[]> {
  throw new EkzaError('not-implemented', 'rig.computeStepSchedule');
}
