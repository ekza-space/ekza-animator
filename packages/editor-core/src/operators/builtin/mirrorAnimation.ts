// Mirror animation (M2A-SPEC §4.9 `pose.mirrorAnimation`, §5.14; A4): flip, left → right or right → left on the
// active clip, optionally half a cycle later; humanoid rigs only. One step, label `Mirror Animation`. The workflow
// loads with the first run (`prepare`, the eager-route budget §5.27); the runner polls again after it.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ControlId } from '@ekza-studio/doc';
import { isHumanoidProgram, type MirrorMode } from '@ekza-studio/rig';
import { GLOBAL_SCOPE } from '../../types';
import type * as MirrorWorkflow from '../../workflows/mirrorAnimation';
import { activeClipRecord, selectedControls } from '../../workflows/targets';
import type { CountResult } from '../args';
import { type AnyOperator, all, defineOperator, fail, isRecord, OK } from './define';
import { activeRuntimeOf, pollClipEdit, pollRuntime } from './polls';

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

const mirrorAnimationOperator = defineOperator({
  id: 'pose.mirrorAnimation',
  label: 'Mirror Animation',
  description:
    'Mirror the animation of the controls (flip, left to right or right to left), optionally half a cycle later.',
  category: 'pose',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Mirror Animation',
  poll({ app }, raw) {
    const problem = argsProblem(raw);
    if (problem !== null) return fail(problem);
    const base = all(pollClipEdit(app), pollRuntime(app));
    if (base !== true) return base;
    const runtime = activeRuntimeOf(app);
    if (runtime === undefined || !isHumanoidProgram(runtime.program)) return fail('Mirror needs a humanoid rig');
    const args = raw as { readonly offset?: string; readonly controls?: readonly ControlId[] };
    if (args.offset === 'halfCycle' && activeClipRecord(app)?.loop !== true) {
      return fail('Half-cycle mirroring needs a loop clip (Clip settings › Loop)');
    }
    if (args.controls !== undefined && args.controls.some((id) => app.store.get('controls', id) === undefined)) {
      return fail('Unknown control');
    }
    return OK;
  },
  prepare: loadMirrorWorkflow,
  apply({ app, tx }, args, workflow) {
    if (tx === null) throw new EkzaError('internal', 'pose.mirrorAnimation runs in a transaction');
    const clip = activeClipRecord(app, tx);
    if (clip === undefined) return { count: 0 } satisfies CountResult;
    const controls = args.controls ?? selectedControls(app, tx).map((control) => control.id);
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
