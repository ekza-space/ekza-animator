// The Channel Box readout (WP-9 DoD, ARCHITECTURE §10 React rules): channel values and states of the selected
// controls kept outside React. Time, document, override and evaluation changes mark it dirty; it recomputes at most
// once per animation frame and hands each row a cell object that keeps its identity while nothing visible changed,
// so during playback only the rows whose value changed commit.
import type { Disposer } from '@ekza-animator/anim-core';
import type { CharacterId, ControlId, TrsChannel } from '@ekza-animator/doc';
import type { ChannelState, EditorApp } from '@ekza-animator/editor-core';
import { formatChannelValue, toDisplayValue } from './kit/kernel';

export interface ChannelCell {
  /** The lead's value, formatted; '—' when the selected controls disagree. */
  readonly text: string;
  readonly mixed: boolean;
  /** The lead's state (`evaluation.channelState`). */
  readonly state: ChannelState;
  /** The lead's active-clip frame while the state is 'keyed-on-frame' ("Keyed at f24"), else null: other cells keep
   *  their identity while the playhead moves. */
  readonly clipFrame: number | null;
  /** Shows a nudge that is not written yet. */
  readonly pending: boolean;
}

export interface ReadoutTargets {
  readonly lead: ControlId;
  readonly character: CharacterId | null;
  /** Each shown channel with the selected controls on which it is keyable. */
  readonly channels: ReadonlyMap<TrsChannel, readonly ControlId[]>;
}

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

const animationFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Relative tolerance under which two selected controls show the same value. */
const SAME_VALUE = 1e-9;

const valueKey = (control: ControlId, channel: TrsChannel): string => `${control}/${channel}`;

export class ChannelReadout {
  readonly #app: EditorApp;
  readonly #scheduler: FrameScheduler;
  readonly #listeners = new Set<() => void>();
  #disposers: Disposer[] = [];
  #targets: ReadoutTargets | null = null;
  #targetsKey = '';
  #cells: ReadonlyMap<TrsChannel, ChannelCell> = new Map();
  #pending: ReadonlyMap<string, number> = new Map();
  #frame: number | null = null;
  #recomputes = 0;

  constructor(app: EditorApp, scheduler: FrameScheduler = animationFrames) {
    this.#app = app;
    this.#scheduler = scheduler;
  }

  /**
   * Starts following the document, the session clock and overrides, evaluation and the character registry; the
   * returned disposer stops (an effect's setup/cleanup pair, so React StrictMode can run it twice). Recomputes now:
   * anything may have changed while disconnected.
   */
  connect(): Disposer {
    const app = this.#app;
    const invalidate = (): void => this.invalidate();
    const disposers = [
      app.store.subscribe(invalidate),
      app.session.subscribe((state, previous) => {
        if (
          state.time !== previous.time ||
          state.overrides !== previous.overrides ||
          state.activeClip !== previous.activeClip ||
          state.activeCharacter !== previous.activeCharacter
        ) {
          invalidate();
        }
      }),
      app.evaluation.subscribe(invalidate),
      app.characters.subscribe(invalidate),
    ];
    this.#disposers.push(...disposers);
    this.recompute();
    return () => {
      for (const dispose of disposers) dispose();
      this.#disposers = this.#disposers.filter((d) => !disposers.includes(d));
      if (this.#frame !== null) this.#scheduler.cancel(this.#frame);
      this.#frame = null;
    };
  }

  /** How many times the cells were recomputed (tests and profiling). */
  get recomputes(): number {
    return this.#recomputes;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  cell(channel: TrsChannel): ChannelCell | undefined {
    return this.#cells.get(channel);
  }

  /** The value the readout shows for one control (pending nudge first), in internal units. */
  value(control: ControlId, channel: TrsChannel): number {
    return this.#pending.get(valueKey(control, channel)) ?? this.#app.evaluation.channelValues(control)[channel];
  }

  /** New selection: recomputes at once, so the first paint shows the values. */
  setTargets(targets: ReadoutTargets | null): void {
    const key =
      targets === null
        ? ''
        : `${targets.lead}|${targets.character ?? ''}|${[...targets.channels].map(([ch, ids]) => `${ch}:${ids.join(',')}`).join(';')}`;
    if (key === this.#targetsKey) return;
    this.#targets = targets;
    this.#targetsKey = key;
    this.recompute();
  }

  /** Values of a nudge that is not written yet (internal units), or null to drop them. */
  setPending(values: ReadonlyMap<string, number> | null): void {
    this.#pending = values ?? new Map();
    this.recompute();
  }

  /** Marks the cells dirty; they recompute on the next animation frame (once, however many changes come in). */
  invalidate(): void {
    if (this.#frame !== null) return;
    this.#frame = this.#scheduler.request(() => {
      this.#frame = null;
      this.recompute();
    });
  }

  recompute(): void {
    if (this.#frame !== null) {
      this.#scheduler.cancel(this.#frame);
      this.#frame = null;
    }
    this.#recomputes++;
    const targets = this.#targets;
    const next = new Map<TrsChannel, ChannelCell>();
    if (targets !== null) {
      const values = new Map<ControlId, ReturnType<EditorApp['evaluation']['channelValues']>>();
      const valueOf = (control: ControlId, channel: TrsChannel): { readonly v: number; readonly pending: boolean } => {
        const pending = this.#pending.get(valueKey(control, channel));
        if (pending !== undefined) return { v: pending, pending: true };
        let all = values.get(control);
        if (all === undefined) {
          all = this.#app.evaluation.channelValues(control);
          values.set(control, all);
        }
        return { v: all[channel], pending: false };
      };
      const clipFrame = targets.character === null ? null : this.#app.evaluation.clipFrame(targets.character);
      for (const [channel, controls] of targets.channels) {
        const lead = valueOf(targets.lead, channel);
        const display = toDisplayValue(channel, lead.v);
        let mixed = false;
        let pending = lead.pending;
        for (const control of controls) {
          if (control === targets.lead) continue;
          const other = valueOf(control, channel);
          pending ||= other.pending;
          const otherDisplay = toDisplayValue(channel, other.v);
          if (Math.abs(otherDisplay - display) > SAME_VALUE * Math.max(1, Math.abs(display))) mixed = true;
        }
        const state = this.#app.evaluation.channelState(targets.lead, channel);
        const cell: ChannelCell = {
          text: mixed ? '—' : formatChannelValue(channel, lead.v),
          mixed,
          state,
          clipFrame: state === 'keyed-on-frame' ? clipFrame : null,
          pending,
        };
        const previous = this.#cells.get(channel);
        next.set(channel, previous !== undefined && sameCell(previous, cell) ? previous : cell);
      }
    }
    const changed =
      next.size !== this.#cells.size || [...next].some(([channel, cell]) => this.#cells.get(channel) !== cell);
    if (!changed) return;
    this.#cells = next;
    for (const listener of this.#listeners) listener();
  }

  /** Disconnects everything and drops listeners (end of life outside React). */
  dispose(): void {
    if (this.#frame !== null) this.#scheduler.cancel(this.#frame);
    this.#frame = null;
    for (const dispose of this.#disposers.splice(0)) dispose();
    this.#listeners.clear();
  }
}

function sameCell(a: ChannelCell, b: ChannelCell): boolean {
  return (
    a.text === b.text &&
    a.mixed === b.mixed &&
    a.state === b.state &&
    a.pending === b.pending &&
    a.clipFrame === b.clipFrame
  );
}

export { valueKey as readoutValueKey };
