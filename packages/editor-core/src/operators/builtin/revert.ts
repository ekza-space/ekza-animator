// Selective revert and restore (MCP-SPEC §4.10, §5.13): `edit.revertSteps` (a forward step that restores older
// history steps' changes, compare-before-restore per merge unit, through doc `planRestore`) and
// `edit.restoreDocument` (user runs only: "Restore the project as it was before the agent", through doc
// `planSnapshotRestore`). Nothing of this lives in `edit.ts` (M6a's B11 owns it). The definitions and polls live
// here; the applies load on first use with the agent operators' implementation (`agentImpl.ts`).
import { GLOBAL_SCOPE, type HistoryStep } from '../../types';
import { type AgentImpl, loadAgentImpl } from './agentLoad';
import { type AnyOperator, defineOperator, fail, isActorRun, isRecord, OK } from './define';
import { pollEditable } from './polls';

const EDIT = { category: 'edit', scope: GLOBAL_SCOPE, flags: { undo: true, internal: true } } as const;

function stepsArg(raw: unknown): readonly number[] | string {
  if (!isRecord(raw) || !Array.isArray(raw['steps'])) return 'expects { steps: [step ids] }';
  const steps = raw['steps'] as readonly unknown[];
  if (steps.length === 0) return 'steps is empty';
  if (!steps.every((id) => Number.isInteger(id))) return 'steps must be history step ids';
  return steps as readonly number[];
}

/**
 * The undo-stack steps of the ids (each once, however often it is named), or why one cannot be reverted (not in the
 * undo stack, no change journal).
 */
export function revertible(undo: readonly HistoryStep[], ids: readonly number[]): readonly HistoryStep[] | string {
  const out: HistoryStep[] = [];
  for (const id of new Set(ids)) {
    const step = undo.find((candidate) => candidate.id === id);
    if (step === undefined) return `Step ${id} is not in the undo history`;
    if (step.changes === undefined || step.changes === null) {
      return `Step ${id} cannot be reverted on its own (no change record; only agent steps keep one)`;
    }
    out.push(step);
  }
  return out;
}

const revertSteps = defineOperator<'edit.revertSteps', AgentImpl>({
  ...EDIT,
  id: 'edit.revertSteps',
  label: 'Revert Steps',
  description: 'Revert older history steps as one new step; fields changed since are kept and reported.',
  // A step named twice is reverted once, so it is counted once (the user-run label of the apply agrees).
  undoLabel: (args) => {
    const count = new Set(args.steps).size;
    return count === 1 ? 'Revert 1 step' : `Revert ${count} steps`;
  },
  poll({ app }, raw) {
    const ids = stepsArg(raw);
    if (typeof ids === 'string') return fail(ids);
    const editable = pollEditable(app);
    if (editable !== true) return editable;
    const steps = revertible(app.history.entries().undo, ids);
    return typeof steps === 'string' ? fail(steps) : OK;
  },
  prepare: () => loadAgentImpl(),
  apply: (ctx, args, impl) => impl.revertSteps(ctx, args),
});

const restoreDocument = defineOperator<'edit.restoreDocument', AgentImpl>({
  ...EDIT,
  id: 'edit.restoreDocument',
  label: 'Restore Document',
  description: 'Make the document equal to an earlier snapshot in one undoable step.',
  undoLabel: (args) => (typeof args.label === 'string' && args.label.length > 0 ? args.label : 'Restore Document'),
  poll(ctx, raw) {
    // §4.10: user runs only ("Restore the project as it was before the agent"); agents are denied by policy too.
    if (isActorRun(ctx)) return fail('Restoring the document is the user’s action');
    if (!isRecord(raw) || !isRecord(raw['snapshot']) || typeof raw['label'] !== 'string') {
      return fail('expects { snapshot, label }');
    }
    return pollEditable(ctx.app);
  },
  prepare: () => loadAgentImpl(),
  apply: ({ tx }, args, impl) => impl.restoreDocument(tx, args),
});

export const REVERT_OPERATORS: readonly AnyOperator[] = [revertSteps, restoreDocument];
