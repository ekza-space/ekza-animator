// Selective revert and restore (MCP-SPEC §4.10, §5.13): `edit.revertSteps` (a forward step that restores older
// history steps' changes, compare-before-restore per merge unit, through doc `planRestore`) and
// `edit.restoreDocument` (user runs only: "Restore the project as it was before the agent", through doc
// `planSnapshotRestore`). Nothing of this lives in `edit.ts` (M6a's B11 owns it).
import { EkzaError } from '@ekza-animator/anim-core';
import { applyRestorePlan, planRestore, planSnapshotRestore, restoreHostOf } from '@ekza-animator/doc';
import { GLOBAL_SCOPE, type HistoryStep } from '../../types';
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

/** The undo-stack steps of the ids, or why one cannot be reverted (not in the undo stack, no change journal). */
function revertible(undo: readonly HistoryStep[], ids: readonly number[]): readonly HistoryStep[] | string {
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

const revertSteps = defineOperator({
  ...EDIT,
  id: 'edit.revertSteps',
  label: 'Revert Steps',
  description: 'Revert older history steps as one new step; fields changed since are kept and reported.',
  undoLabel: (args) => (args.steps.length === 1 ? 'Revert 1 step' : `Revert ${args.steps.length} steps`),
  poll({ app }, raw) {
    const ids = stepsArg(raw);
    if (typeof ids === 'string') return fail(ids);
    const editable = pollEditable(app);
    if (editable !== true) return editable;
    const steps = revertible(app.history.entries().undo, ids);
    return typeof steps === 'string' ? fail(steps) : OK;
  },
  apply(ctx, args) {
    const { app, tx } = ctx;
    if (tx === null) throw new EkzaError('internal', 'edit.revertSteps runs in a transaction');
    const steps = revertible(app.history.entries().undo, args.steps);
    if (typeof steps === 'string') throw new EkzaError('unsupported', steps);
    const reverted: number[] = [];
    const skipped: { step: number; reason: string }[] = [];
    const skippedFields: { table: string; id: string; fields: readonly string[] | null }[] = [];
    // Newest first, each against the document as the earlier reverts left it (the transaction's view).
    for (const step of [...steps].sort((a, b) => b.id - a.id)) {
      const plan = planRestore(restoreHostOf(tx), step.changes ?? [], 'undo');
      const written = applyRestorePlan(tx, plan);
      for (const skip of plan.skipped) {
        skippedFields.push({ table: skip.change.table, id: String(skip.change.id), fields: skip.fields });
      }
      if (written > 0) reverted.push(step.id);
      else skipped.push({ step: step.id, reason: plan.skipped.length > 0 ? 'changed since' : 'nothing to revert' });
    }
    // Labels (§4.10): agent runs `AI: Revert N steps` (the runner adds the prefix); user runs name the AI step.
    if (!isActorRun(ctx)) {
      const only = steps.length === 1 ? steps[0] : undefined;
      tx.annotate({ label: only === undefined ? `Revert ${steps.length} AI steps` : `Revert AI step: ${only.label}` });
    }
    return { reverted: reverted.sort((a, b) => a - b), skipped, skippedFields };
  },
});

const restoreDocument = defineOperator({
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
  apply({ tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'edit.restoreDocument runs in a transaction');
    const writes = applyRestorePlan(tx, planSnapshotRestore(restoreHostOf(tx), args.snapshot));
    return { writes };
  },
});

export const REVERT_OPERATORS: readonly AnyOperator[] = [revertSteps, restoreDocument];
