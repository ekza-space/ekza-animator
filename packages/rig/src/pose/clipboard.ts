// WP-3 stubs: final signatures (MVP-SPEC §7 WP-3); bodies throw until the pose clipboard lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, RigRecord } from '@ekza-animator/doc';
import type { PoseClipboard, RigProgram } from '../types';

export function makePoseClipboard(
  _program: RigProgram,
  _rig: RigRecord,
  _values: ReadonlyMap<ControlId, ChannelValues>,
): PoseClipboard {
  throw new EkzaError('not-implemented', 'rig.makePoseClipboard');
}

export function applyPoseClipboard(
  _clip: PoseClipboard,
  _program: RigProgram,
  _mode: 'local' | 'mirrored',
): Map<ControlId, ChannelValues> {
  throw new EkzaError('not-implemented', 'rig.applyPoseClipboard');
}
