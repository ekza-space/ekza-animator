// The apply bodies of the Graph Editor operators (`graph.ts`; MVP-SPEC §4.9 `graph.*`, §4.11.3–§4.11.5): a lazy chunk
// of its own (M-AI B5, `check:size`). `graph.ts` keeps each operator's definition and poll on the first visit; a run's
// `prepare` loads this module (synchronously once loaded) and `apply` calls its body. The bodies are the shipped ones,
// moved unchanged.
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
  type ApplyContext,
  type EditorApp,
  type KeyEditOptions,
  type KeyPartSelection,
  type OperatorArgs,
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
  targetCurves,
} from '../../workflows/targets';
import { constantCurve } from '../../workflows/util';
import type { KeyFieldsArgs } from '../args';
import { optionalArgs, panelOf } from './define';
import {
  forgetScopedKeys,
  scopedClipRecord,
  scopedSelectedKeyIds,
  scopedSelectedKeys,
  scopedTargetControls,
  scopedTargetCurves,
  selectScopedKeysOnly,
  snapOf,
} from './scoped';

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

// ---------- numeric fields (§4.11.4) ----------

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

/** Moves every key of `curves` at or after `from` by `frames` (paste insert, §5.10). Locked curves are skipped. */
function shiftKeysFrom(tx: Tx, curves: readonly CurveId[], from: number, frames: number): void {
  for (const curveId of new Set(curves)) {
    if (tx.get('curves', curveId)?.locked !== false) continue;
    // Later keys first, so no key passes over one that has not moved yet.
    const keys = [...tx.query.keysOfCurve(curveId)].reverse();
    for (const key of keys) if (key.t >= from - 1e-6) tx.put('keys', { ...key, t: key.t + frames });
  }
}

const ROTATIONS = ['rx', 'ry', 'rz'] as const;

function toleranceFor(channel: ChannelId, spec: ReduceSpec): number {
  if (isRotation(channel)) return spec.rotationRad;
  if (channel === 'tx' || channel === 'ty' || channel === 'tz') return spec.translationM;
  return spec.scale;
}

/** `graph.tangent.set` */
export function tangentSet(ctx: ApplyContext, args: OperatorArgs<'graph.tangent.set'>) {
  const { app } = ctx;
  const t = txOf(ctx.tx, 'graph.tangent.set');
  for (const [side, ids] of tangentTargets(ctx, t, args.side)) setTangentTypes(app, t, ids, args.type, side);
}

/** `graph.tangent.break` */
export function tangentBreak(ctx: ApplyContext) {
  const t = txOf(ctx.tx, 'graph.tangent.break');
  for (const { key } of scopedSelectedKeys(ctx, t)) {
    if (key.broken || t.get('curves', key.curve)?.locked === true) continue;
    t.put('keys', { ...key, broken: true });
  }
}

/** `graph.tangent.unify` */
export function tangentUnify(ctx: ApplyContext) {
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
}

/** `graph.curve.setWeighted` */
export function setWeighted(ctx: ApplyContext, args: OperatorArgs<'graph.curve.setWeighted'>) {
  const t = txOf(ctx.tx, 'graph.curve.setWeighted');
  for (const curve of scopedTargetCurves(ctx, t)) {
    if (!curve.locked && curve.weighted !== args.weighted) t.patch('curves', curve.id, { weighted: args.weighted });
  }
}

/** `graph.tangent.lockWeight` */
export function lockWeight(ctx: ApplyContext, args: OperatorArgs<'graph.tangent.lockWeight'>) {
  const t = txOf(ctx.tx, 'graph.tangent.lockWeight');
  const selected = scopedSelectedKeys(ctx, t).map((s) => s.key.id);
  const ids = selected.length > 0 ? selected : keysOfCurves(t, scopedTargetCurves(ctx, t));
  for (const id of ids) {
    const key = t.get('keys', id);
    if (key === undefined || key.weightLocked === args.locked || t.get('curves', key.curve)?.locked === true) continue;
    t.put('keys', { ...key, weightLocked: args.locked });
  }
}

/** `graph.infinity.set` */
export function infinitySet(ctx: ApplyContext, args: OperatorArgs<'graph.infinity.set'>) {
  const t = txOf(ctx.tx, 'graph.infinity.set');
  for (const curve of scopedTargetCurves(ctx, t)) {
    if (curve.locked) continue;
    const patch: { pre?: InfinityMode; post?: InfinityMode } = {};
    if (args.pre !== undefined && args.pre !== curve.pre) patch.pre = args.pre;
    if (args.post !== undefined && args.post !== curve.post) patch.post = args.post;
    if (Object.keys(patch).length > 0) t.patch('curves', curve.id, patch);
  }
}

/** `graph.keys.setFields` */
export function setFields(ctx: ApplyContext, args: KeyFieldsArgs) {
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
}

/** `graph.keys.move` */
export function keysMove(ctx: ApplyContext, args: OperatorArgs<'graph.keys.move'>) {
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
}

/** `graph.keys.scale` */
export function keysScale(ctx: ApplyContext, args: OperatorArgs<'graph.keys.scale'>) {
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
}

/** `graph.keys.copyTo` */
export function keysCopyTo(ctx: ApplyContext, args: OperatorArgs<'graph.keys.copyTo'>) {
  const { app, tx } = ctx;
  const t = txOf(tx, 'graph.keys.copyTo');
  const result = copyKeysInTime(app, t, selectedKeyIds(app, t), args.dFrames, keyEdit(app));
  forgetKeys(app, result.deleted);
  if (result.created.length > 0) selectOnly(app, result.created);
  return { count: result.created.length };
}

/** `graph.keys.delete` */
export function keysDelete(ctx: ApplyContext) {
  const { app, tx } = ctx;
  const t = txOf(tx, 'graph.keys.delete');
  const ids = selectedKeyIds(app, t);
  const count = deleteKeys(app, t, ids);
  forgetKeys(app, ids);
  t.annotate({ label: count === 1 ? 'Delete Key' : `Delete ${count} Keys` });
  return { count };
}

/** `graph.key.insert` */
export function keyInsert(ctx: ApplyContext, args: OperatorArgs<'graph.key.insert'>) {
  const t = txOf(ctx.tx, 'graph.key.insert');
  // MCP-SPEC §4.10 actor-safe migration: agents snap to whole frames and never select the new key.
  const frame = snapOf(ctx) ? Math.round(args.frame) : args.frame;
  const key = insertKeyOnCurve(ctx.app, t, args.curve, frame);
  selectScopedKeysOnly(ctx, [key]);
  return { key };
}

/** `graph.keys.keyCurves` */
export function keyCurves(ctx: ApplyContext) {
  const { app, tx } = ctx;
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
}

/** `graph.keys.copy` */
export function keysCopy(ctx: ApplyContext) {
  const { app } = ctx;
  const ids = selectedKeyIds(app);
  const clipboard = copyKeys(app.store, ids);
  if (clipboard === null) return { count: 0 };
  const state = app.session.getState();
  app.session.setState({ clipboard: { ...state.clipboard, keys: clipboard } });
  return { count: clipboard.curves.reduce((n, curve) => n + curve.keys.length, 0) };
}

/** `graph.keys.paste` */
export function keysPaste(ctx: ApplyContext, args: OperatorArgs<'graph.keys.paste'>) {
  const { app } = ctx;
  const t = txOf(ctx.tx, 'graph.keys.paste');
  const clip = activeClipRecord(app, t);
  const clipboard = app.session.getState().clipboard.keys;
  if (clip === undefined || clipboard === null) return { count: 0 };
  const given = optionalArgs(args)?.['mode'] as 'merge' | 'replace' | 'insert' | undefined;
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
}

/** `graph.eulerFilter` */
export function eulerFilter(ctx: ApplyContext) {
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
        if (data.v === key.v && data.inHandle.dv === key.inHandle.dv && data.outHandle.dv === key.outHandle.dv) return;
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
}

/** `graph.curves.simplify` */
export function simplify(ctx: ApplyContext, args: OperatorArgs<'graph.curves.simplify'>) {
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
}
