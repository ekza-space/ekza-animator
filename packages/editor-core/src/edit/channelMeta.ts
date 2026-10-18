// Facts about channels used across the kernel: buffer slots (rig CHANNELS_PER_CONTROL layout), rotation channels
// (degrees in the UI), defaults (0, or 1 for scale) and the keyable/locked flags of a control; M2a: display units and
// defaults of custom attribute channels ('@name', M2A-SPEC §5.1 rules 5–6).
import type { AttrDef, ChannelId, ControlRecord, TrsChannel } from '@ekza-animator/doc';
import type { ChannelUnit } from '../types';

const SLOTS: Readonly<Record<TrsChannel, number>> = {
  tx: 0,
  ty: 1,
  tz: 2,
  rx: 3,
  ry: 4,
  rz: 5,
  sx: 6,
  sy: 7,
  sz: 8,
};

export const TRANSLATE_CHANNELS = ['tx', 'ty', 'tz'] as const;
export const ROTATE_CHANNELS = ['rx', 'ry', 'rz'] as const;
export const SCALE_CHANNELS = ['sx', 'sy', 'sz'] as const;

export function isTrsChannel(channel: ChannelId): channel is TrsChannel {
  return Object.hasOwn(SLOTS, channel);
}

/** Slot in a control's 9-value channel block (tx ty tz rx ry rz sx sy sz), or -1 for custom attributes. */
export function trsSlot(channel: ChannelId): number {
  return isTrsChannel(channel) ? SLOTS[channel] : -1;
}

/** Rotation channels are radians internally and degrees in the UI. */
export function isRotation(channel: ChannelId): boolean {
  return channel === 'rx' || channel === 'ry' || channel === 'rz';
}

/** The value of a channel without curve, static value or override: 1 for scale, else 0. */
export function channelDefault(channel: ChannelId): number {
  return channel === 'sx' || channel === 'sy' || channel === 'sz' ? 1 : 0;
}

/** Flag lookup for `ControlRecord.keyable` / `.locked`; custom attributes (`@name`) are neither in the MVP. */
function axisFlag(flags: ControlRecord['keyable'], channel: ChannelId): boolean {
  const slot = trsSlot(channel);
  if (slot === -1) return false;
  const group = slot < 3 ? flags.t : slot < 6 ? flags.r : flags.s;
  return group[slot % 3] === true;
}

export function isKeyable(control: ControlRecord, channel: ChannelId): boolean {
  return axisFlag(control.keyable, channel);
}

export function isLocked(control: ControlRecord, channel: ChannelId): boolean {
  return axisFlag(control.locked, channel);
}

/** The attribute definition behind a '@name' channel of `control` (undefined for TRS channels and unknown names). */
export function attrDefOf(control: ControlRecord | null | undefined, channel: ChannelId): AttrDef | undefined {
  if (control === null || control === undefined || !channel.startsWith('@')) return undefined;
  const attrs = control.attrs as Readonly<Record<string, AttrDef>> | undefined;
  if (typeof attrs !== 'object' || attrs === null) return undefined;
  const name = channel.slice(1);
  return Object.hasOwn(attrs, name) ? attrs[name] : undefined;
}

/**
 * M2A-SPEC §5.1 rule 5 (A0): display unit of a TRS channel or a '@name' attribute of `control`: rotations are
 * angles (degrees in the UI), translations distances (metres), scale plain numbers; an attribute takes its
 * `AttrDef.unit`, else a plain number (also for unknown attributes and a null control).
 */
export function channelUnit(control: ControlRecord | null, channel: ChannelId): ChannelUnit {
  if (isRotation(channel)) return 'angle';
  if (channel === 'tx' || channel === 'ty' || channel === 'tz') return 'distance';
  const unit = attrDefOf(control, channel)?.unit;
  return unit === 'angle' || unit === 'distance' ? unit : 'none';
}

/**
 * M2A-SPEC §5.1 rule 6 (A0): default of a TRS channel (M1 `channelDefault`: 1 for scale, else 0) or of a '@name'
 * attribute (`AttrDef.default`; 0 when the attribute or its default is unknown).
 */
export function channelDefaultOf(control: ControlRecord | null, channel: ChannelId): number {
  if (!channel.startsWith('@')) return channelDefault(channel);
  const value = attrDefOf(control, channel)?.default;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
