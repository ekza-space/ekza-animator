// The one-shot tween (M2A-SPEC §4.9 `key.tween`, §5.13; A4): menus, scripts and preset buttons run it; the Tween bar's
// slider uses the gesture form (`beginTweenGesture`). One step per run.
//
// MCP-SPEC §4.10 (P1): `frames` tweens and keys the pose at each of those clip frames on the run's controls (or the
// controls of its selected keys) from the keyed values, never the playhead or the overrides (user and agent runs
// alike); agent runs read their run scope (keys, controls, channels and clip) and never write the session.
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import {
  applyTweenPlan,
  clampTweenAmount,
  dropPlannedOverrides,
  planTween,
  resolveTweenTarget,
  TWEEN_MODES,
  type TweenPlan,
} from '../../edit/tween';
import { selectionOf } from '../scope';
import { type EditorApp, GLOBAL_SCOPE, type OperatorContext, type TweenMode } from '../../types';
import type { CountResult } from '../args';
import { framesProblem } from './agentLoad';
import { type AnyOperator, defineOperator, fail, isActorRun, isFiniteNumber, isRecord, OK } from './define';
import {
  pollScopedClipEdit,
  pollScopeTargets,
  scopedClipRecord,
  scopedSelectedKeyIds,
  scopedSelectedKeys,
} from './scoped';

/** Labels of the modes (menus, history steps). */
export const TWEEN_MODE_LABELS: Readonly<Record<TweenMode, string>> = {
  tween: 'Tween',
  neighbor: 'Blend to Neighbour',
  ease: 'Ease',
  pushPull: 'Push/Pull',
  toDefault: 'Blend to Default',
};

function argsProblem(raw: unknown): string | null {
  if (!isRecord(raw)) return 'expects { mode, amount, target?, breakdown? }';
  if (!TWEEN_MODES.includes(raw['mode'] as TweenMode)) return `mode is one of ${TWEEN_MODES.join(', ')}`;
  if (!isFiniteNumber(raw['amount'])) return 'amount must be a finite number';
  const target = raw['target'];
  if (target !== undefined && target !== 'frame' && target !== 'keys') return "target is 'frame' or 'keys'";
  if (raw['breakdown'] !== undefined && typeof raw['breakdown'] !== 'boolean') return 'breakdown must be a boolean';
  if (raw['frames'] !== undefined) return framesProblem(raw['frames'], 'frames');
  return null;
}

interface TweenArgs {
  readonly target?: 'frame' | 'keys';
  readonly frames?: readonly Frame[];
}

/** What one run tweens: its plans (one per frame with `frames`), or why there is nothing to plan. */
interface RunPlan {
  readonly plans: readonly TweenPlan[];
  readonly empty: string;
}

function frameList(frames: readonly Frame[]): string {
  const shown = frames.slice(0, 5).map((frame) => `f${frame}`);
  return frames.length > 5 ? `${shown.join(', ')}, …` : shown.join(', ');
}

/** The controls a `frames` tween keys: the run's controls, else the controls of its selected keys. */
function frameControls(ctx: OperatorContext): readonly ControlId[] {
  const controls = selectionOf(ctx).controls;
  if (controls.length > 0) return controls;
  const out: ControlId[] = [];
  for (const { key } of scopedSelectedKeys(ctx)) {
    const control = ctx.app.store.get('curves', key.curve)?.control;
    if (control !== undefined && !out.includes(control)) out.push(control);
  }
  return out;
}

/** The plans of one run (reads the committed document and, for user runs without `frames`, the session). */
function runPlan(ctx: OperatorContext, args: TweenArgs): RunPlan | string {
  const { app } = ctx;
  if (args.frames !== undefined) {
    const selection = selectionOf(ctx);
    const clip = scopedClipRecord(ctx);
    const base = {
      kind: 'frame' as const,
      controls: frameControls(ctx),
      channels: selection.channels.length > 0 ? selection.channels : null,
      ...(clip === undefined ? {} : { clip: clip.id }),
      // §4.10: with `frames` the playhead is not read, so no run reads the overrides of the current frame.
      keyed: true,
    };
    const frames = [...new Set(args.frames)];
    return {
      plans: frames.map((frame) => planTween(app, { ...base, frame })),
      empty: `Nothing to tween: no keyed channel has keys before and after ${frameList(frames)}`,
    };
  }
  if (isActorRun(ctx)) {
    if (args.target === 'frame') return 'An agent tween at a pose needs frames (the playhead is the user’s)';
    const plan = planTween(app, { kind: 'keys', keys: scopedSelectedKeyIds(ctx) });
    return { plans: [plan], empty: 'Nothing to tween: the selected keys need unselected keys before and after them' };
  }
  const resolved = resolveTweenTarget(app, args.target);
  return {
    plans: [planTween(app, resolved.target)],
    empty:
      resolved.kind === 'keys'
        ? 'Nothing to tween: the selected keys need unselected keys before and after them'
        : `Nothing to tween: no keyed channel has keys before and after ${resolved.label.replace('Pose @ ', '')}`,
  };
}

function pollRunPlan(ctx: OperatorContext, args: TweenArgs) {
  const plan = runPlan(ctx, args);
  if (typeof plan === 'string') return fail(plan);
  return plan.plans.some((p) => p.entries.length > 0) ? OK : fail(plan.empty);
}

/**
 * Keyed channels leave the overrides (§4.11.1 rule 5) on the shipped path only: a user run at the playhead. A run with
 * `frames` never reads the playhead, so it neither reads nor drops the overrides (a key it writes at the user's frame
 * shows once the frame changes, like any key written under an override).
 */
function dropOverrides(app: EditorApp, ctx: OperatorContext, args: TweenArgs, plans: readonly TweenPlan[]): void {
  if (isActorRun(ctx) || args.frames !== undefined) return;
  for (const plan of plans) dropPlannedOverrides(app, plan);
}

const keyTween = defineOperator({
  id: 'key.tween',
  label: 'Tween',
  description: 'Tween, blend to a neighbour, ease, push/pull or blend to the default, on the pose or selected keys.',
  category: 'key',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => TWEEN_MODE_LABELS[args.mode] ?? 'Tween',
  poll(ctx, raw) {
    const problem = argsProblem(raw);
    if (problem !== null) return fail(problem);
    const base = pollScopedClipEdit(ctx);
    if (base !== true) return base;
    const scoped = pollScopeTargets(ctx);
    if (scoped !== true) return scoped;
    return pollRunPlan(ctx, raw as TweenArgs);
  },
  apply(ctx, args) {
    const { app, tx } = ctx;
    if (tx === null) throw new EkzaError('internal', 'key.tween runs in a transaction');
    const plan = runPlan(ctx, args);
    if (typeof plan === 'string') throw new EkzaError('unsupported', plan);
    const amount = clampTweenAmount(args.amount, app.prefs.getState().tweenOvershoot);
    let count = 0;
    for (const p of plan.plans)
      count += applyTweenPlan(app, tx, p, args.mode, amount, { breakdown: args.breakdown !== false });
    // Keyed channels leave the overrides (§4.11.1 rule 5), as after `key.set`.
    dropOverrides(app, ctx, args, plan.plans);
    return { count } satisfies CountResult;
  },
});

export const TWEEN_OPERATORS: readonly AnyOperator[] = [keyTween];
