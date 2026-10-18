// Time operators (MVP-SPEC §4.9 `time.*`, §4.11.8): frames are active-clip frames unless `unit: 'scene'`; the
// session keeps the scene clock. Frame changes discard pose overrides (the kernel does it for every writer).
import type { Frame } from '@ekza-animator/anim-core';
import type { ClipRecord } from '@ekza-animator/doc';
import { type EditorApp, GLOBAL_SCOPE, type LoopMode, type PlaybackSpeed, type TimeState } from '../../types';
import { clipFrameOfScene, sceneFpsIn, sceneFrameOf } from '../../workflows/session';
import { activeClipRecord, keyTimes, selectedControls } from '../../workflows/targets';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK, optionalArgs } from './define';
import { stubOperator } from './stub';

const LOOP_MODES: readonly LoopMode[] = ['once', 'loop', 'oscillate'];
const SPEEDS: readonly PlaybackSpeed[] = ['realtime', 'every-frame', 'half', 'double'];
const KEY_EPSILON = 1e-6;

function setTime(app: EditorApp, patch: Partial<TimeState>): void {
  const state = app.session.getState();
  app.session.setState({ time: { ...state.time, ...patch } });
}

/** The active clip's frame range, or the project's scene range without a clip. */
function rangeOf(app: EditorApp, clip: ClipRecord | undefined): { readonly start: Frame; readonly end: Frame } {
  if (clip !== undefined) return clip.range;
  return app.store.get('project', 'project')?.sceneRange ?? { start: 0, end: 60 };
}

/**
 * Moves the scene clock to clip frame `frame` of the active clip, clamped to the clip range; snapped to whole frames
 * when `snap` (and `snapToFrames`). Without an active clip the frame is a scene frame.
 */
export function goToClipFrame(app: EditorApp, frame: Frame, snap: boolean): void {
  const clip = activeClipRecord(app);
  const time = app.session.getState().time;
  const snapped = snap && time.snapToFrames ? Math.round(frame) : frame;
  const range = rangeOf(app, clip);
  const clamped = Math.min(Math.max(snapped, Math.min(range.start, range.end)), Math.max(range.start, range.end));
  const sceneFrame = clip === undefined ? clamped : sceneFrameOf(app, sceneFpsIn(app.store), clip, clamped);
  if (sceneFrame !== time.sceneFrame) setTime(app, { sceneFrame });
}

/** The active clip's current frame (scene frame without a clip). */
function currentFrame(app: EditorApp): Frame {
  const character = app.session.getState().activeCharacter;
  const frame = character === null ? null : app.evaluation.clipFrame(character);
  return frame ?? app.session.getState().time.sceneFrame;
}

const setFrame = defineOperator({
  id: 'time.setFrame',
  label: 'Go to Frame',
  description: 'Set the current frame (active-clip frames, or scene frames with unit "scene").',
  category: 'time',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  poll(_ctx, args) {
    if (!isRecord(args) || !isFiniteNumber(args['frame'])) return fail('expects { frame, unit? }');
    const unit = args['unit'];
    return unit === undefined || unit === 'clip' || unit === 'scene' ? OK : fail("unit is 'clip' or 'scene'");
  },
  apply({ app }, args) {
    if (args.unit === 'scene') {
      if (args.frame !== app.session.getState().time.sceneFrame) setTime(app, { sceneFrame: args.frame });
      return;
    }
    goToClipFrame(app, args.frame, true);
  },
});

const step = defineOperator({
  id: 'time.step',
  label: 'Step Frames',
  description: 'Move by whole active-clip frames.',
  category: 'time',
  scope: GLOBAL_SCOPE,
  poll: (_ctx, args) => (isRecord(args) && isFiniteNumber(args['delta']) ? OK : fail('expects { delta }')),
  apply({ app }, args) {
    goToClipFrame(app, currentFrame(app) + args.delta, true);
  },
});

function keyJump(direction: 1 | -1): AnyOperator {
  return defineOperator({
    id: direction === 1 ? 'time.nextKey' : 'time.prevKey',
    label: direction === 1 ? 'Next Key' : 'Previous Key',
    description: `Go to the ${direction === 1 ? 'next' : 'previous'} key of the selected controls (all when none).`,
    category: 'time',
    scope: GLOBAL_SCOPE,
    poll: ({ app }) => (activeClipRecord(app) === undefined ? fail('No active clip') : OK),
    apply({ app }) {
      const clip = activeClipRecord(app);
      if (clip === undefined) return;
      const selected = selectedControls(app);
      // Keys outside the clip range (kept after shortening it) are not frames the clip can show.
      const times = keyTimes(app.store, clip, selected.length > 0 ? new Set(selected.map((c) => c.id)) : null).filter(
        (t) => t >= clip.range.start - KEY_EPSILON && t <= clip.range.end + KEY_EPSILON,
      );
      if (times.length === 0) return;
      const now = currentFrame(app);
      // Like Maya, the jump wraps around at the last (first) key.
      const target =
        direction === 1
          ? (times.find((t) => t > now + KEY_EPSILON) ?? times[0])
          : ([...times].reverse().find((t) => t < now - KEY_EPSILON) ?? times[times.length - 1]);
      if (target !== undefined) goToClipFrame(app, target, false);
    },
  });
}

/** Playback range start/end in active-clip frames (the clip range without a playback range). */
function playbackBounds(app: EditorApp): { readonly start: Frame; readonly end: Frame } {
  const clip = activeClipRecord(app);
  const range = app.session.getState().time.playbackRange;
  if (range === null) return rangeOf(app, clip);
  if (clip === undefined) return range;
  const fps = sceneFpsIn(app.store);
  return { start: clipFrameOfScene(app, fps, clip, range.start), end: clipFrameOfScene(app, fps, clip, range.end) };
}

const goToStart = defineOperator({
  id: 'time.goToStart',
  label: 'Go to Start',
  description: 'Go to the start of the playback range.',
  category: 'time',
  scope: GLOBAL_SCOPE,
  apply: ({ app }) => goToClipFrame(app, playbackBounds(app).start, false),
});

const goToEnd = defineOperator({
  id: 'time.goToEnd',
  label: 'Go to End',
  description: 'Go to the end of the playback range.',
  category: 'time',
  scope: GLOBAL_SCOPE,
  apply: ({ app }) => goToClipFrame(app, playbackBounds(app).end, false),
});

function directionArg(args: unknown): 1 | -1 | null | 'bad' {
  const options = optionalArgs(args);
  if (options === null) return 'bad';
  const direction = options['direction'];
  if (direction === undefined) return null;
  return direction === 1 || direction === -1 ? direction : 'bad';
}

function pollDirection(_ctx: unknown, args: unknown) {
  return directionArg(args) === 'bad' ? fail('expects { direction?: 1 | -1 }') : OK;
}

function play(app: EditorApp, args: unknown): void {
  const direction = directionArg(args);
  setTime(app, { playing: true, direction: direction === null || direction === 'bad' ? 1 : direction });
  app.requestFrame();
}

function stop(app: EditorApp): void {
  if (app.session.getState().time.playing) setTime(app, { playing: false });
}

const togglePlay = defineOperator({
  id: 'time.togglePlay',
  label: 'Play / Stop',
  description: 'Start or stop playback.',
  category: 'time',
  scope: GLOBAL_SCOPE,
  poll: pollDirection,
  apply({ app }, args) {
    if (app.session.getState().time.playing) stop(app);
    else play(app, args);
  },
});

const playOp = defineOperator({
  id: 'time.play',
  label: 'Play',
  description: 'Start playback (direction -1 plays backwards).',
  category: 'time',
  scope: GLOBAL_SCOPE,
  poll: pollDirection,
  apply: ({ app }, args) => play(app, args),
});

const stopOp = defineOperator({
  id: 'time.stop',
  label: 'Stop',
  description: 'Stop playback on the current frame.',
  category: 'time',
  scope: GLOBAL_SCOPE,
  apply: ({ app }) => stop(app),
});

const setPlaybackRange = defineOperator({
  id: 'time.setPlaybackRange',
  label: 'Set Playback Range',
  description: 'Limit playback to a range of scene frames (null: the active clip).',
  category: 'time',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  poll(_ctx, args) {
    if (!isRecord(args) || !('range' in args)) return fail('expects { range }');
    const range = args['range'];
    if (range === null) return OK;
    return isRecord(range) && isFiniteNumber(range['start']) && isFiniteNumber(range['end'])
      ? OK
      : fail('range is { start, end } or null');
  },
  apply({ app }, args) {
    const range = args.range;
    setTime(app, {
      playbackRange:
        range === null ? null : { start: Math.min(range.start, range.end), end: Math.max(range.start, range.end) },
    });
  },
});

const setLoop = defineOperator({
  id: 'time.setLoop',
  label: 'Playback Loop',
  description: 'Loop, play once or oscillate.',
  category: 'time',
  scope: GLOBAL_SCOPE,
  poll(_ctx, raw) {
    const args: unknown = raw;
    return isRecord(args) && LOOP_MODES.includes(args['loop'] as LoopMode)
      ? OK
      : fail(`expects { loop: ${LOOP_MODES.join(' | ')} }`);
  },
  apply: ({ app }, args) => setTime(app, { loop: args.loop }),
});

const setSpeed = defineOperator({
  id: 'time.setSpeed',
  label: 'Playback Speed',
  description: 'Real time (dropping frames), every frame, half or double speed.',
  category: 'time',
  scope: GLOBAL_SCOPE,
  poll(_ctx, raw) {
    const args: unknown = raw;
    return isRecord(args) && SPEEDS.includes(args['speed'] as PlaybackSpeed)
      ? OK
      : fail(`expects { speed: ${SPEEDS.join(' | ')} }`);
  },
  apply: ({ app }, args) => setTime(app, { speed: args.speed }),
});

export const TIME_OPERATORS: readonly AnyOperator[] = [
  // M2a (M2A-SPEC §5.9, §5.11; A3 implements them)
  stubOperator('key.toggleRipple', 'Ripple Edit', {
    category: 'key',
    description: 'Moving or scaling keys in the Dope Sheet and time slider shifts the later keys with them.',
  }),
  stubOperator('time.insertTime', 'Insert Time', {
    category: 'time',
    description: 'Insert or remove frames after a frame (default: the current frame), shifting the later keys.',
    undo: true,
  }),
  stubOperator('time.deleteTime', 'Delete Time', {
    category: 'time',
    description: 'Remove the frames of the time-slider range (or the current frame) and their keys.',
    undo: true,
  }),
  setFrame,
  step,
  keyJump(1),
  keyJump(-1),
  goToStart,
  goToEnd,
  togglePlay,
  playOp,
  stopOp,
  setPlaybackRange,
  setLoop,
  setSpeed,
];
