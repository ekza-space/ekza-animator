// Session and preference defaults of the fake app (MVP-SPEC §4.5 comments give every default). WP-7a owns the
// production `defaultSession` / `defaultPrefs`; these copies keep the kit independent of their stubs.
import type { ChannelRef, KeyPartSelection, Prefs, Selection, SessionState } from '../types';
import type { CharacterId, ClipId, ControlId, DocumentStore, KeyId, UserId } from '@ekza-animator/doc';

export const EMPTY_SELECTION: Selection = { controls: [], keys: new Map(), channels: [] };

export function fakeDefaultSession(user: UserId): SessionState {
  return {
    user,
    projectName: 'Untitled',
    dirty: false,
    activeCharacter: null,
    activeClip: {},
    selection: EMPTY_SELECTION,
    time: {
      sceneFrame: 0,
      playing: false,
      direction: 1,
      loop: 'loop',
      speed: 'realtime',
      playbackRange: null,
      snapToFrames: true,
      band: null,
    },
    tools: {
      viewport: 'select',
      graph: 'select',
      manipulatorSize: 90,
      selectionMask: { controls: true, joints: false, meshes: false },
      keyTarget: 'selected',
    },
    overrides: new Map(),
    hiddenControls: new Set(),
    showSecondary: false,
    viewportLayout: 'split',
    maximizedPane: null,
    hoveredPanel: null,
    clipboard: { pose: null, keys: null },
    feetPins: null,
    dialog: null,
    busy: null,
  };
}

/** Session for a loaded document: project name, first character active, first clip of every character active. */
export function sessionForDocument(store: DocumentStore): SessionState {
  const session = fakeDefaultSession(store.user);
  const characters = store.list('characters');
  const activeClip: Record<CharacterId, ClipId> = {};
  for (const character of characters) {
    const clip = store.query.clipsOfCharacter(character.id)[0];
    if (clip !== undefined) activeClip[character.id] = clip.id;
  }
  return {
    ...session,
    projectName: store.get('project', 'project')?.name ?? session.projectName,
    activeCharacter: characters[0]?.id ?? null,
    activeClip,
  };
}

export function fakeDefaultPrefs(platform: 'mac' | 'other'): Prefs {
  return {
    version: 1,
    firstRunDone: true,
    navProfile: platform === 'mac' ? 'trackpad' : 'maya',
    spaceBehaviour: 'maya',
    keymapOverrides: [],
    defaultTangents: { in: 'auto', out: 'auto' },
    autoKey: false,
    autoKeyMode: 'keyed-only',
    graphHandles: 'selected',
    moveSpace: 'world',
    rotateSpace: 'object',
    reduceOnImport: 'auto',
    uiScale: 1,
  };
}

/** Plain, JSON-safe selection snapshot carried by TxMeta and history steps. */
export interface SelectionSnapshot {
  readonly kind: 'ekza.selection';
  readonly controls: readonly ControlId[];
  readonly keys: readonly (readonly [KeyId, KeyPartSelection])[];
  readonly channels: readonly ChannelRef[];
}

export function snapshotSelection(selection: Selection): SelectionSnapshot {
  return {
    kind: 'ekza.selection',
    controls: [...selection.controls],
    keys: [...selection.keys],
    channels: [...selection.channels],
  };
}

export function selectionFromSnapshot(snapshot: unknown): Selection | null {
  if (typeof snapshot !== 'object' || snapshot === null || (snapshot as { kind?: unknown }).kind !== 'ekza.selection') {
    return null;
  }
  const value = snapshot as SelectionSnapshot;
  return { controls: [...value.controls], keys: new Map(value.keys), channels: [...value.channels] };
}
