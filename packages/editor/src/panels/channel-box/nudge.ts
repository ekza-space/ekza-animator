// ↑/↓ value nudges in a Channel Box field (FR-CB-03, research 09 §4.5): ±step (Shift ×10, Alt ×0.1) on every
// selected control, relative to each control's own value. A burst — key presses and auto-repeat until the arrow is
// released, Enter, Tab, blur or Esc — is ONE interactive edit: a `beginChannelEditGesture` (live preview, one
// history step, auto-key on commit). While the edit kernel is not implemented the burst is shown in the fields and
// written by one `channel.setValues` run when it ends (wp-notes D-1).
import type { ControlId, TrsChannel } from '@ekza-animator/doc';
import type { ChannelEditGesture, EditorApp, PanelKind } from '@ekza-animator/editor-core';
import { fromDisplayValue, isRotationChannel, startChannelEditGesture, toDisplayValue } from './kit/kernel';
import { runOperator } from './kit/run';
import { type ChannelReadout, readoutValueKey } from './readout';

/** Display units per press: 1° for rotations, 0.01 for translations (metres) and scales. */
export function nudgeStep(channel: TrsChannel, modifiers: { readonly shift: boolean; readonly alt: boolean }): number {
  const base = isRotationChannel(channel) ? 1 : 0.01;
  return base * (modifiers.shift ? 10 : modifiers.alt ? 0.1 : 1);
}

interface NudgeEdit {
  readonly control: ControlId;
  readonly channel: TrsChannel;
  readonly value: number;
}

interface Burst {
  readonly id: number;
  readonly label: string;
  /** `${control}/${channel}` → value when the burst started (internal units). */
  readonly base: ReadonlyMap<
    string,
    { readonly control: ControlId; readonly channel: TrsChannel; readonly value: number }
  >;
  readonly signature: string;
  readonly offset: Map<TrsChannel, number>;
  readonly gesture: ChannelEditGesture | null;
  edits: readonly NudgeEdit[];
}

export class ChannelNudge {
  readonly #app: EditorApp;
  readonly #readout: ChannelReadout;
  readonly #panel: PanelKind;
  #burst: Burst | null = null;
  #bursts = 0;
  /** The burst whose values the readout shows as pending (deferred mode). */
  #pendingBurst: number | null = null;

  constructor(app: EditorApp, readout: ChannelReadout, panel: PanelKind) {
    this.#app = app;
    this.#readout = readout;
    this.#panel = panel;
  }

  get active(): boolean {
    return this.#burst !== null;
  }

  /**
   * Adds `delta` (display units) to each channel of `targets` on its controls. A press on other channels or
   * controls than the running burst first ends that burst.
   */
  press(targets: ReadonlyMap<TrsChannel, readonly ControlId[]>, delta: number, label: string): void {
    const signature = [...targets].map(([channel, ids]) => `${channel}:${ids.join(',')}`).join(';');
    if (this.#burst !== null && this.#burst.signature !== signature) this.end(false);
    let burst = this.#burst;
    if (burst === null) {
      const base = new Map<string, { control: ControlId; channel: TrsChannel; value: number }>();
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
        id: ++this.#bursts,
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
    burst.edits = [...burst.base.values()].map(({ control, channel, value }) => ({
      control,
      channel,
      value: fromDisplayValue(channel, toDisplayValue(channel, value) + (burst.offset.get(channel) ?? 0)),
    }));
    if (burst.gesture !== null) {
      burst.gesture.update(burst.edits);
    } else {
      this.#pendingBurst = burst.id;
      this.#readout.setPending(
        new Map(burst.edits.map((edit) => [readoutValueKey(edit.control, edit.channel), edit.value])),
      );
    }
  }

  /** Ends the burst: commits it, or with `cancel` restores the values from before it. No-op without a burst. */
  end(cancel: boolean): void {
    const burst = this.#burst;
    if (burst === null) return;
    this.#burst = null;
    if (burst.gesture !== null) {
      if (cancel) burst.gesture.cancel();
      else burst.gesture.commit();
      return;
    }
    if (cancel || burst.edits.length === 0) {
      this.#clearPending(burst.id);
      return;
    }
    // The pending values stay on screen until the run lands, so the field does not flash the old value.
    void runOperator(this.#app, this.#panel, 'channel.setValues', {
      edits: burst.edits,
      key: 'auto',
      label: burst.label,
    }).finally(() => this.#clearPending(burst.id));
  }

  #clearPending(burst: number): void {
    if (this.#pendingBurst !== burst) return; // a newer burst shows its own values
    this.#pendingBurst = null;
    this.#readout.setPending(null);
  }
}
