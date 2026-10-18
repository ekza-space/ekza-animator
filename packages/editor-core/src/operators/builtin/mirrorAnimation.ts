// Mirror animation (M2A-SPEC §4.9 `pose.mirrorAnimation`, §5.14; A4): flip, left → right or right → left on the
// active clip, optionally half a cycle later; humanoid rigs only. One step, label `Mirror Animation`.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import { isHumanoidProgram, type MirrorMode } from '@ekza-animator/rig';
import { GLOBAL_SCOPE } from '../../types';
import { mirrorAnimation } from '../../workflows/mirrorAnimation';
import { activeClipRecord, selectedControls } from '../../workflows/targets';
import type { CountResult } from '../args';
import { type AnyOperator, all, defineOperator, fail, isRecord, OK } from './define';
import { activeRuntimeOf, pollClipEdit, pollRuntime } from './polls';

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
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'pose.mirrorAnimation runs in a transaction');
    const clip = activeClipRecord(app, tx);
    if (clip === undefined) return { count: 0 } satisfies CountResult;
    const controls = args.controls ?? selectedControls(app, tx).map((control) => control.id);
    const result = mirrorAnimation(app, tx, clip, {
      mode: args.mode,
      offset: args.offset ?? 'none',
      controls: controls.length > 0 ? controls : null,
    });
    if (result.warnings.length > 0) app.services.notify.toast({ kind: 'warning', text: result.warnings.join('; ') });
    return { count: result.count } satisfies CountResult;
  },
});

export const MIRROR_ANIMATION_OPERATORS: readonly AnyOperator[] = [mirrorAnimationOperator];
