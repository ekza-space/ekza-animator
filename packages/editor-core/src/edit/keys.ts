// Edit-kernel helpers for curves and keys (MVP-SPEC §4.11.0 table, §4.11.3, §4.11.4). Every writer of keys —
// operators, Graph Editor and time-slider drags, manipulators — goes through these, inside the caller's transaction
// or preview update (`tx`). Keys of curves locked in the Graph Editor (`CurveRecord.locked`) are never edited.
import { EkzaError, type Frame, type Handle, type KeyData, RAD2DEG, type TangentType } from '@ekza-animator/anim-core';
import type {
  ChannelId,
  ClipId,
  ControlId,
  CurveId,
  CurveRecord,
  KeyId,
  KeyRecord,
  ReadView,
  Tx,
} from '@ekza-animator/doc';
import { internalsOf, newRecordId } from '../app/internals';
import type { EditorApp, KeyEditOptions, KeyEditResult } from '../types';
import { channelDefaultOf, channelUnit } from './channelMeta';
import {
  animCurve,
  compileInTx,
  currentClipFrame,
  ensureBaseLayer,
  keyDataOf,
  requireClip,
  requireCurve,
  SAME_FRAME_EPS,
  sameKeyData,
} from './context';
import { fromDisplayValue } from './numeric';
import { type RippleScope, rippleScopeOf } from './ripple';

/** While dragging, a moved key stops this far (frames) from a non-moved neighbour (§4.11.3). */
const DRAG_MARGIN = 1e-3;
/** Smallest handle |dt| in frames; steeper handles clamp to ±90° (§4.11.4). */
const MIN_HANDLE_DT = 1e-6;
/** Smallest scale factor of `scaleKeys` (§4.11.3). */
const MIN_SCALE = 0.01;

// ---------- curves ----------

/**
 * The canonical base-layer curve of (clip, control, channel), created when missing (§4.11.0). This is the shared
 * curve-creation helper of keying (key.set, auto-key, tween keys, pastes): on a clip with `loop: true` a new curve
 * gets `pre` and `post` 'cycle' (M2A-SPEC §5.23), so the editor's cycle-aware auto tangents make the seam C¹.
 * Existing curves are never rewritten.
 */
export function ensureCurve(app: EditorApp, tx: Tx, clip: ClipId, control: ControlId, channel: ChannelId): CurveId {
  const clipRecord = requireClip(tx, clip);
  if (tx.get('controls', control) === undefined) {
    throw new EkzaError('invalid-record', `Control ${control} does not exist`);
  }
  const layer = ensureBaseLayer(app, tx, clip);
  const existing = tx.query.curveFor(clip, layer.id, control, channel);
  if (existing !== undefined) return existing.id;
  const curve: CurveRecord = {
    id: newRecordId(app, 'curve'),
    clip,
    layer: layer.id,
    control,
    channel,
    weighted: false,
    pre: clipRecord.loop === true ? 'cycle' : 'constant',
    post: clipRecord.loop === true ? 'cycle' : 'constant',
    staticValue: null,
    locked: false,
    muted: false,
    deleted: null,
  };
  tx.put('curves', curve);
  return curve.id;
}

/**
 * Sets the key of `curve` at `frame` to `value`: patches the value of a key within 1e-6 frames, else inserts a key
 * with the given tangents, zero handles, unified and weight-locked (§4.11.1 rule 4).
 *
 * M2a (`opts`, M2A-SPEC §4.5): `breakdown` is the flag of a new key (a breakdown key, §5.12); with
 * `existing: 'set'` it is also written on a key already at the frame; the default `'keep'` leaves that key's flag
 * alone (tween patches keep it). A non-breakdown key carries no `breakdown` field (M1 records stay byte-identical).
 */
export function writeKeyAt(
  app: EditorApp,
  tx: Tx,
  curve: CurveId,
  frame: Frame,
  value: number,
  tangents: { readonly in: TangentType; readonly out: TangentType },
  opts?: { readonly breakdown?: boolean; readonly existing?: 'keep' | 'set' },
): KeyId {
  const record = requireCurve(tx, curve);
  const breakdown = opts?.breakdown === true;
  const existing = tx.query.keysOfCurve(curve).find((key) => Math.abs(key.t - frame) < SAME_FRAME_EPS);
  if (existing !== undefined) {
    const setFlag = opts?.existing === 'set' && (existing.breakdown === true) !== breakdown;
    if (existing.v !== value || setFlag) {
      let next: KeyRecord = { ...existing, v: value };
      if (setFlag) {
        if (breakdown) next = { ...next, breakdown: true };
        else {
          const { breakdown: _flag, ...rest } = next;
          next = rest;
        }
      }
      tx.put('keys', next);
    }
    return existing.id;
  }
  const key: KeyRecord = {
    id: newRecordId(app, 'key'),
    clip: record.clip,
    curve,
    t: frame,
    v: value,
    inType: tangents.in,
    outType: tangents.out,
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
    ...(breakdown ? { breakdown: true } : {}),
  };
  tx.put('keys', key);
  return key.id;
}

// ---------- moving and scaling (§4.11.3; M2a ripple §5.11 and breakdown retiming §5.12) ----------

interface Placement {
  readonly key: KeyRecord;
  /** Moved by the edit (edited, rippled) or retimed. */
  moving: boolean;
  /** Target time (moving keys) or the current time. */
  t: number;
  /** A non-edited breakdown moved by its anchors (§5.12). */
  retimed: boolean;
}

/** What `place` moves on one curve: the keys and their targets, and the keys the caller edited. */
interface PlaceRequest {
  /** The curve's keys in time order. */
  readonly keys: readonly KeyRecord[];
  readonly moving: ReadonlySet<KeyId>;
  readonly target: (key: KeyRecord) => number;
  /** Keys the caller passed (retiming moves the other breakdowns, §5.12). */
  readonly edited: ReadonlySet<KeyId>;
  /** Current time of a key (the moving keys' times bound the slice of `keys` the edit can change). */
  readonly timeOf: (id: KeyId) => number | undefined;
}

/** Index of the first key with `t ≥ time` in time-ordered keys. */
function firstKeyAtOrAfter(keys: readonly KeyRecord[], time: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((keys[mid] as KeyRecord).t < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The slice of a curve's keys an edit can change: the moving keys' time span, widened over the breakdowns next to it
 * to the first non-breakdown key on each side (or the curve's end). Every key outside it stays where it is: moving
 * runs stop at their nearest non-moving neighbour, a breakdown retimes only when one of its anchors moved, and both
 * lie inside (§4.11.3, §5.12). Working on the slice makes a drag cost follow the moved keys, not the curves' key
 * counts (a Dope Sheet drag of a few keys on hundreds of dense curves, §5.22).
 */
function editWindow(request: PlaceRequest): readonly KeyRecord[] {
  const keys = request.keys;
  let min = Infinity;
  let max = -Infinity;
  for (const id of request.moving) {
    const t = request.timeOf(id);
    if (t === undefined) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!(min <= max)) return [];
  let lo = firstKeyAtOrAfter(keys, min - SAME_FRAME_EPS);
  let hi = firstKeyAtOrAfter(keys, max + SAME_FRAME_EPS);
  while (lo > 0 && (keys[lo - 1] as KeyRecord).breakdown === true) lo--;
  if (lo > 0) lo--;
  while (hi < keys.length && (keys[hi] as KeyRecord).breakdown === true) hi++;
  if (hi < keys.length) hi++;
  return lo === 0 && hi === keys.length ? keys : keys.slice(lo, hi);
}

/**
 * Places the moving keys of one curve at their target times under the §4.11.3 rules and returns the keys to delete.
 * Runs of consecutive moving keys never cross a non-moving neighbour: while dragging they stop `DRAG_MARGIN` short
 * (as a block for moves, key by key for scales); on the final update a key that lands exactly on it deletes it. With
 * snapping, a key dragged **past** the neighbour stops on the last whole frame before it instead, so an overshoot
 * never deletes a key (acceptance round 2). Two moving keys landing on one frame keep the `preferred` one (final
 * update only). M2a: breakdown retiming (§5.12) runs between the clamp and the collision rules. The placements
 * cover the slice of keys the edit can change (`editWindow`).
 */
function place(
  request: PlaceRequest,
  opts: KeyEditOptions,
  clampAs: 'block' | 'each',
  preferred: (a: KeyRecord, b: KeyRecord, at: number) => KeyRecord,
): { readonly placements: readonly Placement[]; readonly deleted: readonly KeyId[] } {
  const keys = editWindow(request);
  const initial = (): Placement[] =>
    keys.map((key) => {
      if (!request.moving.has(key.id)) return { key, moving: false, t: key.t, retimed: false };
      const t = request.target(key);
      // `+ 0` turns a −0 (a snapped sub-half-frame move left of 0) into 0: no key is written at −0, as in M1, where the
      // block clamp always added its shift (integration fix; the clamp skips a zero shift since A3).
      return { key, moving: true, t: (opts.snap ? Math.round(t) : t) + 0, retimed: false };
    });
  let placements = initial();
  const retime =
    opts.retimeBreakdowns !== false && keys.some((key) => key.breakdown === true && !request.edited.has(key.id));
  if (!retime) {
    clampRuns(placements, opts, clampAs, null);
  } else {
    // §5.12: non-edited breakdowns follow their anchors, so they do not stop the keys moving past them; retiming
    // places them afterwards. Should that cross an edited breakdown, the M1 clamp (breakdowns as neighbours) runs.
    const floating = (p: Placement): boolean => p.key.breakdown === true && !request.edited.has(p.key.id);
    clampRuns(placements, opts, clampAs, floating);
    if (!retimeBreakdowns(placements, request.edited, opts)) {
      placements = initial();
      clampRuns(placements, opts, clampAs, null);
      retimeBreakdowns(placements, request.edited, opts);
    }
  }
  if (!opts.resolveCollisions) return { placements, deleted: [] };
  return { placements, deleted: collisions(placements, preferred) };
}

/**
 * The §4.11.3 clamp of runs of moving keys against their non-moving neighbours (in place). Placements `floating`
 * selects are left out: they neither move with a run nor stop one (retimed breakdowns, §5.12).
 */
function clampRuns(
  all: Placement[],
  opts: KeyEditOptions,
  clampAs: 'block' | 'each',
  floating: ((p: Placement) => boolean) | null,
): void {
  const placements = floating === null ? all : all.filter((p) => !floating(p));
  const margin = opts.resolveCollisions ? 0 : DRAG_MARGIN;
  for (let i = 0; i < placements.length; ) {
    if (!(placements[i] as Placement).moving) {
      i++;
      continue;
    }
    let j = i;
    while (j < placements.length && (placements[j] as Placement).moving) j++;
    const prev = i > 0 ? (placements[i - 1] as Placement).t : -Infinity;
    const next = j < placements.length ? (placements[j] as Placement).t : Infinity;
    const lower = prev + margin;
    const upper = next - margin;
    // Snapped stops for an overshoot: the whole frames just inside the neighbours (when there is one).
    const wholeLower = opts.snap ? Math.max(Math.floor(prev) + 1, lower) : lower;
    const wholeUpper = opts.snap ? Math.min(Math.ceil(next) - 1, upper) : upper;
    const roomy = wholeLower <= wholeUpper;
    const clampOne = (t: number): number => {
      if (t > next + SAME_FRAME_EPS) return roomy ? wholeUpper : upper; // past the neighbour
      if (t > upper) return upper; // on it: lands (final update) or stops just short (drag)
      if (t < prev - SAME_FRAME_EPS) return roomy ? wholeLower : lower;
      if (t < lower) return lower;
      return t;
    };
    let min = Infinity;
    let max = -Infinity;
    for (let k = i; k < j; k++) {
      const t = (placements[k] as Placement).t;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    if (clampAs === 'block' && max - min <= upper - lower) {
      let shift = min < lower ? clampOne(min) - min : max > upper ? clampOne(max) - max : 0;
      // The whole-frame stop leaves no room for the block: stop at the neighbour as before.
      if (min + shift < lower || max + shift > upper) shift = min < lower ? lower - min : upper - max;
      if (shift !== 0) for (let k = i; k < j; k++) (placements[k] as Placement).t += shift;
    } else {
      // Key by key (scales): when some key of the run overshoots a neighbour, the keys that would land exactly on it
      // stop on the same whole frame, so the run keeps its order (a key landing on 18 while the next one, past it,
      // stops on 17 would swap them) and an overshoot still never deletes the neighbour.
      const overUp = max > next + SAME_FRAME_EPS && roomy;
      const overDown = min < prev - SAME_FRAME_EPS && roomy;
      for (let k = i; k < j; k++) {
        const p = placements[k] as Placement;
        if (overUp && p.t > wholeUpper) p.t = wholeUpper;
        else if (overDown && p.t < wholeLower) p.t = wholeLower;
        else p.t = clampOne(p.t);
      }
    }
    i = j;
  }
}

/** The final-update collision rules of §4.11.3: the keys to delete. */
function collisions(
  placements: readonly Placement[],
  preferred: (a: KeyRecord, b: KeyRecord, at: number) => KeyRecord,
): KeyId[] {
  const deleted = new Set<KeyId>();
  const sorted = placements.filter((p) => p.moving).sort((a, b) => a.t - b.t);
  const times = sorted.map((p) => p.t);
  // Non-moving keys under a moving key are deleted.
  for (const p of placements) if (!p.moving && hasTimeNear(times, p.t)) deleted.add(p.key.id);
  // Moving keys on one frame: one survives.
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && Math.abs((sorted[j] as Placement).t - (sorted[i] as Placement).t) < SAME_FRAME_EPS) j++;
    if (j - i > 1) {
      const group = sorted.slice(i, j);
      const at = (sorted[i] as Placement).t;
      const keep = group.map((p) => p.key).reduce((best, key) => preferred(best, key, at));
      for (const p of group) if (p.key !== keep) deleted.add(p.key.id);
    }
    i = j;
  }
  return [...deleted];
}

/**
 * §5.12 proportional retiming (in place): every non-edited breakdown whose nearest non-breakdown anchors (pre-edit
 * key order) moved keeps its time ratio between them. With snapping it lands on the nearest whole frame inside
 * `[t_a' + 1, t_c' − 1]`, or keeps the exact time when no whole frame fits. A breakdown with one anchor moves by that
 * anchor's offset. Values and tangents never change. When rounding would put two retimed breakdowns of one span on
 * one frame, the span keeps exact times; when retiming would break the key order (an edited breakdown moved across a
 * retimed one), the curve keeps its unretimed placement.
 */
function retimeBreakdowns(placements: Placement[], edited: ReadonlySet<KeyId>, opts: KeyEditOptions): boolean {
  const moved = (p: Placement | undefined): boolean => p !== undefined && p.t !== p.key.t;
  const before = placements.map((p) => ({ moving: p.moving, t: p.t }));
  let changed = false;
  // Spans between consecutive anchors (non-breakdown keys); -1 / length stand for "no anchor".
  let anchor = -1;
  for (let i = 0; i <= placements.length; i++) {
    const p = placements[i];
    if (p !== undefined && p.key.breakdown === true) continue;
    // [anchor + 1, i) are breakdowns between anchor `anchor` and anchor `i`.
    if (i - anchor > 1) {
      const a = anchor >= 0 ? placements[anchor] : undefined;
      const c = p;
      if (moved(a) || moved(c)) {
        const exact: number[] = [];
        const rounded: number[] = [];
        const targets: Placement[] = [];
        for (let k = anchor + 1; k < i; k++) {
          const b = placements[k] as Placement;
          if (edited.has(b.key.id)) continue;
          let t: number;
          if (a !== undefined && c !== undefined) {
            const span = c.key.t - a.key.t;
            const r = span !== 0 ? (b.key.t - a.key.t) / span : 0;
            t = a.t + r * (c.t - a.t);
          } else if (a !== undefined) t = b.key.t + (a.t - a.key.t);
          else t = b.key.t + ((c as Placement).t - (c as Placement).key.t);
          exact.push(t);
          rounded.push(snapInside(t, a, c, opts.snap));
          targets.push(b);
        }
        // Rounding must not put two breakdowns of the span on one frame.
        let distinct = true;
        for (let k = 1; k < rounded.length; k++) {
          if ((rounded[k] as number) - (rounded[k - 1] as number) < SAME_FRAME_EPS) distinct = false;
        }
        const times = distinct ? rounded : exact;
        targets.forEach((b, k) => {
          const t = times[k] as number;
          if (t === b.t && !b.moving) return;
          b.t = t;
          b.moving = true;
          b.retimed = true;
          changed = true;
        });
      }
    }
    anchor = i;
  }
  if (!changed) return orderedPlacements(placements);
  // Retiming must keep the key order (§5.12 "order is preserved"); a crossing with an edited breakdown reverts it.
  for (let i = 1; i < placements.length; i++) {
    const a = placements[i - 1] as Placement;
    const b = placements[i] as Placement;
    const crossed = b.t < a.t - SAME_FRAME_EPS || (Math.abs(b.t - a.t) < SAME_FRAME_EPS && (a.retimed || b.retimed));
    if (!crossed) continue;
    placements.forEach((p, k) => {
      const original = before[k] as { readonly moving: boolean; readonly t: number };
      p.moving = original.moving;
      p.t = original.t;
      p.retimed = false;
    });
    return false;
  }
  return true;
}

/** True when no placement is before its predecessor (pre-edit order). */
function orderedPlacements(placements: readonly Placement[]): boolean {
  for (let i = 1; i < placements.length; i++) {
    if ((placements[i] as Placement).t < (placements[i - 1] as Placement).t - SAME_FRAME_EPS) return false;
  }
  return true;
}

/** §5.12 snapping of a retimed breakdown: the nearest whole frame in [t_a' + 1, t_c' − 1], else the exact time. */
function snapInside(t: number, a: Placement | undefined, c: Placement | undefined, snap: boolean): number {
  if (!snap) return t;
  let rounded = Math.floor(t + 0.5);
  const lo = a === undefined ? -Infinity : Math.ceil(a.t + 1 - SAME_FRAME_EPS);
  const hi = c === undefined ? Infinity : Math.floor(c.t - 1 + SAME_FRAME_EPS);
  if (lo > hi) return t;
  if (rounded < lo) rounded = lo;
  if (rounded > hi) rounded = hi;
  return rounded;
}

/** True when the ascending `times` hold a value within `SAME_FRAME_EPS` of `t` (binary search). */
function hasTimeNear(times: readonly number[], t: number): boolean {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((times[mid] as number) <= t - SAME_FRAME_EPS) lo = mid + 1;
    else hi = mid;
  }
  return lo < times.length && Math.abs((times[lo] as number) - t) < SAME_FRAME_EPS;
}

/** Key ids grouped by curve (missing keys skipped), preserving first-seen curve order. */
function byCurve(tx: ReadView, keys: readonly KeyId[]): Map<CurveId, Set<KeyId>> {
  const groups = new Map<CurveId, Set<KeyId>>();
  for (const id of keys) {
    const key = tx.get('keys', id);
    if (key === undefined) continue;
    let group = groups.get(key.curve);
    if (group === undefined) {
      group = new Set();
      groups.set(key.curve, group);
    }
    group.add(id);
  }
  return groups;
}

/** Editable curve of a key group, or undefined for missing and Graph-Editor-locked curves. */
function editableCurve(tx: ReadView, curve: CurveId): CurveRecord | undefined {
  const record = tx.get('curves', curve);
  return record === undefined || record.locked ? undefined : record;
}

/** Min and max time of the edited keys. */
function editedRange(tx: ReadView, groups: ReadonlyMap<CurveId, ReadonlySet<KeyId>>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const ids of groups.values()) {
    for (const id of ids) {
      const t = (tx.get('keys', id) as KeyRecord).t;
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  return { min, max };
}

/** The scope curves of a ripple edit that take edits (scope ∪ edited curves are both scanned by the callers). */
function scopeCurves(tx: ReadView, scope: RippleScope): CurveRecord[] {
  const out: CurveRecord[] = [];
  const seen = new Set<CurveId>();
  for (const id of scope.curves) {
    if (seen.has(id)) continue;
    seen.add(id);
    const curve = editableCurve(tx, id);
    if (curve !== undefined) out.push(curve);
  }
  return out;
}

function addTo(groups: Map<CurveId, Set<KeyId>>, curve: CurveId, key: KeyId): void {
  let group = groups.get(curve);
  if (group === undefined) {
    group = new Set();
    groups.set(curve, group);
  }
  group.add(key);
}

/** A ripple move (§5.11): the one effective offset of the block and the keys it carries per curve. */
interface RippleMovePlan {
  readonly shift: number;
  /** Edited keys plus every key of the scope curves at or after the region start. */
  readonly moving: Map<CurveId, Set<KeyId>>;
}

function rippleMovePlan(
  tx: ReadView,
  edited: ReadonlyMap<CurveId, ReadonlySet<KeyId>>,
  scope: RippleScope,
  dFrames: number,
  opts: KeyEditOptions,
): RippleMovePlan {
  const moving = new Map<CurveId, Set<KeyId>>();
  for (const [curve, ids] of edited) moving.set(curve, new Set(ids));
  const range = editedRange(tx, edited);
  if (!Number.isFinite(range.min)) return { shift: dFrames, moving };
  const a = Math.min(scope.region?.start ?? range.min, range.min);
  let blockMin = range.min;
  /** The latest key before the region over all scope (and edited) curves: the block's stop going back. */
  let stop = -Infinity;
  const scoped = new Set<CurveId>();
  for (const curve of scopeCurves(tx, scope)) {
    scoped.add(curve.id);
    for (const key of tx.query.keysOfCurve(curve.id)) {
      if (key.t >= a - SAME_FRAME_EPS) {
        addTo(moving, curve.id, key.id);
        if (key.t < blockMin) blockMin = key.t;
      } else if (key.t > stop) stop = key.t;
    }
  }
  for (const [curveId, ids] of edited) {
    if (scoped.has(curveId) || editableCurve(tx, curveId) === undefined) continue;
    for (const key of tx.query.keysOfCurve(curveId)) if (!ids.has(key.id) && key.t < a && key.t > stop) stop = key.t;
  }
  let shift = opts.snap ? Math.round(blockMin + dFrames) - blockMin : dFrames;
  if (shift < 0 && Number.isFinite(stop)) {
    // §4.11.3 applied to the block as a whole: one stop for every curve.
    const margin = opts.resolveCollisions ? 0 : DRAG_MARGIN;
    const lower = stop + margin;
    const wholeLower = opts.snap ? Math.max(Math.floor(stop) + 1, lower) : lower;
    let target = blockMin + shift;
    if (target < stop - SAME_FRAME_EPS) target = wholeLower <= blockMin ? wholeLower : lower;
    else if (target < lower) target = lower;
    shift = Math.min(0, Math.max(shift, target - blockMin));
  }
  return { shift: shift + 0, moving };
}

/** A ripple scale (§5.11): keys in the region scale, keys after it shift by one amount. */
interface RippleScalePlan {
  readonly moving: Map<CurveId, Set<KeyId>>;
  /** Keys after the region: shifted by `shiftAfter` instead of scaled. */
  readonly shifted: ReadonlySet<KeyId>;
  readonly shiftAfter: number;
}

function rippleScalePlan(
  tx: ReadView,
  edited: ReadonlyMap<CurveId, ReadonlySet<KeyId>>,
  scope: RippleScope,
  pivot: number,
  factor: number,
  opts: KeyEditOptions,
): RippleScalePlan {
  const moving = new Map<CurveId, Set<KeyId>>();
  for (const [curve, ids] of edited) moving.set(curve, new Set(ids));
  const shifted = new Set<KeyId>();
  const range = editedRange(tx, edited);
  if (!Number.isFinite(range.min)) return { moving, shifted, shiftAfter: 0 };
  const a = Math.min(scope.region?.start ?? range.min, range.min);
  const b = Math.max(scope.region?.end ?? range.max, range.max);
  const end = pivot + (b - pivot) * factor;
  const shiftAfter = (opts.snap ? Math.round(end) : end) - b;
  for (const curve of scopeCurves(tx, scope)) {
    const own = edited.get(curve.id);
    for (const key of tx.query.keysOfCurve(curve.id)) {
      if (key.t < a - SAME_FRAME_EPS) continue;
      addTo(moving, curve.id, key.id);
      if (key.t > b + SAME_FRAME_EPS && own?.has(key.id) !== true) shifted.add(key.id);
    }
  }
  return { moving, shifted, shiftAfter: shiftAfter + 0 };
}

/**
 * The time offset a move of `keys` by `dFrames` really applies to its block (§5.11): `dFrames` (snapped like the
 * keys) without ripple, else the one offset every rippled key gets after the Δ < 0 stop. Panels use it to move a band
 * or a region bar with the keys.
 */
export function rippleMoveShift(
  app: EditorApp,
  view: ReadView,
  keys: readonly KeyId[],
  dFrames: number,
  opts: KeyEditOptions,
  scope?: RippleScope,
): number {
  if (opts.ripple !== true) return dFrames;
  const edited = byCurve(view, keys);
  const ripple = scope ?? defaultScope(app, view, keys);
  return rippleMovePlan(view, edited, ripple, dFrames, opts).shift;
}

function defaultScope(app: EditorApp, view: ReadView, keys: readonly KeyId[]): RippleScope {
  return rippleScopeOf(app, view, keys, null);
}

/**
 * Moves keys by `dFrames` (time) and `dValue` (display units: degrees for angles), §4.11.3. M2a: with `ripple`
 * (§5.11) every key of the scope curves at or after the region start moves too, by the same offset; non-edited
 * breakdowns retime (§5.12) unless `retimeBreakdowns: false`. Only the edited keys change value. `scope` defaults to
 * the edited keys' clip with the default control set (`rippleScopeOf`).
 */
export function moveKeys(
  app: EditorApp,
  tx: Tx,
  keys: readonly KeyId[],
  dFrames: number,
  dValue: number,
  opts: KeyEditOptions,
  scope?: RippleScope,
): KeyEditResult {
  if (!Number.isFinite(dFrames) || !Number.isFinite(dValue)) {
    throw new EkzaError('invalid-record', 'moveKeys: offsets must be finite');
  }
  const edited = byCurve(tx, keys);
  let groups: Map<CurveId, Set<KeyId>> = edited;
  let shift = dFrames;
  if (opts.ripple === true && edited.size > 0) {
    const plan = rippleMovePlan(tx, edited, scope ?? defaultScope(app, tx, keys), dFrames, opts);
    groups = plan.moving;
    shift = plan.shift;
  }
  let moved = 0;
  const deleted: KeyId[] = [];
  const timeOf = (id: KeyId): number | undefined => tx.get('keys', id)?.t;
  for (const [curveId, ids] of groups) {
    const curve = editableCurve(tx, curveId);
    if (curve === undefined) continue;
    const own = edited.get(curveId) ?? EMPTY_IDS;
    const dv =
      dValue === 0
        ? 0
        : fromDisplayValue(
            curve.channel,
            dValue,
            channelUnit(tx.get('controls', curve.control) ?? null, curve.channel),
          );
    const nearest = (a: KeyRecord, b: KeyRecord, at: number): KeyRecord => {
      const da = Math.abs(a.t + shift - at);
      const db = Math.abs(b.t + shift - at);
      return da < db || (da === db && a.id > b.id) ? a : b;
    };
    const plan = place(
      { keys: tx.query.keysOfCurve(curveId), moving: ids, target: (key) => key.t + shift, edited: own, timeOf },
      opts,
      'block',
      nearest,
    );
    const removed = new Set(plan.deleted);
    for (const id of plan.deleted) tx.remove('keys', id);
    deleted.push(...plan.deleted);
    for (const p of plan.placements) {
      if (!p.moving || removed.has(p.key.id)) continue;
      const change = own.has(p.key.id) ? dv : 0;
      if (p.t === p.key.t && change === 0) continue;
      tx.put('keys', { ...p.key, t: p.t, v: p.key.v + change });
      moved++;
    }
  }
  return { moved, deleted };
}

const EMPTY_IDS: ReadonlySet<KeyId> = new Set();

/**
 * Scales key times around `pivot` (`t' = pivot + (t − pivot)·factor`, factor ≥ 0.01), §4.11.3. Fixed handles of
 * weighted curves scale their `dt` with the keys; non-weighted handles keep their direction. M2a: with `ripple`
 * (§5.11) the scope keys inside the region scale too and every scope key after it shifts by
 * `(pivot + (b − pivot)·factor) − b`; non-edited breakdowns retime (§5.12) unless `retimeBreakdowns: false`.
 */
export function scaleKeys(
  app: EditorApp,
  tx: Tx,
  keys: readonly KeyId[],
  pivot: Frame,
  factor: number,
  opts: KeyEditOptions,
  scope?: RippleScope,
): KeyEditResult {
  if (!Number.isFinite(pivot) || !Number.isFinite(factor)) {
    throw new EkzaError('invalid-record', 'scaleKeys: pivot and factor must be finite');
  }
  const f = Math.max(factor, MIN_SCALE);
  const edited = byCurve(tx, keys);
  let groups: Map<CurveId, Set<KeyId>> = edited;
  let shifted: ReadonlySet<KeyId> = EMPTY_IDS;
  let shiftAfter = 0;
  if (opts.ripple === true && edited.size > 0) {
    const plan = rippleScalePlan(tx, edited, scope ?? defaultScope(app, tx, keys), pivot, f, opts);
    groups = plan.moving;
    shifted = plan.shifted;
    shiftAfter = plan.shiftAfter;
  }
  const targetOf = (key: KeyRecord): number => (shifted.has(key.id) ? key.t + shiftAfter : pivot + (key.t - pivot) * f);
  let moved = 0;
  const deleted: KeyId[] = [];
  const timeOf = (id: KeyId): number | undefined => tx.get('keys', id)?.t;
  const fartherFromPivot = (a: KeyRecord, b: KeyRecord): KeyRecord => {
    const da = Math.abs(a.t - pivot);
    const db = Math.abs(b.t - pivot);
    return da > db || (da === db && a.id > b.id) ? a : b;
  };
  for (const [curveId, ids] of groups) {
    const curve = editableCurve(tx, curveId);
    if (curve === undefined) continue;
    const own = edited.get(curveId) ?? EMPTY_IDS;
    const plan = place(
      { keys: tx.query.keysOfCurve(curveId), moving: ids, target: targetOf, edited: own, timeOf },
      opts,
      'each',
      fartherFromPivot,
    );
    const removed = new Set(plan.deleted);
    for (const id of plan.deleted) tx.remove('keys', id);
    deleted.push(...plan.deleted);
    for (const p of plan.placements) {
      if (!p.moving || removed.has(p.key.id)) continue;
      const key = p.key;
      // Scaled keys scale their weighted fixed handles; shifted (ripple) and retimed keys keep their tangents.
      const scaled = !p.retimed && !shifted.has(key.id) && f !== 1 && curve.weighted;
      const scaleIn = scaled && key.inType === 'fixed';
      const scaleOut = scaled && key.outType === 'fixed';
      if (p.t === key.t && !scaleIn && !scaleOut) continue;
      tx.put('keys', {
        ...key,
        t: p.t,
        inHandle: scaleIn ? { dt: key.inHandle.dt * f, dv: key.inHandle.dv } : key.inHandle,
        outHandle: scaleOut ? { dt: key.outHandle.dt * f, dv: key.outHandle.dv } : key.outHandle,
      });
      moved++;
    }
  }
  return { moved, deleted };
}

// ---------- tangents (§4.11.4) ----------

/**
 * Display metrics of a curve's handles: frames per second and the value display scale (degrees for rotations and
 * `unit: 'angle'` attributes, M2A-SPEC §5.1 rule 5 — the units the Graph Editor draws and its fields show).
 */
function handleMetrics(tx: Tx, curve: CurveRecord): { readonly fps: number; readonly k: number } {
  const clip = requireClip(tx, curve.clip);
  const unit = channelUnit(tx.get('controls', curve.control) ?? null, curve.channel);
  return { fps: clip.fps.num / clip.fps.den, k: unit === 'angle' ? RAD2DEG : 1 };
}

/** Maya tangent weight: 3·hypot(|dt| seconds, dv display units). */
function weightOf(h: Handle, metrics: { readonly fps: number; readonly k: number }): number {
  return 3 * Math.hypot(Math.abs(h.dt) / metrics.fps, h.dv * metrics.k);
}

/** `direction` rescaled to the given weight (null when either has no length). */
function withWeight(
  direction: Handle,
  weight: number,
  metrics: { readonly fps: number; readonly k: number },
): Handle | null {
  const length = weightOf(direction, metrics);
  if (!(length > 0) || !(weight > 0) || !Number.isFinite(weight)) return null;
  const s = weight / length;
  return { dt: direction.dt * s, dv: direction.dv * s };
}

/** `direction` rescaled to the given |dt| (non-weighted handles carry only a slope). */
function withDt(direction: Handle, dt: number): Handle {
  const slope = direction.dv / direction.dt;
  const sign = direction.dt < 0 ? -1 : 1;
  return { dt: sign * dt, dv: slope * sign * dt };
}

/** The handle on its side of the key: a handle dragged across the key becomes vertical (±90°, §4.11.4). */
function orient(handle: Handle, side: 'in' | 'out'): Handle {
  const sign = side === 'out' ? 1 : -1;
  const dt = handle.dt * sign > MIN_HANDLE_DT ? handle.dt : sign * MIN_HANDLE_DT;
  return { dt, dv: handle.dv };
}

/**
 * Sets a key's tangent handle from a drag (§4.11.4 handle rules): the dragged side — and the opposite side unless
 * the key is broken or `tempBreak` — become `fixed` with resolved values. Non-weighted curves and weight-locked keys
 * change only the angle; weighted unlocked keys take angle and length with `dt` limited to the span towards the
 * neighbour. A unified key turns its opposite handle collinear, keeping that handle's length. `tempBreak` (Alt held)
 * leaves the opposite side alone and writes `broken: true`.
 */
export function setKeyHandle(
  app: EditorApp,
  tx: Tx,
  key: KeyId,
  side: 'in' | 'out',
  handle: Handle,
  opts: { readonly tempBreak: boolean },
): void {
  if (!Number.isFinite(handle.dt) || !Number.isFinite(handle.dv)) {
    throw new EkzaError('invalid-record', 'setKeyHandle: the handle must be finite');
  }
  const record = tx.get('keys', key);
  if (record === undefined) throw new EkzaError('invalid-record', `Key ${key} does not exist`);
  const curve = editableCurve(tx, record.curve);
  if (curve === undefined) return;
  const { keys, compiled } = compileInTx(app, tx, curve);
  const index = keys.findIndex((k) => k.id === key);
  if (index === -1) return; // a hidden duplicate (projection loser) has no handles to edit
  const metrics = handleMetrics(tx, curve);
  const resolved = (s: 'in' | 'out'): Handle =>
    s === 'in'
      ? { dt: compiled.inDt[index] as number, dv: compiled.inDv[index] as number }
      : { dt: compiled.outDt[index] as number, dv: compiled.outDv[index] as number };
  /** |dt| a non-weighted side keeps (its resolved span/3; 1 frame when degenerate). */
  const keptDt = (s: 'in' | 'out'): number => {
    const dt = Math.abs(resolved(s).dt);
    return dt > MIN_HANDLE_DT ? dt : 1;
  };
  /** `direction` with the length of side `s` (weight on weighted curves, |dt| otherwise). */
  const withLengthOf = (direction: Handle, s: 'in' | 'out'): Handle =>
    (curve.weighted ? withWeight(direction, weightOf(resolved(s), metrics), metrics) : null) ??
    withDt(direction, keptDt(s));

  const dragged = orient(handle, side);
  let next: Handle;
  if (!curve.weighted || record.weightLocked) {
    next = withLengthOf(dragged, side);
  } else {
    // §4.11.4: angle and length follow the pointer; only `dt` is clamped to (0, span] ("clamp x, keep y", the Graph
    // Editor's drag rule, WP-6 G-21), so scripted callers get what a drag gets.
    const neighbour = keys[side === 'out' ? index + 1 : index - 1];
    const span = neighbour === undefined ? Infinity : Math.abs(neighbour.t - record.t);
    next = Math.abs(dragged.dt) > span ? { dt: Math.sign(dragged.dt) * span, dv: dragged.dv } : dragged;
  }

  let updated: KeyRecord =
    side === 'in' ? { ...record, inType: 'fixed', inHandle: next } : { ...record, outType: 'fixed', outHandle: next };
  if (opts.tempBreak) {
    updated = { ...updated, broken: true };
  } else if (!record.broken) {
    const opposite = side === 'in' ? 'out' : 'in';
    const aligned = withLengthOf({ dt: -next.dt, dv: -next.dv }, opposite);
    updated =
      opposite === 'in'
        ? { ...updated, inType: 'fixed', inHandle: aligned }
        : { ...updated, outType: 'fixed', outHandle: aligned };
  }
  tx.put('keys', updated);
}

/**
 * Sets tangent types (§4.11.4 type rules): `step` / `stepNext` set the out side only; `fixed` first stores the
 * resolved handles of the affected sides; changing a fixed side to a computed type keeps its stored handle.
 */
export function setTangentTypes(
  app: EditorApp,
  tx: Tx,
  keys: readonly KeyId[],
  type: TangentType,
  side: 'both' | 'in' | 'out',
): void {
  const sides: readonly ('in' | 'out')[] =
    type === 'step' || type === 'stepNext' ? ['out'] : side === 'both' ? ['in', 'out'] : [side];
  for (const [curveId, ids] of byCurve(tx, keys)) {
    const curve = editableCurve(tx, curveId);
    if (curve === undefined) continue;
    const resolvedKeys = type === 'fixed' ? compileInTx(app, tx, curve) : null;
    for (const id of ids) {
      const key = tx.get('keys', id) as KeyRecord;
      let updated: KeyRecord = key;
      for (const s of sides) {
        if (s === 'in') updated = { ...updated, inType: type };
        else updated = { ...updated, outType: type };
      }
      if (resolvedKeys !== null) {
        const index = resolvedKeys.keys.findIndex((k) => k.id === id);
        if (index !== -1) {
          const c = resolvedKeys.compiled;
          if (sides.includes('in')) {
            updated = { ...updated, inHandle: { dt: c.inDt[index] as number, dv: c.inDv[index] as number } };
          }
          if (sides.includes('out')) {
            updated = { ...updated, outHandle: { dt: c.outDt[index] as number, dv: c.outDv[index] as number } };
          }
        }
      }
      if (!sameKeyData(updated, key)) tx.put('keys', updated);
    }
  }
}

// ---------- insert and delete ----------

/**
 * Inserts a key on a curve without changing its shape (§4.11.4 insert rule, anim-core `insertKeyPreservingShape`):
 * neighbours whose computed handles would change are frozen as `fixed`. A key already at `frame` is returned as is;
 * a curve without keys gets a key at its static value with the default tangents.
 */
export function insertKeyOnCurve(app: EditorApp, tx: Tx, curve: CurveId, frame: Frame): KeyId {
  if (!Number.isFinite(frame)) throw new EkzaError('invalid-record', 'insertKeyOnCurve: frame must be finite');
  const record = requireCurve(tx, curve);
  if (record.locked) throw new EkzaError('unsupported', `Curve ${curve} is locked`);
  const keys = tx.query.keysOfCurve(curve);
  const existing = keys.find((key) => Math.abs(key.t - frame) < SAME_FRAME_EPS);
  if (existing !== undefined) return existing.id;
  if (keys.length === 0) {
    const value = record.staticValue ?? channelDefaultOf(tx.get('controls', record.control) ?? null, record.channel);
    return writeKeyAt(app, tx, curve, frame, value, app.prefs.getState().defaultTangents);
  }
  const result = internalsOf(app).deps.curves.insertKeyPreservingShape(animCurve(record, keys.map(keyDataOf)), frame);
  if (result.keys.length !== keys.length + 1) {
    throw new EkzaError('internal', 'insertKeyPreservingShape returned an unexpected key count');
  }
  const id = newRecordId(app, 'key');
  result.keys.forEach((data: KeyData, i: number) => {
    if (i === result.index) {
      tx.put('keys', { ...keyDataOf(data), id, clip: record.clip, curve });
      return;
    }
    const original = keys[i < result.index ? i : i - 1] as KeyRecord;
    if (!sameKeyData(original, data)) tx.put('keys', { ...original, ...keyDataOf(data) });
  });
  return id;
}

/**
 * Hard-deletes keys (§4.11.0). A curve that loses its last key keeps its value at the current frame as
 * `staticValue`, so the pose does not jump.
 */
export function deleteKeys(app: EditorApp, tx: Tx, keys: readonly KeyId[]): number {
  let count = 0;
  for (const [curveId, ids] of byCurve(tx, keys)) {
    const curve = editableCurve(tx, curveId);
    if (curve === undefined) continue;
    const { keys: visible, compiled } = compileInTx(app, tx, curve);
    if (visible.length > 0 && visible.every((key) => ids.has(key.id))) {
      const clip = requireClip(tx, curve.clip);
      const value = internalsOf(app).deps.curves.engine.evaluate(compiled, currentClipFrame(app, tx, clip));
      tx.patch('curves', curveId, { staticValue: value });
    }
    for (const id of ids) {
      tx.remove('keys', id);
      count++;
    }
  }
  return count;
}

// ---------- copying and inserting time (M2A-SPEC §5.9) ----------

/**
 * M2a: copies of `keys` at `t + dFrames` on the same curves (whole frames when `opts.snap`), with the originals'
 * values, tangents and breakdown flags; the originals are unchanged. A copy landing on a non-copied key's time
 * replaces that key (during a drag too, so the preview shows the result); a copy landing on a copied key's time is
 * not made (the original stays). Keys of locked curves are not copied.
 */
export function copyKeys(
  app: EditorApp,
  tx: Tx,
  keys: readonly KeyId[],
  dFrames: number,
  opts: KeyEditOptions,
): { readonly created: readonly KeyId[]; readonly deleted: readonly KeyId[] } {
  if (!Number.isFinite(dFrames)) throw new EkzaError('invalid-record', 'copyKeys: the offset must be finite');
  const created: KeyId[] = [];
  const deleted: KeyId[] = [];
  for (const [curveId, ids] of byCurve(tx, keys)) {
    if (editableCurve(tx, curveId) === undefined) continue;
    const existing = tx.query.keysOfCurve(curveId);
    const originals = existing.filter((key) => ids.has(key.id));
    const originalTimes = originals.map((key) => key.t).sort((a, b) => a - b);
    const removed = new Set<KeyId>();
    for (const key of originals) {
      const t = opts.snap ? Math.round(key.t + dFrames) : key.t + dFrames;
      if (hasTimeNear(originalTimes, t)) continue;
      for (const other of existing) {
        if (ids.has(other.id) || removed.has(other.id) || Math.abs(other.t - t) >= SAME_FRAME_EPS) continue;
        tx.remove('keys', other.id);
        removed.add(other.id);
        deleted.push(other.id);
      }
      const id = newRecordId(app, 'key');
      tx.put('keys', { ...key, id, t });
      created.push(id);
    }
  }
  return { created, deleted };
}

/**
 * M2a §5.9: a uniform time warp of `curves` after `at`. `frames > 0` inserts time: every key with `t > at`
 * (breakdowns included) moves by `frames`. `frames < 0` removes time: keys in `(at, at + |frames|]` are deleted (a
 * curve losing its last key keeps its value as `staticValue`, `deleteKeys`) and the later keys move back by
 * `|frames|`. Nothing at or before `at` changes; breakdowns are never retimed. Locked curves are skipped. The
 * operators decide whether a deletion is allowed (`time.insertTime {removeKeys}`).
 */
export function insertTime(
  app: EditorApp,
  tx: Tx,
  curves: readonly CurveId[],
  at: Frame,
  frames: number,
): KeyEditResult {
  if (!Number.isFinite(at) || !Number.isFinite(frames)) {
    throw new EkzaError('invalid-record', 'insertTime: at and frames must be finite');
  }
  if (frames === 0) return { moved: 0, deleted: [] };
  const removeUntil = frames < 0 ? at - frames : at;
  let moved = 0;
  const deleted: KeyId[] = [];
  const seen = new Set<CurveId>();
  for (const curveId of curves) {
    if (seen.has(curveId)) continue;
    seen.add(curveId);
    if (editableCurve(tx, curveId) === undefined) continue;
    const keys = tx.query.keysOfCurve(curveId);
    const doomed = keys.filter((key) => key.t > at + SAME_FRAME_EPS && key.t <= removeUntil + SAME_FRAME_EPS);
    if (doomed.length > 0) {
      const ids = doomed.map((key) => key.id);
      deleteKeys(app, tx, ids);
      deleted.push(...ids);
    }
    for (const key of keys) {
      if (key.t <= removeUntil + SAME_FRAME_EPS) continue;
      tx.put('keys', { ...key, t: key.t + frames });
      moved++;
    }
  }
  return { moved, deleted };
}

/** Keys of `curves` in `(at, at + |frames|]` that removing `frames < 0` frames after `at` would delete (§5.9 poll). */
export function keysInRemovedTime(view: ReadView, curves: readonly CurveId[], at: Frame, frames: number): KeyRecord[] {
  if (!(frames < 0)) return [];
  const out: KeyRecord[] = [];
  for (const curveId of new Set(curves)) {
    if (editableCurve(view, curveId) === undefined) continue;
    for (const key of view.query.keysOfCurve(curveId)) {
      if (key.t > at + SAME_FRAME_EPS && key.t <= at - frames + SAME_FRAME_EPS) out.push(key);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
