// Graph Editor operators (MVP-SPEC §4.9 `graph.*`, §4.11.3–§4.11.5); the time slider runs the key operators on its
// band's keys. Key-level operators act on the selected keys (and handles); curve-level ones on the curves of the
// selected keys, else of the selected channels, else of the selected controls, else on every curve of the active
// clip (workflows/targets). All edits go through the edit kernel.
import {
  type AnimCurve,
  EkzaError,
  eulerFilterCurves,
  type Fps,
  type Handle,
  handleFromFields,
  type InfinityMode,
  type KeyData,
  RAD2DEG,
  reduceKeys,
  type TangentType,
  tangentFields,
} from '@ekza-studio/anim-core';
import type { ChannelId, ControlId, CurveId, CurveRecord, KeyId, KeyRecord, Tx } from '@ekza-studio/doc';
import { DEFAULT_REDUCE, type ReduceSpec } from '@ekza-studio/rig';
import { EDITOR_CURVE_OPTIONS } from '../../app/deps';
import { channelUnit, isRotation } from '../../edit/channelMeta';
import { animCurve, compileInTx, currentClipFrame, keyDataOf } from '../../edit/context';
import {
  copyKeys as copyKeysInTime,
  deleteKeys,
  insertKeyOnCurve,
  moveKeys,
  scaleKeys,
  setKeyHandle,
  setTangentTypes,
} from '../../edit/keys';
import { scaleKeyValues } from '../../edit/valueScale';
import { type RippleScope, rippleControls, rippleCurves, rippleScopeOf } from '../../edit/ripple';
import { toDisplayValue } from '../../edit/numeric';
import {
  type EditorApp,
  GLOBAL_SCOPE,
  type KeyEditOptions,
  type KeyPartSelection,
  type OperatorContext,
  PANEL,
  type PanelKind,
} from '../../types';
import { copyKeys, pasteKeys } from '../../workflows/keyClipboard';
import { keyRecord } from '../../workflows/records';
import {
  activeClipRecord,
  baseCurves,
  curveOf,
  keysOfCurves,
  selectedKeyIds,
  selectedKeys,
  targetCurves,
} from '../../workflows/targets';
import { constantCurve } from '../../workflows/util';
import type { KeyFieldsArgs } from '../args';
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
  panelOf,
} from './define';
import { pollClipEdit, pollEditable } from './polls';
import {
  forgetScopedKeys,
  pollScopedClipEdit,
  pollScopeTargets,
  scopedClipRecord,
  scopedSelectedKeyIds,
  scopedSelectedKeys,
  scopedTargetControls,
  scopedTargetCurves,
  selectScopedKeysOnly,
  snapOf,
} from './scoped';
import { AGENT_SPAN_LIMIT } from './agentLoad';

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
/** Computed types that resolve one slope for both sides of a key (unifying needs no handles). */
const SMOOTH: ReadonlySet<TangentType> = new Set([
  'auto',
  'autoEase',
  'autoMix',
  'spline',
  'clamped',
  'flat',
  'plateau',
]);
const INFINITY_MODES: readonly InfinityMode[] = ['constant', 'linear', 'cycle', 'cycleOffset', 'oscillate'];
const SIDES = ['both', 'in', 'out'] as const;

function keyEdit(app: EditorApp) {
  return { snap: app.session.getState().time.snapToFrames, resolveCollisions: true } as const;
}

function txOf(tx: Tx | null, id: string): Tx {
  if (tx === null) throw new EkzaError('internal', `${id} runs in a transaction`);
  return tx;
}

/** Drops deleted keys from the key selection. */
function forgetKeys(app: EditorApp, deleted: readonly KeyId[]): void {
  if (deleted.length === 0) return;
  const selection = app.session.getState().selection;
  if (!deleted.some((id) => selection.keys.has(id))) return;
  const keys = new Map(selection.keys);
  for (const id of deleted) keys.delete(id);
  app.session.setState({ selection: { ...selection, keys } });
}

function selectOnly(app: EditorApp, ids: readonly KeyId[]): void {
  const selection = app.session.getState().selection;
  const keys = new Map<KeyId, KeyPartSelection>(ids.map((id) => [id, { key: true, in: false, out: false }]));
  app.session.setState({ selection: { ...selection, keys } });
}

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

/** Keys to change per side for `graph.tangent.set` (§4.11.4 editing rules). */
function tangentTargets(
  ctx: OperatorContext,
  tx: Tx,
  side: 'both' | 'in' | 'out' | undefined,
): Map<'both' | 'in' | 'out', KeyId[]> {
  const groups = new Map<'both' | 'in' | 'out', KeyId[]>();
  const add = (s: 'both' | 'in' | 'out', id: KeyId): void => {
    const group = groups.get(s);
    if (group === undefined) groups.set(s, [id]);
    else group.push(id);
  };
  const selected = scopedSelectedKeys(ctx, tx);
  if (selected.length > 0) {
    for (const { key, parts } of selected) {
      if (parts.key) add(side ?? 'both', key.id);
      else add(parts.in && parts.out ? 'both' : parts.in ? 'in' : 'out', key.id);
    }
  } else {
    for (const id of keysOfCurves(tx, scopedTargetCurves(ctx, tx))) add(side ?? 'both', id);
  }
  return groups;
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
  apply(ctx, args) {
    const { app } = ctx;
    const t = txOf(ctx.tx, 'graph.tangent.set');
    for (const [side, ids] of tangentTargets(ctx, t, args.side)) setTangentTypes(app, t, ids, args.type, side);
  },
});

const tangentBreak = defineOperator({
  id: 'graph.tangent.break',
  label: 'Break Tangents',
  description: 'Let the in and out handles of the selected keys move independently.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: (ctx) => all(pollEditable(ctx.app), pollScopeTargets(ctx), pollScopedSelectedKeys(ctx, false)),
  apply(ctx) {
    const t = txOf(ctx.tx, 'graph.tangent.break');
    for (const { key } of scopedSelectedKeys(ctx, t)) {
      if (key.broken || t.get('curves', key.curve)?.locked === true) continue;
      t.put('keys', { ...key, broken: true });
    }
  },
});

/** Resolved handles of a key (the curve engine's), by key id. */
function resolvedHandles(app: EditorApp, tx: Tx, curve: CurveRecord, key: KeyId): { in: Handle; out: Handle } | null {
  const { keys, compiled } = compileInTx(app, tx, curve);
  const i = keys.findIndex((k) => k.id === key);
  if (i === -1) return null;
  return {
    in: { dt: compiled.inDt[i] as number, dv: compiled.inDv[i] as number },
    out: { dt: compiled.outDt[i] as number, dv: compiled.outDv[i] as number },
  };
}

const tangentUnify = defineOperator({
  id: 'graph.tangent.unify',
  label: 'Unify Tangents',
  description: 'Make the in and out handles of the selected keys collinear again (keeps the out angle).',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: (ctx) => all(pollEditable(ctx.app), pollScopeTargets(ctx), pollScopedSelectedKeys(ctx, false)),
  apply(ctx) {
    const { app } = ctx;
    const t = txOf(ctx.tx, 'graph.tangent.unify');
    for (const { key: selected } of scopedSelectedKeys(ctx, t)) {
      const key = t.get('keys', selected.id);
      const curve = key === undefined ? undefined : t.get('curves', key.curve);
      if (key === undefined || curve === undefined || curve.locked || !key.broken) continue;
      t.put('keys', { ...key, broken: false });
      // Sides that already share one computed slope (auto, spline, flat, …) or a stepped out side need no handles.
      const stepped = key.outType === 'step' || key.outType === 'stepNext';
      if (stepped || (key.inType === key.outType && SMOOTH.has(key.inType))) continue;
      const handles = resolvedHandles(app, t, curve, key.id);
      // The out handle keeps its angle; the in handle turns collinear and keeps its length (setKeyHandle rules).
      if (handles !== null) setKeyHandle(app, t, key.id, 'out', handles.out, { tempBreak: false });
    }
  },
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
  apply(ctx, args) {
    const t = txOf(ctx.tx, 'graph.curve.setWeighted');
    for (const curve of scopedTargetCurves(ctx, t)) {
      if (!curve.locked && curve.weighted !== args.weighted) t.patch('curves', curve.id, { weighted: args.weighted });
    }
  },
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
  apply(ctx, args) {
    const t = txOf(ctx.tx, 'graph.tangent.lockWeight');
    const selected = scopedSelectedKeys(ctx, t).map((s) => s.key.id);
    const ids = selected.length > 0 ? selected : keysOfCurves(t, scopedTargetCurves(ctx, t));
    for (const id of ids) {
      const key = t.get('keys', id);
      if (key === undefined || key.weightLocked === args.locked || t.get('curves', key.curve)?.locked === true)
        continue;
      t.put('keys', { ...key, weightLocked: args.locked });
    }
  },
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
  apply(ctx, args) {
    const t = txOf(ctx.tx, 'graph.infinity.set');
    for (const curve of scopedTargetCurves(ctx, t)) {
      if (curve.locked) continue;
      const patch: { pre?: InfinityMode; post?: InfinityMode } = {};
      if (args.pre !== undefined && args.pre !== curve.pre) patch.pre = args.pre;
      if (args.post !== undefined && args.post !== curve.post) patch.post = args.post;
      if (Object.keys(patch).length > 0) t.patch('curves', curve.id, patch);
    }
  },
});

// ---------- numeric fields (§4.11.4) ----------

const FIELD_NAMES = ['frame', 'value', 'inAngleDeg', 'outAngleDeg', 'inWeight', 'outWeight'] as const;

/**
 * A typed tangent angle and/or weight on one side of a key (§4.11.4 `handleFromFields`). The angle goes through the
 * kernel's `setKeyHandle` — the side becomes `fixed`, and a unified key turns its opposite side collinear with its own
 * length, exactly like a handle drag. A weight (weighted curves only; the fields are disabled otherwise) then scales
 * that side along its direction, so it stays collinear.
 */
function applyTangentField(
  app: EditorApp,
  tx: Tx,
  id: KeyId,
  side: 'in' | 'out',
  angle: number | undefined,
  weight: number | undefined,
  relative: boolean,
): void {
  const curveOfKey = (): { readonly curve: CurveRecord; readonly fps: Fps; readonly k: number } | null => {
    const key = tx.get('keys', id);
    const curve = key === undefined ? undefined : tx.get('curves', key.curve);
    const clip = curve === undefined ? undefined : tx.get('clips', curve.clip);
    if (curve === undefined || clip === undefined || curve.locked) return null;
    // Display units per curve unit (M2A-SPEC §5.1 rule 5): degrees for rotations and `unit: 'angle'` attributes.
    const unit = channelUnit(tx.get('controls', curve.control) ?? null, curve.channel);
    return { curve, fps: clip.fps, k: unit === 'angle' ? RAD2DEG : 1 };
  };
  const target = curveOfKey();
  if (target === null) return;
  const resolved = (): Handle | null => resolvedHandles(app, tx, target.curve, id)?.[side] ?? null;
  if (angle !== undefined) {
    const current = resolved();
    if (current === null) return;
    const angleDeg = relative ? tangentFields(current, side, target.fps, target.k).angleDeg + angle : angle;
    setKeyHandle(app, tx, id, side, handleFromFields({ angleDeg }, current, side, target.fps, target.k), {
      tempBreak: false,
    });
  }
  if (weight !== undefined && target.curve.weighted) {
    const current = resolved();
    const key = tx.get('keys', id);
    if (current === null || key === undefined) return;
    const now = tangentFields(current, side, target.fps, target.k).weight;
    const handle = handleFromFields(
      { weight: Math.max(0, relative ? now + weight : weight) },
      current,
      side,
      target.fps,
      target.k,
    );
    tx.put(
      'keys',
      side === 'in' ? { ...key, inType: 'fixed', inHandle: handle } : { ...key, outType: 'fixed', outHandle: handle },
    );
  }
}

/** Selected key ids (key parts) grouped by curve, in selection order. */
function byCurveOf(tx: Tx, ids: readonly KeyId[]): Map<CurveId, KeyId[]> {
  const groups = new Map<CurveId, KeyId[]>();
  for (const id of ids) {
    const key = tx.get('keys', id);
    if (key === undefined) continue;
    const group = groups.get(key.curve);
    if (group === undefined) groups.set(key.curve, [id]);
    else group.push(id);
  }
  return groups;
}

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
  apply(ctx, args: KeyFieldsArgs) {
    const { app } = ctx;
    const t = txOf(ctx.tx, 'graph.keys.setFields');
    const relative = args.relative === true;
    // Frame and value act on selected keys (key parts), like moving; tangent fields on every selected key or handle.
    const keyIds = scopedSelectedKeyIds(ctx, t);
    const deleted: KeyId[] = [];
    const typed = { snap: false, resolveCollisions: true } as const;
    if (args.frame !== undefined) {
      if (relative) {
        // One block move: the keys keep their spacing and never land on each other.
        if (args.frame !== 0) deleted.push(...moveKeys(app, t, keyIds, args.frame, 0, typed).deleted);
      } else {
        // Per curve the selected keys move as a block whose first key lands on the typed frame (several keys of one
        // curve cannot share a frame).
        for (const ids of byCurveOf(t, keyIds).values()) {
          const first = Math.min(...ids.map((id) => t.get('keys', id)?.t ?? Number.POSITIVE_INFINITY));
          if (Number.isFinite(first) && first !== args.frame) {
            deleted.push(...moveKeys(app, t, ids, args.frame - first, 0, typed).deleted);
          }
        }
      }
    }
    if (args.value !== undefined) {
      if (relative) {
        if (args.value !== 0) moveKeys(app, t, keyIds, 0, args.value, typed);
      } else {
        for (const id of keyIds) {
          const key = t.get('keys', id);
          const curve = key === undefined ? undefined : t.get('curves', key.curve);
          if (key === undefined || curve === undefined) continue;
          // The typed value and `moveKeys`' delta are display units of the channel's unit (§5.1 rule 5).
          const unit = channelUnit(t.get('controls', curve.control) ?? null, curve.channel);
          const dValue = args.value - toDisplayValue(curve.channel, key.v, unit);
          if (dValue !== 0) moveKeys(app, t, [id], 0, dValue, typed);
        }
      }
    }
    const tangentIds = scopedSelectedKeys(ctx, t).map((s) => s.key.id);
    for (const side of ['in', 'out'] as const) {
      const angle = side === 'in' ? args.inAngleDeg : args.outAngleDeg;
      const weight = side === 'in' ? args.inWeight : args.outWeight;
      if (angle === undefined && weight === undefined) continue;
      for (const id of tangentIds) applyTangentField(app, t, id, side, angle, weight, relative);
    }
    forgetScopedKeys(ctx, deleted);
  },
});

// ---------- moving, scaling, deleting, inserting ----------

// ---------- M2a ripple (M2A-SPEC §5.11) ----------

/** Panels whose key edits ripple when `session.tools.ripple` is on (the Graph Editor never ripples, M2A-D9). */
const RIPPLE_PANELS: ReadonlySet<PanelKind> = new Set([PANEL.dopeSheet, PANEL.timeline]);

/** `ripple` of a key edit: the argument, else `tools.ripple` when the edit comes from the Dope Sheet or the slider. */
function rippleOf(ctx: OperatorContext, ripple: boolean | undefined): boolean {
  if (ripple !== undefined) return ripple;
  const panel = panelOf(ctx);
  return panel !== null && RIPPLE_PANELS.has(panel) && ctx.app.session.getState().tools.ripple;
}

/** The ripple scope of an edit of `keys` from the run's panel; the time slider's region is its band (§5.11). */
function scopeOf(ctx: OperatorContext, tx: Tx, keys: readonly KeyId[]): RippleScope {
  const panel = panelOf(ctx);
  const band = panel === PANEL.timeline ? ctx.app.session.getState().time.band : null;
  return rippleScopeOf(ctx.app, tx, keys, panel, band);
}

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
  apply(ctx, args) {
    const { app } = ctx;
    const t = txOf(ctx.tx, 'graph.keys.move');
    const keys = selectedKeyIds(app, t);
    const ripple = rippleOf(ctx, args.ripple);
    const opts: KeyEditOptions = { ...keyEdit(app), ripple };
    const probe = panelOf(ctx) === PANEL.timeline ? keys.find((key) => t.get('keys', key) !== undefined) : undefined;
    const before = probe === undefined ? undefined : t.get('keys', probe)?.t;
    const result = moveKeys(app, t, keys, args.dFrames, args.dValue, opts, ripple ? scopeOf(ctx, t, keys) : undefined);
    forgetKeys(app, result.deleted);
    // A nudge on the time slider (arrows): the band follows the keys by the offset they really got, as after a band
    // drag (acceptance fix round 1: it stayed behind, so a later band drag or scale targeted an empty range).
    const after = probe === undefined ? undefined : t.get('keys', probe)?.t;
    const time = app.session.getState().time;
    if (time.band !== null && before !== undefined && after !== undefined && after !== before) {
      const shift = after - before;
      app.session.setState({ time: { ...time, band: { start: time.band.start + shift, end: time.band.end + shift } } });
    }
    return { count: result.moved };
  },
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
  apply(ctx, args) {
    const { app } = ctx;
    const t = txOf(ctx.tx, 'graph.keys.scale');
    const keys = selectedKeyIds(app, t);
    const ripple = rippleOf(ctx, args.ripple);
    const opts: KeyEditOptions = { ...keyEdit(app), ripple };
    const result = scaleKeys(app, t, keys, args.pivot, args.factor, opts, ripple ? scopeOf(ctx, t, keys) : undefined);
    forgetKeys(app, result.deleted);
    // §5.15.3: the value scale of the same keys in the same step; `valuePivot` is in display units and converts per
    // curve (degrees for rotations and angle attributes, `scaleKeyValues`); a negative factor flips. Keys the time
    // scale merged away are gone and skipped.
    const valueFactor = args.valueFactor ?? 1;
    if (valueFactor === 1) return { count: result.moved };
    const removed = new Set(result.deleted);
    const kept = removed.size === 0 ? keys : keys.filter((id) => !removed.has(id));
    const values = scaleKeyValues(app, t, kept, args.valuePivot ?? 0, valueFactor);
    return { count: Math.max(result.moved, values.moved) };
  },
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
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.keys.copyTo');
    const result = copyKeysInTime(app, t, selectedKeyIds(app, t), args.dFrames, keyEdit(app));
    forgetKeys(app, result.deleted);
    if (result.created.length > 0) selectOnly(app, result.created);
    return { count: result.created.length };
  },
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
  apply({ app, tx }) {
    const t = txOf(tx, 'graph.keys.delete');
    const ids = selectedKeyIds(app, t);
    const count = deleteKeys(app, t, ids);
    forgetKeys(app, ids);
    t.annotate({ label: count === 1 ? 'Delete Key' : `Delete ${count} Keys` });
    return { count };
  },
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
  apply(ctx, args) {
    const t = txOf(ctx.tx, 'graph.key.insert');
    // MCP-SPEC §4.10 actor-safe migration: agents snap to whole frames and never select the new key.
    const frame = snapOf(ctx) ? Math.round(args.frame) : args.frame;
    const key = insertKeyOnCurve(ctx.app, t, args.curve, frame);
    selectScopedKeysOnly(ctx, [key]);
    return { key };
  },
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
  apply({ app, tx }) {
    const t = txOf(tx, 'graph.keys.keyCurves');
    const clip = activeClipRecord(app, t);
    if (clip === undefined) return { count: 0 };
    const frame = currentClipFrame(app, t, clip);
    let count = 0;
    for (const curve of targetCurves(app, t)) {
      if (curve.locked || curve.clip !== clip.id) continue;
      insertKeyOnCurve(app, t, curve.id, frame);
      count++;
    }
    return { count };
  },
});

const keysCopy = defineOperator({
  id: 'graph.keys.copy',
  label: 'Copy Keys',
  description: 'Copy the selected keys (with their tangents).',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => pollSelectedKeys(app, true),
  apply({ app }) {
    const ids = selectedKeyIds(app);
    const clipboard = copyKeys(app.store, ids);
    if (clipboard === null) return { count: 0 };
    const state = app.session.getState();
    app.session.setState({ clipboard: { ...state.clipboard, keys: clipboard } });
    return { count: clipboard.curves.reduce((n, curve) => n + curve.keys.length, 0) };
  },
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
  apply(ctx, args) {
    const { app } = ctx;
    const t = txOf(ctx.tx, 'graph.keys.paste');
    const clip = activeClipRecord(app, t);
    const clipboard = app.session.getState().clipboard.keys;
    if (clip === undefined || clipboard === null) return { count: 0 };
    const given = optionalArgs(args)?.['mode'] as (typeof PASTE_MODES)[number] | undefined;
    // §5.10: with ripple on, a paste from the Dope Sheet or the time slider inserts.
    const mode = given ?? (rippleOf(ctx, undefined) ? 'insert' : 'merge');
    const frame = currentClipFrame(app, t, clip);
    if (mode === 'insert') {
      // Every key of the §5.11 scope curves at or after the paste frame first moves by the clipboard's span.
      let last = 0;
      for (const curve of clipboard.curves) for (const key of curve.keys) last = Math.max(last, key.dt);
      const curves = rippleCurves(t, clip.id, rippleControls(app, t, clip.id, panelOf(ctx)));
      shiftKeysFrom(t, curves, frame, last + 1);
    }
    const result = pasteKeys(app, t, clip, clipboard, frame, mode === 'replace' ? 'replace' : 'merge');
    if (result.skipped > 0) {
      app.services.notify.toast({ kind: 'warning', text: `${result.skipped} key(s) had no matching channel` });
    }
    selectOnly(app, result.keys);
    return { count: result.keys.length };
  },
});

/** Moves every key of `curves` at or after `from` by `frames` (paste insert, §5.10). Locked curves are skipped. */
function shiftKeysFrom(tx: Tx, curves: readonly CurveId[], from: number, frames: number): void {
  for (const curveId of new Set(curves)) {
    if (tx.get('curves', curveId)?.locked !== false) continue;
    // Later keys first, so no key passes over one that has not moved yet.
    const keys = [...tx.query.keysOfCurve(curveId)].reverse();
    for (const key of keys) if (key.t >= from - 1e-6) tx.put('keys', { ...key, t: key.t + frames });
  }
}

// ---------- Euler filter and Simplify ----------

const ROTATIONS = ['rx', 'ry', 'rz'] as const;

const eulerFilter = defineOperator({
  id: 'graph.eulerFilter',
  label: 'Euler Filter',
  description: 'Remove rotation flips (2π jumps and the alternate Euler triple) from the rotation curves.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: (ctx) => all(pollScopedClipEdit(ctx), pollScopeTargets(ctx)),
  apply(ctx) {
    const { app } = ctx;
    const t = txOf(ctx.tx, 'graph.eulerFilter');
    const clip = scopedClipRecord(ctx, t);
    if (clip === undefined) return { count: 0 };
    const selected = scopedTargetControls(ctx, t);
    const controls =
      selected.length > 0
        ? selected
        : [...new Set(baseCurves(t, clip).map((curve) => curve.control))]
            .map((id: ControlId) => t.get('controls', id))
            .filter((control) => control !== undefined);
    let count = 0;
    let skipped = 0;
    for (const control of controls) {
      const curves = ROTATIONS.map((channel) => curveOf(t, clip, control.id, channel));
      const keys = curves.map((curve) => (curve === undefined ? [] : t.query.keysOfCurve(curve.id)));
      if (keys.every((list) => list.length === 0)) continue;
      // The filter may switch all three angles to the alternate triple together: a locked curve that cannot follow
      // would change the rotation, so such a control is left alone.
      if (curves.some((curve, axis) => curve?.locked === true && (keys[axis]?.length ?? 0) > 0)) {
        skipped++;
        continue;
      }
      let first = Number.POSITIVE_INFINITY;
      for (const list of keys) for (const key of list) first = Math.min(first, key.t);
      const input = curves.map((curve, axis) => {
        const list = keys[axis] as readonly KeyRecord[];
        if (curve === undefined || list.length === 0) return constantCurve(first, curve?.staticValue ?? 0);
        return animCurve(curve, list.map(keyDataOf));
      }) as [AnimCurve, AnimCurve, AnimCurve];
      const filtered = eulerFilterCurves(input, control.rotateOrder);
      curves.forEach((curve, axis) => {
        const list = keys[axis] as readonly KeyRecord[];
        if (curve === undefined || list.length === 0) return;
        const out = filtered[axis] as KeyData[];
        list.forEach((key, i) => {
          const data = out[i];
          if (data === undefined || data === (input[axis] as AnimCurve).keys[i]) return;
          if (data.v === key.v && data.inHandle.dv === key.inHandle.dv && data.outHandle.dv === key.outHandle.dv)
            return;
          t.put('keys', keyRecord(key.id, key.clip, key.curve, data));
          count++;
        });
      });
    }
    if (skipped > 0) {
      app.services.notify.toast({
        kind: 'warning',
        text: `${skipped} control(s) with locked rotation curves were not filtered`,
      });
    }
    return { count };
  },
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
  if (!isActorRun(ctx)) return OK;
  for (const curve of scopedTargetCurves(ctx)) {
    const keys = ctx.app.store.query.keysOfCurve(curve.id);
    const first = keys[0];
    const last = keys.at(-1);
    if (first !== undefined && last !== undefined && last.t - first.t > AGENT_SPAN_LIMIT) {
      return fail(`A curve spans more than ${AGENT_SPAN_LIMIT} frames; simplify a shorter clip`);
    }
  }
  return OK;
}

function toleranceFor(channel: ChannelId, spec: ReduceSpec): number {
  if (isRotation(channel)) return spec.rotationRad;
  if (channel === 'tx' || channel === 'ty' || channel === 'tz') return spec.translationM;
  return spec.scale;
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
  apply(ctx, args) {
    const t = txOf(ctx.tx, 'graph.curves.simplify');
    const spec = (optionalArgs(args)?.['tolerance'] as ReduceSpec | undefined) ?? DEFAULT_REDUCE;
    let before = 0;
    let after = 0;
    let maxError = 0;
    const removed: KeyId[] = [];
    for (const curve of scopedTargetCurves(ctx, t)) {
      const keys = t.query.keysOfCurve(curve.id);
      before += keys.length;
      if (curve.locked || keys.length < 3) {
        after += keys.length;
        continue;
      }
      const clip = t.get('clips', curve.clip);
      const keep = clip?.contact === null || clip?.contact === undefined ? [] : [clip.contact];
      // Measured on the shape the editor draws: cycle-aware auto tangents on cyclic curves (§5.23).
      const result = reduceKeys(animCurve(curve, keys.map(keyDataOf)), {
        tolerance: toleranceFor(curve.channel, spec),
        keep,
        cycleAwareAuto: EDITOR_CURVE_OPTIONS.cycleAwareAuto,
      });
      // reduceKeys returns the kept keys unchanged: every other key goes.
      const kept = new Set(result.keys.map((key) => key.t));
      for (const key of keys) {
        if (kept.has(key.t)) {
          after++;
          continue;
        }
        t.remove('keys', key.id);
        removed.push(key.id);
      }
      maxError = Math.max(maxError, result.maxError);
    }
    forgetScopedKeys(ctx, removed);
    return { before, after, maxError };
  },
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
