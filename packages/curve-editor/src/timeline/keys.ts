// Keys the time slider shows and edits (MVP-SPEC §4.11.17): those of the selected controls of the active character,
// or of all its controls when nothing is selected, on the base layer of the active clip.
import type { Frame } from '@ekza-animator/anim-core';
import type { ControlId, CurveRecord, KeyId } from '@ekza-animator/doc';
import type { EditorApp, KeyPartSelection, SelectMode } from '@ekza-animator/editor-core';
import { bandContains, type FrameRange, makeBand } from './band';
import { activeTimelineContext, type TimelineContext } from './context';

/** Key times closer than this share one tick. */
export const TICK_EPSILON = 1e-6;
const KEY_ONLY: KeyPartSelection = { key: true, in: false, out: false };

/** The selected controls that belong to the active character, or all of its controls when none is selected. */
export function timelineTargets(app: EditorApp, ctx: TimelineContext): ReadonlySet<ControlId> {
  const rig = app.store.get('characters', ctx.character)?.rig;
  const controls = rig === undefined ? [] : app.store.query.controlsOfRig(rig);
  const own = new Set<ControlId>(controls.map((control) => control.id));
  const selected = app.session.getState().selection.controls.filter((control) => own.has(control));
  return selected.length > 0 ? new Set(selected) : own;
}

/** Base-layer curves of the active clip that animate one of `targets`. */
export function targetCurves(app: EditorApp, ctx: TimelineContext, targets: ReadonlySet<ControlId>): CurveRecord[] {
  const base = app.store.query.baseLayer(ctx.clip.id);
  if (base === undefined) return [];
  return app.store.query
    .curvesOfClip(ctx.clip.id)
    .filter((curve) => curve.layer === base.id && targets.has(curve.control));
}

/**
 * Distinct key times (ascending) with flags per time: `selected` 1 when a key at that time is in `Selection.keys`;
 * `breakdown` 1 when every key at that time is a breakdown (M2A-SPEC §5.9: a tick with both kinds draws as a key).
 */
export interface TickSet {
  readonly times: Float64Array;
  readonly selected: Uint8Array;
  readonly breakdown: Uint8Array;
}

export const EMPTY_TICKS: TickSet = {
  times: new Float64Array(0),
  selected: new Uint8Array(0),
  breakdown: new Uint8Array(0),
};

export function collectTicks(app: EditorApp, ctx: TimelineContext | null): TickSet {
  if (ctx === null) return EMPTY_TICKS;
  const selection = app.session.getState().selection.keys;
  const keys: { readonly t: Frame; readonly selected: boolean; readonly breakdown: boolean }[] = [];
  for (const curve of targetCurves(app, ctx, timelineTargets(app, ctx))) {
    for (const key of app.store.query.keysOfCurve(curve.id)) {
      keys.push({ t: key.t, selected: selection.get(key.id)?.key === true, breakdown: key.breakdown === true });
    }
  }
  keys.sort((a, b) => a.t - b.t);
  const times: number[] = [];
  const flags: number[] = [];
  const breakdowns: number[] = [];
  for (const key of keys) {
    const last = times.length - 1;
    if (last >= 0 && key.t - times[last]! < TICK_EPSILON) {
      if (key.selected) flags[last] = 1;
      if (!key.breakdown) breakdowns[last] = 0;
      continue;
    }
    times.push(key.t);
    flags.push(key.selected ? 1 : 0);
    breakdowns.push(key.breakdown ? 1 : 0);
  }
  return { times: Float64Array.from(times), selected: Uint8Array.from(flags), breakdown: Uint8Array.from(breakdowns) };
}

/** Index of the tick nearest to `frame`, or -1 when there are no ticks. */
export function nearestTick(ticks: TickSet, frame: Frame): number {
  const { times } = ticks;
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < frame) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && frame - times[lo - 1]! <= times[lo]! - frame) return lo - 1;
  return lo;
}

/** Keys of the target controls inside `band` (§4.11.17); keys of locked curves are left out (they take no edits). */
export function bandKeys(app: EditorApp, ctx: TimelineContext, band: FrameRange): KeyId[] {
  const keys: KeyId[] = [];
  for (const curve of targetCurves(app, ctx, timelineTargets(app, ctx))) {
    if (curve.locked) continue;
    for (const key of app.store.query.keysOfCurve(curve.id)) if (bandContains(band, key.t)) keys.push(key.id);
  }
  return keys;
}

/**
 * `time.selectBand`: sets `session.time.band` and selects the band's keys in `Selection.keys` (shared with the Graph
 * Editor) by `mode`. A null band (or no active clip) clears the band; with 'replace' it also clears the key
 * selection. Returns the number of keys inside the band.
 */
export function applyBandSelection(app: EditorApp, band: FrameRange | null, mode: SelectMode): number {
  const state = app.session.getState();
  const ctx = activeTimelineContext(app);
  const normalized = band === null || ctx === null ? null : makeBand(band.start, band.end);
  const inside = normalized === null || ctx === null ? [] : bandKeys(app, ctx, normalized);
  const keys = new Map<KeyId, KeyPartSelection>(mode === 'replace' ? [] : state.selection.keys);
  for (const key of inside) {
    if (mode === 'remove' || (mode === 'toggle' && keys.has(key))) keys.delete(key);
    else keys.set(key, KEY_ONLY);
  }
  app.session.setState({
    time: { ...state.time, band: normalized },
    selection: { ...state.selection, keys },
  });
  return inside.length;
}
