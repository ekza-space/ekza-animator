// Numeric fields of the timeline panel. The current-frame field and the scene-time readout change every frame
// during playback, so they write the DOM directly from store subscriptions instead of re-rendering React.
import { type EditorApp, PANEL } from '@ekza-animator/editor-core';
import { type JSX, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { formatFrameValue, parseFrameInput } from './input';
import { currentFrameOf, subscribeToFrame } from './state';

export const fieldClass =
  'h-[22px] min-w-0 rounded-[3px] border border-line bg-app px-1 text-right font-mono text-xs text-fg ' +
  'tabular-nums outline-none focus:border-accent disabled:text-fg-3';

/** Enter commits, Escape reverts; neither reaches the editor's hotkeys. */
function editKeys(e: KeyboardEvent<HTMLInputElement>, commit: () => void, revert: () => void): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    commit();
    e.currentTarget.blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    revert();
    e.currentTarget.blur();
  }
}

/**
 * The current frame (active-clip frames): typing `24`, `+10` or `-5` and Enter runs `time.setFrame`; ↑/↓ step one
 * frame. While not focused it follows the clock without React renders.
 */
export function CurrentFrameField(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (input === null) return undefined;
    const show = (): void => {
      if (input.ownerDocument.activeElement !== input) input.value = formatFrameValue(currentFrameOf(app).frame);
    };
    show();
    return subscribeToFrame(app, show);
  }, [app]);

  const revert = (): void => {
    if (ref.current !== null) ref.current.value = formatFrameValue(currentFrameOf(app).frame);
  };
  const commit = (): void => {
    const input = ref.current;
    if (input === null) return;
    const { frame, unit } = currentFrameOf(app);
    const target = parseFrameInput(input.value, frame);
    if (target !== null) void app.run('time.setFrame', { frame: target, unit }, { panel: PANEL.timeline });
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      aria-label="Current frame"
      title="Current frame (24, +10, -5)"
      data-testid="timeline-frame-field"
      className={`${fieldClass} w-14`}
      defaultValue="0"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={revert}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          void app.run('time.step', { delta: e.key === 'ArrowUp' ? 1 : -1 }, { panel: PANEL.timeline });
          return;
        }
        editKeys(e, commit, revert);
      }}
    />
  );
}

/** Scene time in seconds (the shared clock, §4.11.8), updated without React renders. */
export function SceneTimeReadout(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const span = ref.current;
    if (span === null) return undefined;
    const show = (): void => {
      const fps = app.store.get('project', 'project')?.sceneFps ?? { num: 30, den: 1 };
      const seconds = (app.session.getState().time.sceneFrame * fps.den) / fps.num;
      span.textContent = `${seconds.toFixed(2)} s`;
    };
    show();
    return subscribeToFrame(app, show);
  }, [app]);
  return (
    <span
      ref={ref}
      className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-fg-2"
      title="Scene time"
      data-testid="timeline-scene-time"
    />
  );
}

export interface FrameInputProps {
  readonly value: number;
  readonly label: string;
  readonly testId: string;
  readonly onCommit: (value: number) => void;
  readonly disabled?: boolean;
}

/** A frame field showing `value`; Enter commits the typed frame (relative forms as in the current-frame field). */
export function FrameInput(props: FrameInputProps): JSX.Element {
  const { value, onCommit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      aria-label={props.label}
      title={props.label}
      data-testid={props.testId}
      className={`${fieldClass} w-11`}
      disabled={props.disabled === true}
      value={draft ?? formatFrameValue(value)}
      onFocus={(e) => {
        setDraft(formatFrameValue(value));
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) =>
        editKeys(
          e,
          () => {
            const next = parseFrameInput(draft ?? '', value);
            setDraft(null);
            if (next !== null && next !== value) onCommit(next);
          },
          () => setDraft(null),
        )
      }
    />
  );
}
