// The Thread at rest (STUDIO-TOUCH-SPEC §10.3, §4.8; T7): ▶ · the time readout · the ruler · ● Rec · the labelled layer
// switch [Timeline │ Keys │ Curves] — seven targets. Tapping the readout expands the transport (start, previous key,
// −1 / +1 frame, next key, end, the four speeds, the range); holding ▶ offers repeat, once, ping-pong and backwards.
// Playback never fades or locks it (§4.7, C18). Every control is an operator run or the shell's own setting (Rec, the
// layer).
import type { LoopMode, PlaybackSpeed } from '@ekza-studio/editor-core';
import { Cluster, Segmented, useLongPress } from '@ekza-studio/ui/touch';
import type { JSX, ReactNode } from 'react';
import { animateWords } from '../../i18n/animate';
import type { HaloController } from '../../shell/controller';
import { useDocumentVersion, useSessionValue } from '../../shell/hooks';
import { useHaloStore } from '../../shell/store';
import { AnimateGlyph, type AnimateIcon } from '../../stages/animate/icons';
import { sceneFps } from '../../stages/animate/model';
import { type AnimateUiStore, useAnimateUi } from '../../stages/animate/ui';
import { currentFrame, threadContext, timeText } from './model';
import { ThreadStrip } from './ThreadStrip';

const w = animateWords.thread;

const LAYERS = [
  { value: '0', label: w.layers.timeline },
  { value: '1', label: w.layers.keys },
  { value: '2', label: w.layers.curves },
] as const;

const SPEEDS: readonly { readonly value: PlaybackSpeed; readonly label: string }[] = [
  { value: 'realtime', label: w.speeds.realtime },
  { value: 'every-frame', label: w.speeds['every-frame'] },
  { value: 'half', label: w.speeds.half },
  { value: 'double', label: w.speeds.double },
];

const LOOPS: readonly { readonly value: LoopMode; readonly label: string }[] = [
  { value: 'loop', label: w.loopModes.loop },
  { value: 'once', label: w.loopModes.once },
  { value: 'oscillate', label: w.loopModes.oscillate },
];

const tpClass =
  'inline-flex h-(--touch-hit) min-w-(--touch-hit) shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 rounded-touch-inner px-2.5 text-touch font-medium text-fg-2 hover:bg-hover hover:text-fg active:bg-pressed aria-pressed:bg-accent-soft aria-pressed:text-fg disabled:opacity-45';

function TransportButton(props: {
  readonly label: string;
  readonly icon?: AnimateIcon;
  readonly text?: string;
  readonly onPress: () => void;
  readonly testId?: string;
  readonly pressed?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={tpClass}
      aria-label={props.label}
      aria-pressed={props.pressed}
      data-testid={props.testId}
      onClick={props.onPress}
    >
      {props.icon === undefined ? null : <AnimateGlyph name={props.icon} />}
      {props.text === undefined ? null : <span className="tabular-nums">{props.text}</span>}
    </button>
  );
}

/** The expanded transport (§10.3), above the Thread. */
function Transport({
  controller,
  ui,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
}): JSX.Element {
  const { ctx } = controller;
  const speed = useSessionValue(ctx.app, (s) => s.time.speed);
  const range = useSessionValue(ctx.app, (s) => s.time.playbackRange);
  const count = (): void => ctx.store.set((s) => ({ touches: s.touches + 1 }));
  const run = (op: string, args?: unknown): void => {
    count();
    void ctx.run(op, args);
  };
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-thread-transport"
      className="pointer-events-auto flex flex-wrap items-center gap-1 p-[5px]"
    >
      <TransportButton label={w.start} icon="start" onPress={() => run('time.goToStart')} testId="halo-tp-start" />
      <TransportButton label={w.prevKey} icon="prevKey" onPress={() => run('time.prevKey')} testId="halo-tp-prev-key" />
      <TransportButton
        label={w.prevFrame}
        text="−1 f"
        onPress={() => run('time.step', { delta: -1 })}
        testId="halo-tp-prev"
      />
      <TransportButton
        label={w.nextFrame}
        text="+1 f"
        onPress={() => run('time.step', { delta: 1 })}
        testId="halo-tp-next"
      />
      <TransportButton label={w.nextKey} icon="nextKey" onPress={() => run('time.nextKey')} testId="halo-tp-next-key" />
      <TransportButton label={w.end} icon="end" onPress={() => run('time.goToEnd')} testId="halo-tp-end" />
      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <Segmented<PlaybackSpeed>
        label={w.speed}
        data-testid="halo-tp-speed"
        value={speed}
        onValueChange={(next) => run('time.setSpeed', { speed: next })}
        items={SPEEDS}
      />
      <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
      <TransportButton
        label={w.clearRange}
        text={range === null ? w.range : w.clearRange}
        pressed={range !== null}
        testId="halo-tp-range"
        onPress={() => {
          if (range !== null) {
            run('time.setPlaybackRange', { range: null });
            return;
          }
          count();
          ui.set({ docked: { kind: 'playhead' }, transport: false });
        }}
      />
    </Cluster>
  );
}

/** ▶'s long-press menu: repeat, once, ping-pong, and backwards (§10.3). */
function PlayMenu({
  controller,
  ui,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
}): JSX.Element {
  const { ctx } = controller;
  const loop = useSessionValue(ctx.app, (s) => s.time.loop);
  const run = (op: string, args?: unknown): void => {
    ctx.store.set((s) => ({ touches: s.touches + 1 }));
    ui.set({ playMenu: false });
    void ctx.run(op, args);
  };
  return (
    <Cluster
      data-halo-chrome=""
      data-testid="halo-thread-play-menu"
      role="menu"
      className="pointer-events-auto flex flex-wrap items-center gap-1 p-[5px]"
    >
      {LOOPS.map((item) => (
        <button
          key={item.value}
          type="button"
          role="menuitemradio"
          aria-checked={loop === item.value}
          className={tpClass}
          onClick={() => run('time.setLoop', { loop: item.value })}
        >
          {item.label}
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        className={tpClass}
        onClick={() => run('time.togglePlay', { direction: -1 })}
      >
        {w.backwards}
      </button>
    </Cluster>
  );
}

function PlayButton({
  controller,
  ui,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
}): JSX.Element {
  const { ctx } = controller;
  const playing = useSessionValue(ctx.app, (s) => s.time.playing);
  const press = useLongPress({
    onTap: () => {
      ctx.store.set((s) => ({ touches: s.touches + 1 }));
      void ctx.run('time.togglePlay');
    },
    onLongPress: () => {
      ctx.store.set((s) => ({ touches: s.touches + 1 }));
      ui.set({ playMenu: !ui.get().playMenu, transport: false });
    },
  });
  return (
    <button
      type="button"
      className={`${tpClass} text-fg`}
      aria-label={`${playing ? w.pause : w.play}. ${w.playHint}`}
      data-testid="halo-thread-play"
      data-playing={playing ? '' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void ctx.run('time.togglePlay');
        }
      }}
      {...press}
    >
      <AnimateGlyph name={playing ? 'pause' : 'play'} />
    </button>
  );
}

function Readout({
  controller,
  ui,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
}): JSX.Element {
  const { ctx } = controller;
  const { app } = ctx;
  useSessionValue(app, (s) => s.time.sceneFrame);
  useDocumentVersion(app);
  const expanded = useAnimateUi(ui, (s) => s.transport);
  const thread = threadContext(app);
  const text = thread === null ? timeText(0, sceneFps(app)) : timeText(currentFrame(app, thread), thread.fps);
  return (
    <button
      type="button"
      className={`${tpClass} min-w-[84px] text-fg tabular-nums`}
      aria-label={w.readout(text)}
      aria-expanded={expanded}
      data-testid="halo-thread-readout"
      onClick={() => {
        ctx.store.set((s) => ({ touches: s.touches + 1 }));
        ui.set({ transport: !expanded, playMenu: false });
      }}
    >
      {text}
    </button>
  );
}

function RecChip({
  controller,
  compact,
}: {
  readonly controller: HaloController;
  readonly compact: boolean;
}): JSX.Element {
  const { store } = controller.ctx;
  const rec = useHaloStore(store, (s) => s.rec);
  return (
    <button
      type="button"
      className={`${tpClass} ${rec ? 'text-fg' : ''}`}
      aria-pressed={rec}
      aria-label={rec ? w.recOn : w.recOff}
      data-testid="halo-thread-rec"
      onClick={() => store.set((s) => ({ rec: !s.rec, touches: s.touches + 1 }))}
    >
      <span
        aria-hidden="true"
        className={`size-3 rounded-full ${rec ? 'bg-[var(--autokey,#e5484d)]' : 'border-2 border-[var(--text-3)]'}`}
      />
      {compact ? null : <span>{w.rec}</span>}
    </button>
  );
}

/** The Thread: its rest row, with the transport or ▶'s menu above it when open. */
export function Thread({
  controller,
  ui,
  compact,
  before,
}: {
  readonly controller: HaloController;
  readonly ui: AnimateUiStore;
  readonly compact: boolean;
  /** Content of the row before ▶ (nothing on wide containers). */
  readonly before?: ReactNode;
}): JSX.Element {
  const { store } = controller.ctx;
  const layer = useHaloStore(store, (s) => s.threadLayer);
  const transport = useAnimateUi(ui, (s) => s.transport);
  const playMenu = useAnimateUi(ui, (s) => s.playMenu);
  return (
    <div className="flex flex-col items-stretch gap-2">
      {transport ? <Transport controller={controller} ui={ui} /> : null}
      {playMenu ? <PlayMenu controller={controller} ui={ui} /> : null}
      <Cluster
        data-halo-chrome=""
        data-testid="halo-thread"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row of controls, not a form (<fieldset>)
        role="group"
        aria-label={w.region}
        className="pointer-events-auto flex w-full flex-wrap items-center gap-1 p-[5px]"
      >
        {before}
        <PlayButton controller={controller} ui={ui} />
        {compact ? null : <Readout controller={controller} ui={ui} />}
        <ThreadStrip controller={controller} ui={ui} row={compact} />
        <RecChip controller={controller} compact={compact} />
        <Segmented<'0' | '1' | '2'>
          label={w.layer}
          data-testid="halo-thread-layer"
          value={String(layer) as '0' | '1' | '2'}
          onValueChange={(next) =>
            store.set((s) => ({ threadLayer: Number(next) as 0 | 1 | 2, touches: s.touches + 1 }))
          }
          items={compact ? LAYERS.map((l) => ({ ...l, label: l.label.slice(0, 1), ariaLabel: l.label })) : LAYERS}
        />
      </Cluster>
    </div>
  );
}
