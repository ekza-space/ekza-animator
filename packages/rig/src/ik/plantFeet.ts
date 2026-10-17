// WP-3 stub: final signature (MVP-SPEC §7 WP-3, §4.11.19); throws until plant feet lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId } from '@ekza-animator/doc';
import type { FootPin, PoseBuffers, RigProgram } from '../types';

export function plantFeetChannels(
  _program: RigProgram,
  _pose: PoseBuffers,
  _pins: readonly FootPin[],
  _reference: ReadonlyMap<ControlId, ChannelValues>,
): { readonly values: Map<ControlId, ChannelValues>; readonly reached: boolean; readonly warnings: readonly string[] } {
  throw new EkzaError('not-implemented', 'rig.plantFeetChannels');
}
