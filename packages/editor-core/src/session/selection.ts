// Selection snapshots: plain, JSON-safe values carried by TxMeta (selectionBefore/After) and history steps, restored
// by undo/redo (ADR 0008 §8).
//
// M6a (M6A-SPEC §4.6): the stored value is a superset of the M6a `SelectionSnapshot` (controls, objects, component
// mode, hilite, per-mesh component selections) and the shipped shape (controls, keys, channels), so an M2a reader and
// an M6a reader both read it. Restoring sets controls, keys, channels and objects; it never changes the component
// mode or the hilite (§5.6), and per-mesh component selections go through `app.components.restore`.
import type { ControlId, GroupId, KeyId, MeshId } from '@ekza-animator/doc';
import type {
  ChannelRef,
  ComponentMode,
  EditorApp,
  KeyPartSelection,
  MeshSelectionSnapshot,
  ModelSessionState,
  SceneObjectId,
  Selection,
  SelectionPart,
  SelectionSnapshot,
} from '../types';

/** The stored form: the shipped fields plus the M6a `SelectionSnapshot` fields. */
export interface StoredSelectionSnapshot extends SelectionSnapshot {
  readonly kind: 'ekza.selection';
  readonly keys: readonly (readonly [KeyId, KeyPartSelection])[];
  readonly channels: readonly ChannelRef[];
}

const COMPONENT_MODES: readonly ComponentMode[] = ['object', 'vertex', 'edge', 'face'];

export function selectionSnapshot(
  selection: Selection,
  model?: Pick<ModelSessionState, 'componentMode' | 'hilite'>,
  meshes?: Readonly<Record<string, MeshSelectionSnapshot>>,
): unknown {
  const snapshot: StoredSelectionSnapshot = {
    kind: 'ekza.selection',
    controls: [...selection.controls],
    keys: [...selection.keys].map(([key, parts]) => [key, { key: parts.key, in: parts.in, out: parts.out }] as const),
    channels: selection.channels.map((ref) => ({ control: ref.control, channel: ref.channel })),
    objects: [...selection.objects],
    componentMode: model?.componentMode ?? 'object',
    hilite: [...(model?.hilite ?? [])],
    meshes: meshes ?? {},
  };
  return snapshot;
}

/** The component mode a snapshot was taken in ('object' for shipped snapshots and unknown values). */
export function snapshotComponentMode(snapshot: unknown): ComponentMode {
  if (!isRecord(snapshot)) return 'object';
  const mode = snapshot['componentMode'];
  return COMPONENT_MODES.find((m) => m === mode) ?? 'object';
}

/** The selection a snapshot describes, or null when `snapshot` is not one (missing, foreign or malformed). */
export function selectionFromSnapshot(snapshot: unknown): Selection | null {
  if (!isRecord(snapshot) || snapshot['kind'] !== 'ekza.selection') return null;
  const { controls, keys, channels } = snapshot;
  if (!Array.isArray(controls) || !Array.isArray(keys) || !Array.isArray(channels)) return null;
  const selection: {
    controls: ControlId[];
    keys: Map<KeyId, KeyPartSelection>;
    channels: ChannelRef[];
    objects: SceneObjectId[];
  } = {
    controls: [],
    keys: new Map(),
    channels: [],
    objects: [],
  };
  // M6a: shipped snapshots have no `objects` (read as none).
  const objects = snapshot['objects'];
  if (Array.isArray(objects)) {
    for (const id of objects as unknown[]) if (typeof id === 'string') selection.objects.push(id as SceneObjectId);
  }
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
  // M6a: per-mesh component selections (B10's service skips meshes whose revision changed).
  const meshes = isRecord(snapshot) ? snapshot['meshes'] : undefined;
  if (isRecord(meshes) && Object.keys(meshes).length > 0) app.components.restore(snapshot as SelectionSnapshot);
}

/** The selection without controls, keys and channel refs that are missing (or soft-deleted) in the store. */
export function pruneSelection(app: Pick<EditorApp, 'store'>, selection: Selection): Selection {
  const store = app.store;
  const controls = selection.controls.filter((id) => store.get('controls', id) !== undefined);
  const keys = new Map([...selection.keys].filter(([id]) => store.get('keys', id) !== undefined));
  const channels = selection.channels.filter((ref) => store.get('controls', ref.control) !== undefined);
  const objects = selection.objects.filter((id) => liveObject(app, id));
  if (
    controls.length === selection.controls.length &&
    keys.size === selection.keys.size &&
    channels.length === selection.channels.length &&
    objects.length === selection.objects.length
  ) {
    return selection;
  }
  return { controls, keys, channels, objects };
}

/** A live mesh or group record (M6a scene objects). */
function liveObject(app: Pick<EditorApp, 'store'>, id: SceneObjectId): boolean {
  return id.startsWith('grp_')
    ? app.store.get('groups', id as GroupId) !== undefined
    : app.store.get('meshes', id as MeshId) !== undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * M6a (§5.6): applies one side of a history selection part. A 'select' part restores the control and object
 * selections and the per-mesh component selections; a 'hide' part restores the hidden objects and the per-mesh hidden
 * components. The component mode and the hilite never change. Returns warnings for meshes whose revision changed.
 */
export function restoreSelectionPart(app: EditorApp, part: SelectionPart, side: 'before' | 'after'): readonly string[] {
  const state = app.session.getState();
  if (part.kind === 'select') {
    const snapshot = side === 'before' ? part.before : part.after;
    const selection = pruneSelection(app, {
      ...state.selection,
      controls: [...snapshot.controls],
      objects: [...snapshot.objects],
    });
    app.session.setState({ selection });
    const { skipped } = app.components.restore(snapshot);
    return skipped.map((mesh) => `Selection on ${mesh} was not restored: the mesh changed since`);
  }
  const snapshot = side === 'before' ? part.before : part.after;
  const hiddenObjects = new Set(snapshot.objects.filter((id) => liveObject(app, id)));
  app.session.setState({ model: { ...state.model, hiddenObjects } });
  const { skipped } = app.components.restoreHidden(snapshot);
  return skipped.map((mesh) => `Hidden components on ${mesh} were not restored: the mesh changed since`);
}
