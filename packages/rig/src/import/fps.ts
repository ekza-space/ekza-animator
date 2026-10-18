import type { Fps } from '@ekza-animator/anim-core';
import type { HumanoidClipData, RawClip } from '../types';

/** Candidate source rates, lowest first (MVP-SPEC §4.11.6 step 5). */
const CANDIDATE_FPS: readonly number[] = [24, 25, 30, 48, 50, 60];

/** Max distance (seconds) of a sampler time from a frame boundary. */
const TIME_TOLERANCE = 1e-4;

function sampleTimes(clip: RawClip | HumanoidClipData): Float32Array[] {
  if ('channels' in clip) return clip.channels.map((channel) => channel.times);
  const out: Float32Array[] = [];
  for (const track of Object.values(clip.rotations)) if (track !== undefined) out.push(track.times);
  if (clip.hips !== null) out.push(clip.hips.times);
  return out;
}

/**
 * The lowest of 24, 25, 30, 48, 50 and 60 fps such that every sampler time is within 1e-4 s of a multiple of
 * 1/fps; null when none fits or the clip has no sampler times.
 */
export function detectClipFps(clip: RawClip | HumanoidClipData): Fps | null {
  const all = sampleTimes(clip);
  if (all.every((times) => times.length === 0)) return null;
  for (const fps of CANDIDATE_FPS) {
    let fits = true;
    for (const times of all) {
      for (let i = 0; i < times.length && fits; i++) {
        const frames = (times[i] as number) * fps;
        if (!Number.isFinite(frames) || Math.abs(frames - Math.round(frames)) / fps > TIME_TOLERANCE) fits = false;
      }
      if (!fits) break;
    }
    if (fits) return { num: fps, den: 1 };
  }
  return null;
}
