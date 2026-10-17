// Session repair against the document: after a committed batch (or when an app opens a document) the session points
// only at live records. Pure: returns the fields to change.
import type { ChangeBatch, CharacterId, ClipId, DocumentStore } from '@ekza-animator/doc';
import type { SessionState } from '../types';
import { pruneSelection } from './selection';

/** Characters in display order (fractional `order`, then id). */
export function orderedCharacters(store: DocumentStore): readonly CharacterId[] {
  return [...store.list('characters')]
    .sort((a, b) => (a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1))
    .map((character) => character.id);
}

/**
 * The session fields to change so that: an active character exists when any character does; every character with
 * clips has a live active clip of its own; selection, overrides and feet pins reference live records; `dirty` follows
 * the batch (`load` → clean, anything else committed → dirty); a load also takes the project name. Null when nothing
 * changes.
 */
export function repairSession(
  store: DocumentStore,
  state: SessionState,
  origin: ChangeBatch['origin'] | 'open',
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
  if (origin === 'load' || origin === 'open') {
    if (state.dirty) patch.dirty = false;
    const name = store.get('project', 'project')?.name;
    if (name !== undefined && name !== state.projectName) patch.projectName = name;
  } else if (origin !== 'preview' && !state.dirty) {
    patch.dirty = true;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

function sameRecord(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
