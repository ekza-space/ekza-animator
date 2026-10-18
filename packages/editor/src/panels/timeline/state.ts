// React-side reads of the timeline panel: the active character's clips and clock (human-speed state only; per-frame
// values are written imperatively by the components that show them).
import type { Fps, Frame } from '@ekza-animator/anim-core';
import type { CharacterId, ClipId, ClipRecord, DocumentStore } from '@ekza-animator/doc';
import type { EditorApp, SessionState } from '@ekza-animator/editor-core';
import { useCallback } from 'react';
import { useDocQuery, useSession } from '../../hooks';

export const DEFAULT_SCENE_FPS: Fps = { num: 30, den: 1 };

export interface ActiveClipState {
  readonly character: CharacterId | null;
  readonly clip: ClipRecord | null;
  /** Clips of the active character, in order. */
  readonly clips: readonly ClipRecord[];
  readonly sceneFps: Fps;
}

const selectCharacter = (s: SessionState): CharacterId | null => s.activeCharacter;
const selectActiveClips = (s: SessionState): Readonly<Record<CharacterId, ClipId>> => s.activeClip;

export function useActiveClip(): ActiveClipState {
  const character = useSession(selectCharacter);
  const activeClips = useSession(selectActiveClips);
  const clipId = character === null ? null : (activeClips[character] ?? null);
  const read = useCallback(
    (store: DocumentStore): ActiveClipState => ({
      character,
      clip: clipId === null ? null : (store.get('clips', clipId) ?? null),
      clips: character === null ? [] : store.query.clipsOfCharacter(character),
      sceneFps: store.get('project', 'project')?.sceneFps ?? DEFAULT_SCENE_FPS,
    }),
    [character, clipId],
  );
  return useDocQuery(read, ['clips', 'project']);
}

/** The frame the panel shows: the active clip frame (`unit: 'clip'`), else the scene frame. */
export function currentFrameOf(app: EditorApp): { readonly frame: Frame; readonly unit: 'clip' | 'scene' } {
  const state = app.session.getState();
  const character = state.activeCharacter;
  const frame = character === null ? null : app.evaluation.clipFrame(character);
  return frame === null ? { frame: state.time.sceneFrame, unit: 'scene' } : { frame, unit: 'clip' };
}

/** Calls `onChange` whenever the shown frame or the scene clock may have changed (frame, clip, fps, load). */
export function subscribeToFrame(app: EditorApp, onChange: () => void): () => void {
  const offSession = app.session.subscribe((state, previous) => {
    if (
      state.time.sceneFrame !== previous.time.sceneFrame ||
      state.activeClip !== previous.activeClip ||
      state.activeCharacter !== previous.activeCharacter
    ) {
      onChange();
    }
  });
  const offStore = app.store.subscribe((batch) => {
    if (batch.origin === 'load' || batch.changes.some((c) => c.table === 'clips' || c.table === 'project')) onChange();
  });
  return () => {
    offSession();
    offStore();
  };
}

/** Range of the active clip (clip frames), or null without one. */
export function activeClipRange(app: EditorApp): { readonly start: Frame; readonly end: Frame } | null {
  const state = app.session.getState();
  const character = state.activeCharacter;
  const clipId = character === null ? undefined : state.activeClip[character];
  return clipId === undefined ? null : (app.store.get('clips', clipId)?.range ?? null);
}
