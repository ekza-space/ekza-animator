// The History ribbon (STUDIO-TOUCH-SPEC §4.1, §6.2 "History step", §12.9, §14; T10): ↶'s long-press, or project menu ›
// History. The kernel's own history, newest first — what can be redone on top, then *Now*, then the steps ↶ takes back
// — with selection steps folded into the next step (§5.3 C9) and each AI agent's run as one group (*"AI · Wave twice ·
// 5 steps"*, titled with the request from the Ask sheet). Tap a step for its verbs: *Undo to here* (or *Redo to here*),
// *Compare* (hold: the project as it was before it), *Revert this* (an AI step on its own), *Adjust* (the latest step
// with numbers), *Show* (what an AI step changed), ⋯ More. A group has *Undo all*, *Compare* and *Steps ▾*. Every verb
// is an operator run of the kernel (`edit.undo`, `edit.redo`, `edit.revertSteps`, `agent.show`). A lazy chunk.
import type { EditorApp, HistoryStep } from '@ekza-studio/editor-core';
import { Sheet, SheetGroup, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { provideHistoryProbe } from '../../history/probe';
import { en } from '../../i18n/en';
import type { HaloSheetProps } from '../../manifest/sheets';
import { holdCompare, repeat, revertSteps, type Run } from './actions';
import { AiGroupCard, HoldButton } from './AiGroupCard';
import { type HistoryRow, historyRows, historyText, type StepView } from './model';
import { requestsOf } from './requests';

const h = en.history;

type Entries = { readonly undo: readonly HistoryStep[]; readonly redo: readonly HistoryStep[] };

/** The history's stacks, re-read on every change. */
function useEntries(app: EditorApp): Entries {
  const cache = useRef<{ version: number; entries: Entries } | null>(null);
  const version = useRef(0);
  const subscribe = useCallback(
    (notify: () => void) =>
      app.history.subscribe(() => {
        version.current++;
        notify();
      }),
    [app],
  );
  const get = useCallback((): Entries => {
    if (cache.current === null || cache.current.version !== version.current) {
      cache.current = { version: version.current, entries: app.history.entries() };
    }
    return cache.current.entries;
  }, [app]);
  return useSyncExternalStore(subscribe, get, get);
}

const keyOf = (row: HistoryRow): string =>
  row.kind === 'ai' ? `ai:${row.steps[0]?.id}` : `${row.side}:${row.step.id}`;

export default function HistorySheet({ ctx }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  const entries = useEntries(app);
  const rows = historyRows(entries, requestsOf(app));
  const [open, setOpen] = useState<string | null>(null);
  const [steps, setSteps] = useState<ReadonlySet<string>>(() => new Set());
  const [note, setNote] = useState<string | null>(null);
  const run: Run = (op, args) => ctx.run(op, args);
  const touch = (): void => ctx.touch?.();
  const lastRun = app.session.getState().lastRun;
  const adjustable = lastRun !== null && lastRun.adjustable && lastRun.closed === null;

  // the test API's rows (an eager probe the sheet fills while it is open)
  useEffect(
    () =>
      provideHistoryProbe(app, () => ({
        rows: historyRows(app.history.entries(), requestsOf(app)).map((row) =>
          row.kind === 'ai'
            ? {
                kind: 'ai' as const,
                id: row.steps[0]?.id ?? 0,
                title: row.title,
                text: h.group(row.title, row.steps.length),
                steps: row.steps.map((s) => s.id),
              }
            : {
                kind: 'step' as const,
                id: row.step.id,
                label: row.step.label,
                side: row.side,
                folded: row.folded,
                ai: row.step.actor !== null,
              },
        ),
      })),
    [app],
  );

  /** *Show* an AI step: the agent module's audit row says what it changed (`agent.show`). */
  const show = async (step: StepView): Promise<void> => {
    const agent = await import('@ekza-studio/editor/agent');
    const runtime = agent.existingAgentRuntime(app);
    const audit = runtime?.store.getState().session?.store.getState().audit ?? [];
    const row = audit.find((r) => r.step?.id === step.id);
    if (row?.show === null || row?.show === undefined) {
      setNote(h.showReason);
      return;
    }
    await run(agent.AGENT_SHOW, row.show);
  };

  const stepVerbs = (row: Extract<HistoryRow, { kind: 'step' }>, latestUndo: boolean): JSX.Element => {
    const { step } = row;
    if (row.side === 'redo') {
      return (
        <div className="flex flex-wrap gap-1.5 py-1" data-testid={`halo-history-verbs-${step.id}`}>
          <TouchButton
            data-testid={`halo-history-redo-to-${step.id}`}
            onClick={() => {
              touch();
              setOpen(null);
              void repeat(run, 'edit.redo', row.depth);
            }}
          >
            {h.redoTo}
          </TouchButton>
        </div>
      );
    }
    const ai = step.actor !== null;
    return (
      <div className="flex flex-wrap gap-1.5 py-1" data-testid={`halo-history-verbs-${step.id}`}>
        <TouchButton
          data-testid={`halo-history-undo-to-${step.id}`}
          disabled={row.depth <= 1}
          onClick={() => {
            touch();
            setOpen(null);
            // the steps above this one go back; this one stays
            void repeat(run, 'edit.undo', row.depth - 1);
          }}
        >
          {h.undoTo}
        </TouchButton>
        <HoldButton
          label={h.compare}
          title={h.compareHint}
          testId={`halo-history-compare-${step.id}`}
          onHold={() => {
            touch();
            const release = holdCompare(run, row.depth);
            return () => void release();
          }}
        />
        <TouchButton
          data-testid={`halo-history-revert-${step.id}`}
          aria-disabled={!step.revertable}
          onClick={() => {
            touch();
            if (!step.revertable) {
              setNote(h.revertReason);
              return;
            }
            setOpen(null);
            void revertSteps(run, [step.id]);
          }}
        >
          {h.revert}
        </TouchButton>
        {latestUndo ? (
          <TouchButton
            data-testid={`halo-history-adjust-${step.id}`}
            aria-disabled={!adjustable}
            onClick={() => {
              touch();
              if (!adjustable) {
                setNote(h.adjustReason);
                return;
              }
              // the Echo chips of the latest run sit beside its result (§5.6)
              ctx.close();
            }}
          >
            {h.adjust}
          </TouchButton>
        ) : null}
        {ai ? (
          <TouchButton
            data-testid={`halo-history-show-${step.id}`}
            onClick={() => {
              touch();
              void show(step);
            }}
          >
            {h.show}
          </TouchButton>
        ) : null}
        <TouchButton
          variant="ghost"
          aria-label={en.more.title(step.label)}
          data-testid={`halo-history-more-${step.id}`}
          onClick={() => {
            touch();
            ctx.openMore?.({
              kind: 'historyStep',
              id: String(step.id),
              ids: [String(step.id)],
              label: step.label,
              count: 1,
              character: null,
            });
          }}
        >
          ⋯
        </TouchButton>
      </div>
    );
  };

  const firstUndo = rows.find((row) => row.side === 'undo');
  const items: JSX.Element[] = [];
  let nowShown = false;
  const nowLine = (
    <div
      key="now"
      className="flex items-center gap-2 px-2 py-1 text-touch-label font-semibold tracking-wide text-accent uppercase"
      data-testid="halo-history-now"
    >
      <span className="h-px flex-1 bg-accent/50" />
      {h.now}
      <span className="h-px flex-1 bg-accent/50" />
    </div>
  );
  for (const row of rows) {
    if (row.side === 'undo' && !nowShown) {
      items.push(nowLine);
      nowShown = true;
    }
    const key = keyOf(row);
    if (row.kind === 'ai') {
      const expanded = steps.has(key);
      items.push(
        <AiGroupCard
          key={key}
          app={app}
          run={run}
          row={row}
          touch={touch}
          stepsOpen={expanded}
          steps={() =>
            setSteps((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        >
          {expanded ? (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {[...row.steps].reverse().map((step, index) => {
                // depth of this step inside the group: the group's newest is reached first
                const depth = row.depth - row.steps.length + index + 1;
                const stepRow = { kind: 'step', side: 'undo', step, folded: 0, depth } as const;
                return (
                  <li key={step.id} className="flex flex-col">
                    <button
                      type="button"
                      className="flex min-h-(--touch-hit) w-full items-center gap-2 rounded-touch-inner px-2 text-left text-fg-2 hover:bg-hover"
                      data-testid={`halo-history-step-${step.id}`}
                      aria-expanded={open === `undo:${step.id}`}
                      onClick={() => {
                        touch();
                        setNote(null);
                        setOpen(open === `undo:${step.id}` ? null : `undo:${step.id}`);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{step.label}</span>
                    </button>
                    {open === `undo:${step.id}` ? stepVerbs(stepRow, firstUndo === row && index === 0) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </AiGroupCard>,
      );
      continue;
    }
    const { step } = row;
    items.push(
      <div key={key} className={`flex flex-col ${row.side === 'redo' ? 'opacity-60' : ''}`}>
        <button
          type="button"
          className="flex min-h-(--touch-hit) w-full items-center gap-2 rounded-touch-inner px-2 text-left hover:bg-hover active:bg-pressed"
          data-testid={`halo-history-step-${step.id}`}
          aria-expanded={open === key}
          onClick={() => {
            touch();
            setNote(null);
            setOpen(open === key ? null : key);
          }}
        >
          <span className="min-w-0 flex-1 truncate text-fg">{step.label}</span>
          {row.folded > 0 ? (
            <span className="shrink-0 text-touch-label text-fg-3">{h.selection(row.folded)}</span>
          ) : null}
          {step.actor !== null ? <span className="shrink-0 text-touch-label text-fg-3">{h.ai}</span> : null}
        </button>
        {open === key ? stepVerbs(row, row === firstUndo) : null}
      </div>,
    );
  }
  if (!nowShown) items.push(nowLine);

  return (
    <Sheet
      data-testid="halo-sheet-history"
      open
      onOpenChange={(next) => {
        if (!next) ctx.close();
      }}
      modal={false}
      side={ctx.side}
      defaultDetent={ctx.compact === true ? 'full' : 'half'}
      title={en.sheets['history'] ?? 'History'}
      actions={
        <TouchButton
          variant="ghost"
          data-testid="halo-history-redo"
          disabled={entries.redo.length === 0}
          onClick={() => {
            touch();
            void run('edit.redo');
          }}
        >
          {h.redo}
        </TouchButton>
      }
      footer={
        <TouchButton
          variant="ghost"
          className="flex-1"
          onClick={() => {
            touch();
            void navigator.clipboard?.writeText(historyText(rows)).then(
              () => setNote(h.copied),
              () => undefined,
            );
          }}
        >
          {h.copy}
        </TouchButton>
      }
    >
      {note === null ? null : (
        <output className="block px-2 py-1 text-touch-label text-fg-2" data-testid="halo-history-note">
          {note}
        </output>
      )}
      {entries.undo.length === 0 && entries.redo.length === 0 ? (
        <p className="m-0 px-2 py-3 text-fg-2">{h.empty}</p>
      ) : null}
      {entries.redo.length > 0 ? <SheetGroup>{h.redoSide}</SheetGroup> : null}
      <div className="flex flex-col gap-1">{items}</div>
    </Sheet>
  );
}
