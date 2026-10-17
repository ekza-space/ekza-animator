// The curves a Graph Editor shows (ARCHITECTURE §9 `CurveSet`): visible CurveIds → records, keys and compiled curves
// from the evaluation service. Rebuilt lazily after document changes; reads go through the store, so an active
// preview (a drag in progress) is what gets drawn.
import type { CompiledAnimCurve } from '@ekza-animator/anim-core';
import type { ChannelId, ControlRecord, CurveId, CurveRecord, KeyId, KeyRecord } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import { channelColor } from '../channel-tree/colors';
import { channelDisplayScale } from '../view/transform';

export interface CurveEntry {
  readonly id: CurveId;
  readonly record: CurveRecord;
  readonly channel: ChannelId;
  /** Display units per curve unit (degrees for rotations). */
  readonly scale: number;
  readonly color: string;
  /** Curve lock or channel lock: drawn, never edited or selected. */
  readonly locked: boolean;
  readonly compiled: CompiledAnimCurve;
  /** Index-aligned with `compiled` (sorted by time). */
  readonly keys: readonly KeyRecord[];
  readonly index: ReadonlyMap<KeyId, number>;
}

export interface CurveSet {
  readonly entries: readonly CurveEntry[];
  readonly byCurve: ReadonlyMap<CurveId, CurveEntry>;
  /** Key → its curve entry and index. */
  readonly byKey: ReadonlyMap<KeyId, { readonly entry: CurveEntry; readonly index: number }>;
}

export const EMPTY_CURVE_SET: CurveSet = { entries: [], byCurve: new Map(), byKey: new Map() };

/** True when the control's lock flags cover a TRS channel. */
export function channelLocked(control: ControlRecord | undefined, channel: ChannelId): boolean {
  if (control === undefined || channel.length !== 2) return false;
  const group = channel[0] === 't' ? control.locked.t : channel[0] === 'r' ? control.locked.r : control.locked.s;
  const axis = 'xyz'.indexOf(channel[1] ?? '');
  return axis !== -1 && (channel[0] === 't' || channel[0] === 'r' || channel[0] === 's') && group[axis] === true;
}

export function buildCurveSet(app: EditorApp, curves: readonly CurveId[]): CurveSet {
  const entries: CurveEntry[] = [];
  const byCurve = new Map<CurveId, CurveEntry>();
  const byKey = new Map<KeyId, { entry: CurveEntry; index: number }>();
  for (const id of curves) {
    if (byCurve.has(id)) continue;
    const record = app.store.get('curves', id);
    if (record === undefined) continue;
    let compiled: CompiledAnimCurve;
    try {
      compiled = app.evaluation.compiledCurve(id);
    } catch {
      continue; // a curve the evaluation service cannot compile (e.g. its partition is loading) is not drawn
    }
    const keys = app.store.query.keysOfCurve(id);
    // Compiled arrays and records must align index by index; a stale compiled curve is not drawn.
    if (keys.length !== compiled.keyCount) continue;
    const index = new Map<KeyId, number>();
    keys.forEach((key, i) => index.set(key.id, i));
    const control = app.store.get('controls', record.control);
    const entry: CurveEntry = {
      id,
      record,
      channel: record.channel,
      scale: channelDisplayScale(record.channel),
      color: channelColor(record.channel),
      locked: record.locked || channelLocked(control, record.channel),
      compiled,
      keys,
      index,
    };
    entries.push(entry);
    byCurve.set(id, entry);
    keys.forEach((key, i) => byKey.set(key.id, { entry, index: i }));
  }
  return { entries, byCurve, byKey };
}
