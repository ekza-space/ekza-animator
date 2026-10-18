// Edit-kernel helpers for curves and keys (MVP-SPEC §4.11.0 table, §4.11.3, §4.11.4). Every writer of keys —
// operators, Graph Editor and time-slider drags, manipulators — goes through these, inside the caller's transaction
// or preview update (`tx`). Keys of curves locked in the Graph Editor (`CurveRecord.locked`) are never edited.
import { EkzaError, type Frame, type Handle, type KeyData, RAD2DEG, type TangentType } from '@ekza-animator/anim-core';
import type { ChannelId, ClipId, ControlId, CurveId, CurveRecord, KeyId, KeyRecord, Tx } from '@ekza-animator/doc';
import { internalsOf, newRecordId } from '../app/internals';
import type { EditorApp, KeyEditOptions, KeyEditResult } from '../types';
import { channelDefaultOf, isRotation } from './channelMeta';
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

// ---------- moving and scaling (§4.11.3) ----------

interface Placement {
  readonly key: KeyRecord;
  readonly moving: boolean;
  /** Target time (moving keys) or the current time. */
  t: number;
}

/**
 * Places the moving keys of one curve at their target times under the §4.11.3 rules and returns the keys to delete.
 * Runs of consecutive moving keys never cross a non-moving neighbour: while dragging they stop `DRAG_MARGIN` short
 * (as a block for moves, key by key for scales); on the final update a key that lands exactly on it deletes it. With
 * snapping, a key dragged **past** the neighbour stops on the last whole frame before it instead, so an overshoot
 * never deletes a key (acceptance round 2). Two moving keys landing on one frame keep the `preferred` one (final
 * update only).
 */
function place(
  keys: readonly KeyRecord[],
  moving: ReadonlySet<KeyId>,
  target: (key: KeyRecord) => number,
  opts: KeyEditOptions,
  clampAs: 'block' | 'each',
  preferred: (a: KeyRecord, b: KeyRecord, at: number) => KeyRecord,
): { readonly placements: readonly Placement[]; readonly deleted: readonly KeyId[] } {
  const placements: Placement[] = keys.map((key) => {
    if (!moving.has(key.id)) return { key, moving: false, t: key.t };
    const t = target(key);
    return { key, moving: true, t: opts.snap ? Math.round(t) : t };
  });
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
    const run = placements.slice(i, j);
    let min = Infinity;
    let max = -Infinity;
    for (const p of run) {
      if (p.t < min) min = p.t;
      if (p.t > max) max = p.t;
    }
    if (clampAs === 'block' && max - min <= upper - lower) {
      let shift = min < lower ? clampOne(min) - min : max > upper ? clampOne(max) - max : 0;
      // The whole-frame stop leaves no room for the block: stop at the neighbour as before.
      if (min + shift < lower || max + shift > upper) shift = min < lower ? lower - min : upper - max;
      for (const p of run) p.t += shift;
    } else {
      for (const p of run) p.t = clampOne(p.t);
    }
    i = j;
  }
  if (!opts.resolveCollisions) return { placements, deleted: [] };

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
  return { placements, deleted: [...deleted] };
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
function byCurve(tx: Tx, keys: readonly KeyId[]): Map<CurveId, Set<KeyId>> {
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
function editableCurve(tx: Tx, curve: CurveId): CurveRecord | undefined {
  const record = tx.get('curves', curve);
  return record === undefined || record.locked ? undefined : record;
}

/** Moves keys by `dFrames` (time) and `dValue` (display units: degrees for rotation curves), §4.11.3. */
export function moveKeys(
  _app: EditorApp,
  tx: Tx,
  keys: readonly KeyId[],
  dFrames: number,
  dValue: number,
  opts: KeyEditOptions,
): KeyEditResult {
  if (!Number.isFinite(dFrames) || !Number.isFinite(dValue)) {
    throw new EkzaError('invalid-record', 'moveKeys: offsets must be finite');
  }
  let moved = 0;
  const deleted: KeyId[] = [];
  for (const [curveId, ids] of byCurve(tx, keys)) {
    const curve = editableCurve(tx, curveId);
    if (curve === undefined) continue;
    const dv = fromDisplayValue(curve.channel, dValue);
    const nearest = (a: KeyRecord, b: KeyRecord, at: number): KeyRecord => {
      const da = Math.abs(a.t + dFrames - at);
      const db = Math.abs(b.t + dFrames - at);
      return da < db || (da === db && a.id > b.id) ? a : b;
    };
    const plan = place(tx.query.keysOfCurve(curveId), ids, (key) => key.t + dFrames, opts, 'block', nearest);
    const removed = new Set(plan.deleted);
    for (const id of plan.deleted) tx.remove('keys', id);
    deleted.push(...plan.deleted);
    for (const p of plan.placements) {
      if (!p.moving || removed.has(p.key.id)) continue;
      if (p.t === p.key.t && dv === 0) continue;
      tx.put('keys', { ...p.key, t: p.t, v: p.key.v + dv });
      moved++;
    }
  }
  return { moved, deleted };
}

/**
 * Scales key times around `pivot` (`t' = pivot + (t − pivot)·factor`, factor ≥ 0.01), §4.11.3. Fixed handles of
 * weighted curves scale their `dt` with the keys; non-weighted handles keep their direction.
 */
export function scaleKeys(
  _app: EditorApp,
  tx: Tx,
  keys: readonly KeyId[],
  pivot: Frame,
  factor: number,
  opts: KeyEditOptions,
): KeyEditResult {
  if (!Number.isFinite(pivot) || !Number.isFinite(factor)) {
    throw new EkzaError('invalid-record', 'scaleKeys: pivot and factor must be finite');
  }
  const f = Math.max(factor, MIN_SCALE);
  let moved = 0;
  const deleted: KeyId[] = [];
  const fartherFromPivot = (a: KeyRecord, b: KeyRecord): KeyRecord => {
    const da = Math.abs(a.t - pivot);
    const db = Math.abs(b.t - pivot);
    return da > db || (da === db && a.id > b.id) ? a : b;
  };
  for (const [curveId, ids] of byCurve(tx, keys)) {
    const curve = editableCurve(tx, curveId);
    if (curve === undefined) continue;
    const plan = place(
      tx.query.keysOfCurve(curveId),
      ids,
      (key) => pivot + (key.t - pivot) * f,
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
      const scaleIn = curve.weighted && key.inType === 'fixed' && f !== 1;
      const scaleOut = curve.weighted && key.outType === 'fixed' && f !== 1;
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

/** Display metrics of a curve's handles: frames per second and the value display scale. */
function handleMetrics(tx: Tx, curve: CurveRecord): { readonly fps: number; readonly k: number } {
  const clip = requireClip(tx, curve.clip);
  return { fps: clip.fps.num / clip.fps.den, k: isRotation(curve.channel) ? RAD2DEG : 1 };
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

// ---------- M2a contract stubs (M2A-SPEC §4.5; A3 implements) ----------

/** M2a: copies of `keys` at t + dFrames (same curves); colliding non-copied keys are replaced (A3). */
export function copyKeys(
  _app: EditorApp,
  _tx: Tx,
  _keys: readonly KeyId[],
  _dFrames: number,
  _opts: KeyEditOptions,
): { readonly created: readonly KeyId[]; readonly deleted: readonly KeyId[] } {
  throw new EkzaError('not-implemented', 'editor-core.copyKeys');
}

/** M2a §5.9: insert (frames > 0) or remove (frames < 0) time after `at` on the curves (A3). */
export function insertTime(
  _app: EditorApp,
  _tx: Tx,
  _curves: readonly CurveId[],
  _at: Frame,
  _frames: number,
): KeyEditResult {
  throw new EkzaError('not-implemented', 'editor-core.insertTime');
}
