// Keys the time slider shows and edits (MVP-SPEC §4.11.17): those of the selected controls of the active character,
// or of all its controls when nothing is selected, on the base layer of the active clip.
import type { Frame } from '@ekza-studio/anim-core';
import type { ControlId, CurveRecord, KeyId, KeyRecord } from '@ekza-studio/doc';
import type { EditorApp, KeyPartSelection, SelectMode } from '@ekza-studio/editor-core';
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

/** Whole-frame key times spanning at most this many frames are counted in dense arrays (no sort). */
const DENSE_SPAN = 1 << 20;

/** Index of the tick a key time belongs to (merged into the tick at most TICK_EPSILON before it), or -1. */
function tickIndexOf(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && t - times[lo - 1]! < TICK_EPSILON) return lo - 1;
  if (lo < times.length && times[lo]! - t < TICK_EPSILON) return lo;
  return -1;
}

/** True when `key` is one of the visible keys of its curve (`keys`, time order): hidden duplicates get no tick. */
function isVisibleKey(keys: readonly KeyRecord[], key: KeyRecord): boolean {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid]!.t < key.t - TICK_EPSILON) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < keys.length && keys[i]!.t < key.t + TICK_EPSILON; i++) if (keys[i]!.id === key.id) return true;
  return false;
}

/**
 * The ticks of the target controls' keys. Whole-frame keys (the common case) are counted in dense arrays without a
 * sort or an object per key; selected ticks come from the selected keys, not a selection lookup per key, so a redraw
 * during a drag of dense curves stays well under a millisecond (M2A-SPEC §5.22).
 */
export function collectTicks(app: EditorApp, ctx: TimelineContext | null): TickSet {
  if (ctx === null) return EMPTY_TICKS;
  const curves = targetCurves(app, ctx, timelineTargets(app, ctx));
  const lists: (readonly KeyRecord[])[] = [];
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let integral = true;
  for (const curve of curves) {
    const keys = app.store.query.keysOfCurve(curve.id);
    if (keys.length === 0) continue;
    lists.push(keys);
    count += keys.length;
    min = Math.min(min, keys[0]!.t);
    max = Math.max(max, keys[keys.length - 1]!.t);
    if (integral) for (const key of keys) if (!Number.isInteger(key.t)) integral = false;
  }
  if (count === 0) return EMPTY_TICKS;
  let times: Float64Array;
  let breakdown: Uint8Array;
  if (integral && max - min < DENSE_SPAN) {
    const span = max - min + 1;
    // 1: a key there; 2: a key there that is not a breakdown.
    const flags = new Uint8Array(span);
    for (const keys of lists) {
      for (const key of keys) flags[key.t - min]! |= key.breakdown === true ? 1 : 3;
    }
    let distinct = 0;
    for (let i = 0; i < span; i++) if (flags[i] !== 0) distinct++;
    times = new Float64Array(distinct);
    breakdown = new Uint8Array(distinct);
    for (let i = 0, j = 0; i < span; i++) {
      const flag = flags[i]!;
      if (flag === 0) continue;
      times[j] = min + i;
      breakdown[j] = flag === 1 ? 1 : 0;
      j++;
    }
  } else {
    const all = new Float64Array(count);
    const plain = new Uint8Array(count);
    let k = 0;
    for (const keys of lists) {
      for (const key of keys) {
        all[k] = key.t;
        plain[k] = key.breakdown === true ? 0 : 1;
        k++;
      }
    }
    const order = new Uint32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    order.sort((a, b) => all[a]! - all[b]!);
    const outTimes: number[] = [];
    const outBreakdown: number[] = [];
    for (let i = 0; i < count; i++) {
      const index = order[i]!;
      const t = all[index]!;
      const last = outTimes.length - 1;
      if (last >= 0 && t - outTimes[last]! < TICK_EPSILON) {
        if (plain[index] === 1) outBreakdown[last] = 0;
        continue;
      }
      outTimes.push(t);
      outBreakdown.push(plain[index] === 1 ? 0 : 1);
    }
    times = Float64Array.from(outTimes);
    breakdown = Uint8Array.from(outBreakdown);
  }
  const selected = new Uint8Array(times.length);
  const selection = app.session.getState().selection.keys;
  if (selection.size > 0) {
    const targets = new Set(curves.map((curve) => curve.id));
    for (const [id, parts] of selection) {
      if (!parts.key) continue;
      const key = app.store.get('keys', id);
      if (key === undefined || !targets.has(key.curve)) continue;
      if (!isVisibleKey(app.store.query.keysOfCurve(key.curve), key)) continue;
      const index = tickIndexOf(times, key.t);
      if (index >= 0) selected[index] = 1;
    }
  }
  return { times, selected, breakdown };
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
