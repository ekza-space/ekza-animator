// ↑/↓ value nudges in a Channel Box field (FR-CB-03, research 09 §4.5): ±step (Shift ×10, Alt ×0.1) on every
// selected control, relative to each control's own value. A burst — key presses and auto-repeat until the arrow is
// released, Enter, Tab, blur or Esc — is ONE interactive edit: a `beginChannelEditGesture` (live preview, one
// history step, auto-key on commit). M2a: attribute rows nudge in their display unit (1° on `angle` attributes).
import type { ChannelId, ControlId } from '@ekza-studio/doc';
import {
  type ChannelEditGesture,
  type ChannelUnit,
  channelUnit,
  clampChannelValue,
  type EditorApp,
  type PanelKind,
} from '@ekza-studio/editor-core';
import { fromDisplayValue, isRotationChannel, startChannelEditGesture, toDisplayValue } from './kit/kernel';
import { type ChannelReadout, readoutValueKey } from './readout';

/** Display units per press: 1° for rotations and angle attributes, 0.01 for translations (metres), scales and others. */
export function nudgeStep(
  channel: ChannelId,
  modifiers: { readonly shift: boolean; readonly alt: boolean },
  unit?: ChannelUnit,
): number {
  const base = (unit === undefined ? isRotationChannel(channel) : unit === 'angle') ? 1 : 0.01;
  return base * (modifiers.shift ? 10 : modifiers.alt ? 0.1 : 1);
}

interface NudgeEdit {
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly value: number;
}

interface Burst {
  readonly label: string;
  /** `${control}/${channel}` → value when the burst started (internal units). */
  readonly base: ReadonlyMap<
    string,
    { readonly control: ControlId; readonly channel: ChannelId; readonly value: number }
  >;
  readonly signature: string;
  readonly offset: Map<ChannelId, number>;
  readonly gesture: ChannelEditGesture;
  edits: readonly NudgeEdit[];
}

export class ChannelNudge {
  readonly #app: EditorApp;
  readonly #readout: ChannelReadout;
  #burst: Burst | null = null;

  /** `_panel`: the panel kind the nudges come from (kept for the call sites; the gesture needs no run context). */
  constructor(app: EditorApp, readout: ChannelReadout, _panel: PanelKind) {
    this.#app = app;
    this.#readout = readout;
  }

  get active(): boolean {
    return this.#burst !== null;
  }

  /**
   * Adds `delta` (display units) to each channel of `targets` on its controls. A press on other channels or
   * controls than the running burst first ends that burst.
   */
  press(targets: ReadonlyMap<ChannelId, readonly ControlId[]>, delta: number, label: string): void {
    const signature = [...targets].map(([channel, ids]) => `${channel}:${ids.join(',')}`).join(';');
    if (this.#burst !== null && this.#burst.signature !== signature) this.end(false);
    let burst = this.#burst;
    if (burst === null) {
      const base = new Map<string, { control: ControlId; channel: ChannelId; value: number }>();
      for (const [channel, controls] of targets) {
        for (const control of controls) {
          base.set(readoutValueKey(control, channel), {
            control,
            channel,
            value: this.#readout.value(control, channel),
          });
        }
      }
      burst = {
        label,
        base,
        signature,
        offset: new Map(),
        gesture: startChannelEditGesture(this.#app, label, { key: 'auto' }),
        edits: [],
      };
      this.#burst = burst;
    }
    for (const channel of targets.keys()) burst.offset.set(channel, (burst.offset.get(channel) ?? 0) + delta);
    burst.edits = [...burst.base.values()].map(({ control, channel, value }) => {
      const record = this.#app.store.get('controls', control);
      const unit = channelUnit(record ?? null, channel);
      const shown = toDisplayValue(channel, value, unit) + (burst.offset.get(channel) ?? 0);
      return { control, channel, value: clampChannelValue(record, channel, fromDisplayValue(channel, shown, unit)) };
    });
    burst.gesture.update(burst.edits);
  }

  /** Ends the burst: commits it, or with `cancel` restores the values from before it. No-op without a burst. */
  end(cancel: boolean): void {
    const burst = this.#burst;
    if (burst === null) return;
    this.#burst = null;
    if (cancel) burst.gesture.cancel();
    else burst.gesture.commit();
  }
}
