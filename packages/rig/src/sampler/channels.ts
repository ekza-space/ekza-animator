import { EkzaError } from '@ekza-animator/anim-core';
import type { ChannelId, ChannelValues, ControlId, ControlRecord, TrsChannel } from '@ekza-animator/doc';
import { CHANNELS_PER_CONTROL, type ChannelBuffer, type RigProgram } from '../types';

// Channel slots: tx ty tz rx ry rz sx sy sz (CHANNELS_PER_CONTROL per control); custom attributes ('@name') have no
// slot in the MVP.

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

/** Default value of a channel: 1 for scale, 0 otherwise (custom attributes default to 0 here). */
export function channelDefaultValue(channel: ChannelId): number {
  return channel === 'sx' || channel === 'sy' || channel === 'sz' ? 1 : 0;
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

/** Writes the given TRS channels (others keep their values); custom attributes and non-finite values are ignored. */
export function writeControlChannels(
  program: RigProgram,
  ch: ChannelBuffer,
  control: ControlId,
  values: ChannelValues,
): void {
  const o = controlSlotOf(program, control) * CHANNELS_PER_CONTROL;
  writeSlots(ch, o, values);
}

/** Writes session pose overrides over sampled channels; overrides of controls outside the program are skipped. */
export function applyOverrides(
  program: RigProgram,
  ch: ChannelBuffer,
  overrides: ReadonlyMap<ControlId, ChannelValues>,
): void {
  for (const [control, values] of overrides) {
    const index = program.controlIndex.get(control);
    if (index === undefined) continue;
    writeSlots(ch, index * CHANNELS_PER_CONTROL, values);
  }
}

function writeSlots(ch: ChannelBuffer, offset: number, values: ChannelValues): void {
  for (const key in values) {
    const slot = TRS_SLOT[key as TrsChannel];
    if (slot === undefined) continue;
    const value = values[key as TrsChannel];
    if (value === undefined || !Number.isFinite(value)) continue;
    ch.values[offset + slot] = value;
  }
}
