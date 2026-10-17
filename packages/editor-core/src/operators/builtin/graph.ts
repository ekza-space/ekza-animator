// Graph Editor operators (MVP-SPEC §4.9 `graph.*`, §4.11.3–§4.11.5); the time slider runs the key operators on its
// band's keys. Key-level operators act on the selected keys (and handles); curve-level ones on the curves of the
// selected keys, else of the selected channels, else of the selected controls, else on every curve of the active
// clip (workflows/targets). All edits go through the edit kernel.
import {
  type AnimCurve,
  EkzaError,
  eulerFilterCurves,
  type Handle,
  handleFromFields,
  type InfinityMode,
  type KeyData,
  RAD2DEG,
  reduceKeys,
  type TangentType,
  tangentFields,
} from '@ekza-animator/anim-core';
import type { ChannelId, ControlId, CurveId, CurveRecord, KeyId, KeyRecord, Tx } from '@ekza-animator/doc';
import { DEFAULT_REDUCE, type ReduceSpec } from '@ekza-animator/rig';
import { isRotation } from '../../edit/channelMeta';
import { animCurve, compileInTx, currentClipFrame, keyDataOf } from '../../edit/context';
import { deleteKeys, insertKeyOnCurve, moveKeys, scaleKeys, setKeyHandle, setTangentTypes } from '../../edit/keys';
import { toDisplayValue } from '../../edit/numeric';
import { type EditorApp, GLOBAL_SCOPE, type KeyPartSelection } from '../../types';
import { copyKeys, pasteKeys } from '../../workflows/keyClipboard';
import { keyRecord } from '../../workflows/records';
import {
  activeClipRecord,
  baseCurves,
  curveOf,
  keysOfCurves,
  selectedControls,
  selectedKeyIds,
  selectedKeys,
  targetCurves,
} from '../../workflows/targets';
import type { KeyFieldsArgs } from '../args';
import { type AnyOperator, all, defineOperator, fail, isFiniteNumber, isRecord, OK, optionalArgs } from './define';
import { pollClipEdit, pollEditable } from './polls';

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
/** M1-stretch tangent types (§1.2): the enum value exists, the operator refuses it. */
const NOT_YET: ReadonlySet<TangentType> = new Set(['plateau']);
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

/** Keys to change per side for `graph.tangent.set` (§4.11.4 editing rules). */
function tangentTargets(
  app: EditorApp,
  tx: Tx,
  side: 'both' | 'in' | 'out' | undefined,
): Map<'both' | 'in' | 'out', KeyId[]> {
  const groups = new Map<'both' | 'in' | 'out', KeyId[]>();
  const add = (s: 'both' | 'in' | 'out', id: KeyId): void => {
    const group = groups.get(s);
    if (group === undefined) groups.set(s, [id]);
    else group.push(id);
  };
  const selected = selectedKeys(app, tx);
  if (selected.length > 0) {
    for (const { key, parts } of selected) {
      if (parts.key) add(side ?? 'both', key.id);
      else add(parts.in && parts.out ? 'both' : parts.in ? 'in' : 'out', key.id);
    }
  } else {
    for (const id of keysOfCurves(tx, targetCurves(app, tx))) add(side ?? 'both', id);
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
  poll({ app }, raw) {
    const args: unknown = raw;
    if (!isRecord(args) || !TANGENT_TYPES.includes(args['type'] as TangentType)) return fail('expects { type, side? }');
    if (NOT_YET.has(args['type'] as TangentType)) return fail('not available yet');
    if (args['side'] !== undefined && !SIDES.includes(args['side'] as (typeof SIDES)[number])) {
      return fail("side is 'both', 'in' or 'out'");
    }
    return all(pollEditable(app), selectedKeys(app).length > 0 ? OK : pollTargetCurves(app));
  },
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.tangent.set');
    for (const [side, ids] of tangentTargets(app, t, args.side)) setTangentTypes(app, t, ids, args.type, side);
  },
});

const tangentBreak = defineOperator({
  id: 'graph.tangent.break',
  label: 'Break Tangents',
  description: 'Let the in and out handles of the selected keys move independently.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: ({ app }) => all(pollEditable(app), pollSelectedKeys(app, false)),
  apply({ app, tx }) {
    const t = txOf(tx, 'graph.tangent.break');
    for (const { key } of selectedKeys(app, t)) {
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
  poll: ({ app }) => all(pollEditable(app), pollSelectedKeys(app, false)),
  apply({ app, tx }) {
    const t = txOf(tx, 'graph.tangent.unify');
    for (const { key: selected } of selectedKeys(app, t)) {
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
  poll: ({ app }, args) =>
    isRecord(args) && typeof args['weighted'] === 'boolean'
      ? all(pollEditable(app), pollTargetCurves(app))
      : fail('expects { weighted }'),
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.curve.setWeighted');
    for (const curve of targetCurves(app, t)) {
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
  poll: ({ app }, args) =>
    isRecord(args) && typeof args['locked'] === 'boolean'
      ? all(pollEditable(app), selectedKeys(app).length > 0 ? OK : pollTargetCurves(app))
      : fail('expects { locked }'),
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.tangent.lockWeight');
    const selected = selectedKeys(app, t).map((s) => s.key.id);
    const ids = selected.length > 0 ? selected : keysOfCurves(t, targetCurves(app, t));
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
  poll({ app }, raw) {
    const args: unknown = raw;
    if (!isRecord(args)) return fail('expects { pre?, post? }');
    const { pre, post } = args;
    if (pre === undefined && post === undefined) return fail('expects { pre?, post? }');
    for (const mode of [pre, post]) {
      if (mode !== undefined && !INFINITY_MODES.includes(mode as InfinityMode))
        return fail(`unknown infinity ${JSON.stringify(mode)}`);
    }
    return all(pollEditable(app), pollTargetCurves(app));
  },
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.infinity.set');
    for (const curve of targetCurves(app, t)) {
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

/** Maya weight of a handle (seconds, display units). */
function weightOf(h: Handle, fps: number, k: number): number {
  return 3 * Math.hypot(Math.abs(h.dt) / fps, h.dv * k);
}

/** The opposite side of a unified key turned collinear with `h`, keeping its own length. */
function alignOpposite(
  h: Handle,
  opposite: Handle,
  side: 'in' | 'out',
  weighted: boolean,
  fps: number,
  k: number,
): Handle {
  const direction: Handle = { dt: -h.dt, dv: -h.dv };
  if (weighted) {
    const from = weightOf(direction, fps, k);
    const to = weightOf(opposite, fps, k);
    if (from > 0 && to > 0) return { dt: (direction.dt * to) / from, dv: (direction.dv * to) / from };
  }
  const absDt = Math.abs(opposite.dt) > 1e-6 ? Math.abs(opposite.dt) : 1;
  const sign = side === 'out' ? 1 : -1;
  const slope = Math.abs(direction.dt) > 0 ? direction.dv / direction.dt : 0;
  return { dt: sign * absDt, dv: slope * sign * absDt };
}

function applyTangentField(
  app: EditorApp,
  tx: Tx,
  id: KeyId,
  side: 'in' | 'out',
  angle: number | undefined,
  weight: number | undefined,
  relative: boolean,
): void {
  const key = tx.get('keys', id);
  const curve = key === undefined ? undefined : tx.get('curves', key.curve);
  const clip = curve === undefined ? undefined : tx.get('clips', curve.clip);
  if (key === undefined || curve === undefined || clip === undefined || curve.locked) return;
  // Weight fields are disabled on non-weighted curves.
  const w = curve.weighted ? weight : undefined;
  if (angle === undefined && w === undefined) return;
  const handles = resolvedHandles(app, tx, curve, id);
  if (handles === null) return;
  const k = isRotation(curve.channel) ? RAD2DEG : 1;
  const current = handles[side];
  const now = tangentFields(current, side, clip.fps, k);
  const fields = {
    ...(angle === undefined ? {} : { angleDeg: relative ? now.angleDeg + angle : angle }),
    ...(w === undefined ? {} : { weight: Math.max(0, relative ? now.weight + w : w) }),
  };
  const handle = handleFromFields(fields, current, side, clip.fps, k);
  let updated: KeyRecord =
    side === 'in' ? { ...key, inType: 'fixed', inHandle: handle } : { ...key, outType: 'fixed', outHandle: handle };
  if (!key.broken && angle !== undefined) {
    const opposite = side === 'in' ? 'out' : 'in';
    const aligned = alignOpposite(handle, handles[opposite], opposite, curve.weighted, clip.fps.num / clip.fps.den, k);
    updated =
      opposite === 'in'
        ? { ...updated, inType: 'fixed', inHandle: aligned }
        : { ...updated, outType: 'fixed', outHandle: aligned };
  }
  tx.put('keys', updated);
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
  poll({ app }, args) {
    if (!isRecord(args)) return fail('expects key fields');
    const given = FIELD_NAMES.filter((name) => args[name] !== undefined);
    if (given.length === 0) return fail('expects at least one field');
    if (given.some((name) => !isFiniteNumber(args[name]))) return fail('fields must be finite numbers');
    if (args['relative'] !== undefined && typeof args['relative'] !== 'boolean')
      return fail('relative must be a boolean');
    return all(pollEditable(app), pollSelectedKeys(app, false));
  },
  apply({ app, tx }, args: KeyFieldsArgs) {
    const t = txOf(tx, 'graph.keys.setFields');
    const relative = args.relative === true;
    const ids = selectedKeys(app, t).map((s) => s.key.id);
    const deleted: KeyId[] = [];
    if (args.frame !== undefined) {
      for (const id of ids) {
        const key = t.get('keys', id);
        if (key === undefined) continue;
        const dFrames = relative ? args.frame : args.frame - key.t;
        if (dFrames !== 0)
          deleted.push(...moveKeys(app, t, [id], dFrames, 0, { snap: false, resolveCollisions: true }).deleted);
      }
    }
    if (args.value !== undefined) {
      for (const id of ids) {
        const key = t.get('keys', id);
        const curve = key === undefined ? undefined : t.get('curves', key.curve);
        if (key === undefined || curve === undefined) continue;
        const dValue = relative ? args.value : args.value - toDisplayValue(curve.channel, key.v);
        if (dValue !== 0) moveKeys(app, t, [id], 0, dValue, { snap: false, resolveCollisions: true });
      }
    }
    for (const side of ['in', 'out'] as const) {
      const angle = side === 'in' ? args.inAngleDeg : args.outAngleDeg;
      const weight = side === 'in' ? args.inWeight : args.outWeight;
      if (angle === undefined && weight === undefined) continue;
      for (const id of ids) applyTangentField(app, t, id, side, angle, weight, relative);
    }
    forgetKeys(app, deleted);
  },
});

// ---------- moving, scaling, deleting, inserting ----------

const keysMove = defineOperator({
  id: 'graph.keys.move',
  label: 'Move Keys',
  description: 'Move the selected keys in time (frames) and value (display units).',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  poll: ({ app }, args) =>
    isRecord(args) && isFiniteNumber(args['dFrames']) && isFiniteNumber(args['dValue'])
      ? all(pollEditable(app), pollSelectedKeys(app, true))
      : fail('expects { dFrames, dValue }'),
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.keys.move');
    const result = moveKeys(app, t, selectedKeyIds(app, t), args.dFrames, args.dValue, keyEdit(app));
    forgetKeys(app, result.deleted);
    return { count: result.moved };
  },
});

const keysScale = defineOperator({
  id: 'graph.keys.scale',
  label: 'Scale Keys',
  description: 'Scale the selected keys in time around a pivot frame.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  poll: ({ app }, args) =>
    isRecord(args) && isFiniteNumber(args['pivot']) && isFiniteNumber(args['factor']) && args['factor'] > 0
      ? all(pollEditable(app), pollSelectedKeys(app, true))
      : fail('expects { pivot, factor > 0 }'),
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.keys.scale');
    const result = scaleKeys(app, t, selectedKeyIds(app, t), args.pivot, args.factor, keyEdit(app));
    forgetKeys(app, result.deleted);
    return { count: result.moved };
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
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.key.insert');
    const frame = app.session.getState().time.snapToFrames ? Math.round(args.frame) : args.frame;
    const key = insertKeyOnCurve(app, t, args.curve, frame);
    selectOnly(app, [key]);
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

const keysPaste = defineOperator({
  id: 'graph.keys.paste',
  label: 'Paste Keys',
  description: 'Paste copied keys at the current frame onto the same controls and channels.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Paste Keys',
  poll({ app }, args) {
    const options = optionalArgs(args);
    const mode = options?.['mode'];
    if (options === null || (mode !== undefined && mode !== 'merge' && mode !== 'replace')) {
      return fail("expects { mode?: 'merge' | 'replace' }");
    }
    if (app.session.getState().clipboard.keys === null) return fail('There are no copied keys');
    return pollClipEdit(app);
  },
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.keys.paste');
    const clip = activeClipRecord(app, t);
    const clipboard = app.session.getState().clipboard.keys;
    if (clip === undefined || clipboard === null) return { count: 0 };
    const mode = optionalArgs(args)?.['mode'] === 'replace' ? 'replace' : 'merge';
    const result = pasteKeys(app, t, clip, clipboard, currentClipFrame(app, t, clip), mode);
    if (result.skipped > 0) {
      app.services.notify.toast({ kind: 'warning', text: `${result.skipped} key(s) had no matching channel` });
    }
    selectOnly(app, result.keys);
    return { count: result.keys.length };
  },
});

// ---------- Euler filter and Simplify ----------

const ROTATIONS = ['rx', 'ry', 'rz'] as const;

/** A curve standing for a channel without keys: one key holding its static value (anim-core contract). */
function constantCurve(value: number): AnimCurve {
  const key: KeyData = {
    t: 0,
    v: value,
    inType: 'flat',
    outType: 'flat',
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
  };
  return { keys: [key], weighted: false, pre: 'constant', post: 'constant' };
}

const eulerFilter = defineOperator({
  id: 'graph.eulerFilter',
  label: 'Euler Filter',
  description: 'Remove rotation flips (2π jumps and the alternate Euler triple) from the rotation curves.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  poll: ({ app }) => pollClipEdit(app),
  apply({ app, tx }) {
    const t = txOf(tx, 'graph.eulerFilter');
    const clip = activeClipRecord(app, t);
    if (clip === undefined) return { count: 0 };
    const selected = selectedControls(app, t);
    const controls =
      selected.length > 0
        ? selected
        : [...new Set(baseCurves(t, clip).map((curve) => curve.control))]
            .map((id: ControlId) => t.get('controls', id))
            .filter((control) => control !== undefined);
    let count = 0;
    for (const control of controls) {
      const curves = ROTATIONS.map((channel) => curveOf(t, clip, control.id, channel));
      const keys = curves.map((curve) => (curve === undefined ? [] : t.query.keysOfCurve(curve.id)));
      if (keys.every((list) => list.length === 0)) continue;
      const input = curves.map((curve, axis) => {
        const list = keys[axis] as readonly KeyRecord[];
        if (curve === undefined || list.length === 0) return constantCurve(curve?.staticValue ?? 0);
        return animCurve(curve, list.map(keyDataOf));
      }) as [AnimCurve, AnimCurve, AnimCurve];
      const filtered = eulerFilterCurves(input, control.rotateOrder);
      curves.forEach((curve, axis) => {
        const list = keys[axis] as readonly KeyRecord[];
        if (curve === undefined || curve.locked || list.length === 0) return;
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
  poll({ app }, args) {
    const options = optionalArgs(args);
    if (options === null) return fail('expects { tolerance? }');
    const problem = reduceSpecProblem(options['tolerance']);
    return problem === null ? all(pollEditable(app), pollTargetCurves(app)) : fail(problem);
  },
  apply({ app, tx }, args) {
    const t = txOf(tx, 'graph.curves.simplify');
    const spec = (optionalArgs(args)?.['tolerance'] as ReduceSpec | undefined) ?? DEFAULT_REDUCE;
    let before = 0;
    let after = 0;
    let maxError = 0;
    const removed: KeyId[] = [];
    for (const curve of targetCurves(app, t)) {
      const keys = t.query.keysOfCurve(curve.id);
      before += keys.length;
      if (curve.locked || keys.length < 3) {
        after += keys.length;
        continue;
      }
      const clip = t.get('clips', curve.clip);
      const keep = clip?.contact === null || clip?.contact === undefined ? [] : [clip.contact];
      const result = reduceKeys(animCurve(curve, keys.map(keyDataOf)), {
        tolerance: toleranceFor(curve.channel, spec),
        keep,
      });
      const kept = new Set(result.keys.map((key) => key.t));
      for (const key of keys) {
        if (kept.has(key.t)) continue;
        t.remove('keys', key.id);
        removed.push(key.id);
      }
      after += keys.length - (keys.length - kept.size);
      maxError = Math.max(maxError, result.maxError);
    }
    forgetKeys(app, removed);
    return { before, after, maxError };
  },
});

export const GRAPH_OPERATORS: readonly AnyOperator[] = [
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
