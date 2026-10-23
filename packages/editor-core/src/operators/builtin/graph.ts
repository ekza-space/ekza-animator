// Graph Editor operators (MVP-SPEC §4.9 `graph.*`, §4.11.3–§4.11.5); the time slider runs the key operators on its
// band's keys. Key-level operators act on the selected keys (and handles); curve-level ones on the curves of the
// selected keys, else of the selected channels, else of the selected controls, else on every curve of the active
// clip (workflows/targets). All edits go through the edit kernel.
import type { InfinityMode, TangentType } from '@ekza-studio/anim-core';
import type { CurveId } from '@ekza-studio/doc';
import { type EditorApp, GLOBAL_SCOPE, type OperatorContext } from '../../types';
import { selectedKeys, targetCurves } from '../../workflows/targets';
import {
  type AnyOperator,
  all,
  defineOperator,
  fail,
  isActorRun,
  isFiniteNumber,
  isRecord,
  OK,
  optionalArgs,
} from './define';
import { lazyBodies } from './lazyBodies';
import { pollClipEdit, pollEditable } from './polls';
import { pollScopedClipEdit, pollScopeTargets, scopedSelectedKeys, scopedTargetCurves } from './scoped';
import { actorScope } from '../scope';

/** The operators' apply bodies (this file keeps definitions and polls): every run's `prepare` (`lazyBodies`). */
const graphBodies = lazyBodies(() => import('./graphBodies'));

const TANGENT_TYPES: readonly TangentType[] = [
  'auto',
  'autoEase',
  'autoMix',
  'spline',
  'clamped',
  'plateau',
  'linear',
  'flat',
  'step',
  'stepNext',
  'fixed',
];
const INFINITY_MODES: readonly InfinityMode[] = ['constant', 'linear', 'cycle', 'cycleOffset', 'oscillate'];
const SIDES = ['both', 'in', 'out'] as const;

function pollSelectedKeys(app: EditorApp, keyPart: boolean) {
  const keys = selectedKeys(app);
  const any = keyPart ? keys.some((k) => k.parts.key) : keys.length > 0;
  return any ? OK : fail('No keys are selected');
}

function pollTargetCurves(app: EditorApp) {
  return targetCurves(app).some((curve) => !curve.locked) ? OK : fail('No curves to edit');
}

// MCP-SPEC §4.10: the scope-ready operators read their targets through the run (`scoped.ts`): the session for user
// runs (unchanged), the run scope for agent runs.

function pollScopedSelectedKeys(ctx: OperatorContext, keyPart: boolean) {
  const keys = scopedSelectedKeys(ctx);
  const any = keyPart ? keys.some((k) => k.parts.key) : keys.length > 0;
  return any ? OK : fail('No keys are selected');
}

function pollScopedTargetCurves(ctx: OperatorContext) {
  return scopedTargetCurves(ctx).some((curve) => !curve.locked) ? OK : fail('No curves to edit');
}

const tangentSet = defineOperator({
  id: 'graph.tangent.set',
  label: 'Set Tangents',
  description: 'Set the tangent type of the selected keys or handles (all keys of the shown curves when none).',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => `Tangents: ${String(args.type)}`,
  poll(ctx, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || !TANGENT_TYPES.includes(args['type'] as TangentType)) return fail('expects { type, side? }');
    if (args['side'] !== undefined && !SIDES.includes(args['side'] as (typeof SIDES)[number])) {
      return fail("side is 'both', 'in' or 'out'");
    }
    return all(
      pollEditable(ctx.app),
      pollScopeTargets(ctx),
      scopedSelectedKeys(ctx).length > 0 ? OK : pollScopedTargetCurves(ctx),
    );
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.tangentSet(ctx, args),
});

const tangentBreak = defineOperator({
  id: 'graph.tangent.break',
  label: 'Break Tangents',
  description: 'Let the in and out handles of the selected keys move independently.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: (ctx) => all(pollEditable(ctx.app), pollScopeTargets(ctx), pollScopedSelectedKeys(ctx, false)),
  prepare: graphBodies,
  apply: (ctx, _args, bodies) => bodies.tangentBreak(ctx),
});

const tangentUnify = defineOperator({
  id: 'graph.tangent.unify',
  label: 'Unify Tangents',
  description: 'Make the in and out handles of the selected keys collinear again (keeps the out angle).',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: (ctx) => all(pollEditable(ctx.app), pollScopeTargets(ctx), pollScopedSelectedKeys(ctx, false)),
  prepare: graphBodies,
  apply: (ctx, _args, bodies) => bodies.tangentUnify(ctx),
});

const setWeighted = defineOperator({
  id: 'graph.curve.setWeighted',
  label: 'Weighted Tangents',
  description: 'Make the selected curves weighted (handle lengths matter) or non-weighted.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => (args.weighted ? 'Weighted Tangents' : 'Non-weighted Tangents'),
  poll: (ctx, args) =>
    isRecord(args) && typeof args['weighted'] === 'boolean'
      ? all(pollEditable(ctx.app), pollScopeTargets(ctx), pollScopedTargetCurves(ctx))
      : fail('expects { weighted }'),
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.setWeighted(ctx, args),
});

const lockWeight = defineOperator({
  id: 'graph.tangent.lockWeight',
  label: 'Lock Tangent Weight',
  description: 'Lock (drags change only the angle) or free the tangent weights of the selected keys.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => (args.locked ? 'Lock Tangent Weight' : 'Free Tangent Weight'),
  poll: (ctx, args) =>
    isRecord(args) && typeof args['locked'] === 'boolean'
      ? all(
          pollEditable(ctx.app),
          pollScopeTargets(ctx),
          scopedSelectedKeys(ctx).length > 0 ? OK : pollScopedTargetCurves(ctx),
        )
      : fail('expects { locked }'),
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.lockWeight(ctx, args),
});

const infinitySet = defineOperator({
  id: 'graph.infinity.set',
  label: 'Infinity',
  description: 'Pre/post infinity of the selected curves: constant, linear, cycle, cycle with offset, oscillate.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Set Infinity',
  poll(ctx, raw) {
    const args: unknown = raw;
    if (!isRecord(args)) return fail('expects { pre?, post? }');
    const { pre, post } = args;
    if (pre === undefined && post === undefined) return fail('expects { pre?, post? }');
    for (const mode of [pre, post]) {
      if (mode !== undefined && !INFINITY_MODES.includes(mode as InfinityMode))
        return fail(`unknown infinity ${JSON.stringify(mode)}`);
    }
    return all(pollEditable(ctx.app), pollScopeTargets(ctx), pollScopedTargetCurves(ctx));
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.infinitySet(ctx, args),
});

const FIELD_NAMES = ['frame', 'value', 'inAngleDeg', 'outAngleDeg', 'inWeight', 'outWeight'] as const;

const setFields = defineOperator({
  id: 'graph.keys.setFields',
  label: 'Key Fields',
  description: 'Type the frame, value, tangent angles or weights of the selected keys.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: (args) =>
    args.frame !== undefined ? 'Move Key' : args.value !== undefined ? 'Set Key Value' : 'Edit Tangent',
  poll(ctx, args) {
    if (!isRecord(args)) return fail('expects key fields');
    const given = FIELD_NAMES.filter((name) => args[name] !== undefined);
    if (given.length === 0) return fail('expects at least one field');
    if (given.some((name) => !isFiniteNumber(args[name]))) return fail('fields must be finite numbers');
    if (args['relative'] !== undefined && typeof args['relative'] !== 'boolean')
      return fail('relative must be a boolean');
    return all(pollEditable(ctx.app), pollScopeTargets(ctx), pollScopedSelectedKeys(ctx, false));
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.setFields(ctx, args),
});

// ---------- moving, scaling, deleting, inserting ----------

const keysMove = defineOperator({
  id: 'graph.keys.move',
  label: 'Move Keys',
  description: 'Move the selected keys in time (frames) and value (display units); ripple shifts the later keys.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  poll({ app }, args) {
    if (!isRecord(args) || !isFiniteNumber(args['dFrames']) || !isFiniteNumber(args['dValue'])) {
      return fail('expects { dFrames, dValue, ripple? }');
    }
    if (args['ripple'] !== undefined && typeof args['ripple'] !== 'boolean') return fail('ripple must be a boolean');
    return all(pollEditable(app), pollSelectedKeys(app, true));
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.keysMove(ctx, args),
});

const keysScale = defineOperator({
  id: 'graph.keys.scale',
  label: 'Scale Keys',
  description:
    'Scale the selected keys in time around a pivot frame and in value around a value pivot (display units); ' +
    'ripple shifts the later keys.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  poll({ app }, args) {
    if (!isRecord(args) || !isFiniteNumber(args['pivot']) || !isFiniteNumber(args['factor']) || args['factor'] <= 0) {
      return fail('expects { pivot, factor > 0, ripple?, valuePivot?, valueFactor? }');
    }
    if (args['ripple'] !== undefined && typeof args['ripple'] !== 'boolean') return fail('ripple must be a boolean');
    const valueFactor = args['valueFactor'];
    const valuePivot = args['valuePivot'];
    if (valueFactor !== undefined && !isFiniteNumber(valueFactor)) return fail('valueFactor must be finite');
    if (valuePivot !== undefined && !isFiniteNumber(valuePivot)) return fail('valuePivot must be finite');
    return all(pollEditable(app), pollSelectedKeys(app, true));
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.keysScale(ctx, args),
});

const keysCopyTo = defineOperator({
  id: 'graph.keys.copyTo',
  label: 'Copy Keys',
  description: 'Copy the selected keys by a number of frames (keys already there are replaced).',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Copy Keys',
  poll({ app }, args) {
    if (!isRecord(args) || !isFiniteNumber(args['dFrames'])) return fail('expects { dFrames }');
    return all(pollEditable(app), pollSelectedKeys(app, true));
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.keysCopyTo(ctx, args),
});

const keysDelete = defineOperator({
  id: 'graph.keys.delete',
  label: 'Delete Keys',
  description: 'Delete the selected keys.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Delete Keys',
  poll: ({ app }) => all(pollEditable(app), pollSelectedKeys(app, true)),
  prepare: graphBodies,
  apply: (ctx, _args, bodies) => bodies.keysDelete(ctx),
});

const keyInsert = defineOperator({
  id: 'graph.key.insert',
  label: 'Insert Key',
  description: 'Insert a key on a curve without changing its shape.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  poll({ app }, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || typeof args['curve'] !== 'string' || !isFiniteNumber(args['frame'])) {
      return fail('expects { curve, frame }');
    }
    const curve = app.store.get('curves', args['curve'] as CurveId);
    if (curve === undefined) return fail('The curve does not exist');
    if (curve.locked) return fail('The curve is locked');
    return pollEditable(app);
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.keyInsert(ctx, args),
});

const keyCurves = defineOperator({
  id: 'graph.keys.keyCurves',
  label: 'Key Curves',
  description: 'Key the shown curves at the current frame without changing their shape.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Set Key',
  poll: ({ app }) => all(pollClipEdit(app), pollTargetCurves(app)),
  prepare: graphBodies,
  apply: (ctx, _args, bodies) => bodies.keyCurves(ctx),
});

const keysCopy = defineOperator({
  id: 'graph.keys.copy',
  label: 'Copy Keys',
  description: 'Copy the selected keys (with their tangents).',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => pollSelectedKeys(app, true),
  prepare: graphBodies,
  apply: (ctx, _args, bodies) => bodies.keysCopy(ctx),
});

const PASTE_MODES = ['merge', 'replace', 'insert'] as const;

const keysPaste = defineOperator({
  id: 'graph.keys.paste',
  label: 'Paste Keys',
  description:
    'Paste copied keys at the current frame onto the same controls and channels (insert: later keys make room).',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Paste Keys',
  poll({ app }, args) {
    const options = optionalArgs(args);
    const mode = options?.['mode'];
    if (options === null || (mode !== undefined && !PASTE_MODES.includes(mode as (typeof PASTE_MODES)[number]))) {
      return fail("expects { mode?: 'merge' | 'replace' | 'insert' }");
    }
    if (app.session.getState().clipboard.keys === null) return fail('There are no copied keys');
    return pollClipEdit(app);
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.keysPaste(ctx, args),
});

// ---------- Euler filter and Simplify ----------

const eulerFilter = defineOperator({
  id: 'graph.eulerFilter',
  label: 'Euler Filter',
  description: 'Remove rotation flips (2π jumps and the alternate Euler triple) from the rotation curves.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: (ctx) => all(pollScopedClipEdit(ctx), pollScopeTargets(ctx)),
  prepare: graphBodies,
  apply: (ctx, _args, bodies) => bodies.eulerFilter(ctx),
});

function reduceSpecProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'tolerance is { rotationRad, translationM, scale }';
  for (const field of ['rotationRad', 'translationM', 'scale'] as const) {
    const v = value[field];
    if (!isFiniteNumber(v) || v < 0) return `tolerance.${field} must be a non-negative number`;
  }
  return null;
}

/**
 * MCP-SPEC §5.5: Simplify measures every frame between a curve's first and last key, so an agent run poll-fails when
 * a target curve spans more than 100,000 frames (a synchronous loop cannot be interrupted). User runs are unchanged.
 */
function pollSimplifySpan(ctx: OperatorContext) {
  return isActorRun(ctx) ? actorScope().pollSimplifySpan(ctx) : OK;
}

const simplify = defineOperator({
  id: 'graph.curves.simplify',
  label: 'Simplify Curves',
  description: 'Remove keys while the curves stay within a tolerance of their current shape.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll(ctx, args) {
    const options = optionalArgs(args);
    if (options === null) return fail('expects { tolerance? }');
    const problem = reduceSpecProblem(options['tolerance']);
    if (problem !== null) return fail(problem);
    return all(pollEditable(ctx.app), pollScopeTargets(ctx), pollScopedTargetCurves(ctx), pollSimplifySpan(ctx));
  },
  prepare: graphBodies,
  apply: (ctx, args, bodies) => bodies.simplify(ctx, args),
});

export const GRAPH_OPERATORS: readonly AnyOperator[] = [
  // M2a (M2A-SPEC §5.9; A3)
  keysCopyTo,
  tangentSet,
  tangentBreak,
  tangentUnify,
  setWeighted,
  lockWeight,
  infinitySet,
  setFields,
  keysMove,
  keysScale,
  keysDelete,
  keyInsert,
  keyCurves,
  keysCopy,
  keysPaste,
  eulerFilter,
  simplify,
];
