// The curves a Graph Editor shows (ARCHITECTURE §9 `CurveSet`): visible CurveIds → records, keys and compiled curves
// from the evaluation service. Rebuilt lazily after document changes; reads go through the store, so an active
// preview (a drag in progress) is what gets drawn.
import type { CompiledAnimCurve } from '@ekza-animator/anim-core';
import type { ChannelId, ControlRecord, CurveId, CurveRecord, KeyId, KeyRecord } from '@ekza-animator/doc';
import { channelUnit, type EditorApp } from '@ekza-animator/editor-core';
import { channelColor } from '../channel-tree/colors';
import { channelDisplayScale } from '../view/transform';

export interface CurveEntry {
  readonly id: CurveId;
  readonly record: CurveRecord;
  readonly channel: ChannelId;
  /** Display units per curve unit in the absolute view (degrees for angles, `channelUnit`). */
  readonly unitScale: number;
  /**
   * The drawn value of a curve value v is `v · scale + offset` (M2A-SPEC §5.15.2): in the absolute view `scale` is
   * `unitScale` and `offset` 0; the normalized and stacked views map each curve into −1…1 (and its lane). Set by the
   * controller's view mapping whenever the mode, the curve set or the frozen ranges change.
   */
  scale: number;
  offset: number;
  readonly color: string;
  /** Curve lock or channel lock: drawn, never edited or selected. */
  readonly locked: boolean;
  readonly compiled: CompiledAnimCurve;
  /** Index-aligned with `compiled` (sorted by time). */
  readonly keys: readonly KeyRecord[];
  readonly index: ReadonlyMap<KeyId, number>;
}

export interface KeyLocation {
  readonly entry: CurveEntry;
  readonly index: number;
}

export interface CurveSet {
  readonly entries: readonly CurveEntry[];
  readonly byCurve: ReadonlyMap<CurveId, CurveEntry>;
  /**
   * Key → its curve entry and index. Found through the key's record and the entry's own index, so an edit of one
   * curve rebuilds only that curve's entry (no set-wide key map).
   */
  readonly byKey: { get(key: KeyId): KeyLocation | undefined };
}

export const EMPTY_CURVE_SET: CurveSet = {
  entries: [],
  byCurve: new Map(),
  byKey: { get: () => undefined },
};

/** True when the control's lock flags cover a TRS channel. */
export function channelLocked(control: ControlRecord | undefined, channel: ChannelId): boolean {
  if (control === undefined || channel.length !== 2) return false;
  const group = channel[0] === 't' ? control.locked.t : channel[0] === 'r' ? control.locked.r : control.locked.s;
  const axis = 'xyz'.indexOf(channel[1] ?? '');
  return axis !== -1 && (channel[0] === 't' || channel[0] === 'r' || channel[0] === 's') && group[axis] === true;
}

/** The drawn value of curve value `v` (M2A-SPEC §5.15.2 view mapping). */
export function drawnOf(entry: CurveEntry, v: number): number {
  return v * entry.scale + entry.offset;
}

/**
 * The entry of one curve; null when it is gone or cannot be drawn yet. `previous` (the curve's entry before an edit)
 * lends its key index when the keys are the same ids in the same order (M-1: a value drag rebuilds the dragged curves'
 * entries every frame; their key order never changes).
 */
function buildEntry(app: EditorApp, id: CurveId, previous?: CurveEntry): CurveEntry | null {
  const record = app.store.get('curves', id);
  if (record === undefined) return null;
  let compiled: CompiledAnimCurve;
  try {
    compiled = app.evaluation.compiledCurve(id);
  } catch {
    return null; // a curve the evaluation service cannot compile (e.g. its partition is loading) is not drawn
  }
  const keys = app.store.query.keysOfCurve(id);
  // Compiled arrays and records must align index by index; a stale compiled curve is not drawn.
  if (keys.length !== compiled.keyCount) return null;
  const index = sameKeyOrder(previous?.keys, keys) ? (previous as CurveEntry).index : indexOf(keys);
  const control = app.store.get('controls', record.control);
  const unitScale = channelDisplayScale(record.channel, channelUnit(control ?? null, record.channel));
  return {
    id,
    record,
    channel: record.channel,
    unitScale,
    scale: unitScale,
    offset: 0,
    color: channelColor(record.channel),
    locked: record.locked || channelLocked(control, record.channel),
    compiled,
    keys,
    index,
  };
}

function indexOf(keys: readonly KeyRecord[]): Map<KeyId, number> {
  const index = new Map<KeyId, number>();
  for (let i = 0; i < keys.length; i++) index.set((keys[i] as KeyRecord).id, i);
  return index;
}

function sameKeyOrder(a: readonly KeyRecord[] | undefined, b: readonly KeyRecord[]): boolean {
  if (a === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if ((a[i] as KeyRecord).id !== (b[i] as KeyRecord).id) return false;
  return true;
}

function assemble(app: EditorApp, curves: readonly CurveId[], entryOf: (id: CurveId) => CurveEntry | null): CurveSet {
  const entries: CurveEntry[] = [];
  const byCurve = new Map<CurveId, CurveEntry>();
  for (const id of curves) {
    if (byCurve.has(id)) continue;
    const entry = entryOf(id);
    if (entry === null) continue;
    entries.push(entry);
    byCurve.set(id, entry);
  }
  const byKey = {
    get(key: KeyId): KeyLocation | undefined {
      const curve = app.store.get('keys', key)?.curve;
      const entry = curve === undefined ? undefined : byCurve.get(curve);
      const index = entry?.index.get(key);
      return entry === undefined || index === undefined ? undefined : { entry, index };
    },
  };
  return { entries, byCurve, byKey };
}

export function buildCurveSet(app: EditorApp, curves: readonly CurveId[]): CurveSet {
  return assemble(app, curves, (id) => buildEntry(app, id));
}

/**
 * `set` after edits of the `changed` curves: their entries are rebuilt, the others are reused as they are. Curves
 * that had no entry (not drawable before) are retried.
 */
export function updateCurveSet(
  app: EditorApp,
  set: CurveSet,
  curves: readonly CurveId[],
  changed: ReadonlySet<CurveId>,
): CurveSet {
  return assemble(app, curves, (id) => {
    const previous = set.byCurve.get(id);
    return (changed.has(id) ? null : previous) ?? buildEntry(app, id, previous);
  });
}
