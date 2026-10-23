// What the audit log's buttons do (MCP-SPEC §5.11, §5.12; B3), all user runs: Undo (a plain `edit.undo` while the
// step is the top of the undo stack), Revert (one `edit.revertSteps` step over older AI steps; what the user changed
// since is kept and reported by the operator) and Revert all AI changes since pairing.
import type { EditorApp, OperatorResult, RunContext } from '@ekza-studio/editor-core';
import type { AgentAuditRow } from '../types';
import { revertAllSteps } from './model';
import type { AgentRuntime } from './runtime';

export type RunOperator = (op: string, args?: unknown, ctx?: RunContext) => Promise<OperatorResult<unknown>>;

export const AGENT_PANEL_CTX: RunContext = { panel: 'agent', source: 'toolkit' };

/** Undoes the step when it is still the top of the undo stack. */
export async function undoStep(app: EditorApp, run: RunOperator, step: number): Promise<boolean> {
  if (app.history.peekUndo()?.id !== step) return false;
  const result = await run('edit.undo', undefined, AGENT_PANEL_CTX);
  return result.status === 'finished';
}

/** Reverts steps as one new step and remembers which step reverted them. */
export async function revertSteps(runtime: AgentRuntime, run: RunOperator, steps: readonly number[]): Promise<boolean> {
  if (steps.length === 0) return false;
  const result = await run('edit.revertSteps', { steps: [...steps] }, AGENT_PANEL_CTX);
  if (result.status !== 'finished') return false;
  runtime.markReverted(steps, runtime.app.history.peekUndo()?.id ?? 0);
  return true;
}

/** The steps Revert all would take back now. */
export function revertAllTargets(runtime: AgentRuntime, audit: readonly AgentAuditRow[]): number[] {
  return revertAllSteps(audit, runtime.app.history.entries(), runtime.store.getState().revertedBy);
}

/** Revert all AI changes since pairing (§5.11): one `edit.revertSteps` over every AI step still in the undo stack. */
export async function revertAll(
  runtime: AgentRuntime,
  run: RunOperator,
  audit: readonly AgentAuditRow[],
): Promise<boolean> {
  return revertSteps(runtime, run, revertAllTargets(runtime, audit));
}
