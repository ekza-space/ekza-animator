// WP-3 stub: final signature (MVP-SPEC §7 WP-3, §4.11.20); throws until mirroring lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId } from '@ekza-animator/doc';
import type { MirrorMode, RigProgram } from '../types';

export function mirrorPose(
  _program: RigProgram,
  _values: ReadonlyMap<ControlId, ChannelValues>,
  _mode: MirrorMode,
  _scope: ReadonlySet<ControlId> | null,
): { readonly values: Map<ControlId, ChannelValues>; readonly warnings: readonly string[] } {
  throw new EkzaError('not-implemented', 'rig.mirrorPose');
}
