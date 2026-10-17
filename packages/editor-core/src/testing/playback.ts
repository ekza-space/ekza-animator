// Playback clock of the fake app: advances session time on `advance(nowMs)` (real-time, every-frame, half, double;
// loop, once, oscillate) within the playback range or the active clip's range, in scene frames (§4.11.8).
import type { Fps } from '@ekza-animator/anim-core';
import type { DocumentStore } from '@ekza-animator/doc';
import type { PlaybackClock, SessionStore } from '../types';

export function createFakePlayback(store: DocumentStore, session: SessionStore): PlaybackClock {
  let lastMs: number | null = null;

  const sceneFps = (): Fps => store.get('project', 'project')?.sceneFps ?? { num: 30, den: 1 };
  const activeClip = () => {
    const state = session.getState();
    const clipId = state.activeCharacter === null ? undefined : state.activeClip[state.activeCharacter];
    return clipId === undefined ? undefined : store.get('clips', clipId);
  };
  /** Scene frames per active-clip frame. */
  const clipFrameInScene = (): number => {
    const clip = activeClip();
    const fps = sceneFps();
    return clip === undefined ? 1 : (fps.num * clip.fps.den) / (fps.den * clip.fps.num);
  };
  const range = (): { readonly start: number; readonly end: number } => {
    const time = session.getState().time;
    if (time.playbackRange !== null) return time.playbackRange;
    const clip = activeClip();
    if (clip === undefined) return store.get('project', 'project')?.sceneRange ?? { start: 0, end: 60 };
    const scale = clipFrameInScene();
    return { start: clip.sceneStart + clip.range.start * scale, end: clip.sceneStart + clip.range.end * scale };
  };

  return {
    get running() {
      return session.getState().time.playing;
    },
    advance(nowMs: number): boolean {
      const time = session.getState().time;
      if (!time.playing) {
        lastMs = null;
        return false;
      }
      const elapsed = lastMs === null ? 0 : nowMs - lastMs;
      lastMs = nowMs;
      const fps = sceneFps();
      const perSecond = fps.num / fps.den;
      const step =
        time.speed === 'every-frame'
          ? clipFrameInScene()
          : (elapsed / 1000) * perSecond * (time.speed === 'half' ? 0.5 : time.speed === 'double' ? 2 : 1);
      if (step === 0) return false;
      const { start, end } = range();
      const span = end - start;
      let frame = time.sceneFrame + step * time.direction;
      let direction = time.direction;
      let playing = true;
      if (frame > end || frame < start) {
        if (time.loop === 'loop' && span > 0) {
          frame = start + ((((frame - start) % span) + span) % span);
        } else if (time.loop === 'oscillate' && span > 0) {
          frame = Math.min(Math.max(frame > end ? end - (frame - end) : start + (start - frame), start), end);
          direction = direction === 1 ? -1 : 1;
        } else {
          frame = Math.min(Math.max(frame, start), end);
          playing = false;
        }
      }
      session.setState({ time: { ...time, sceneFrame: frame, direction, playing } });
      return true;
    },
  };
}
