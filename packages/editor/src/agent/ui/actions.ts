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
  const state = runtime.store.getState();
  const actor = state.session?.store.getState().actor?.id ?? null;
  return revertAllSteps(audit, runtime.app.history.entries(), state.revertedBy, actor);
}

/**
 * The agent's steps when they are the whole top of the undo stack (nothing of the user's above the first of them),
 * oldest first; null otherwise.
 */
function agentSuffix(runtime: AgentRuntime): readonly { readonly id: number; readonly revertable: boolean }[] | null {
  const actor = runtime.store.getState().session?.store.getState().actor?.id ?? null;
  if (actor === null) return null;
  const undo = runtime.app.history.entries().undo;
  const first = undo.findIndex((entry) => entry.actor?.id === actor);
  if (first < 0) return null;
  const suffix = undo.slice(first);
  if (suffix.some((entry) => entry.actor?.id !== actor)) return null;
  return suffix.map((entry) => ({ id: entry.id, revertable: entry.changes !== undefined && entry.changes !== null }));
}

/**
 * Revert all AI changes since pairing (§5.11): one `edit.revertSteps` over every AI step still in the undo stack. When
 * the agent's steps are the top of the undo stack and one of them carries no change record (a model import, a rig:
 * the journal keeps no changes for them) or the revert fails, they are undone one by one instead (INT): the user's
 * own steps are below them and stay, and Redo brings the agent's work back.
 */
export async function revertAll(
  runtime: AgentRuntime,
  run: RunOperator,
  audit: readonly AgentAuditRow[],
): Promise<boolean> {
  const suffix = agentSuffix(runtime);
  const undoAll = async (steps: readonly { readonly id: number }[]): Promise<boolean> => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const result = await run('edit.undo', undefined, AGENT_PANEL_CTX);
      if (result.status !== 'finished') return false;
    }
    return true;
  };
  if (suffix !== null && suffix.some((step) => !step.revertable)) return undoAll(suffix);
  if (await revertSteps(runtime, run, revertAllTargets(runtime, audit))) return true;
  return suffix === null ? false : undoAll(suffix);
}
