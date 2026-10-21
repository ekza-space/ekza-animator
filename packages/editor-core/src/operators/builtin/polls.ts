// Shared poll conditions of the built-in operators.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ClipRecord } from '@ekza-studio/doc';
import type { CharacterRuntime, EditorApp, PollResult } from '../../types';
import { activeClipRecord } from '../../workflows/targets';
import { fail, OK } from './define';

/** Document edits need a writable store (projects from newer apps open read-only). */
export function pollEditable(app: EditorApp): PollResult {
  return app.store.readOnly ? fail('The project is read-only (written by a newer version)') : OK;
}

export function pollActiveClip(app: EditorApp): PollResult {
  if (app.session.getState().activeCharacter === null) return fail('No character is loaded');
  return activeClipRecord(app) === undefined ? fail('The character has no active clip') : OK;
}

/** Editable document and an active clip. */
export function pollClipEdit(app: EditorApp): PollResult {
  const editable = pollEditable(app);
  return editable === true ? pollActiveClip(app) : editable;
}

export function requireActiveClip(app: EditorApp): ClipRecord {
  const clip = activeClipRecord(app);
  if (clip === undefined) throw new EkzaError('unsupported', 'The character has no active clip');
  return clip;
}

export function activeRuntimeOf(app: EditorApp): CharacterRuntime | undefined {
  const character = app.session.getState().activeCharacter;
  return character === null ? undefined : app.characters.get(character);
}

/** The active character has a runtime (rig program and pose buffers). */
export function pollRuntime(app: EditorApp): PollResult {
  const character = app.session.getState().activeCharacter;
  if (character === null) return fail('No character is loaded');
  return app.characters.get(character) === undefined ? fail('The character is still loading') : OK;
}

export function pollSelection(app: EditorApp): PollResult {
  return app.session.getState().selection.controls.length > 0 ? OK : fail('Nothing is selected');
}
