// Facts about channels used across the kernel: buffer slots (rig CHANNELS_PER_CONTROL layout), rotation channels
// (degrees in the UI), defaults (0, or 1 for scale) and the keyable/locked flags of a control; M2a: display units and
// defaults of custom attribute channels ('@name', M2A-SPEC §5.1 rules 5–6).
import type { TangentType } from '@ekza-studio/anim-core';
import type { AttrDef, ChannelId, ControlRecord, TrsChannel } from '@ekza-studio/doc';
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
const TRS_CHANNELS_COUNT = Object.keys(SLOTS).length;

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

/** Flag lookup for `ControlRecord.keyable` / `.locked` of a TRS channel (false for anything else). */
function axisFlag(flags: ControlRecord['keyable'], channel: ChannelId): boolean {
  const slot = trsSlot(channel);
  if (slot === -1) return false;
  const group = slot < 3 ? flags.t : slot < 6 ? flags.r : flags.s;
  return group[slot % 3] === true;
}

/**
 * Keyable channel: a TRS channel by `ControlRecord.keyable`, a '@name' attribute by `AttrDef.keyable` (M2A-SPEC
 * §5.1 rule 1: attribute curves, keys, statics and overrides work like TRS channels); unknown attributes are not.
 */
export function isKeyable(control: ControlRecord, channel: ChannelId): boolean {
  if (channel.startsWith('@')) return attrDefOf(control, channel)?.keyable === true;
  return axisFlag(control.keyable, channel);
}

/** Locked channel (`ControlRecord.locked`); attributes cannot be locked in M2a (M2A-SPEC §5.1 rule 1). */
export function isLocked(control: ControlRecord, channel: ChannelId): boolean {
  return axisFlag(control.locked, channel);
}

/** Whether a channel id names a custom attribute ('@name'). */
export function isAttrChannel(channel: ChannelId): channel is `@${string}` {
  return channel.startsWith('@');
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

/** The '@name' channels of a control's attributes, in `attrs` key order (the Channels panel row order, §5.1 rule 5). */
export function attrChannelsOf(control: ControlRecord | null | undefined): readonly `@${string}`[] {
  const attrs: Readonly<Record<string, AttrDef>> | undefined = control?.attrs;
  if (typeof attrs !== 'object' || attrs === null) return [];
  const out: `@${string}`[] = [];
  for (const name of Object.keys(attrs)) {
    const def = attrs[name];
    if (typeof def === 'object' && def !== null) out.push(`@${name}`);
  }
  return out;
}

/**
 * M2A-SPEC §5.1 rule 4: `false` for a `keyAll: false` attribute (a mode or setting such as `ikFk` or `soft`), which
 * `S` with 'all' or 'attributes', body-part keying, the tween 'frame' target, the pose clipboard and
 * `pose.resetToRest` skip unless it is a channel selected in the Channels panel; `true` for TRS channels and other
 * attributes.
 */
export function isKeyAllChannel(control: ControlRecord | null | undefined, channel: ChannelId): boolean {
  if (!isAttrChannel(channel)) return true;
  return attrDefOf(control, channel)?.keyAll !== false;
}

/** Title case of an attribute name: 'heelTwist' → 'Heel Twist', 'ikFk' → 'Ik Fk'. */
export function titleCaseAttr(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * The Channels panel and Graph Editor label of an attribute channel: `AttrDef.label`, else the title-cased name
 * (§5.1 rule 5).
 */
export function attrLabel(control: ControlRecord | null | undefined, channel: ChannelId): string {
  const def = attrDefOf(control, channel);
  const label = def?.label;
  if (typeof label === 'string' && label.trim() !== '') return label;
  return titleCaseAttr(channel.startsWith('@') ? channel.slice(1) : channel);
}

/** Names of the TRS channels (FR-CB-01: the Channels panel's row names). */
export const TRS_CHANNEL_LABEL: Readonly<Record<TrsChannel, string>> = {
  tx: 'Translate X',
  ty: 'Translate Y',
  tz: 'Translate Z',
  rx: 'Rotate X',
  ry: 'Rotate Y',
  rz: 'Rotate Z',
  sx: 'Scale X',
  sy: 'Scale Y',
  sz: 'Scale Z',
};

/** The limb IK/FK switch attribute (§5.2): the Channels panel shows it as the IK/FK row, below the attributes. */
const IK_FK: ChannelId = '@ikFk';

/**
 * The name of a channel of `control` wherever channels are listed — Channels panel, Graph Editor, Dope Sheet, virtual
 * slider (§5.1 rule 5): the TRS names, an attribute's `AttrDef.label`, else its title-cased name ('@heelTwist' →
 * 'Heel Twist'; `@ikFk` → 'IK/FK' by its label).
 */
export function channelDisplayLabel(control: ControlRecord | null | undefined, channel: ChannelId): string {
  if (isAttrChannel(channel)) return attrLabel(control, channel);
  return isTrsChannel(channel) ? TRS_CHANNEL_LABEL[channel] : channel;
}

/**
 * `channels` of `control` in the Channels panel's row order, for every panel that lists channels (§5.1 rule 5;
 * acceptance fix round 2, M2A-INT-35): TRS in the usual Channels panel order (tx ty tz, rx ry rz, sx sy sz), then the
 * control's attributes in `attrs` key order with `@ikFk` after them (where the Channels panel shows the limb's IK/FK
 * row), then attribute channels the control does not define (a curve left by a removed attribute) by id.
 */
export function sortChannelsForDisplay(
  control: ControlRecord | null | undefined,
  channels: Iterable<ChannelId>,
): ChannelId[] {
  const attrs = attrChannelsOf(control);
  const rank = (channel: ChannelId): number => {
    const slot = trsSlot(channel);
    if (slot !== -1) return slot;
    const index = (attrs as readonly ChannelId[]).indexOf(channel);
    if (index === -1) return TRS_CHANNELS_COUNT + attrs.length + 1;
    return TRS_CHANNELS_COUNT + (channel === IK_FK ? attrs.length : index);
  };
  return [...channels]
    .map((channel) => ({ channel, rank: rank(channel) }))
    .sort((a, b) => a.rank - b.rank || (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0))
    .map((entry) => entry.channel);
}

/**
 * The value an attribute accepts: clamped to `AttrDef.min`/`max` (the ones that are finite numbers); unchanged for
 * TRS channels and attributes without a range. Used where a value is produced for an attribute (virtual slider,
 * tween), never on curves (§5.1 rule 3).
 */
export function clampChannelValue(
  control: ControlRecord | null | undefined,
  channel: ChannelId,
  value: number,
): number {
  const def = attrDefOf(control, channel);
  if (def === undefined) return value;
  let out = value;
  if (typeof def.min === 'number' && Number.isFinite(def.min) && out < def.min) out = def.min;
  if (typeof def.max === 'number' && Number.isFinite(def.max) && out > def.max) out = def.max;
  return out;
}

/**
 * Tangents of a NEW key on a channel (§5.1 rule 4): an attribute with `stepped: true` gets in 'flat', out 'step'
 * (a mode switch holds until the next key); everything else the preference's default tangents.
 */
export function newKeyTangents(
  control: ControlRecord | null | undefined,
  channel: ChannelId,
  defaults: { readonly in: TangentType; readonly out: TangentType },
): { readonly in: TangentType; readonly out: TangentType } {
  return attrDefOf(control, channel)?.stepped === true ? STEPPED_TANGENTS : defaults;
}

const STEPPED_TANGENTS = { in: 'flat', out: 'step' } as const satisfies {
  readonly in: TangentType;
  readonly out: TangentType;
};
