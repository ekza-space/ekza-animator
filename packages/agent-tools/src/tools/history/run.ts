// History tools (MCP-SPEC §6.9, §5.13): history_checkpoint records the newest undo step and the document version under
// a `cp_…` handle (one labelled checkpoint per user request) and lists recent steps with who made them;
// history_revert takes back this actor's steps since a checkpoint (or given steps) — plain undos when they are exactly
// the top of the undo stack, else one `edit.revertSteps` step that skips what the user changed since — never touching
// the user's steps unless `includeUserSteps` (confirmed).
import type { HistoryStep } from '@ekza-animator/editor-core';
import { failureFromEkza } from '../../envelope/errors';
import { actorRevisionsOf, runtimeStateOf } from '../../runtime/runtime';
import { valueOf, undoOf } from '../../runtime/toolkit';
import { sanitizeText } from '../../sanitize/sanitize';
import { AgentToolFailure, type AgentToolContext, type AgentToolResult, type ConfirmPrompt } from '../../types';
import { actorKindOf } from '../scene/summary';
import { EkzaError } from '@ekza-animator/anim-core';

/** Checkpoints kept per runtime (oldest dropped). */
export const CHECKPOINTS_MAX = 200;
const LABEL_MAX = 60;

export interface HistoryCheckpointArgs {
  readonly label?: string | undefined;
  readonly list: boolean;
  readonly limit: number;
}

export function historyCheckpoint(
  ctx: AgentToolContext,
  args: HistoryCheckpointArgs,
): Promise<AgentToolResult<unknown>> {
  const state = runtimeStateOf(ctx);
  const { undo, redo } = ctx.app.history.entries();
  const stepId = undo.at(-1)?.id ?? 0;
  const label = args.label === undefined ? null : sanitizeText(args.label, { maxChars: LABEL_MAX, kind: 'name' });
  const id = state.handle('cp');
  state.checkpoints.set(id, { id, label, stepId, docVersion: ctx.app.store.version, at: Date.now() });
  while (state.checkpoints.size > CHECKPOINTS_MAX) {
    const oldest = state.checkpoints.keys().next().value;
    if (oldest === undefined) break;
    state.checkpoints.delete(oldest);
  }
  const data: Record<string, unknown> = { checkpoint: id, step: stepId, docVersion: ctx.app.store.version };
  if (args.list) {
    const chronological: { step: HistoryStep; undone: boolean }[] = [
      ...undo.map((step) => ({ step, undone: false })),
      ...redo.map((step) => ({ step, undone: true })),
    ];
    data['steps'] = chronological.slice(-args.limit).map(({ step, undone }) => ({
      step: step.id,
      label: step.label,
      actor: actorKindOf(step, ctx.actor),
      undone,
    }));
    data['checkpoints'] = [...state.checkpoints.values()].map((cp) => ({
      checkpoint: cp.id,
      label: cp.label,
      step: cp.stepId,
    }));
  }
  return Promise.resolve({ ok: true, data });
}

export interface HistoryRevertArgs {
  readonly to?: string | undefined;
  readonly steps?: readonly number[] | undefined;
  readonly includeUserSteps: boolean;
  readonly dryRun: boolean;
  readonly confirm?: boolean | undefined;
}

interface RevertPlan {
  readonly mode: 'undo' | 'revert' | 'none';
  /** Steps to take back, oldest first. */
  readonly targets: readonly HistoryStep[];
  readonly alreadyUndone: readonly number[];
  readonly unreachable: readonly number[];
  /** includeUserSteps: the user's (and other agents') steps the undo takes back too. */
  readonly others: readonly HistoryStep[];
}

const isMine = (ctx: AgentToolContext, step: HistoryStep): boolean => step.actor?.id === ctx.actor.id;

/** What history_revert would do (§5.13): the target steps and the mode. */
export function planRevert(ctx: AgentToolContext, args: HistoryRevertArgs): RevertPlan {
  const state = runtimeStateOf(ctx);
  const { undo, redo } = ctx.app.history.entries();
  const known = new Set([...undo, ...redo].map((step) => step.id));
  if (args.to !== undefined) {
    const cp = state.checkpoints.get(args.to);
    if (cp === undefined) {
      throw new AgentToolFailure(
        'expired_handle',
        'The checkpoint is unknown or expired.',
        'history_checkpoint {list: true} lists the checkpoints of this session',
      );
    }
    const unreachable = state.ownSteps.filter((id) => id > cp.stepId && !known.has(id));
    const alreadyUndone = redo.filter((step) => step.id > cp.stepId && isMine(ctx, step)).map((step) => step.id);
    const above = undo.filter((step) => step.id > cp.stepId);
    if (args.includeUserSteps) {
      return {
        mode: above.length === 0 ? 'none' : 'undo',
        targets: above,
        alreadyUndone,
        unreachable,
        others: above.filter((step) => !isMine(ctx, step)),
      };
    }
    const targets = above.filter((step) => isMine(ctx, step));
    return { mode: modeOf(undo, targets), targets, alreadyUndone, unreachable, others: [] };
  }
  if (args.includeUserSteps) {
    throw new AgentToolFailure(
      'invalid_args',
      'includeUserSteps works with a checkpoint (to), not with steps.',
      'pass to: the checkpoint to undo back to',
      { detail: { path: 'includeUserSteps' } },
    );
  }
  const targets: HistoryStep[] = [];
  const alreadyUndone: number[] = [];
  const unreachable: number[] = [];
  for (const id of new Set(args.steps ?? [])) {
    const inUndo = undo.find((step) => step.id === id);
    const inRedo = inUndo === undefined ? redo.find((step) => step.id === id) : undefined;
    const step = inUndo ?? inRedo;
    if (step === undefined) {
      if (state.ownSteps.includes(id)) {
        unreachable.push(id);
        continue;
      }
      throw new AgentToolFailure(
        'invalid_args',
        `Step ${id} is not in the history.`,
        'history_checkpoint {list: true} lists the steps',
        {
          detail: { path: 'steps' },
        },
      );
    }
    if (!isMine(ctx, step)) {
      throw new AgentToolFailure(
        'invalid_args',
        `Step ${id} is not yours (${step.actor === null || step.actor === undefined ? 'the user' : 'another agent'} made it).`,
        'history_revert takes back your own steps only; ask the user about theirs',
        { detail: { path: 'steps' } },
      );
    }
    if (inRedo !== undefined) alreadyUndone.push(id);
    else targets.push(step);
  }
  targets.sort((a, b) => a.id - b.id);
  return { mode: modeOf(undo, targets), targets, alreadyUndone, unreachable, others: [] };
}

/** Plain undos when the targets are exactly the top of the undo stack, else a selective revert. */
function modeOf(undo: readonly HistoryStep[], targets: readonly HistoryStep[]): 'undo' | 'revert' | 'none' {
  if (targets.length === 0) return 'none';
  const top = undo.slice(-targets.length);
  return top.every((step, i) => step.id === targets[i]?.id) ? 'undo' : 'revert';
}

/** history_revert {includeUserSteps} is consequential: the user's own steps go too (§5.9). */
export function revertConfirm(ctx: AgentToolContext, args: HistoryRevertArgs): ConfirmPrompt | null {
  if (!args.includeUserSteps || args.dryRun) return null;
  const plan = planRevert(ctx, args);
  if (plan.others.length === 0) return null;
  const labels = plan.others
    .slice(-5)
    .map((step) => step.label)
    .join('; ');
  return {
    title: `AI wants to undo ${plan.others.length} of your steps`,
    detail: `${labels}${plan.others.length > 5 ? '; …' : ''}. Redo brings them back.`,
    danger: true,
  };
}

export async function historyRevert(ctx: AgentToolContext, args: HistoryRevertArgs): Promise<AgentToolResult<unknown>> {
  const plan = planRevert(ctx, args);
  const base = {
    alreadyUndone: [...plan.alreadyUndone],
    unreachable: [...plan.unreachable],
    dryRun: args.dryRun,
  };
  const next =
    plan.unreachable.length > 0
      ? `${plan.unreachable.length} of your steps left the undo history and cannot be reverted; only the user's "Restore the project as it was before the agent" (or reopening the saved file) gets back past them.`
      : undefined;
  const withNext = <T>(result: AgentToolResult<T>): AgentToolResult<T> =>
    next === undefined || !result.ok ? result : { ...result, next };
  if (args.dryRun || plan.mode === 'none') {
    return withNext({
      ok: true,
      data: { mode: plan.mode, reverted: plan.targets.map((step) => step.id), skippedFields: [], ...base },
    });
  }
  ctx.focus({ character: null, clip: null, controls: [], frame: null }, `Revert ${plan.targets.length} AI steps`);
  if (plan.mode === 'undo') {
    // Navigations, no new step (§5.6): wait for the user's drag like any edit (the history refuses during a preview).
    const state = runtimeStateOf(ctx);
    if (ctx.app.store.preview?.active === true) ctx.progress(0, null, 'waiting for your drag to finish');
    if (!(await ctx.host.waitForGesture(ctx.signal, state.gestureWaitMs))) {
      throw new AgentToolFailure('busy', 'The user kept dragging; nothing was undone.', 'retry in a moment', {
        retryable: true,
      });
    }
    if (ctx.signal.aborted) {
      throw new AgentToolFailure('cancelled', 'The call was cancelled before anything was undone.', 'nothing changed');
    }
    const reverted: number[] = [];
    const warnings: string[] = [];
    const revisions = actorRevisionsOf(ctx);
    for (const step of [...plan.targets].reverse()) {
      if (ctx.app.history.peekUndo()?.id !== step.id) break;
      let result;
      try {
        result = revisions.runOwn(() => ctx.app.history.undo());
      } catch (error) {
        if (error instanceof EkzaError && error.code === 'preview-active') {
          throw new AgentToolFailure('busy', 'The user started dragging; the undo stopped.', 'retry in a moment', {
            retryable: true,
            detail: { reverted },
          });
        }
        throw error instanceof EkzaError ? failureFromEkza(error) : error;
      }
      if (result === null) break;
      reverted.push(step.id);
      warnings.push(...result.warnings);
    }
    return withNext({
      ok: true,
      data: { mode: 'undo', reverted, skippedFields: [], ...base },
      ...(warnings.length === 0 ? {} : { warnings }),
    });
  }
  const run = await ctx.run('edit.revertSteps', { steps: plan.targets.map((step) => step.id) });
  const value = valueOf<{
    readonly reverted: readonly number[];
    readonly skipped: readonly { readonly step: number; readonly reason: string }[];
    readonly skippedFields: readonly {
      readonly table: string;
      readonly id: string;
      readonly fields: readonly string[] | null;
    }[];
  }>('edit.revertSteps', run);
  const skippedSteps = value.skipped.map((skip) => `step ${skip.step}: ${skip.reason}`);
  return withNext({
    ok: true,
    data: {
      mode: 'revert',
      reverted: [...value.reverted],
      skippedFields: value.skippedFields.slice(0, 60).map((field) => ({
        record: `${field.table}:${field.id}`,
        fields: field.fields === null ? null : [...field.fields],
      })),
      ...base,
    },
    ...undoOf(run),
    ...(skippedSteps.length + run.warnings.length === 0 ? {} : { warnings: [...skippedSteps, ...run.warnings] }),
  });
}
