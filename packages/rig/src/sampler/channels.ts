import { EkzaError } from '@ekza-animator/anim-core';
import type { AttrDef, ChannelId, ChannelValues, ControlId, ControlRecord, TrsChannel } from '@ekza-animator/doc';
import { type AttrKey, CHANNELS_PER_CONTROL, type ChannelBuffer, type RigProgram } from '../types';

// Channel slots: tx ty tz rx ry rz sx sy sz (CHANNELS_PER_CONTROL per control) in `ChannelBuffer.values`; custom
// attributes ('@name', M2A-SPEC §5.1) have one slot each in `ChannelBuffer.attrs`, numbered by `RigProgram.attrIndex`.

export const TRS_SLOT: Readonly<Record<TrsChannel, number>> = {
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

export const SLOT_CHANNELS: readonly TrsChannel[] = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];

/** Slot 0..8 of a TRS channel, −1 for custom attributes and unknown channels. */
export function channelSlot(channel: ChannelId): number {
  return TRS_SLOT[channel as TrsChannel] ?? -1;
}

/**
 * Default value of a channel: 1 for scale, 0 for the other TRS channels; a custom attribute ('@name') takes
 * `def.default` when its definition is given (M2A-SPEC §4.5 `unit`/`def` additions), else 0.
 */
export function channelDefaultValue(channel: ChannelId, def?: AttrDef): number {
  if (channel.startsWith('@')) return def !== undefined && Number.isFinite(def.default) ? def.default : 0;
  return channel === 'sx' || channel === 'sy' || channel === 'sz' ? 1 : 0;
}

/** Key of an attribute slot: `${control}/@${name}`. */
export function attrKey(control: ControlId, name: string): AttrKey {
  return `${control}/@${name}`;
}

/** The `ChannelBuffer.attrs` slot of an attribute, −1 when the program has no such control or attribute. */
export function attrSlotOf(program: RigProgram, control: ControlId, name: string): number {
  return program.attrIndex.get(attrKey(control, name)) ?? -1;
}

/** Slot of an attribute channel ('@name') of a control, −1 for TRS channels and unknown attributes. */
export function attrChannelSlot(program: RigProgram, control: ControlId, channel: ChannelId): number {
  return channel.startsWith('@') ? attrSlotOf(program, control, channel.slice(1)) : -1;
}

/** Value of a custom attribute in `ch` (M2A-SPEC §5.1); undefined when the control or attribute is unknown. */
export function readAttr(program: RigProgram, ch: ChannelBuffer, control: ControlId, name: string): number | undefined {
  const slot = attrSlotOf(program, control, name);
  return slot === -1 || slot >= ch.attrs.length ? undefined : ch.attrs[slot];
}

/**
 * Writes a custom attribute into `ch`. Unknown controls or attributes and non-finite values are ignored (like the
 * TRS writers ignore custom channels without a slot); values are never clamped here (§5.1 rule 3: ranges clamp where
 * they are consumed).
 */
export function writeAttr(
  program: RigProgram,
  ch: ChannelBuffer,
  control: ControlId,
  name: string,
  value: number,
): void {
  const slot = attrSlotOf(program, control, name);
  if (slot === -1 || slot >= ch.attrs.length || !Number.isFinite(value)) return;
  ch.attrs[slot] = value;
}

export function slotDefault(slot: number): number {
  return slot >= 6 ? 1 : 0;
}

export function isRotationSlot(slot: number): boolean {
  return slot >= 3 && slot < 6;
}

/** Whether the control's TRS channel at `slot` is keyable. */
export function isSlotKeyable(control: ControlRecord, slot: number): boolean {
  const group = slot < 3 ? control.keyable.t : slot < 6 ? control.keyable.r : control.keyable.s;
  return group[slot % 3] === true;
}

export function controlSlotOf(program: RigProgram, control: ControlId): number {
  const index = program.controlIndex.get(control);
  if (index === undefined) {
    throw new EkzaError('invalid-record', `Control ${control} is not part of rig program ${program.rigId}`, {
      control,
    });
  }
  return index;
}

export function readControlChannels(
  program: RigProgram,
  ch: ChannelBuffer,
  control: ControlId,
): Record<TrsChannel, number> {
  const o = controlSlotOf(program, control) * CHANNELS_PER_CONTROL;
  const v = ch.values;
  return {
    tx: v[o] as number,
    ty: v[o + 1] as number,
    tz: v[o + 2] as number,
    rx: v[o + 3] as number,
    ry: v[o + 4] as number,
    rz: v[o + 5] as number,
    sx: v[o + 6] as number,
    sy: v[o + 7] as number,
    sz: v[o + 8] as number,
  };
}

/**
 * Writes the given channels (others keep their values): TRS channels and the control's custom attributes ('@name');
 * unknown attributes and non-finite values are ignored.
 */
export function writeControlChannels(
  program: RigProgram,
  ch: ChannelBuffer,
  control: ControlId,
  values: ChannelValues,
): void {
  const o = controlSlotOf(program, control) * CHANNELS_PER_CONTROL;
  writeSlots(program, ch, control, o, values);
}

/**
 * Writes session pose overrides over sampled channels, attributes included (M2A-SPEC §5.1 rule 3: overrides apply
 * after sampling); overrides of controls outside the program are skipped.
 */
export function applyOverrides(
  program: RigProgram,
  ch: ChannelBuffer,
  overrides: ReadonlyMap<ControlId, ChannelValues>,
): void {
  for (const [control, values] of overrides) {
    const index = program.controlIndex.get(control);
    if (index === undefined) continue;
    writeSlots(program, ch, control, index * CHANNELS_PER_CONTROL, values);
  }
}

function writeSlots(
  program: RigProgram,
  ch: ChannelBuffer,
  control: ControlId,
  offset: number,
  values: ChannelValues,
): void {
  for (const key in values) {
    const value = values[key as ChannelId];
    if (value === undefined || !Number.isFinite(value)) continue;
    const slot = TRS_SLOT[key as TrsChannel];
    if (slot !== undefined) {
      ch.values[offset + slot] = value;
    } else if (key.startsWith('@')) {
      const attr = attrSlotOf(program, control, key.slice(1));
      if (attr !== -1 && attr < ch.attrs.length) ch.attrs[attr] = value;
    }
  }
}
