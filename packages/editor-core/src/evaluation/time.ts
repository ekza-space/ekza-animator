// Scene clock helpers (MVP-SPEC §4.11.8): the session's scene frame maps to each character's active-clip frame
// through the clip's fps and `sceneStart`; outside the clip range a looping clip wraps into [start, end) and a
// non-looping clip holds its end pose.
import type { Fps, Frame } from '@ekza-studio/anim-core';
import type { CharacterId, ClipRecord, ReadView } from '@ekza-studio/doc';
import type { KernelDeps } from '../app/deps';
import type { SessionState } from '../types';

export const DEFAULT_SCENE_FPS: Fps = { num: 30, den: 1 };

export function sceneFpsOf(view: ReadView): Fps {
  return view.get('project', 'project')?.sceneFps ?? DEFAULT_SCENE_FPS;
}

/** The character's active clip record (absent, deleted or another character's clip → undefined). */
export function activeClipOf(view: ReadView, state: SessionState, character: CharacterId): ClipRecord | undefined {
  const clipId = state.activeClip[character];
  const clip = clipId === undefined ? undefined : view.get('clips', clipId);
  return clip?.character === character ? clip : undefined;
}

/** Clip frame shown for `clip` at a scene frame: mapped, then wrapped (loop) or clamped (once). */
export function clipFrameAt(deps: KernelDeps, sceneFps: Fps, clip: ClipRecord, sceneFrame: Frame): Frame {
  return deps.time.wrapClipFrame(clip, deps.time.sceneToClipFrame(sceneFps, clip, sceneFrame));
}
