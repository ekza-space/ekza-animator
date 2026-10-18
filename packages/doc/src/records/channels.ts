// Channel helpers (MVP-SPEC §4.2 `ChannelId`, §4.11.8 defaults).
import type { ChannelId } from '../records';

/** Rest value of a channel: 1 for sx/sy/sz, 0 otherwise (custom `@attr` channels default to 0 here). */
export function defaultChannelValue(channel: ChannelId): number {
  return channel === 'sx' || channel === 'sy' || channel === 'sz' ? 1 : 0;
}

/** True for the Euler rotation channels rx, ry, rz (radians internally, degrees in the UI). */
export function isRotationChannel(channel: ChannelId): boolean {
  return channel === 'rx' || channel === 'ry' || channel === 'rz';
}
