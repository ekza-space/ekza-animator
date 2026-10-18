// The Channel Box readout (WP-9 DoD, ARCHITECTURE §10 React rules): channel values and states of the selected
// controls kept outside React. Time, document, override and evaluation changes mark it dirty; it recomputes at most
// once per animation frame and hands each row a cell object that keeps its identity while nothing visible changed,
// so during playback only the rows whose value changed commit.
//
// M2a (M2A-SPEC §5.1 rule 5, §5.6; A2): rows are TRS channels and '@name' attributes, shown in the unit of
// `channelUnit` (an `angle` attribute in degrees, `bool` as 0/1, `enum` by its labels), plus the IK/FK proxy row
// (cell `PROXY_CELL`): the limb IK control's `@ikFk`.
import type { Disposer } from '@ekza-animator/anim-core';
import type { ChannelId, CharacterId, ControlId, ControlRecord } from '@ekza-animator/doc';
import { attrDefOf, type ChannelState, channelUnit, type EditorApp } from '@ekza-animator/editor-core';
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

/** The cell key of the IK/FK proxy row (M2A-SPEC §5.6). */
export const PROXY_CELL = 'ikfk-proxy';

export interface ReadoutTargets {
  readonly lead: ControlId;
  readonly character: CharacterId | null;
  /** Each shown channel (TRS or '@name') with the selected controls on which it is keyable. */
  readonly channels: ReadonlyMap<ChannelId, readonly ControlId[]>;
  /** M2a: the IK/FK proxy row's channel (`<ikControl>/@ikFk`), or none. */
  readonly proxy?: { readonly control: ControlId; readonly channel: ChannelId } | null;
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

const valueKey = (control: ControlId, channel: ChannelId): string => `${control}/${channel}`;

/**
 * Display text of a channel value (§5.1 rule 5): `bool` attributes 0/1, `enum` attributes by label, otherwise the
 * unit-aware three-decimal text (degrees for angles).
 */
export function channelText(record: ControlRecord | null | undefined, channel: ChannelId, value: number): string {
  const def = attrDefOf(record, channel);
  if (def?.type === 'bool') return value >= 0.5 ? '1' : '0';
  if (def?.type === 'enum') {
    const label = def.enumLabels?.[Math.round(value)];
    if (label !== undefined) return label;
  }
  return formatChannelValue(channel, value, channelUnit(record ?? null, channel));
}

export class ChannelReadout {
  readonly #app: EditorApp;
  readonly #scheduler: FrameScheduler;
  readonly #listeners = new Set<() => void>();
  #disposers: Disposer[] = [];
  #targets: ReadoutTargets | null = null;
  #targetsKey = '';
  #cells: ReadonlyMap<string, ChannelCell> = new Map();
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

  /** The cell of a channel row ('rx', '@roll') or of the IK/FK proxy row (`PROXY_CELL`). */
  cell(key: ChannelId | typeof PROXY_CELL): ChannelCell | undefined {
    return this.#cells.get(key);
  }

  /** The value the readout shows for one control (pending nudge first), in internal units. */
  value(control: ControlId, channel: ChannelId): number {
    const pending = this.#pending.get(valueKey(control, channel));
    if (pending !== undefined) return pending;
    return channel.startsWith('@')
      ? this.#app.evaluation.channelValue(control, channel)
      : (this.#app.evaluation.channelValues(control)[channel as 'tx'] ?? 0);
  }

  /** New selection: recomputes at once, so the first paint shows the values. */
  setTargets(targets: ReadoutTargets | null): void {
    const key =
      targets === null
        ? ''
        : `${targets.lead}|${targets.character ?? ''}|${[...targets.channels].map(([ch, ids]) => `${ch}:${ids.join(',')}`).join(';')}|${targets.proxy === undefined || targets.proxy === null ? '' : valueKey(targets.proxy.control, targets.proxy.channel)}`;
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
    const next = new Map<string, ChannelCell>();
    if (targets !== null) {
      const app = this.#app;
      const values = new Map<ControlId, ReturnType<EditorApp['evaluation']['channelValues']>>();
      const valueOf = (control: ControlId, channel: ChannelId): { readonly v: number; readonly pending: boolean } => {
        const pending = this.#pending.get(valueKey(control, channel));
        if (pending !== undefined) return { v: pending, pending: true };
        if (channel.startsWith('@')) return { v: app.evaluation.channelValue(control, channel), pending: false };
        let all = values.get(control);
        if (all === undefined) {
          all = app.evaluation.channelValues(control);
          values.set(control, all);
        }
        return { v: all[channel as 'tx'] ?? 0, pending: false };
      };
      const clipFrame = targets.character === null ? null : app.evaluation.clipFrame(targets.character);
      const cellOf = (lead: ControlId, channel: ChannelId, controls: readonly ControlId[]): ChannelCell => {
        const record = app.store.get('controls', lead);
        const unit = channelUnit(record ?? null, channel);
        const first = valueOf(lead, channel);
        const display = toDisplayValue(channel, first.v, unit);
        let mixed = false;
        let pending = first.pending;
        for (const control of controls) {
          if (control === lead) continue;
          const other = valueOf(control, channel);
          pending ||= other.pending;
          const otherDisplay = toDisplayValue(channel, other.v, unit);
          if (Math.abs(otherDisplay - display) > SAME_VALUE * Math.max(1, Math.abs(display))) mixed = true;
        }
        const state = app.evaluation.channelState(lead, channel);
        return {
          text: mixed ? '—' : channelText(record, channel, first.v),
          mixed,
          state,
          clipFrame: state === 'keyed-on-frame' ? clipFrame : null,
          pending,
        };
      };
      const keep = (key: string, cell: ChannelCell): void => {
        const previous = this.#cells.get(key);
        next.set(key, previous !== undefined && sameCell(previous, cell) ? previous : cell);
      };
      for (const [channel, controls] of targets.channels) keep(channel, cellOf(targets.lead, channel, controls));
      const proxy = targets.proxy;
      if (proxy !== undefined && proxy !== null)
        keep(PROXY_CELL, cellOf(proxy.control, proxy.channel, [proxy.control]));
    }
    const changed = next.size !== this.#cells.size || [...next].some(([key, cell]) => this.#cells.get(key) !== cell);
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
