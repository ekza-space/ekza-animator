// The shared Tween bar (M2A-SPEC §5.13, §7): mode select, slider, overshoot toggle, target label and presets, mounted
// in the status line (compact: presets and overshoot in an overflow menu) and in the Graph Editor and Dope Sheet
// toolbars. A slider drag is one gesture (`beginTweenGesture`: preview, one `Tween` history step; Esc cancels);
// release keeps the result and springs the thumb back to 0. Presets run `key.tween`. While mounted the bar registers
// the `tween.<panel>` probe (`screenOfTween`, `tweenTarget`).
import {
  beginTweenGesture,
  clampTweenAmount,
  type EditorApp,
  resolveTweenTarget,
  TWEEN_LIMIT,
  TWEEN_OVERSHOOT_LIMIT,
  type TweenGesture,
  type TweenMode,
} from '@ekza-studio/editor-core';
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ekza-studio/ui';
import {
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useEditorApp, useHelpLine, usePrefs, useRunOperator, useSession, useTestProbe } from '../../hooks';
import { type TweenPanel, type TweenProbe, tweenProbeKey } from '../../shell/types';

/** The modes in menu order with their labels (`key.tween` undo labels use the same words). */
export const TWEEN_MODE_OPTIONS: readonly { readonly mode: TweenMode; readonly label: string }[] = [
  { mode: 'tween', label: 'Tween' },
  { mode: 'neighbor', label: 'Blend to Neighbour' },
  { mode: 'ease', label: 'Ease' },
  { mode: 'pushPull', label: 'Push/Pull' },
  { mode: 'toDefault', label: 'Blend to Default' },
];

/** tweenMachine's 0/25/50/75/100 % as slider amounts (§5.13). */
export const TWEEN_PRESETS: readonly number[] = [-100, -50, 0, 50, 100];

const BUTTON =
  'inline-flex h-6 shrink-0 items-center rounded-[4px] px-1.5 text-[11px] leading-none text-fg-2 ' +
  'hover:bg-[var(--bg-hover,#30323a)] hover:text-fg disabled:pointer-events-none disabled:opacity-40 ' +
  'aria-pressed:bg-[var(--bg-pressed,#3a3d46)] aria-pressed:text-fg focus-visible:outline-2 ' +
  'focus-visible:outline-[var(--accent-text)]';

/**
 * Keeps the target label ("Pose @ f21" or "12 keys", §5.13: the bar always shows the resolved target) in `ref`'s text,
 * written to the DOM directly: the frame changes on every played or scrubbed frame, and an idle editor commits no
 * React render for that (ARCHITECTURE §14, `shell.test.tsx`).
 */
function useTweenTargetLabel(app: EditorApp, ref: { readonly current: HTMLElement | null }): void {
  useEffect(() => {
    const write = (): void => {
      const element = ref.current;
      if (element === null) return;
      const resolved = resolveTweenTarget(app);
      if (element.textContent !== resolved.label) element.textContent = resolved.label;
      element.dataset['kind'] = resolved.kind;
    };
    write();
    return app.session.subscribe((state, previous) => {
      if (
        state.selection.keys !== previous.selection.keys ||
        state.selection.controls !== previous.selection.controls ||
        state.selection.channels !== previous.selection.channels ||
        state.tools.tweenTarget !== previous.tools.tweenTarget ||
        state.tools.keyTarget !== previous.tools.keyTarget ||
        // While playing, the label would change on every frame and is not actionable; it updates when playback stops.
        (state.time.sceneFrame !== previous.time.sceneFrame && !state.time.playing) ||
        state.time.playing !== previous.time.playing ||
        state.activeCharacter !== previous.activeCharacter ||
        state.activeClip !== previous.activeClip
      ) {
        write();
      }
    });
  }, [app, ref]);
}

export function TweenBar(props: { readonly panel: TweenPanel }): JSX.Element {
  const { panel } = props;
  const app = useEditorApp();
  const run = useRunOperator();
  const help = useHelpLine();
  const overshoot = usePrefs((p) => p.tweenOvershoot);
  const forced = useSession((s) => s.tools.tweenTarget === 'frame');
  const labelRef = useRef<HTMLSpanElement>(null);
  useTweenTargetLabel(app, labelRef);
  const [mode, setMode] = useState<TweenMode>('tween');
  const [amount, setAmount] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<TweenGesture | null>(null);
  const limit = overshoot ? TWEEN_OVERSHOOT_LIMIT : TWEEN_LIMIT;
  const compact = panel === 'status';

  /** Slider amount (whole number, §5.13 slider step 1) at a client x. */
  const amountAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (track === null) return 0;
      const rect = track.getBoundingClientRect();
      const fraction = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
      return Math.round(clampTweenAmount((fraction * 2 - 1) * limit, overshoot));
    },
    [limit, overshoot],
  );

  const finish = useCallback((commit: boolean, value: number) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture !== null) {
      if (commit) gesture.commit(value);
      else gesture.cancel();
    }
    // Release keeps the result and springs the thumb back to 0 (§5.13).
    setAmount(0);
  }, []);

  // Esc cancels a drag (capture phase: before the shell's keymap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || gestureRef.current === null) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false, 0);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [finish]);
  useEffect(() => () => gestureRef.current?.cancel(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || gestureRef.current !== null) return;
    e.preventDefault();
    const poll = app.operators.poll('key.tween', {}, { mode, amount: 0 });
    if (poll !== true) {
      help(`Tween: ${poll.reason}`, 'warning');
      return;
    }
    let gesture: TweenGesture;
    try {
      gesture = beginTweenGesture(app, { mode });
    } catch (error) {
      help(`Tween: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      return;
    }
    gestureRef.current = gesture;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer cannot be captured; the drag still works over the track.
    }
    const value = amountAt(e.clientX);
    setAmount(value);
    gesture.update(value);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current;
    if (gesture === null) return;
    const value = amountAt(e.clientX);
    setAmount(value);
    gesture.update(value);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (gestureRef.current === null) return;
    finish(true, amountAt(e.clientX));
  };
  const onPointerCancel = (): void => finish(false, 0);

  const toggleTarget = (): void => {
    const tools = app.session.getState().tools;
    // U state, like the channel selection: no history step (§5.13 toggle between 'auto' and 'frame').
    app.session.setState({ tools: { ...tools, tweenTarget: tools.tweenTarget === 'frame' ? 'auto' : 'frame' } });
  };
  // A preference (P state, persisted by the kernel), like the auto-key toggle: no history step.
  const setOvershoot = (on: boolean): void => app.prefs.setState({ tweenOvershoot: on });
  const preset = (value: number): void => {
    void run('key.tween', { mode, amount: value });
  };

  // The e2e probe (page CSS px of a slider amount; the resolved target).
  const probe = useMemo<TweenProbe>(
    () => ({
      screenOfTween: (value) => {
        const track = trackRef.current;
        if (track === null || !Number.isFinite(value) || Math.abs(value) > limit) return null;
        const rect = track.getBoundingClientRect();
        if (!(rect.width > 0)) return null;
        return { x: rect.left + ((value + limit) / (2 * limit)) * rect.width, y: rect.top + rect.height / 2 };
      },
      tweenTarget: () => {
        const resolved = resolveTweenTarget(app);
        return { kind: resolved.kind, label: resolved.label };
      },
    }),
    [app, limit],
  );
  useTestProbe(tweenProbeKey(panel), probe);

  const thumb = (amount + limit) / (2 * limit);
  const modeLabel = TWEEN_MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? 'Tween';
  const presetButtons = TWEEN_PRESETS.map((value) => (
    <button
      key={value}
      type="button"
      className={BUTTON}
      data-testid={`tween-preset-${panel}-${value}`}
      title={`${modeLabel} ${value}`}
      onClick={() => preset(value)}
    >
      {value > 0 ? `+${value}` : String(value)}
    </button>
  ));

  return (
    <fieldset
      className={cn(
        'm-0 flex min-w-0 shrink-0 items-center gap-1 border-0 p-0',
        compact && 'border-r border-line pr-2',
      )}
      aria-label="Tween"
      data-testid={`tween-bar-${panel}`}
    >
      {compact && <span className="text-ui-dense text-fg-3">Tween</span>}
      <select
        className="h-6 min-w-0 rounded-[3px] border border-line bg-[var(--bg-field,#17181b)] px-1 text-[11px] text-fg"
        aria-label="Tween mode"
        data-testid={`tween-mode-${panel}`}
        value={mode}
        onChange={(e) => setMode(e.currentTarget.value as TweenMode)}
      >
        {TWEEN_MODE_OPTIONS.map((option) => (
          <option key={option.mode} value={option.mode}>
            {option.label}
          </option>
        ))}
      </select>
      <div
        ref={trackRef}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a range input cannot run a key-edit gesture with Esc and a spring-back thumb
        role="slider"
        tabIndex={0}
        aria-label={`${modeLabel} amount`}
        aria-valuemin={-limit}
        aria-valuemax={limit}
        aria-valuenow={amount}
        data-testid={`tween-slider-${panel}`}
        className={cn('relative h-5 shrink-0 cursor-ew-resize touch-none select-none', compact ? 'w-24' : 'w-32')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded bg-line" />
        <div className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-y-1/2 bg-fg-3" />
        {overshoot && (
          <>
            <div
              className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-fg-3"
              style={{ left: `${(50 / 300) * 100}%` }}
            />
            <div
              className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-fg-3"
              style={{ left: `${(250 / 300) * 100}%` }}
            />
          </>
        )}
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-[var(--accent)]"
          style={{ left: `${thumb * 100}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[11px] text-fg-2" aria-live="off">
        {amount}
      </span>
      <button
        type="button"
        className={cn(BUTTON, 'w-24 justify-start truncate tabular-nums')}
        data-testid={`tween-target-${panel}`}
        aria-label="Tween target"
        aria-pressed={forced}
        title={
          forced
            ? 'Tweening the pose at the current frame (click: selected keys when there are any)'
            : 'Tweening the selected keys, else the pose at the current frame (click: always the pose)'
        }
        onClick={toggleTarget}
      >
        <span ref={labelRef} />
      </button>
      {compact ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={BUTTON} data-testid={`tween-more-${panel}`} title="Tween presets">
              ⋯
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-36">
            {TWEEN_PRESETS.map((value) => (
              <DropdownMenuItem
                key={value}
                data-testid={`tween-preset-${panel}-${value}`}
                onSelect={() => preset(value)}
              >
                {modeLabel} {value > 0 ? `+${value}` : String(value)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={overshoot}
              data-testid={`tween-overshoot-${panel}`}
              onCheckedChange={(checked) => setOvershoot(checked === true)}
            >
              Overshoot (±150)
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <button
            type="button"
            className={BUTTON}
            data-testid={`tween-overshoot-${panel}`}
            aria-pressed={overshoot}
            title="Overshoot: the slider reaches ±150"
            onClick={() => setOvershoot(!overshoot)}
          >
            ±
          </button>
          {presetButtons}
        </>
      )}
    </fieldset>
  );
}
