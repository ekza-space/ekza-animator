// What a Dope Sheet row shows (M2A-SPEC §5.10): glyphs at the key times of its curves (|Δt| < 1e-6) with how many
// keys there are breakdowns and selected, hold bars by the channel rule and the aggregate rule, and stepped spans.
// `DopeSheetData` caches per curve (rebuilt only for curves a batch touched) and per row (rebuilt when any curve
// or, for glyphs, the key selection changed), so a redraw that changed nothing recomputes nothing.
import {
  type CompiledAnimCurve,
  type Frame,
  type InfinityMode,
  Segment,
  segmentControlPoints,
} from '@ekza-animator/anim-core';
import type { CurveId, KeyId, KeyRecord } from '@ekza-animator/doc';
import type { EditorApp, KeyPartSelection } from '@ekza-animator/editor-core';
import type { DopeSheetRow } from '../types';

/** Key times closer than this share a glyph (§5.10). */
export const SAME_TIME = 1e-6;
/** Integer key times spanning at most this many frames aggregate through dense counting arrays. */
const DENSE_SPAN = 1 << 20;

export interface CurveData {
  readonly id: CurveId;
  /** Keys in time order (the store's). */
  readonly keys: readonly KeyRecord[];
  /** Every key time is a whole frame. */
  readonly integral: boolean;
  /** Compiled key times (what the engine evaluates; duplicates projected out). */
  readonly times: Float64Array;
  /** Per span i (key i → i+1): 1 when it holds by the channel rule. */
  readonly hold: Uint8Array;
  /** Per span: 1 when it is stepped (step or step-next out tangent). */
  readonly stepped: Uint8Array;
  /** The curve is constant before its first key / after its last key (a constant infinity, or ≤ 1 key). */
  readonly constPre: boolean;
  readonly constPost: boolean;
}

export interface RowGlyphs {
  /** Distinct key times, ascending. */
  readonly times: Float64Array;
  /** Keys at each time, breakdown keys among them, selected keys among them. */
  readonly total: Uint32Array;
  readonly breakdowns: Uint32Array;
  readonly selected: Uint32Array;
}

export const EMPTY_GLYPHS: RowGlyphs = {
  times: new Float64Array(0),
  total: new Uint32Array(0),
  breakdowns: new Uint32Array(0),
  selected: new Uint32Array(0),
};

const scratch = new Float64Array(8);

function isConstant(mode: InfinityMode, keyCount: number): boolean {
  // §5.10: a part in a linear or cyclic infinity is not constant; a curve with one key is constant everywhere.
  return keyCount <= 1 || mode === 'constant';
}

/**
 * The channel rule (§5.10): span i holds when v_{i+1} and the span's four Bézier ordinates all equal v_i within
 * 1e-9·max(1, |v_i|).
 */
export function spanHolds(compiled: CompiledAnimCurve, i: number): boolean {
  segmentControlPoints(compiled, i, scratch);
  const v = compiled.v[i] as number;
  const tolerance = 1e-9 * Math.max(1, Math.abs(v));
  const next = compiled.v[i + 1] as number;
  return (
    Math.abs(next - v) <= tolerance &&
    Math.abs((scratch[1] as number) - v) <= tolerance &&
    Math.abs((scratch[3] as number) - v) <= tolerance &&
    Math.abs((scratch[5] as number) - v) <= tolerance &&
    Math.abs((scratch[7] as number) - v) <= tolerance
  );
}

/** The cached facts of one curve (recomputed by `DopeSheetData` when a batch touches it). */
export function curveDataOf(app: EditorApp, id: CurveId): CurveData {
  const keys = app.store.query.keysOfCurve(id);
  let integral = true;
  for (const key of keys) {
    if (!Number.isInteger(key.t)) {
      integral = false;
      break;
    }
  }
  const record = app.store.get('curves', id);
  if (record === undefined || keys.length === 0) {
    return {
      id,
      keys,
      integral,
      times: new Float64Array(0),
      hold: new Uint8Array(0),
      stepped: new Uint8Array(0),
      constPre: true,
      constPost: true,
    };
  }
  const compiled = app.evaluation.compiledCurve(id);
  const n = compiled.keyCount;
  const hold = new Uint8Array(Math.max(n - 1, 0));
  const stepped = new Uint8Array(Math.max(n - 1, 0));
  for (let i = 0; i < n - 1; i++) {
    hold[i] = spanHolds(compiled, i) ? 1 : 0;
    const kind = compiled.segment[i];
    stepped[i] = kind === Segment.Step || kind === Segment.StepNext ? 1 : 0;
  }
  return {
    id,
    keys,
    integral,
    times: compiled.t.slice(0, n),
    hold,
    stepped,
    constPre: isConstant(compiled.pre, n),
    constPost: isConstant(compiled.post, n),
  };
}

const isSelected = (selection: ReadonlyMap<KeyId, KeyPartSelection>, id: KeyId): boolean =>
  selection.get(id)?.key === true;

/** The glyphs of a row: distinct key times of its curves with key, breakdown and selection counts. */
export function aggregateGlyphs(
  curves: readonly CurveData[],
  selection: ReadonlyMap<KeyId, KeyPartSelection>,
): RowGlyphs {
  let count = 0;
  let integral = true;
  let min = Infinity;
  let max = -Infinity;
  for (const curve of curves) {
    const n = curve.keys.length;
    if (n === 0) continue;
    count += n;
    integral &&= curve.integral;
    min = Math.min(min, (curve.keys[0] as KeyRecord).t);
    max = Math.max(max, (curve.keys[n - 1] as KeyRecord).t);
  }
  if (count === 0) return EMPTY_GLYPHS;
  if (integral && max - min < DENSE_SPAN) {
    // Whole-frame keys (the common case): dense counters, one pass, no sort.
    const span = max - min + 1;
    const total = new Uint32Array(span);
    const breakdowns = new Uint32Array(span);
    const selected = new Uint32Array(span);
    for (const curve of curves) {
      for (const key of curve.keys) {
        const i = key.t - min;
        total[i] = (total[i] as number) + 1;
        if (key.breakdown === true) breakdowns[i] = (breakdowns[i] as number) + 1;
        if (isSelected(selection, key.id)) selected[i] = (selected[i] as number) + 1;
      }
    }
    let distinct = 0;
    for (let i = 0; i < span; i++) if ((total[i] as number) > 0) distinct++;
    const out = {
      times: new Float64Array(distinct),
      total: new Uint32Array(distinct),
      breakdowns: new Uint32Array(distinct),
      selected: new Uint32Array(distinct),
    };
    let j = 0;
    for (let i = 0; i < span; i++) {
      if ((total[i] as number) === 0) continue;
      out.times[j] = min + i;
      out.total[j] = total[i] as number;
      out.breakdowns[j] = breakdowns[i] as number;
      out.selected[j] = selected[i] as number;
      j++;
    }
    return out;
  }
  // Fractional times: sort every key time once, then merge times closer than SAME_TIME.
  const times = new Float64Array(count);
  const flags = new Uint8Array(count);
  let k = 0;
  for (const curve of curves) {
    for (const key of curve.keys) {
      times[k] = key.t;
      flags[k] = (key.breakdown === true ? 1 : 0) | (isSelected(selection, key.id) ? 2 : 0);
      k++;
    }
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => (times[a] as number) - (times[b] as number));
  const outTimes: number[] = [];
  const outTotal: number[] = [];
  const outBreakdowns: number[] = [];
  const outSelected: number[] = [];
  for (let i = 0; i < count; i++) {
    const index = order[i] as number;
    const t = times[index] as number;
    const flag = flags[index] as number;
    const last = outTimes.length - 1;
    if (last < 0 || t - (outTimes[last] as number) >= SAME_TIME) {
      outTimes.push(t);
      outTotal.push(0);
      outBreakdowns.push(0);
      outSelected.push(0);
    }
    const at = outTimes.length - 1;
    outTotal[at] = (outTotal[at] as number) + 1;
    if ((flag & 1) !== 0) outBreakdowns[at] = (outBreakdowns[at] as number) + 1;
    if ((flag & 2) !== 0) outSelected[at] = (outSelected[at] as number) + 1;
  }
  return {
    times: Float64Array.from(outTimes),
    total: Uint32Array.from(outTotal),
    breakdowns: Uint32Array.from(outBreakdowns),
    selected: Uint32Array.from(outSelected),
  };
}

/** Index of the time in ascending `times` within SAME_TIME of `t` at or after `from`, or -1. */
function indexFrom(times: Float64Array, t: number, from: number): number {
  for (let i = from; i < times.length; i++) {
    const d = (times[i] as number) - t;
    if (Math.abs(d) < SAME_TIME) return i;
    if (d > 0) return -1;
  }
  return -1;
}

/**
 * The aggregate hold rule (§5.10) over `curves` with the row's distinct key times `times`: interval
 * `[t_i, t_{i+1}]` holds when every curve is constant on it (each overlapping span holds by the channel rule; parts
 * outside the key range lie in a constant infinity) and has keys at both ends or none in the closed interval. With
 * one curve it is the channel rule.
 */
export function aggregateHolds(curves: readonly CurveData[], times: Float64Array): (readonly [Frame, Frame])[] {
  const n = times.length;
  if (n < 2) return [];
  // fail[i] > 0: interval i (times[i] → times[i + 1]) is broken; marked as a difference array over [a, b).
  const fail = new Int32Array(n);
  const mark = (a: number, b: number): void => {
    if (a >= b) return;
    fail[a] = (fail[a] as number) + 1;
    fail[b] = (fail[b] as number) - 1;
  };
  const idx: number[] = [];
  for (const curve of curves) {
    const m = curve.times.length;
    if (m === 0) continue;
    idx.length = 0;
    let from = 0;
    for (let k = 0; k < m; k++) {
      const at = indexFrom(times, curve.times[k] as number, from);
      idx.push(at);
      if (at >= 0) from = at;
    }
    if (idx.some((at) => at < 0)) {
      // Times the row does not list (should not happen): the curve breaks every interval it spans.
      mark(0, n - 1);
      continue;
    }
    const first = idx[0] as number;
    const last = idx[m - 1] as number;
    if (first > 0) {
      mark(first - 1, first); // a key at t_{i+1} only
      if (!curve.constPre) mark(0, first - 1);
    }
    for (let k = 0; k < m - 1; k++) {
      const a = idx[k] as number;
      const b = idx[k + 1] as number;
      if (curve.hold[k] !== 1) mark(a, b);
      else if (b - a >= 2) {
        mark(a, a + 1); // keyed at t_i but not at t_{i+1}
        mark(b - 1, b); // keyed at t_{i+1} but not at t_i
      }
    }
    if (last < n - 1) {
      mark(last, last + 1); // a key at t_i only
      if (!curve.constPost) mark(last + 1, n - 1);
    }
  }
  const out: (readonly [Frame, Frame])[] = [];
  let running = 0;
  for (let i = 0; i < n - 1; i++) {
    running += fail[i] as number;
    if (running === 0) out.push([times[i] as number, times[i + 1] as number]);
  }
  return out;
}

/**
 * §5.10 aggregate hold rule over the given curves (public API): intervals `[t_i, t_{i+1}]` between consecutive
 * `keyTimes` (clip frames, ascending) on which every curve holds.
 */
export function holdIntervals(
  app: EditorApp,
  curves: readonly CurveId[],
  keyTimes: readonly Frame[],
): readonly (readonly [Frame, Frame])[] {
  const data = curves.map((curve) => curveDataOf(app, curve));
  return aggregateHolds(data, Float64Array.from([...keyTimes].sort((a, b) => a - b)));
}

interface GlyphEntry {
  readonly curves: readonly CurveId[];
  readonly generation: number;
  readonly selection: number;
  readonly glyphs: RowGlyphs;
}

interface HoldEntry {
  readonly curves: readonly CurveId[];
  readonly generation: number;
  readonly holds: readonly (readonly [Frame, Frame])[];
}

/** Per-curve and per-row caches of what rows show; invalidated by the controller from batches and selection. */
export class DopeSheetData {
  private readonly curveCache = new Map<CurveId, CurveData>();
  private readonly glyphCache = new Map<string, GlyphEntry>();
  private readonly holdCache = new Map<string, HoldEntry>();
  private generation = 0;
  private selectionGeneration = 0;

  constructor(private readonly app: EditorApp) {}

  /** Curves whose keys or settings changed (null: everything, e.g. a document load). */
  invalidate(curves: Iterable<CurveId> | null): void {
    if (curves === null) this.curveCache.clear();
    else for (const curve of curves) this.curveCache.delete(curve);
    this.generation++;
  }

  /** The key selection changed: glyph colours change, holds do not. */
  invalidateSelection(): void {
    this.selectionGeneration++;
  }

  curve(id: CurveId): CurveData {
    let data = this.curveCache.get(id);
    if (data === undefined) {
      data = curveDataOf(this.app, id);
      this.curveCache.set(id, data);
    }
    return data;
  }

  glyphs(row: DopeSheetRow): RowGlyphs {
    const cached = this.glyphCache.get(row.id);
    if (
      cached !== undefined &&
      cached.curves === row.curves &&
      cached.generation === this.generation &&
      cached.selection === this.selectionGeneration
    ) {
      return cached.glyphs;
    }
    const glyphs = aggregateGlyphs(
      row.curves.map((curve) => this.curve(curve)),
      this.app.session.getState().selection.keys,
    );
    this.glyphCache.set(row.id, {
      curves: row.curves,
      generation: this.generation,
      selection: this.selectionGeneration,
      glyphs,
    });
    return glyphs;
  }

  holds(row: DopeSheetRow): readonly (readonly [Frame, Frame])[] {
    const cached = this.holdCache.get(row.id);
    if (cached !== undefined && cached.curves === row.curves && cached.generation === this.generation) {
      return cached.holds;
    }
    const holds = aggregateHolds(
      row.curves.map((curve) => this.curve(curve)),
      this.glyphs(row).times,
    );
    this.holdCache.set(row.id, { curves: row.curves, generation: this.generation, holds });
    return holds;
  }

  /** Stepped spans of a channel row (hatched); aggregate rows have none. */
  stepped(row: DopeSheetRow): (readonly [Frame, Frame])[] {
    if (row.kind !== 'channel' || row.curves.length !== 1) return [];
    const curve = this.curve(row.curves[0] as CurveId);
    const out: (readonly [Frame, Frame])[] = [];
    for (let i = 0; i < curve.stepped.length; i++) {
      if (curve.stepped[i] === 1) out.push([curve.times[i] as number, curve.times[i + 1] as number]);
    }
    return out;
  }

  /** Keys of the row's curves at `frame` (|Δt| < 1e-6). */
  keysAt(row: DopeSheetRow, frame: Frame): KeyId[] {
    return this.keysIn(row, frame - SAME_TIME * 0.999, frame + SAME_TIME * 0.999);
  }

  /** Keys of the row's curves with `from ≤ t ≤ to`. */
  keysIn(row: DopeSheetRow, from: Frame, to: Frame): KeyId[] {
    const out: KeyId[] = [];
    for (const id of row.curves) {
      const keys = this.curve(id).keys;
      // Keys are in time order: binary search the first one at or after `from`.
      let lo = 0;
      let hi = keys.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((keys[mid] as KeyRecord).t < from) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < keys.length && (keys[i] as KeyRecord).t <= to; i++) out.push((keys[i] as KeyRecord).id);
    }
    return out;
  }
}
