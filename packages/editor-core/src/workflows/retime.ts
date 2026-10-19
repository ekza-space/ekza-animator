// Retiming helpers of `key.retime` (MCP-SPEC §4.10, P1) that the shipped edit kernel does not cover without reading
// the session: deleting keys with a deterministic static value, inserting and deleting time with that rule, and the
// cyclic offset of a loop clip (`wrap`). Offsets and scales without `wrap` go through the kernel's `moveKeys` and
// `scaleKeys`.
import type { Frame } from '@ekza-animator/anim-core';
import type { ClipRecord, CurveId, CurveRecord, KeyId, KeyRecord, Tx } from '@ekza-animator/doc';
import { newRecordId } from '../app/internals';
import { compileInTx, SAME_FRAME_EPS } from '../edit/context';
import { insertKeyOnCurve } from '../edit/keys';
import { internalsOf } from '../app/internals';
import type { EditorApp } from '../types';

/**
 * Hard-deletes keys of one curve. A curve that loses its last key keeps its value at the clip's range start as
 * `staticValue` (the shipped `deleteKeys` keeps the value at the user's current frame; an agent run never reads it,
 * so the result is the same live and headless). Locked curves are left alone. Returns the deleted ids.
 */
export function deleteCurveKeys(app: EditorApp, tx: Tx, curve: CurveRecord, keys: readonly KeyId[]): KeyId[] {
  if (curve.locked || keys.length === 0) return [];
  const ids = new Set(keys);
  const { keys: all, compiled } = compileInTx(app, tx, curve);
  const doomed = all.filter((key) => ids.has(key.id));
  if (doomed.length === 0) return [];
  if (doomed.length === all.length) {
    const clip = tx.get('clips', curve.clip);
    const at = clip?.range.start ?? (all[0] as KeyRecord).t;
    tx.patch('curves', curve.id, { staticValue: internalsOf(app).deps.curves.engine.evaluate(compiled, at) });
  }
  for (const key of doomed) tx.remove('keys', key.id);
  return doomed.map((key) => key.id);
}

/**
 * M2a §5.9 time warp over `curves` after `at` with the deterministic static rule of `deleteCurveKeys`: `frames > 0`
 * moves every key with `t > at` by `frames`; `frames < 0` deletes the keys in `(at, at + |frames|]` and moves the later
 * ones back. Locked curves are skipped.
 */
export function insertTimeOn(
  app: EditorApp,
  tx: Tx,
  curves: readonly CurveRecord[],
  at: Frame,
  frames: number,
): { readonly moved: number; readonly deleted: readonly KeyId[] } {
  if (frames === 0) return { moved: 0, deleted: [] };
  const removeUntil = frames < 0 ? at - frames : at;
  let moved = 0;
  const deleted: KeyId[] = [];
  for (const curve of curves) {
    if (curve.locked) continue;
    const keys = tx.query.keysOfCurve(curve.id);
    const doomed = keys.filter((key) => key.t > at + SAME_FRAME_EPS && key.t <= removeUntil + SAME_FRAME_EPS);
    deleted.push(
      ...deleteCurveKeys(
        app,
        tx,
        curve,
        doomed.map((key) => key.id),
      ),
    );
    for (const key of keys) {
      if (key.t <= removeUntil + SAME_FRAME_EPS) continue;
      tx.put('keys', { ...key, t: key.t + frames });
      moved++;
    }
  }
  return { moved, deleted };
}

/** `a mod p` in [0, p). */
function mod(a: number, p: number): number {
  const r = a % p;
  return r < 0 ? r + p : r;
}

/**
 * The cyclic offset of one curve of a loop clip (`key.retime {mode: 'offset', wrap: true}`): keys move by `offset`
 * and keys leaving the clip range come in at the other end (times modulo the range length). So that the loop stays
 * closed and its shape is kept, the old curve first gets a shape-preserving key at the time that lands on the range
 * start, a seam key at the range end that duplicates the start key is dropped (the start key takes its in side), and
 * after the move the new start key is copied to the range end. Keys landing on one frame: the later (in the old
 * curve) wins. Returns how many keys moved and merged.
 */
export function wrapOffsetCurve(
  app: EditorApp,
  tx: Tx,
  curve: CurveRecord,
  clip: ClipRecord,
  offset: number,
): { readonly moved: number; readonly merged: number } {
  const { start, end } = clip.range;
  const period = end - start;
  if (curve.locked || !(period > 0)) return { moved: 0, merged: 0 };
  const shift = mod(offset, period);
  if (tx.query.keysOfCurve(curve.id).length === 0 || shift < SAME_FRAME_EPS || period - shift < SAME_FRAME_EPS) {
    return { moved: 0, merged: 0 };
  }
  const near = (keys: readonly KeyRecord[], t: number): KeyRecord | undefined =>
    keys.find((key) => Math.abs(key.t - t) < SAME_FRAME_EPS);
  // 1. The old time that lands on the range start gets a key (the shape around it is kept).
  const landing = start + period - shift;
  if (near(tx.query.keysOfCurve(curve.id), landing) === undefined) insertKeyOnCurve(app, tx, curve.id, landing);
  // 2. The seam: a key at the range end that repeats the start key goes; the start key keeps its incoming side.
  let keys = tx.query.keysOfCurve(curve.id);
  const startKey = near(keys, start);
  const endKey = near(keys, end);
  if (startKey !== undefined && endKey !== undefined && startKey.id !== endKey.id) {
    tx.remove('keys', endKey.id);
    tx.put('keys', { ...startKey, inType: endKey.inType, inHandle: endKey.inHandle });
    keys = tx.query.keysOfCurve(curve.id);
  }
  // 3. Move every key cyclically; on a collision the later old key wins.
  const placed = new Map<number, KeyRecord>();
  let merged = 0;
  const order = [...keys].sort((a, b) => a.t - b.t);
  for (const key of order) {
    const t = start + mod(key.t - start + shift, period);
    const snapped = Math.abs(t - end) < SAME_FRAME_EPS ? start : t;
    const slot = Math.round(snapped * 1e6);
    const loser = placed.get(slot);
    if (loser !== undefined) {
      tx.remove('keys', loser.id);
      merged++;
    }
    placed.set(slot, { ...key, t: snapped });
  }
  let moved = 0;
  for (const key of placed.values()) {
    const before = tx.get('keys', key.id);
    if (before === undefined) continue;
    if (before.t !== key.t) moved++;
    tx.put('keys', key);
  }
  // 4. Close the loop: the key now at the range start is repeated at the range end.
  const after = tx.query.keysOfCurve(curve.id);
  const first = near(after, start);
  if (first !== undefined && near(after, end) === undefined) {
    tx.put('keys', { ...first, id: newRecordId(app, 'key'), t: end });
  }
  return { moved, merged };
}

/** Curve ids of base-layer curves of `clip` that have keys. */
export function keyedBaseCurves(tx: Tx, clip: ClipRecord): readonly CurveId[] {
  const layer = tx.query.baseLayer(clip.id);
  if (layer === undefined) return [];
  return tx.query
    .curvesOfClip(clip.id)
    .filter((curve) => curve.layer === layer.id && tx.query.keysOfCurve(curve.id).length > 0)
    .map((curve) => curve.id);
}
