// Scene clock ↔ clip frames (MVP-SPEC §4.11.8, ADR 0003):
//   clipFrame = (sceneFrame − clip.sceneStart) · (clip.fps.num · sceneFps.den) / (clip.fps.den · sceneFps.num)
// `sceneStart` is in scene frames. Products are formed before the division so integer inputs stay exact.
import { EkzaError, type Fps, type Frame } from '@ekza-studio/anim-core';
import type { ClipRecord } from '../records';

function assertFps(fps: Fps, what: string): void {
  if (!(fps.num > 0 && fps.den > 0 && Number.isFinite(fps.num) && Number.isFinite(fps.den))) {
    throw new EkzaError('invalid-record', `${what}: fps must have a positive numerator and denominator`, { fps });
  }
}

export function sceneToClipFrame(
  sceneFps: Fps,
  clip: Pick<ClipRecord, 'fps' | 'sceneStart'>,
  sceneFrame: Frame,
): Frame {
  assertFps(sceneFps, 'sceneToClipFrame');
  assertFps(clip.fps, 'sceneToClipFrame');
  const scale = clip.fps.num * sceneFps.den;
  const unit = clip.fps.den * sceneFps.num;
  return ((sceneFrame - clip.sceneStart) * scale) / unit;
}

export function clipToSceneFrame(sceneFps: Fps, clip: Pick<ClipRecord, 'fps' | 'sceneStart'>, clipFrame: Frame): Frame {
  assertFps(sceneFps, 'clipToSceneFrame');
  assertFps(clip.fps, 'clipToSceneFrame');
  const scale = clip.fps.den * sceneFps.num;
  const unit = clip.fps.num * sceneFps.den;
  return clip.sceneStart + (clipFrame * scale) / unit;
}

/**
 * The frame a clip evaluates at: inside `[start, end]` as is; outside it a looping clip wraps into `[start, end)` and
 * a non-looping clip clamps (holds the first or last pose).
 */
export function wrapClipFrame(clip: Pick<ClipRecord, 'range' | 'loop'>, clipFrame: Frame): Frame {
  const { start, end } = clip.range;
  if (clipFrame >= start && clipFrame <= end) return clipFrame;
  if (!clip.loop || !(end > start)) return clipFrame < start ? start : end;
  const length = end - start;
  const offset = (clipFrame - start) % length;
  const wrapped = start + (offset < 0 ? offset + length : offset);
  // Floating-point remainders can land exactly on `end` for tiny negative offsets.
  return wrapped >= end ? start : wrapped;
}
