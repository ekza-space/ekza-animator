// Session repair against the document: after a committed batch (or when an app opens a document) the session points
// only at live records. Pure: returns the fields to change.
import type { CharacterId, ClipId, DocumentStore, GroupId, MeshId } from '@ekza-studio/doc';
import type { ModelSessionState, SceneObjectId, SessionState, SymmetrySettings } from '../types';
import { pruneSelection } from './selection';

/** Characters in display order (fractional `order`, then id). */
export function orderedCharacters(store: DocumentStore): readonly CharacterId[] {
  return [...store.list('characters')]
    .sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1))
    .map((character) => character.id);
}

/**
 * Why the session is repaired: an app opened its store (`open`), a document load replaced the document (`load`), a
 * committed batch changed it (`commit`: local, undo/redo, remote, import, …), or a partition was opened or closed
 * (`visibility`: records appeared or disappeared, the document did not change).
 */
export type RepairCause = 'open' | 'load' | 'commit' | 'visibility';

/**
 * The session fields to change so that: an active character exists when any character does; every character with
 * clips has a live active clip of its own; selection, overrides and feet pins reference live records; `dirty` follows
 * the cause (open/load → clean, commit → dirty, visibility → unchanged); a load also takes the project name. Null
 * when nothing changes.
 */
export function repairSession(
  store: DocumentStore,
  state: SessionState,
  cause: RepairCause,
): Partial<SessionState> | null {
  const patch: { -readonly [K in keyof SessionState]?: SessionState[K] } = {};
  const characters = orderedCharacters(store);
  if (state.activeCharacter === null || store.get('characters', state.activeCharacter) === undefined) {
    const first = characters[0] ?? null;
    if (first !== state.activeCharacter) patch.activeCharacter = first;
  }
  const activeClip: Record<CharacterId, ClipId> = {};
  for (const character of characters) {
    const current = state.activeClip[character];
    const valid = current !== undefined && store.get('clips', current)?.character === character;
    const clip = valid ? current : store.query.clipsOfCharacter(character)[0]?.id;
    if (clip !== undefined) activeClip[character] = clip;
  }
  if (!sameRecord(activeClip, state.activeClip)) patch.activeClip = activeClip;
  const selection = pruneSelection({ store }, state.selection);
  if (selection !== state.selection) patch.selection = selection;
  if (state.overrides.size > 0) {
    const overrides = new Map([...state.overrides].filter(([control]) => store.get('controls', control) !== undefined));
    if (overrides.size !== state.overrides.size) patch.overrides = overrides;
  }
  if (state.feetPins !== null && store.get('characters', state.feetPins.character) === undefined) patch.feetPins = null;
  if (state.hoverControl !== null && store.get('controls', state.hoverControl) === undefined) patch.hoverControl = null;
  const model = repairModel(store, state.model, cause);
  if (model !== state.model) patch.model = model;
  if (cause === 'load' || cause === 'open') {
    if (state.dirty) patch.dirty = false;
    const name = store.get('project', 'project')?.name;
    if (name !== undefined && name !== state.projectName) patch.projectName = name;
  } else if (cause === 'commit' && !state.dirty) {
    patch.dirty = true;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * M6a (M6A-SPEC §5.6; B10): the Model session points at live meshes and groups only (hilite, hidden objects, pane
 * isolate sets); a document load ends component editing (object mode, no hilite) and clears hiding and isolation,
 * which are per-user session state never saved with the document.
 */
export function repairModel(store: DocumentStore, model: ModelSessionState, cause: RepairCause): ModelSessionState {
  if (cause === 'load') {
    const reset =
      model.componentMode !== 'object' ||
      model.hilite.length > 0 ||
      model.hiddenObjects.size > 0 ||
      Object.keys(model.isolate).length > 0;
    if (!reset) return model;
    return {
      ...model,
      componentMode: 'object',
      lastComponentMode: model.componentMode === 'object' ? model.lastComponentMode : model.componentMode,
      hilite: [],
      hiddenObjects: new Set(),
      isolate: {},
    };
  }
  const liveMesh = (id: string): boolean => {
    const record = store.get('meshes', id as MeshId);
    return record !== undefined && record.deleted === null && record.data !== null;
  };
  const liveObject = (id: string): boolean => {
    const record = store.get('meshes', id as MeshId) ?? store.get('groups', id as GroupId);
    return record !== undefined && record.deleted === null;
  };
  let next = model;
  const hilite = model.hilite.filter(liveMesh);
  if (hilite.length !== model.hilite.length) next = { ...next, hilite };
  if ([...model.hiddenObjects].some((id) => !liveObject(id))) {
    next = { ...next, hiddenObjects: new Set([...model.hiddenObjects].filter(liveObject)) };
  }
  let isolate: Record<string, readonly SceneObjectId[] | null> | null = null;
  for (const [pane, list] of Object.entries(model.isolate)) {
    if (list === null || list.every(liveObject)) continue;
    isolate ??= { ...model.isolate };
    const kept = list.filter(liveObject);
    isolate[pane] = kept.length === 0 ? null : kept;
  }
  if (isolate !== null) next = { ...next, isolate };
  return next;
}

/**
 * Template symmetry after a document load or open (acceptance fix round 1): symmetry is session state (§5.14, never
 * saved), so a reopened project would come back with every mesh 'off'. A mesh directly in a Humanoid template group
 * without a remembered entry takes Object X again, as when it was created there (§5.16); other meshes stay off. The
 * model state is returned unchanged when nothing is added.
 */
export function templateSymmetry(store: DocumentStore, model: ModelSessionState, tolerance: number): ModelSessionState {
  let next: Map<MeshId, SymmetrySettings> | null = null;
  for (const mesh of store.list('meshes')) {
    if (mesh.deleted !== null || mesh.parent === null || model.symmetry.has(mesh.id)) continue;
    if (store.get('groups', mesh.parent as GroupId)?.template?.kind !== 'humanoid') continue;
    next ??= new Map(model.symmetry);
    next.set(mesh.id, { mode: 'object-x', tolerance, preserveSeam: true });
  }
  return next === null ? model : { ...model, symmetry: next };
}

function sameRecord(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
