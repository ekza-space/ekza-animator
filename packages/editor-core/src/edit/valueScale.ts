// M2A-SPEC §5.15.3 value scaling of keys (A4): the Graph Editor's scale tool and region box, `graph.keys.scale`
// with `valuePivot`/`valueFactor`. Values scale around a pivot in display units (degrees for rotations); the `dv` of
// fixed handles scales with the factor, so the curve between scaled keys keeps its shape scaled; a negative factor
// flips the keys around the pivot. Keys of locked curves are not changed.
import { EkzaError } from '@ekza-animator/anim-core';
import type { CurveId, KeyId, KeyRecord, Tx } from '@ekza-animator/doc';
import type { EditorApp, KeyEditResult } from '../types';
import { channelUnit, isLocked, isTrsChannel } from './channelMeta';
import { fromDisplayValue } from './numeric';

/** M2a: value scale of keys around `pivot` (display units); handles' dv scale with the factor. */
export function scaleKeyValues(
  _app: EditorApp,
  tx: Tx,
  keys: readonly KeyId[],
  pivot: number,
  factor: number,
): KeyEditResult {
  if (!Number.isFinite(pivot) || !Number.isFinite(factor)) {
    throw new EkzaError('invalid-record', 'scaleKeyValues: pivot and factor must be finite');
  }
  if (factor === 1) return { moved: 0, deleted: [] };
  // `0 + x` keeps zero values at +0 (−0 would leak into documents and comparisons).
  const scaled = (x: number): number => 0 + x * factor;
  const byCurve = new Map<CurveId, KeyRecord[]>();
  const seen = new Set<KeyId>();
  for (const id of keys) {
    if (seen.has(id)) continue;
    seen.add(id);
    const key = tx.get('keys', id);
    if (key === undefined) continue;
    const list = byCurve.get(key.curve);
    if (list === undefined) byCurve.set(key.curve, [key]);
    else list.push(key);
  }
  let moved = 0;
  for (const [curveId, list] of byCurve) {
    const curve = tx.get('curves', curveId);
    if (curve === undefined || curve.locked) continue;
    const control = tx.get('controls', curve.control) ?? null;
    if (control !== null && isTrsChannel(curve.channel) && isLocked(control, curve.channel)) continue;
    const p = fromDisplayValue(curve.channel, pivot, channelUnit(control, curve.channel));
    for (const key of list) {
      const v = p + scaled(key.v - p);
      const inHandle = key.inType === 'fixed' ? { dt: key.inHandle.dt, dv: scaled(key.inHandle.dv) } : key.inHandle;
      const outHandle =
        key.outType === 'fixed' ? { dt: key.outHandle.dt, dv: scaled(key.outHandle.dv) } : key.outHandle;
      tx.put('keys', { ...key, v, inHandle, outHandle });
      moved++;
    }
  }
  return { moved, deleted: [] };
}
