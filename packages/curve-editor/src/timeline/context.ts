// What the time slider shows: the active character's active clip, in that clip's frames (MVP-SPEC §4.11.8).
import type { Fps, Frame } from '@ekza-animator/anim-core';
import type { CharacterId, ClipRecord } from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import type { FrameRange } from './band';

/** `ProjectRecord.sceneFps` default (§4.2) when the document has no project record yet. */
export const DEFAULT_SCENE_FPS: Fps = { num: 30, den: 1 };

/** The active character and its active clip; null when either is missing (empty document, unopened partition). */
export interface TimelineContext {
  readonly character: CharacterId;
  readonly clip: ClipRecord;
  readonly sceneFps: Fps;
}

export function activeTimelineContext(app: EditorApp): TimelineContext | null {
  const state = app.session.getState();
  const character = state.activeCharacter;
  if (character === null) return null;
  const clipId = state.activeClip[character];
  if (clipId === undefined) return null;
  const clip = app.store.get('clips', clipId);
  if (clip === undefined) return null;
  return { character, clip, sceneFps: sceneFpsOf(app) };
}

export function sceneFpsOf(app: EditorApp): Fps {
  return app.store.get('project', 'project')?.sceneFps ?? DEFAULT_SCENE_FPS;
}

/** Scene frames per frame of `clip` (§4.11.8). */
export function sceneFramesPerClipFrame(sceneFps: Fps, clip: Pick<ClipRecord, 'fps'>): number {
  return (sceneFps.num * clip.fps.den) / (sceneFps.den * clip.fps.num);
}

/**
 * Clip frame → scene frame, unwrapped (no loop or clamp), as `clipToSceneFrame` in `doc` (§4.11.8). Kept local so
 * the time slider works against the shared test kit before WP-2 lands; both are the same formula.
 */
export function clipFrameToScene(sceneFps: Fps, clip: Pick<ClipRecord, 'fps' | 'sceneStart'>, clipFrame: Frame): Frame {
  return clip.sceneStart + clipFrame * sceneFramesPerClipFrame(sceneFps, clip);
}

/** Scene frame → clip frame, unwrapped (the inverse of `clipFrameToScene`). */
export function sceneFrameToClip(
  sceneFps: Fps,
  clip: Pick<ClipRecord, 'fps' | 'sceneStart'>,
  sceneFrame: Frame,
): Frame {
  return (sceneFrame - clip.sceneStart) / sceneFramesPerClipFrame(sceneFps, clip);
}

/** The playback range in active-clip frames: `session.time.playbackRange` (scene frames) or the clip's range. */
export function playbackRangeInClip(app: EditorApp, ctx: TimelineContext): FrameRange {
  const range = app.session.getState().time.playbackRange;
  if (range === null) return ctx.clip.range;
  const a = sceneFrameToClip(ctx.sceneFps, ctx.clip, range.start);
  const b = sceneFrameToClip(ctx.sceneFps, ctx.clip, range.end);
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

/** The current frame shown by the slider: the active clip frame, else the scene frame. */
export function currentFrame(app: EditorApp, ctx: TimelineContext | null): Frame {
  if (ctx !== null) {
    const frame = app.evaluation.clipFrame(ctx.character);
    if (frame !== null) return frame;
  }
  return app.session.getState().time.sceneFrame;
}

/**
 * Frames the slider spans: the active clip's range united with the playback range (clip frames), so a playback
 * range reaching past the clip stays visible. Without an active clip: the project's scene range.
 */
export function sliderRange(app: EditorApp, ctx: TimelineContext | null): FrameRange {
  let start: number;
  let end: number;
  if (ctx === null) {
    const scene = app.store.get('project', 'project')?.sceneRange ?? { start: 0, end: 60 };
    start = scene.start;
    end = scene.end;
  } else {
    const playback = playbackRangeInClip(app, ctx);
    start = Math.min(ctx.clip.range.start, playback.start);
    end = Math.max(ctx.clip.range.end, playback.end);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { start: 0, end: 1 };
  return end - start < 1 ? { start, end: start + 1 } : { start, end };
}
