// Accessors for the active character's clip, runtime and clip frame (MVP-SPEC §4.11.8: the UI shows active-clip
// frames).
import type { Frame } from '@ekza-animator/anim-core';
import type { ClipRecord } from '@ekza-animator/doc';
import type { CharacterRuntime, EditorApp } from '../types';

export function activeClip(app: EditorApp): ClipRecord | null {
  const state = app.session.getState();
  if (state.activeCharacter === null) return null;
  const clipId = state.activeClip[state.activeCharacter];
  return clipId === undefined ? null : (app.store.get('clips', clipId) ?? null);
}

export function activeRuntime(app: EditorApp): CharacterRuntime | null {
  const character = app.session.getState().activeCharacter;
  return character === null ? null : (app.characters.get(character) ?? null);
}

export function activeClipFrame(app: EditorApp): Frame | null {
  const character = app.session.getState().activeCharacter;
  return character === null ? null : app.evaluation.clipFrame(character);
}
