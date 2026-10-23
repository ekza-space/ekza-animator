// The audit log (MCP-SPEC §5.11, §7.2; B3): one row per AI call, newest first — time, tool, argument digest, status
// (and error code), duration and the history step — with [Show] when the call touched a clip and [Undo] (its step is
// the top of the undo stack) or [Revert] (an older step with a change record). Undone, reverted and unreachable steps
// say so. Checkpoint groups are deferred in the MVP (§0.4.2): the rows are one list.
import type { EditorApp } from '@ekza-studio/editor-core';
import { type JSX, memo } from 'react';
import type { AgentAuditRow, AgentSessionState } from '../types';
import { type RunOperator, revertSteps, undoStep } from '../ui/actions';
import { useHistoryView } from '../ui/hooks';
import { clockOf, type RowAction, rowAction } from '../ui/model';
import type { AgentRuntime } from '../ui/runtime';
import { showAgentStep } from '../ui/show';
import { useSyncExternalStore } from 'react';

const ROW_BUTTON =
  'inline-flex h-5 items-center rounded-[4px] border border-line px-1.5 text-[11px] text-fg hover:bg-hover ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const STATUS_TEXT: Readonly<Record<AgentAuditRow['status'], string>> = {
  running: 'running',
  waiting: 'waiting',
  ok: 'ok',
  error: 'error',
  cancelled: 'cancelled',
  denied: 'denied',
};

function stateNote(action: RowAction): string | null {
  switch (action.kind) {
    case 'undone':
      return 'undone';
    case 'reverted':
      return action.by === null ? 'reverted' : `reverted by step ${action.by}`;
    case 'unreachable':
      return 'can no longer be undone';
    case 'none':
    case 'undo':
    case 'revert':
      return null;
  }
}

const Row = memo(function Row(props: {
  readonly app: EditorApp;
  readonly runtime: AgentRuntime;
  readonly row: AgentAuditRow;
  readonly action: RowAction;
  readonly run: RunOperator;
}): JSX.Element {
  const { row, action } = props;
  const note = stateNote(action);
  const failed = row.status === 'error' || row.status === 'denied' || row.status === 'cancelled';
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 border-b border-line/60 px-1 py-1 hover:bg-hover/40"
      data-testid={`agent-audit-row-${row.n}`}
      data-status={row.status}
      data-action={action.kind}
    >
      <span className="text-fg-3 tabular-nums">{clockOf(row.at)}</span>
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <code className="shrink-0 text-fg">{row.tool}</code>
          <span className="min-w-0 truncate text-fg-2" title={row.digest}>
            {row.digest}
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-fg-3">
          <span className={failed ? 'text-danger' : undefined}>
            {STATUS_TEXT[row.status]}
            {row.code === null ? '' : ` (${row.code})`}
          </span>
          {row.ms === null ? null : <span className="tabular-nums">{Math.round(row.ms)} ms</span>}
          {row.step === null ? null : (
            <span className="min-w-0 truncate text-fg-2" title={row.step.label}>
              {row.step.label}
            </span>
          )}
          {note === null ? null : (
            <span className="italic" data-testid={action.kind === 'unreachable' ? 'agent-unreachable' : undefined}>
              {note}
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 gap-1">
        {row.show === null ? null : (
          <button
            type="button"
            className={ROW_BUTTON}
            data-testid={`agent-audit-show-${row.n}`}
            onClick={() => {
              if (row.show !== null) void showAgentStep(props.app, row.show);
            }}
          >
            Show
          </button>
        )}
        {action.kind === 'undo' ? (
          <button
            type="button"
            className={ROW_BUTTON}
            data-testid={`agent-audit-undo-${row.n}`}
            onClick={() => void undoStep(props.app, props.run, action.step)}
          >
            Undo
          </button>
        ) : null}
        {action.kind === 'revert' ? (
          <button
            type="button"
            className={ROW_BUTTON}
            data-testid={`agent-audit-revert-${row.n}`}
            onClick={() => void revertSteps(props.runtime, props.run, [action.step])}
          >
            Revert
          </button>
        ) : null}
      </span>
    </li>
  );
});

export function AuditLog(props: {
  readonly app: EditorApp;
  readonly runtime: AgentRuntime;
  readonly state: AgentSessionState;
  readonly run: RunOperator;
}): JSX.Element {
  const history = useHistoryView(props.app);
  const revertedBy = useSyncExternalStore(
    props.runtime.store.subscribe,
    () => props.runtime.store.getState().revertedBy,
    () => props.runtime.store.getState().revertedBy,
  );
  const rows = [...props.state.audit].reverse();
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1" aria-label="AI activity">
      <h3 className="text-ui-dense font-semibold tracking-wide text-fg-3 uppercase">Activity</h3>
      <ul className="min-h-0 flex-1 overflow-auto rounded border border-line bg-field/40" data-testid="agent-audit">
        {rows.map((row) => (
          <Row
            key={row.n}
            app={props.app}
            runtime={props.runtime}
            row={row}
            action={rowAction(row, history, revertedBy)}
            run={props.run}
          />
        ))}
      </ul>
    </section>
  );
}
