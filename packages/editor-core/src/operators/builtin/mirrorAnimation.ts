// Mirror animation (M2A-SPEC §4.9 `pose.mirrorAnimation`, §5.14; A4): flip, left → right or right → left on the
// active clip, optionally half a cycle later; humanoid rigs only. One step, label `Mirror Animation`. The workflow
// loads with the first run (`prepare`, the eager-route budget §5.27); the runner polls again after it.
// MCP-SPEC §4.10 (P1): agent runs mirror the run scope's clip and controls (`controls` argument first, else the
// scope's controls or its keys' and channels' controls), never the user's selection or active clip.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ControlId } from '@ekza-studio/doc';
import { isHumanoidProgram, type MirrorMode } from '@ekza-studio/rig';
import { scopedCharacterOf } from '../scope';
import { type CharacterRuntime, GLOBAL_SCOPE, type OperatorContext } from '../../types';
import type * as MirrorWorkflow from '../../workflows/mirrorAnimation';
import type { CountResult } from '../args';
import { type AnyOperator, all, defineOperator, fail, isActorRun, isRecord, OK } from './define';
import { pollRuntime } from './polls';
import { NO_TARGETS, pollScopedClipEdit, scopedClipRecord, scopedTargetControls } from './scoped';

type MirrorWorkflowModule = typeof MirrorWorkflow;

let loading: Promise<MirrorWorkflowModule> | null = null;

/** Loads the Mirror Animation workflow once; a failed load is forgotten so the next run tries again. */
function loadMirrorWorkflow(): Promise<MirrorWorkflowModule> {
  if (loading === null) {
    const attempt = import('../../workflows/mirrorAnimation');
    loading = attempt;
    attempt.catch(() => {
      if (loading === attempt) loading = null;
    });
  }
  return loading;
}

const MODES: readonly MirrorMode[] = ['flip', 'leftToRight', 'rightToLeft'];

function argsProblem(raw: unknown): string | null {
  if (!isRecord(raw) || !MODES.includes(raw['mode'] as MirrorMode)) {
    return `expects { mode: ${MODES.join(' | ')}, offset?, controls? }`;
  }
  const offset = raw['offset'];
  if (offset !== undefined && offset !== 'none' && offset !== 'halfCycle') return "offset is 'none' or 'halfCycle'";
  const controls = raw['controls'];
  if (
    controls !== undefined &&
    (!Array.isArray(controls) || !(controls as readonly unknown[]).every((c) => typeof c === 'string'))
  ) {
    return 'controls must be control ids';
  }
  return null;
}

/** The runtime of the run's character (the active one for user runs, the scope's for agents). */
function runtimeOfRun(ctx: OperatorContext): CharacterRuntime | undefined {
  const character = scopedCharacterOf(ctx);
  return character === null ? undefined : ctx.app.characters.get(character);
}

function pollRunRuntime(ctx: OperatorContext) {
  if (!isActorRun(ctx)) return pollRuntime(ctx.app);
  return runtimeOfRun(ctx) === undefined ? fail('The character is still loading') : OK;
}

const mirrorAnimationOperator = defineOperator({
  id: 'pose.mirrorAnimation',
  label: 'Mirror Animation',
  description:
    'Mirror the animation of the controls (flip, left to right or right to left), optionally half a cycle later.',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Mirror Animation',
  poll(ctx, raw) {
    const { app } = ctx;
    const problem = argsProblem(raw);
    if (problem !== null) return fail(problem);
    const base = all(pollScopedClipEdit(ctx), pollRunRuntime(ctx));
    if (base !== true) return base;
    const runtime = runtimeOfRun(ctx);
    if (runtime === undefined || !isHumanoidProgram(runtime.program)) return fail('Mirror needs a humanoid rig');
    const args = raw as { readonly offset?: string; readonly controls?: readonly ControlId[] };
    if (args.offset === 'halfCycle' && scopedClipRecord(ctx)?.loop !== true) {
      return fail('Half-cycle mirroring needs a loop clip (Clip settings › Loop)');
    }
    if (args.controls !== undefined && args.controls.some((id) => app.store.get('controls', id) === undefined)) {
      return fail('Unknown control');
    }
    // Agent runs never fall back to "the whole character": they name controls (argument or scope).
    if (isActorRun(ctx) && (args.controls ?? scopedTargetControls(ctx)).length === 0) return fail(NO_TARGETS);
    return OK;
  },
  prepare: loadMirrorWorkflow,
  apply(ctx, args, workflow) {
    const { app, tx } = ctx;
    if (tx === null) throw new EkzaError('internal', 'pose.mirrorAnimation runs in a transaction');
    const clip = scopedClipRecord(ctx, tx);
    if (clip === undefined) return { count: 0 } satisfies CountResult;
    const controls = args.controls ?? scopedTargetControls(ctx, tx).map((control) => control.id);
    const result = workflow.mirrorAnimation(app, tx, clip, {
      mode: args.mode,
      offset: args.offset ?? 'none',
      controls: controls.length > 0 ? controls : null,
    });
    if (result.warnings.length > 0) app.services.notify.toast({ kind: 'warning', text: result.warnings.join('; ') });
    return { count: result.count } satisfies CountResult;
  },
});

export const MIRROR_ANIMATION_OPERATORS: readonly AnyOperator[] = [mirrorAnimationOperator];
