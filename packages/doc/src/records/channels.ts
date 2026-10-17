// WP-2 stubs: final signatures (MVP-SPEC §7 WP-2); bodies throw until record helpers land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelId } from '../records';

/** 0, or 1 for sx/sy/sz. */
export function defaultChannelValue(_channel: ChannelId): number {
  throw new EkzaError('not-implemented', 'doc.defaultChannelValue');
}

export function isRotationChannel(_channel: ChannelId): boolean {
  throw new EkzaError('not-implemented', 'doc.isRotationChannel');
}
