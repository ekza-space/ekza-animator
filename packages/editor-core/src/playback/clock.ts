// Playback clock (MVP-SPEC §4.11.8): called once per animation frame with the rAF timestamp, it advances the scene
// clock while `time.playing`.
//
// - Speeds: 'realtime' (frame dropping: the elapsed wall time decides the frame), 'half', 'double', and
//   'every-frame' (exactly one active-clip frame per tick).
// - The position runs in active-clip frames over the playback range (scene frames, converted) or the active
//   clip's range: 'loop' wraps into [start, end), 'once' stops at the end, 'oscillate' bounces and flips
//   `time.direction`.
// - With `snapToFrames` the displayed frame is an integer active-clip frame; the clock keeps the fractional position
//   internally so real-time playback does not drift.
// - A frame change made by someone else (scrubbing during playback) moves the clock to that frame.
import type { Fps, Frame } from '@ekza-animator/anim-core';
import type { ClipRecord, DocumentStore } from '@ekza-animator/doc';
import type { KernelDeps } from '../app/deps';
import { activeClipOf, sceneFpsOf } from '../evaluation/time';
import type { PlaybackClock, SessionStore, TimeState } from '../types';

const SPEED_FACTOR: Readonly<Record<TimeState['speed'], number>> = {
  realtime: 1,
  'every-frame': 1,
  half: 0.5,
  double: 2,
};

/** Clip frames used while the active character has no clip: the scene clock itself. */
interface Timeline {
  /** Active-clip frames per second. */
  readonly fps: number;
  readonly start: Frame;
  readonly end: Frame;
  toClip(sceneFrame: Frame): Frame;
  toScene(clipFrame: Frame): Frame;
}

export interface KernelPlayback extends PlaybackClock {
  /** Forgets the timing state (the next `advance` re-anchors at the current frame). */
  reset(): void;
}

export function createPlaybackClock(ctx: {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly deps: KernelDeps;
  readonly requestFrame: () => void;
}): KernelPlayback {
  const { store, session, deps } = ctx;
  let lastMs: number | null = null;
  /** Fractional position in active-clip frames, valid while `lastWritten` is the session's scene frame. */
  let position = 0;
  let lastWritten: Frame | null = null;

  const timeline = (): Timeline => {
    const state = session.getState();
    const sceneFps = sceneFpsOf(store);
    const clip: ClipRecord | undefined =
      state.activeCharacter === null ? undefined : activeClipOf(store, state, state.activeCharacter);
    const range = state.time.playbackRange;
    if (clip === undefined) {
      const scene = range ?? store.get('project', 'project')?.sceneRange ?? { start: 0, end: 60 };
      return { fps: fpsValue(sceneFps), start: scene.start, end: scene.end, toClip: (f) => f, toScene: (f) => f };
    }
    const toClip = (f: Frame): Frame => deps.time.sceneToClipFrame(sceneFps, clip, f);
    const toScene = (f: Frame): Frame => deps.time.clipToSceneFrame(sceneFps, clip, f);
    const start = range === null ? clip.range.start : toClip(range.start);
    const end = range === null ? clip.range.end : toClip(range.end);
    return { fps: fpsValue(clip.fps), start: Math.min(start, end), end: Math.max(start, end), toClip, toScene };
  };

  return {
    get running() {
      return session.getState().time.playing;
    },
    reset(): void {
      lastMs = null;
      lastWritten = null;
    },
    advance(nowMs: number): boolean {
      const time = session.getState().time;
      if (!time.playing) {
        lastMs = null;
        return false;
      }
      const line = timeline();
      const span = line.end - line.start;
      if (lastMs === null || lastWritten === null || time.sceneFrame !== lastWritten) {
        // (Re)start at the current frame. Pressing play at the end of a 'once' range starts over.
        position = line.toClip(time.sceneFrame);
        if (time.loop === 'once') {
          if (time.direction === 1 && position >= line.end) position = line.start;
          if (time.direction === -1 && position <= line.start) position = line.end;
        }
        const first = lastMs === null;
        lastMs = nowMs;
        lastWritten = time.sceneFrame;
        ctx.requestFrame();
        if (first) return false;
      }
      const elapsed = Math.max(0, nowMs - lastMs);
      lastMs = nowMs;
      const step = time.speed === 'every-frame' ? 1 : (elapsed / 1000) * line.fps * SPEED_FACTOR[time.speed];
      let raw = position + step * time.direction;
      let direction = time.direction;
      let playing = true;
      if (span <= 0) {
        raw = line.start;
        playing = time.loop !== 'once';
      } else if (time.loop === 'loop') {
        raw = line.start + mod(raw - line.start, span);
      } else if (time.loop === 'once') {
        if (raw >= line.end || raw <= line.start) {
          raw = Math.min(Math.max(raw, line.start), line.end);
          playing = !(direction === 1 ? raw >= line.end : raw <= line.start);
        }
      } else {
        // Oscillate: a triangle wave over [start, end]; on a falling stretch the motion runs against `direction`.
        const m = mod(raw - line.start, 2 * span);
        if (m > span) direction = direction === 1 ? -1 : 1;
        raw = m <= span ? line.start + m : line.start + 2 * span - m;
      }
      position = raw;
      const shown = time.snapToFrames ? snap(raw, direction, line) : raw;
      const sceneFrame = line.toScene(shown);
      const frameChanged = sceneFrame !== time.sceneFrame;
      if (frameChanged || direction !== time.direction || playing !== time.playing) {
        lastWritten = sceneFrame;
        session.setState({ time: { ...time, sceneFrame, direction, playing } });
      }
      if (playing) ctx.requestFrame();
      else lastMs = null;
      return frameChanged;
    },
  };
}

/** Integer frame shown for a fractional position: the frame most recently passed in the play direction. */
function snap(position: Frame, direction: 1 | -1, line: Timeline): Frame {
  const eps = 1e-9;
  const frame = direction === 1 ? Math.floor(position + eps) : Math.ceil(position - eps);
  return Math.min(Math.max(frame, Math.ceil(line.start - eps)), Math.floor(line.end + eps));
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function fpsValue(fps: Fps): number {
  return fps.num / fps.den;
}
