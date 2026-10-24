// The flow's subject as the document has it now (AUTORIG-SPEC §4.3; T5b). The same rule as Auto-Rig's derived progress
// (`autorig/src/progress`, which T5c moves into editor-core and then reads from here): a character id that was undone is
// dropped, and scene meshes adopted by Create Skeleton lead to the model character that holds them, so a skeleton
// made in Studio still counts. Pure reads.
import { type CharacterId, type CharacterRecord, derivedId, type MeshId, type ReadView } from '@ekza-studio/doc';
import type { AutoRigSubject, EditorApp } from '../types';
import type { AutoRigFlowHost } from './host';

/** The Validation profile the flow checks against (§4.3, the VRM / Ekza Space avatar). */
export const AUTORIG_FLOW_PROFILE = 'ekza/space-avatar-v1';

export interface ResolvedAutoRigSubject {
  /** The live subject character (the flow's, else the model character that adopted the subject meshes). */
  readonly character: CharacterRecord | null;
  /** The live scene meshes of the subject (before Create Skeleton). */
  readonly meshes: readonly MeshId[];
}

/**
 * The subject as the document has it now: a character id that was undone is dropped; scene meshes adopted by Create
 * Skeleton (C1's adoption soft-deletes them and writes `derivedId('mesh', 'char.adopt', [character, source])`) lead to
 * the model character that holds them.
 */
export function resolveAutoRigSubject(view: ReadView, subject: AutoRigSubject): ResolvedAutoRigSubject {
  const meshes = subject.meshes.filter((id) => view.get('meshes', id) !== undefined);
  let character = subject.character === null ? null : (view.get('characters', subject.character) ?? null);
  if (character === null && meshes.length < subject.meshes.length) {
    const gone = subject.meshes.filter((id) => !meshes.includes(id));
    character =
      view
        .list('characters')
        .find(
          (record) =>
            record.source.kind === 'model' &&
            gone.some((source) => view.get('meshes', derivedId('mesh', 'char.adopt', [record.id, source], '', 0))),
        ) ?? null;
  }
  return { character, meshes };
}

/** The live subject character of a host (the flow state's subject resolved against the document), or null. */
export const flowCharacter = (host: Pick<AutoRigFlowHost, 'app' | 'state'>): CharacterRecord | null =>
  resolveAutoRigSubject(host.app.store, host.state.get().subject).character;

/** Its id, or null. */
export const flowCharacterId = (host: Pick<AutoRigFlowHost, 'app' | 'state'>): CharacterId | null =>
  flowCharacter(host)?.id ?? null;

/** The live scene meshes of a subject (the fixes and the inspection work on them). */
export function liveSubjectMeshes(app: EditorApp, subject: AutoRigSubject): MeshId[] {
  return subject.meshes.filter((id) => app.store.get('meshes', id) !== undefined);
}

/** The characters of the document that are not in `before` (an import's new character). */
export const newCharacters = (app: EditorApp, before: ReadonlySet<string>): CharacterId[] =>
  app.store
    .list('characters')
    .filter((character) => !before.has(character.id))
    .map((character) => character.id);

/** The character ids of the document now (an intake's `before`). */
export const characterIds = (app: EditorApp): ReadonlySet<string> =>
  new Set<string>(app.store.list('characters').map((character) => character.id));
