import type { ChannelId } from '@ekza-animator/doc';

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

const AXIS_LABEL: Readonly<Record<string, string>> = { t: 'Translate', r: 'Rotate', s: 'Scale' };

/** 'Translate X', 'Rotate Z', 'Scale Y'; custom attributes show their name without the '@'. */
export function channelLabel(channel: ChannelId): string {
  if (channel.startsWith('@')) return channel.slice(1);
  const group = AXIS_LABEL[channel[0] ?? ''];
  const axis = channel[1]?.toUpperCase();
  return group === undefined || axis === undefined ? channel : `${group} ${axis}`;
}
