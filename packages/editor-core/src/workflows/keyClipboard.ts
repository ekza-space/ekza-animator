// Key clipboard (MVP-SPEC §4.11.4 `KeyClipboard` v2): copied keys keep their tangents, handles, `broken`,
// `weightLocked` and the source curve's `weighted` flag, with times relative to the earliest copied key. Pasting at a
// frame writes onto the same template key + channel of the active character; a weighted flag that differs converts
// fixed handles (weighted → non-weighted keeps the slope; non-weighted → weighted takes 1/3 of the adjacent span
// along the same direction).
import type { Frame, Handle } from '@ekza-animator/anim-core';
import type { ClipRecord, CurveId, KeyId, KeyRecord, Tx } from '@ekza-animator/doc';
import { newRecordId } from '../app/internals';
import { isKeyable, isLocked } from '../edit/channelMeta';
import { ensureCurve } from '../edit/keys';
import type { EditorApp, KeyClipboard, KeyClipboardKey } from '../types';
import { keyRecord } from './records';

/** Two keys this close (frames) share a time. */
const SAME_TIME = 1e-6;

/** The clipboard of the given keys; null when there are none. */
export function copyKeys(view: Tx | EditorApp['store'], keys: readonly KeyId[]): KeyClipboard | null {
  const groups = new Map<CurveId, KeyRecord[]>();
  for (const id of keys) {
    const key = view.get('keys', id);
    if (key === undefined) continue;
    const group = groups.get(key.curve);
    if (group === undefined) groups.set(key.curve, [key]);
    else group.push(key);
  }
  let earliest = Infinity;
  for (const group of groups.values()) for (const key of group) earliest = Math.min(earliest, key.t);
  const curves: KeyClipboard['curves'][number][] = [];
  for (const [curveId, group] of groups) {
    const curve = view.get('curves', curveId);
    const control = curve === undefined ? undefined : view.get('controls', curve.control);
    if (curve === undefined || control === undefined) continue;
    curves.push({
      control: control.key,
      channel: curve.channel,
      weighted: curve.weighted,
      keys: [...group]
        .sort((a, b) => a.t - b.t)
        .map(
          (key): KeyClipboardKey => ({
            dt: key.t - earliest,
            v: key.v,
            inType: key.inType,
            outType: key.outType,
            inHandle: { dt: key.inHandle.dt, dv: key.inHandle.dv },
            outHandle: { dt: key.outHandle.dt, dv: key.outHandle.dv },
            broken: key.broken,
            weightLocked: key.weightLocked,
          }),
        ),
    });
  }
  curves.sort((a, b) => (a.control === b.control ? (a.channel < b.channel ? -1 : 1) : a.control < b.control ? -1 : 1));
  return curves.length === 0 ? null : { kind: 'ekza.keys', version: 2, curves };
}

/** `handle` rescaled along its direction to |dt| = `dt` (unchanged when it has no time extent). */
function withAbsDt(handle: Handle, dt: number): Handle {
  if (Math.abs(handle.dt) < 1e-12 || !(dt > 0)) return handle;
  const s = dt / Math.abs(handle.dt);
  return { dt: handle.dt * s, dv: handle.dv * s };
}

export interface PasteResult {
  readonly keys: readonly KeyId[];
  readonly skipped: number;
}

/**
 * Pastes at clip frame `frame` of `clip` (the active character's). `merge` replaces keys at the pasted times;
 * `replace` first clears each target curve over the pasted time span. Channels that are locked, not keyable or
 * missing on this rig are skipped (counted), as are Graph-Editor-locked curves.
 */
export function pasteKeys(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  clipboard: KeyClipboard,
  frame: Frame,
  mode: 'merge' | 'replace',
): PasteResult {
  const rig = tx.query.rigOfCharacter(clip.character);
  const pasted: KeyId[] = [];
  let skipped = 0;
  for (const source of clipboard.curves) {
    const control = rig === undefined ? undefined : tx.query.controlByKey(rig.id, source.control);
    if (control === undefined || !isKeyable(control, source.channel) || isLocked(control, source.channel)) {
      skipped += source.keys.length;
      continue;
    }
    const curveId = ensureCurve(app, tx, clip.id, control.id, source.channel);
    const curve = tx.get('curves', curveId);
    if (curve === undefined || curve.locked || source.keys.length === 0) {
      skipped += source.keys.length;
      continue;
    }
    const times = source.keys.map((key) => frame + key.dt);
    const first = Math.min(...times);
    const last = Math.max(...times);
    for (const existing of tx.query.keysOfCurve(curveId)) {
      const clash =
        mode === 'replace'
          ? existing.t >= first - SAME_TIME && existing.t <= last + SAME_TIME
          : times.some((t) => Math.abs(existing.t - t) < SAME_TIME);
      if (clash) tx.remove('keys', existing.id);
    }
    const ids: KeyId[] = [];
    source.keys.forEach((key, i) => {
      const id = newRecordId(app, 'key');
      ids.push(id);
      tx.put(
        'keys',
        keyRecord(id, clip.id, curveId, {
          t: times[i] as number,
          v: key.v,
          inType: key.inType,
          outType: key.outType,
          inHandle: key.inHandle,
          outHandle: key.outHandle,
          broken: key.broken,
          weightLocked: key.weightLocked,
        }),
      );
    });
    if (curve.weighted && !source.weighted) {
      // Non-weighted handles carry only a direction: give fixed sides 1/3 of the span to their neighbour.
      const sorted = tx.query.keysOfCurve(curveId);
      const pastedHere = new Set(ids);
      sorted.forEach((key, i) => {
        if (!pastedHere.has(key.id)) return;
        const prev = sorted[i - 1];
        const next = sorted[i + 1];
        let updated = key;
        if (key.inType === 'fixed' && prev !== undefined) {
          updated = { ...updated, inHandle: withAbsDt(key.inHandle, (key.t - prev.t) / 3) };
        }
        if (key.outType === 'fixed' && next !== undefined) {
          updated = { ...updated, outHandle: withAbsDt(key.outHandle, (next.t - key.t) / 3) };
        }
        if (updated !== key) tx.put('keys', updated);
      });
    }
    pasted.push(...ids);
  }
  return { keys: pasted, skipped };
}
