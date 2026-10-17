// WP-3 stubs: final signatures (MVP-SPEC §7 WP-3); bodies throw until channel buffers land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, TrsChannel } from '@ekza-animator/doc';
import type { ChannelBuffer, RigProgram } from '../types';

export function readControlChannels(
  _program: RigProgram,
  _ch: ChannelBuffer,
  _control: ControlId,
): Record<TrsChannel, number> {
  throw new EkzaError('not-implemented', 'rig.readControlChannels');
}

export function writeControlChannels(
  _program: RigProgram,
  _ch: ChannelBuffer,
  _control: ControlId,
  _values: ChannelValues,
): void {
  throw new EkzaError('not-implemented', 'rig.writeControlChannels');
}

export function applyOverrides(
  _program: RigProgram,
  _ch: ChannelBuffer,
  _overrides: ReadonlyMap<ControlId, ChannelValues>,
): void {
  throw new EkzaError('not-implemented', 'rig.applyOverrides');
}
