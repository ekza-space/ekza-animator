// An AI group of the History (STUDIO-TOUCH-SPEC §14, J8; T10): *"AI · Wave twice · 5 steps"* with *Undo all*
// (`edit.revertSteps`, M-AI-INT-7), *Compare* (hold: the project as it was before the group) and *Steps ▾*. The History
// ribbon lists every group; the Ask sheet shows the latest one under the request it answers.
import type { EditorApp } from '@ekza-studio/editor-core';
import { TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, type ReactNode, useRef, useState } from 'react';
import { en } from '../../i18n/en';
import { holdCompare, type Run, undoAll } from './actions';
import type { HistoryRow } from './model';

const h = en.history;

/** A press-and-hold button (Compare): the release runs whatever the press began. */
export function HoldButton(props: {
  readonly label: string;
  readonly title: string;
  readonly onHold: () => () => void;
  readonly testId: string;
}): JSX.Element {
  const release = useRef<(() => void) | null>(null);
  const [held, setHeld] = useState(false);
  const end = (): void => {
    release.current?.();
    release.current = null;
    setHeld(false);
  };
  return (
    <TouchButton
      aria-pressed={held}
      title={props.title}
      data-testid={props.testId}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (release.current !== null) return;
        release.current = props.onHold();
        setHeld(true);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.label}
    </TouchButton>
  );
}

export function AiGroupCard({
  app,
  run,
  row,
  touch,
  steps,
  stepsOpen,
  children,
}: {
  readonly app: EditorApp;
  readonly run: Run;
  readonly row: Extract<HistoryRow, { kind: 'ai' }>;
  readonly touch: () => void;
  /** *Steps ▾*: the History unfolds the group's steps; the Ask sheet opens the History. */
  readonly steps: () => void;
  readonly stepsOpen?: boolean;
  readonly children?: ReactNode;
}): JSX.Element {
  const id = row.steps[0]?.id ?? 0;
  const title = h.group(row.title, row.steps.length);
  return (
    <section
      className="flex flex-col gap-1 rounded-touch-card border border-[color-mix(in_srgb,var(--presence-agent,#e66cff)_45%,transparent)] p-2"
      data-testid={`halo-history-ai-${id}`}
      aria-label={title}
    >
      <span className="min-w-0 truncate font-medium text-fg" data-testid={`halo-history-ai-title-${id}`}>
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <TouchButton
          variant="primary"
          data-testid={`halo-history-undo-all-${id}`}
          onClick={() => {
            touch();
            void undoAll(
              app,
              run,
              row.steps.map((s) => s.id),
            );
          }}
        >
          {h.undoAll}
        </TouchButton>
        <HoldButton
          label={h.compare}
          title={h.compareHint}
          testId={`halo-history-compare-ai-${id}`}
          onHold={() => {
            touch();
            const release = holdCompare(run, row.depth);
            return () => void release();
          }}
        />
        <TouchButton
          aria-expanded={stepsOpen === true}
          data-testid={`halo-history-steps-${id}`}
          onClick={() => {
            touch();
            steps();
          }}
        >
          {stepsOpen === true ? h.hideSteps : `${h.steps} ▾`}
        </TouchButton>
      </div>
      {children}
    </section>
  );
}
