// Clip selector and fps menu of the timeline (FR-CLIP-03, FR-TIME-05): switching clips runs `clip.setActive`; a
// new frame rate asks whether to keep timing in seconds (re-time keys) or keep frame numbers, then runs
// `clip.setSettings`.
import type { Fps } from '@ekza-studio/anim-core';
import type { ClipRecord } from '@ekza-studio/doc';
import { type EditorApp, PANEL } from '@ekza-studio/editor-core';
import { type JSX, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fieldClass } from './fields';
import { formatFps, parseFps, STANDARD_FPS, sameFps } from './input';
import { useAnchoredPlacement } from './placement';

export const selectClass =
  'h-[22px] min-w-0 rounded-[3px] border border-line bg-app px-1 text-xs text-fg outline-none focus:border-accent ' +
  'disabled:text-fg-3';
const buttonClass =
  'h-[22px] rounded-[3px] px-2 text-xs text-fg hover:bg-panel focus-visible:outline focus-visible:outline-1 ' +
  'focus-visible:outline-accent';
const CUSTOM = 'custom';
/** The dialog's start style; `useAnchoredPlacement` positions and reveals it before the first paint. */
const HIDDEN_UNTIL_PLACED = { left: 0, top: 0, right: 'auto', bottom: 'auto', visibility: 'hidden' } as const;

export function ClipSelect(props: {
  readonly app: EditorApp;
  readonly clip: ClipRecord | null;
  readonly clips: readonly ClipRecord[];
}): JSX.Element {
  const { app, clip, clips } = props;
  return (
    <select
      aria-label="Active clip"
      title="Active clip"
      data-testid="timeline-clip-select"
      className={`${selectClass} max-w-36`}
      disabled={clips.length === 0}
      value={clip?.id ?? ''}
      onChange={(e) => {
        const next = clips.find((candidate) => candidate.id === e.currentTarget.value);
        if (next !== undefined && next.id !== clip?.id) {
          void app.run('clip.setActive', { clip: next.id }, { panel: PANEL.timeline });
        }
      }}
    >
      {clip === null ? <option value="">No clip</option> : null}
      {clips.map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {candidate.name}
        </option>
      ))}
    </select>
  );
}

type FpsStep = { readonly kind: 'custom' } | { readonly kind: 'confirm'; readonly fps: Fps };

export function FpsMenu(props: { readonly app: EditorApp; readonly clip: ClipRecord | null }): JSX.Element {
  const { app, clip } = props;
  const [step, setStep] = useState<FpsStep | null>(null);
  const [custom, setCustom] = useState('');
  const customRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  useAnchoredPlacement(selectRef, dialogRef, step);
  // Focus the popover's first control when it opens or changes step.
  useEffect(() => {
    if (step?.kind === 'custom') customRef.current?.select();
    else if (step?.kind === 'confirm') confirmRef.current?.focus();
  }, [step]);
  // Escape or a press outside closes the popover.
  const open = step !== null;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) return undefined;
    const doc = dialog.ownerDocument;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setStep(null);
    };
    const onPointer = (e: PointerEvent): void => {
      if (!(e.target instanceof Node) || !dialog.contains(e.target)) setStep(null);
    };
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('pointerdown', onPointer, true);
    return () => {
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);
  const current = clip?.fps ?? null;
  const standard = current !== null && current.den === 1 && STANDARD_FPS.includes(current.num);
  const value = current === null ? '' : standard ? String(current.num) : 'current';

  const choose = (fps: Fps): void => {
    if (current !== null && sameFps(fps, current)) setStep(null);
    else setStep({ kind: 'confirm', fps });
  };
  const apply = (fpsMode: 'keep-seconds' | 'keep-frames'): void => {
    if (clip !== null && step?.kind === 'confirm') {
      void app.run('clip.setSettings', { clip: clip.id, fps: step.fps, fpsMode }, { panel: PANEL.timeline });
    }
    setStep(null);
  };

  return (
    <div className="relative">
      <select
        ref={selectRef}
        aria-label="Clip frame rate"
        title="Clip frame rate"
        data-testid="timeline-fps"
        className={selectClass}
        disabled={clip === null}
        value={value}
        onChange={(e) => {
          const picked = e.currentTarget.value;
          if (picked === CUSTOM) {
            setCustom(current === null ? '' : formatFps(current));
            setStep({ kind: 'custom' });
          } else if (picked !== 'current') {
            choose({ num: Number(picked), den: 1 });
          }
        }}
      >
        {current !== null && !standard ? <option value="current">{formatFps(current)} fps</option> : null}
        {current === null ? <option value="">fps</option> : null}
        {STANDARD_FPS.map((fps) => (
          <option key={fps} value={String(fps)}>
            {fps} fps
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {step === null
        ? null
        : createPortal(
            <dialog
              ref={dialogRef}
              open
              aria-label="Change frame rate"
              data-testid="timeline-fps-dialog"
              className="fixed z-50 m-0 flex w-64 flex-col gap-2 rounded-md border border-line bg-header p-2 text-xs text-fg shadow-lg"
              style={HIDDEN_UNTIL_PLACED}
            >
              {step.kind === 'custom' ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fps = parseFps(custom);
                    if (fps !== null) choose(fps);
                  }}
                >
                  <label className="text-fg-2" htmlFor="timeline-fps-custom">
                    Frame rate
                  </label>
                  <input
                    id="timeline-fps-custom"
                    ref={customRef}
                    className={`${fieldClass} w-24 text-left`}
                    data-testid="timeline-fps-custom-input"
                    placeholder="29.97 or 30000/1001"
                    value={custom}
                    aria-invalid={custom.trim() !== '' && parseFps(custom) === null}
                    onChange={(e) => setCustom(e.currentTarget.value)}
                  />
                  <button type="submit" className={buttonClass} data-testid="timeline-fps-custom-ok">
                    OK
                  </button>
                </form>
              ) : (
                <>
                  <p className="text-fg">
                    Change {clip?.name ?? 'the clip'} to {formatFps(step.fps)} fps
                  </p>
                  <button
                    type="button"
                    ref={confirmRef}
                    className={`${buttonClass} bg-accent-fill text-left`}
                    data-testid="timeline-fps-keep-seconds"
                    onClick={() => apply('keep-seconds')}
                  >
                    Keep timing in seconds (re-time keys)
                  </button>
                  <button
                    type="button"
                    className={`${buttonClass} bg-panel text-left`}
                    data-testid="timeline-fps-keep-frames"
                    onClick={() => apply('keep-frames')}
                  >
                    Keep frame numbers
                  </button>
                </>
              )}
              <button
                type="button"
                className={`${buttonClass} self-end text-fg-2`}
                data-testid="timeline-fps-cancel"
                onClick={() => setStep(null)}
              >
                Cancel
              </button>
            </dialog>,
            document.body,
          )}
    </div>
  );
}
