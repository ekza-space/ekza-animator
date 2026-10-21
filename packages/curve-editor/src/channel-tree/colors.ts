import type { ChannelId, ControlRecord } from '@ekza-studio/doc';
import { channelDisplayLabel } from '@ekza-studio/editor-core';

/** Channel swatch and curve colours: research 09 §8.2 `--axis-x/y/z` and `--channel-other`. */
export const CHANNEL_COLORS: { readonly x: string; readonly y: string; readonly z: string; readonly other: string } = {
  x: '#ff5f69',
  y: '#5fd36e',
  z: '#4f8dff',
  other: '#3fd1d9',
};

/** X red, Y green, Z blue for the TRS channels; cyan for custom attributes. */
export function channelColor(channel: ChannelId): string {
  if (channel.startsWith('@') || channel.length !== 2) return CHANNEL_COLORS.other;
  switch (channel[1]) {
    case 'x':
      return CHANNEL_COLORS.x;
    case 'y':
      return CHANNEL_COLORS.y;
    case 'z':
      return CHANNEL_COLORS.z;
    case undefined:
    default:
      return CHANNEL_COLORS.other;
  }
}

/**
 * The Channel Box's name of a channel (§5.1 rule 5): 'Translate X', 'Rotate Z', 'Scale Y'; an attribute of `control`
 * by its `AttrDef.label` or title-cased name ('@heelTwist' → 'Heel Twist', `@ikFk` → 'IK/FK'). Before acceptance fix
 * round 2 (M2A-INT-35) attributes showed their raw name ('heelTwist').
 */
export function channelLabel(channel: ChannelId, control?: ControlRecord | null): string {
  return channelDisplayLabel(control, channel);
}
