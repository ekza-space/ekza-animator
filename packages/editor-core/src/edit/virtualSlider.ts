// Channel Box virtual slider (M2A-SPEC §5.18, FR-CB-05; A2): a horizontal drag that changes channel values by a rate
// per pixel, as one channel-edit gesture (preview, coalesced updates, ONE history step, auto-key on release by the
// M1 rules). The DOM side (Pointer Lock or pointer capture, `movementX`, Esc) lives with the panels; this kernel
// part only integrates pixel increments.
//
// Rate per pixel of horizontal motion: rotation channels and `angle` attributes `prefs.virtualSlider.degPerPx`
// (0.5°); translations and `distance` attributes `metresPerPx` (0.01 m); scale `unitsPerPx` (0.01); attributes with
// a `min` and a `max`: `(max − min)/200`; other attributes `unitsPerPx`. Shift ×0.1 and Mod ×10 are read at each
// move, so the value integrates increments. Values are relative per control (start value + motion) and clamped to an
// attribute's range.
import { DEG2RAD } from '@ekza-animator/anim-core';
import type { ChannelId, ControlRecord } from '@ekza-animator/doc';
import type { ChannelEdit, ChannelEditGesture, ChannelRef, EditorApp, Prefs } from '../types';
import {
  attrDefOf,
  channelDisplayLabel,
  channelUnit,
  clampChannelValue,
  isKeyable,
  isLocked,
  isRotation,
} from './channelMeta';
import { beginChannelEditGesture } from './channels';

/** Modifier factors of the virtual slider (§5.18): Shift slows down, Mod speeds up. */
export const VIRTUAL_SLIDER_SHIFT = 0.1;
export const VIRTUAL_SLIDER_MOD = 10;

/** Rate of a channel in internal units (radians, metres, plain) per pixel at no modifier. */
export function virtualSliderRate(
  prefs: Pick<Prefs, 'virtualSlider'>,
  control: ControlRecord | null,
  channel: ChannelId,
): number {
  const rates = prefs.virtualSlider;
  const unit = channelUnit(control, channel);
  if (isRotation(channel) || unit === 'angle') return rates.degPerPx * DEG2RAD;
  if (unit === 'distance') return rates.metresPerPx;
  if (channel === 'sx' || channel === 'sy' || channel === 'sz') return rates.unitsPerPx;
  const def = attrDefOf(control, channel);
  if (
    def !== undefined &&
    typeof def.min === 'number' &&
    typeof def.max === 'number' &&
    Number.isFinite(def.min) &&
    Number.isFinite(def.max) &&
    def.max > def.min
  ) {
    return (def.max - def.min) / 200;
  }
  return rates.unitsPerPx;
}

/** Factor of a move's modifiers (read at each move). */
export function virtualSliderFactor(mods: { readonly shift: boolean; readonly mod: boolean }): number {
  return (mods.shift ? VIRTUAL_SLIDER_SHIFT : 1) * (mods.mod ? VIRTUAL_SLIDER_MOD : 1);
}

/** Label of the gesture's history step ('Drag Rotate Z', 'Drag Roll', 'Drag 3 Channels'). */
export function virtualSliderLabel(app: EditorApp, refs: readonly ChannelRef[]): string {
  const channels = [...new Set(refs.map((ref) => ref.channel))];
  if (channels.length !== 1) return `Drag ${channels.length} Channels`;
  const channel = channels[0] as ChannelId;
  const control = refs[0] === undefined ? undefined : app.store.get('controls', refs[0].control);
  return `Drag ${channelDisplayLabel(control, channel)}`;
}

export interface VirtualSlider {
  readonly active: boolean;
  /** The channels the gesture edits (keyable and unlocked ones of the requested refs). */
  readonly refs: readonly ChannelRef[];
  /** Adds a horizontal motion (`PointerEvent.movementX`, CSS px) with the modifiers held during that move. */
  move(dxPx: number, mods: { readonly shift: boolean; readonly mod: boolean }): void;
  /** Ends the drag: one history step (none when nothing changed). */
  commit(): void;
  /** Esc, a lost Pointer Lock, blur: restores the values. */
  cancel(): void;
}

/**
 * Starts a virtual slider over `refs` (each `{ control, channel }` once): the start values are the current values
 * (curves ⊕ overrides), so motion is relative per control. Channels that are not keyable or are locked are left out;
 * with none left the slider is inactive and does nothing.
 */
export function beginVirtualSlider(
  app: EditorApp,
  refs: readonly ChannelRef[],
  opts?: { readonly label?: string },
): VirtualSlider {
  const seen = new Set<string>();
  const usable: {
    readonly ref: ChannelRef;
    readonly control: ControlRecord;
    readonly start: number;
    readonly rate: number;
  }[] = [];
  const prefs = app.prefs.getState();
  for (const ref of refs) {
    const key = `${ref.control}\u0000${ref.channel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const control = app.store.get('controls', ref.control);
    if (control === undefined || !isKeyable(control, ref.channel) || isLocked(control, ref.channel)) continue;
    usable.push({
      ref: { control: ref.control, channel: ref.channel },
      control,
      start: app.evaluation.channelValue(ref.control, ref.channel),
      rate: virtualSliderRate(prefs, control, ref.channel),
    });
  }
  const chosen = usable.map((entry) => entry.ref);
  let gesture: ChannelEditGesture | null = null;
  let px = 0;
  let done = usable.length === 0;
  const label = opts?.label ?? virtualSliderLabel(app, chosen);

  return {
    get active() {
      return !done;
    },
    refs: chosen,
    move(dxPx, mods) {
      if (done || !Number.isFinite(dxPx) || dxPx === 0) return;
      px += dxPx * virtualSliderFactor(mods);
      gesture ??= beginChannelEditGesture(app, label, { key: 'auto' });
      if (!gesture.active) {
        // Cancelled from outside (Esc through edit.escape): the slider ends too.
        done = true;
        return;
      }
      const edits: ChannelEdit[] = usable.map((entry) => ({
        control: entry.ref.control,
        channel: entry.ref.channel,
        value: clampChannelValue(entry.control, entry.ref.channel, entry.start + px * entry.rate),
      }));
      gesture.update(edits);
    },
    commit() {
      if (done) return;
      done = true;
      gesture?.commit();
    },
    cancel() {
      if (done) return;
      done = true;
      gesture?.cancel();
    },
  };
}
