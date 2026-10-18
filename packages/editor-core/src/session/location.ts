// Where pose overrides live (ADR 0013): the active character's active clip at its current clip frame.
import type { CharacterId, ControlId, ReadView } from '@ekza-animator/doc';
import { activeClipOf } from '../evaluation/time';
import type { OverrideLocation } from '../history/overrides';
import type { EditorApp } from '../types';

export function locateCharacter(app: EditorApp, character: CharacterId): OverrideLocation | null {
  const clip = activeClipOf(app.store, app.session.getState(), character);
  const clipFrame = app.evaluation.clipFrame(character);
  return clip === undefined || clipFrame === null ? null : { character, clip: clip.id, clipFrame };
}

export function activeLocation(app: EditorApp): OverrideLocation | null {
  const character = app.session.getState().activeCharacter;
  return character === null ? null : locateCharacter(app, character);
}

/** The character a control belongs to (deleted controls and rigs included); null for unknown controls. */
export function ownerOfControl(view: ReadView, control: ControlId): CharacterId | null {
  const record = view.getIncludingDeleted('controls', control);
  if (record === undefined) return null;
  return view.getIncludingDeleted('rigs', record.rig)?.character ?? null;
}
