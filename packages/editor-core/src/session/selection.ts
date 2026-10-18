// Selection snapshots: plain, JSON-safe values carried by TxMeta (selectionBefore/After) and history steps, restored
// by undo/redo (ADR 0008 §8).
import type { ControlId, KeyId } from '@ekza-animator/doc';
import type { ChannelRef, EditorApp, KeyPartSelection, Selection } from '../types';

export interface SelectionSnapshot {
  readonly kind: 'ekza.selection';
  readonly controls: readonly ControlId[];
  readonly keys: readonly (readonly [KeyId, KeyPartSelection])[];
  readonly channels: readonly ChannelRef[];
}

export function selectionSnapshot(selection: Selection): unknown {
  const snapshot: SelectionSnapshot = {
    kind: 'ekza.selection',
    controls: [...selection.controls],
    keys: [...selection.keys].map(([key, parts]) => [key, { key: parts.key, in: parts.in, out: parts.out }] as const),
    channels: selection.channels.map((ref) => ({ control: ref.control, channel: ref.channel })),
  };
  return snapshot;
}

/** The selection a snapshot describes, or null when `snapshot` is not one (missing, foreign or malformed). */
export function selectionFromSnapshot(snapshot: unknown): Selection | null {
  if (!isRecord(snapshot) || snapshot['kind'] !== 'ekza.selection') return null;
  const { controls, keys, channels } = snapshot;
  if (!Array.isArray(controls) || !Array.isArray(keys) || !Array.isArray(channels)) return null;
  const selection: { controls: ControlId[]; keys: Map<KeyId, KeyPartSelection>; channels: ChannelRef[] } = {
    controls: [],
    keys: new Map(),
    channels: [],
  };
  for (const control of controls as unknown[])
    if (typeof control === 'string') selection.controls.push(control as ControlId);
  for (const entry of keys as unknown[]) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !isRecord(entry[1])) continue;
    const parts = entry[1];
    selection.keys.set(entry[0] as KeyId, {
      key: parts['key'] === true,
      in: parts['in'] === true,
      out: parts['out'] === true,
    });
  }
  for (const ref of channels as unknown[]) {
    if (isRecord(ref) && typeof ref['control'] === 'string' && typeof ref['channel'] === 'string') {
      selection.channels.push({
        control: ref['control'] as ControlId,
        channel: ref['channel'] as ChannelRef['channel'],
      });
    }
  }
  return selection;
}

/**
 * Applies a snapshot to the session. Controls and keys that no longer exist in the document are dropped, so a
 * restored selection never points at deleted records. Malformed snapshots are ignored.
 */
export function restoreSelection(app: EditorApp, snapshot: unknown): void {
  const selection = selectionFromSnapshot(snapshot);
  if (selection === null) return;
  app.session.setState({ selection: pruneSelection(app, selection) });
}

/** The selection without controls, keys and channel refs that are missing (or soft-deleted) in the store. */
export function pruneSelection(app: Pick<EditorApp, 'store'>, selection: Selection): Selection {
  const store = app.store;
  const controls = selection.controls.filter((id) => store.get('controls', id) !== undefined);
  const keys = new Map([...selection.keys].filter(([id]) => store.get('keys', id) !== undefined));
  const channels = selection.channels.filter((ref) => store.get('controls', ref.control) !== undefined);
  if (
    controls.length === selection.controls.length &&
    keys.size === selection.keys.size &&
    channels.length === selection.channels.length
  ) {
    return selection;
  }
  return { controls, keys, channels };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
