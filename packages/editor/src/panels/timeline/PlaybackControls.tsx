// Transport, loop, speed and auto-key controls of the timeline (research 09 §4.9, FR-TIME-04/06, FR-KEY auto-key).
// Every control runs an operator; the shortcut shown in a tooltip comes from the keymap.
import type { EditorApp, LoopMode, OperatorId, PlaybackSpeed, Prefs, SessionState } from '@ekza-studio/editor-core';
import { PANEL } from '@ekza-studio/editor-core';
import type { JSX } from 'react';
import { usePrefs, useSession } from '../../hooks';
import { selectClass } from './ClipControls';
import { TimelineIcon, type TimelineIconName } from './icons';

const buttonLook =
  'shrink-0 rounded-[4px] text-fg-2 hover:bg-header hover:text-fg focus-visible:outline focus-visible:outline-1 ' +
  'focus-visible:outline-accent disabled:opacity-40 aria-pressed:bg-header aria-pressed:text-fg';
const iconButton = `inline-grid size-6 place-items-center ${buttonLook}`;

/** The `--autokey` token (research 09 §8.2) with its tokens.json value as the fallback. */
const AUTO_KEY_COLOR = 'var(--autokey, #e5484d)';
const LOOP_ORDER: readonly LoopMode[] = ['once', 'loop', 'oscillate'];
const LOOP_LABEL: Readonly<Record<LoopMode, string>> = { once: 'Once', loop: 'Loop', oscillate: 'Oscillate' };
const SPEEDS: readonly (readonly [PlaybackSpeed, string])[] = [
  ['realtime', 'Real-time'],
  ['every-frame', 'Every frame'],
  ['half', '0.5×'],
  ['double', '2×'],
];

const selectPlaying = (s: SessionState): boolean => s.time.playing;
const selectDirection = (s: SessionState): 1 | -1 => s.time.direction;
const selectLoop = (s: SessionState): LoopMode => s.time.loop;
const selectSpeed = (s: SessionState): PlaybackSpeed => s.time.speed;
const selectAutoKey = (p: Prefs): boolean => p.autoKey;

/** "Label (Shortcut)" when the keymap binds `op` (with exactly these args) in a scope the timeline sees. */
function withShortcut(app: EditorApp, label: string, op: OperatorId, args?: unknown): string {
  const binding = app.keymap
    .bindings()
    .find(
      (b) =>
        b.op === op &&
        (b.scope === 'global' || b.scope === PANEL.timeline) &&
        (args === undefined || JSON.stringify(b.args) === JSON.stringify(args)),
    );
  return binding === undefined ? label : `${label} (${app.keymap.label(binding.chord)})`;
}

interface TransportButton {
  readonly testId: string;
  readonly icon: TimelineIconName;
  readonly label: string;
  readonly op: OperatorId;
  readonly args?: unknown;
}

const BEFORE_PLAY: readonly TransportButton[] = [
  { testId: 'timeline-start', icon: 'start', label: 'Go to start', op: 'time.goToStart' },
  { testId: 'timeline-prev-key', icon: 'prevKey', label: 'Previous key', op: 'time.prevKey' },
  { testId: 'timeline-prev-frame', icon: 'prevFrame', label: 'Previous frame', op: 'time.step', args: { delta: -1 } },
];
const AFTER_PLAY: readonly TransportButton[] = [
  { testId: 'timeline-next-frame', icon: 'nextFrame', label: 'Next frame', op: 'time.step', args: { delta: 1 } },
  { testId: 'timeline-next-key', icon: 'nextKey', label: 'Next key', op: 'time.nextKey' },
  { testId: 'timeline-end', icon: 'end', label: 'Go to end', op: 'time.goToEnd' },
];

export function PlaybackControls(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const playing = useSession(selectPlaying);
  const direction = useSession(selectDirection);
  const run = (op: string, args?: unknown): void => {
    void app.runUntyped(op, args, { panel: PANEL.timeline });
  };
  const button = (b: TransportButton): JSX.Element => {
    const title = withShortcut(app, b.label, b.op, b.args);
    return (
      <button
        key={b.testId}
        type="button"
        className={iconButton}
        data-testid={b.testId}
        aria-label={b.label}
        title={title}
        onClick={() => run(b.op, b.args)}
      >
        <TimelineIcon name={b.icon} />
      </button>
    );
  };
  // While playing in a direction, that direction's button stops playback (Maya); the other one reverses.
  const play = (dir: 1 | -1): JSX.Element => {
    const stops = playing && direction === dir;
    const label = stops ? 'Stop' : dir === 1 ? 'Play forwards' : 'Play backwards';
    return (
      <button
        type="button"
        className={iconButton}
        data-testid={dir === 1 ? 'timeline-play' : 'timeline-play-back'}
        aria-label={label}
        aria-pressed={stops}
        title={stops ? withShortcut(app, label, 'time.stop') : withShortcut(app, label, 'time.togglePlay')}
        onClick={() => (stops ? run('time.stop') : run('time.play', { direction: dir }))}
      >
        <TimelineIcon name={stops ? 'stop' : dir === 1 ? 'play' : 'playBack'} />
      </button>
    );
  };
  return (
    <div className="flex shrink-0 items-center" role="toolbar" aria-label="Playback">
      {BEFORE_PLAY.map(button)}
      {play(-1)}
      {play(1)}
      {AFTER_PLAY.map(button)}
    </div>
  );
}

export function LoopSpeedControls(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const loop = useSession(selectLoop);
  const speed = useSession(selectSpeed);
  const next = LOOP_ORDER[(LOOP_ORDER.indexOf(loop) + 1) % LOOP_ORDER.length] ?? 'loop';
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={iconButton}
        data-testid="timeline-loop"
        data-mode={loop}
        aria-label={`Playback: ${LOOP_LABEL[loop]}`}
        title={`Playback: ${LOOP_LABEL[loop]} (click for ${LOOP_LABEL[next]})`}
        onClick={() => void app.run('time.setLoop', { loop: next }, { panel: PANEL.timeline })}
      >
        <TimelineIcon name={loop} />
      </button>
      <select
        aria-label="Playback speed"
        title="Playback speed"
        data-testid="timeline-speed"
        className={selectClass}
        value={speed}
        onChange={(e) => {
          const picked = SPEEDS.find(([id]) => id === e.currentTarget.value)?.[0];
          if (picked !== undefined) void app.run('time.setSpeed', { speed: picked }, { panel: PANEL.timeline });
        }}
      >
        {SPEEDS.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Auto-key toggle; on, it shows a red dot and the time slider gets a red border (Maya). */
export function AutoKeyToggle(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const on = usePrefs(selectAutoKey);
  const label = withShortcut(app, 'Auto key', 'key.toggleAutoKey');
  return (
    <button
      type="button"
      className={`inline-flex h-6 items-center gap-1 px-1.5 text-xs ${buttonLook}`}
      data-testid="timeline-autokey"
      aria-pressed={on}
      aria-label="Auto key"
      title={label}
      onClick={() => void app.run('key.toggleAutoKey', undefined, { panel: PANEL.timeline })}
    >
      <span
        aria-hidden="true"
        className="size-2.5 rounded-full border border-current"
        style={on ? { background: AUTO_KEY_COLOR, borderColor: AUTO_KEY_COLOR } : undefined}
      />
      Auto
    </button>
  );
}
