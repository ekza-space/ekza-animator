// The one-shot tween (M2A-SPEC §4.9 `key.tween`, §5.13; A4): menus, scripts and preset buttons run it; the Tween bar's
// slider uses the gesture form (`beginTweenGesture`). One step per run.
import { EkzaError } from '@ekza-studio/anim-core';
import {
  applyTweenPlan,
  clampTweenAmount,
  dropPlannedOverrides,
  planTween,
  resolveTweenTarget,
  TWEEN_MODES,
} from '../../edit/tween';
import { GLOBAL_SCOPE, type TweenMode } from '../../types';
import type { CountResult } from '../args';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK } from './define';
import { pollClipEdit } from './polls';

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
  return null;
}

const keyTween = defineOperator({
  id: 'key.tween',
  label: 'Tween',
  description: 'Tween, blend to a neighbour, ease, push/pull or blend to the default, on the pose or selected keys.',
  category: 'key',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => TWEEN_MODE_LABELS[args.mode] ?? 'Tween',
  poll({ app }, raw) {
    const problem = argsProblem(raw);
    if (problem !== null) return fail(problem);
    const base = pollClipEdit(app);
    if (base !== true) return base;
    const args = raw as { readonly target?: 'frame' | 'keys' };
    const resolved = resolveTweenTarget(app, args.target);
    if (planTween(app, resolved.target).entries.length > 0) return OK;
    return fail(
      resolved.kind === 'keys'
        ? 'Nothing to tween: the selected keys need unselected keys before and after them'
        : `Nothing to tween: no keyed channel has keys before and after ${resolved.label.replace('Pose @ ', '')}`,
    );
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'key.tween runs in a transaction');
    const resolved = resolveTweenTarget(app, args.target);
    const plan = planTween(app, resolved.target);
    const amount = clampTweenAmount(args.amount, app.prefs.getState().tweenOvershoot);
    const count = applyTweenPlan(app, tx, plan, args.mode, amount, { breakdown: args.breakdown !== false });
    // Keyed channels leave the overrides (§4.11.1 rule 5), as after `key.set`.
    dropPlannedOverrides(app, plan);
    return { count } satisfies CountResult;
  },
});

export const TWEEN_OPERATORS: readonly AnyOperator[] = [keyTween];
