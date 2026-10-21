// Session updates shared by the workflows: activating a character's clip at a frame, clearing the selection, and
// resetting the document-bound session state before a document is replaced (`file.new`, `file.openProject`).
import type { Fps, Frame } from '@ekza-studio/anim-core';
import type { CharacterId, ClipRecord, ReadView } from '@ekza-studio/doc';
import { internalsOf } from '../app/internals';
import { DEFAULT_TIME } from '../session/defaults';
import type { EditorApp, Selection, SessionState } from '../types';
import { DEFAULT_SCENE_FPS } from './records';

export const EMPTY_SELECTION: Selection = {
  controls: [],
  keys: new Map(),
  channels: [],
  objects: [],
  joints: [],
  constraints: [],
};

export function sceneFpsIn(view: ReadView): Fps {
  return view.get('project', 'project')?.sceneFps ?? DEFAULT_SCENE_FPS;
}

/** Scene frame at which `clip` shows `clipFrame` (§4.11.8). */
export function sceneFrameOf(app: EditorApp, sceneFps: Fps, clip: ClipRecord, clipFrame: Frame): Frame {
  return internalsOf(app).deps.time.clipToSceneFrame(sceneFps, clip, clipFrame);
}

/** Clip frame `clip` maps the scene frame to (no wrapping or clamping). */
export function clipFrameOfScene(app: EditorApp, sceneFps: Fps, clip: ClipRecord, sceneFrame: Frame): Frame {
  return internalsOf(app).deps.time.sceneToClipFrame(sceneFps, clip, sceneFrame);
}

/**
 * Makes `clip` the active clip of its character and the character the active one, at clip frame `frame` (default:
 * the clip start). `view` must see the clip (the transaction inside `apply`). Playback stops; overrides of the moved
 * characters are dropped by the kernel.
 */
export function activateClip(
  app: EditorApp,
  view: ReadView,
  clip: ClipRecord,
  opts?: { readonly frame?: Frame; readonly clearSelection?: boolean },
): void {
  const state = app.session.getState();
  const sceneFrame = sceneFrameOf(app, sceneFpsIn(view), clip, opts?.frame ?? clip.range.start);
  const patch: Partial<SessionState> = {
    activeCharacter: clip.character,
    activeClip: { ...state.activeClip, [clip.character]: clip.id },
    time: { ...state.time, sceneFrame, playing: false, band: null },
  };
  app.session.setState(opts?.clearSelection === true ? { ...patch, selection: EMPTY_SELECTION } : patch);
}

/** Session state bound to the document, back to defaults (UI state such as layout and tools is kept). */
export function resetDocumentSession(app: EditorApp): void {
  const state = app.session.getState();
  app.session.setState({
    activeCharacter: null,
    activeClip: {},
    selection: EMPTY_SELECTION,
    time: { ...DEFAULT_TIME, loop: state.time.loop, speed: state.time.speed, snapToFrames: state.time.snapToFrames },
    overrides: new Map(),
    hiddenControls: new Set(),
    maximizedPane: null,
    hoverControl: null,
    feetPins: null,
    busy: null,
  });
}

/** The character a session points at, when it still exists. */
export function liveActiveCharacter(app: EditorApp): CharacterId | null {
  const id = app.session.getState().activeCharacter;
  return id !== null && app.store.get('characters', id) !== undefined ? id : null;
}
