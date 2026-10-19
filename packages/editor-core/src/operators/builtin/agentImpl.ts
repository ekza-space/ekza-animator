// The implementation of the M-AI explicit-target operators (MCP-SPEC §4.10, P1), loaded on first use by
// `agentLoad.ts`: the full polls (`AGENT_POLLS`, from `agentKeyChecks.ts`, `agentPoseChecks.ts` and the loop poll
// below) and the applies of `key.write`, `key.delete`, `key.adjust`, `key.retime`, `pose.setAt`, `pose.goals`,
// `pose.transfer`, `clip.makeLoop`, `edit.revertSteps` and `edit.restoreDocument`. The definitions live in
// `agentKeys.ts`, `agentPose.ts`, `agentClip.ts` and `revert.ts`.

import { EkzaError, type Frame, type TangentType } from '@ekza-animator/anim-core';
import {
  applyRestorePlan,
  type ChannelId,
  type ChannelValues,
  type ClipRecord,
  type ControlId,
  type ControlRecord,
  type CurveRecord,
  type KeyId,
  type KeyRecord,
  planRestore,
  planSnapshotRestore,
  restoreHostOf,
  type Tx,
} from '@ekza-animator/doc';
import { type LimbDesc, type LimbId, writeControlChannels } from '@ekza-animator/rig';
import { internalsOf, newRecordId } from '../../app/internals';
import { isLocked, newKeyTangents, ROTATE_CHANNELS } from '../../edit/channelMeta';
import { compileInTx, SAME_FRAME_EPS } from '../../edit/context';
import { ensureCurve, moveKeys, scaleKeys, writeKeyAt } from '../../edit/keys';
import type { ApplyContext, EditorApp, KeyEditOptions, OperatorArgs, OperatorContext, PollResult } from '../../types';
import {
  type AdjustOffsets,
  type AdjustWhere,
  adjustedKey,
  adjustKindOf,
  adjustWeight,
  offsetFor,
  pivotValueOf,
} from '../../workflows/adjust';
import { inPlaceNode } from '../../workflows/export';
import {
  type AimRequest,
  aimResult,
  applyAim,
  applyIkGoal,
  type ChannelFilter,
  type GoalState,
  restPoseOf,
} from '../../workflows/goals';
import { boneNode, drivingControl, IK_FROM, ikFkIn, REACHED_M } from '../../workflows/goalTargets';
import { channelsAt, limbContext, matchAt, matchEdits } from '../../workflows/ik';
import {
  DEFAULT_BLEND_FRAMES,
  type LoopCurvePlan,
  type LoopMethod,
  planLoopCurve,
  type RootTravel,
  type SeamValue,
  seamValues,
} from '../../workflows/loop';
import { deleteCurveKeys, insertTimeOn, keyedBaseCurves, wrapOffsetCurve } from '../../workflows/retime';
import type { AdjustPivot, ChannelTarget, OperatorMap, SeamMetrics } from '../args';
import {
  baseCurveIn,
  extendClipRange,
  hiddenByOverrides,
  keyedValuesAt,
  requireClipIn,
  requireRuntime,
  txOf,
  uniqueTargets,
} from './agentCommon';
import {
  deletePlan,
  type PlannedKey,
  planWrite,
  pollKeyAdjust,
  pollKeyDelete,
  pollKeyRetime,
  pollKeyWrite,
} from './agentKeyChecks';
import { AGENT_SPAN_LIMIT, AGENT_WRITE_LIMIT, clipArg, pollAgentClip } from './agentLoad';
import {
  type GoalsArgs,
  keyedChannels,
  pollPoseGoals,
  pollPoseSetAt,
  pollPoseTransfer,
  type SetAtArgs,
  type Skip,
  skipOf,
  type TransferArgs,
  transferChannels,
  transferValues,
} from './agentPoseChecks';
import { fail, isActorRun, isFiniteNumber, OK } from './define';
import { revertible } from './revert';
import { NOT_AVAILABLE_YET } from './stub';

// ---------- keys ----------

interface AdjustArgs {
  readonly targets: readonly ChannelTarget[];
  readonly range?: { readonly start: Frame; readonly end: Frame };
  readonly frames?: readonly Frame[];
  readonly offset?: AdjustOffsets;
  readonly factor?: number;
  readonly pivot?: AdjustPivot;
  readonly falloffFrames?: number;
}

/** The adjusted keys per curve, the skipped targets, from the committed (or transaction) view. */
function adjustPlan(
  app: EditorApp,
  view: Tx | EditorApp['store'],
  clip: ClipRecord,
  args: AdjustArgs,
): {
  readonly writes: readonly KeyRecord[];
  readonly curves: number;
  readonly skipped: readonly (ChannelTarget & { readonly reason: 'locked' | 'no_keys' })[];
} {
  const engine = internalsOf(app).deps.curves.engine;
  const range = args.range ?? clip.range;
  const where: AdjustWhere =
    args.frames !== undefined
      ? { kind: 'frames', frames: args.frames }
      : { kind: 'range', start: range.start, end: range.end, falloffFrames: args.falloffFrames ?? 0 };
  const factor = args.factor ?? 1;
  const writes: KeyRecord[] = [];
  const skipped: (ChannelTarget & { readonly reason: 'locked' | 'no_keys' })[] = [];
  let curves = 0;
  for (const target of uniqueTargets(args.targets)) {
    const control = view.get('controls', target.control) ?? null;
    const curve = baseCurveIn(view, clip, target.control, target.channel);
    if (control !== null && isLocked(control, target.channel)) {
      skipped.push({ ...target, reason: 'locked' });
      continue;
    }
    if (curve === undefined || view.query.keysOfCurve(curve.id).length === 0) {
      skipped.push({ ...target, reason: 'no_keys' });
      continue;
    }
    if (curve.locked) {
      skipped.push({ ...target, reason: 'locked' });
      continue;
    }
    const { keys, compiled } = compileInTx(app, view, curve);
    const pivot = pivotValueOf(args.pivot ?? { kind: 'rest' }, engine, compiled, control, target.channel, range);
    const offset = offsetFor(args.offset, adjustKindOf(control, target.channel));
    let changed = false;
    for (const key of keys) {
      const next = adjustedKey(key, { pivot, factor, offset, weight: adjustWeight(key.t, where) });
      if (next === null) continue;
      writes.push(next);
      changed = true;
    }
    if (changed) curves++;
  }
  return { writes, curves, skipped };
}

interface RetimeArgs {
  readonly targets: readonly ChannelTarget[];
  readonly mode: 'offset' | 'scale' | 'insertTime' | 'deleteTime' | 'warp';
  readonly offset?: number;
  readonly wrap?: boolean;
  readonly factor?: number;
  readonly pivot?: Frame;
  readonly at?: Frame;
  readonly frames?: number;
  readonly ripple?: boolean;
  readonly retimeBreakdowns?: boolean;
  readonly snapToFrames?: boolean;
}

/** The editable base curves of the targets (unique, locked curves left out). */
function retimeCurves(tx: Tx, clip: ClipRecord, targets: readonly ChannelTarget[]): CurveRecord[] {
  const out: CurveRecord[] = [];
  for (const target of uniqueTargets(targets)) {
    const curve = baseCurveIn(tx, clip, target.control, target.channel);
    if (curve !== undefined && !curve.locked && !out.some((c) => c.id === curve.id)) out.push(curve);
  }
  return out;
}

/** The contact frame after a scale or offset of every keyed curve of the clip (§4.10), or the unchanged one. */
function movedContact(clip: ClipRecord, args: RetimeArgs, snap: boolean): Frame | null {
  if (clip.contact === null) return null;
  const { start, end } = clip.range;
  let contact = clip.contact;
  if (args.mode === 'offset') {
    contact += args.offset ?? 0;
    if (args.wrap === true && end > start)
      contact = start + ((((contact - start) % (end - start)) + (end - start)) % (end - start));
  } else if (args.mode === 'scale') {
    const pivot = args.pivot ?? start;
    contact = pivot + (contact - pivot) * (args.factor ?? 1);
    if (snap) contact = Math.round(contact);
  }
  return Math.min(Math.max(contact, start), end);
}

/** Keys (still there) whose final time differs from their target time: stopped by a key that did not move. */
function countClamped(tx: Tx, before: ReadonlyMap<KeyId, number>, target: (t: number) => number): number {
  let clamped = 0;
  for (const [id, t] of before) {
    const key = tx.get('keys', id);
    if (key !== undefined && Math.abs(key.t - target(t)) > SAME_FRAME_EPS) clamped++;
  }
  return clamped;
}

export function keyWrite(app: EditorApp, maybe: Tx | null, args: OperatorArgs<'key.write'>) {
  const tx = txOf(maybe, 'key.write');
  const clip = requireClipIn(tx, args.clip);
  const planned = planWrite(app, clip, args);
  if (typeof planned === 'string') throw new EkzaError('unsupported', planned);
  const rangeExtended =
    args.extendRange === true &&
    extendClipRange(
      tx,
      clip,
      planned.map((key) => key.frame),
    );
  const { written, curvesCreated } = writeKeys(app, tx, clip, planned);
  return {
    written,
    curvesCreated,
    rangeExtended,
    hiddenByOverrides: hiddenByOverrides(app, clip, planned),
  };
}

/**
 * Writes keys on the clip's base curves, per curve in one pass: its keys are read once and the items merge into them
 * in order (a later item at the same frame wins, as with one `writeKeyAt` per item), so n keys on one curve cost
 * O(n), not one scan of the curve per key. A key already at a frame takes the value, the explicit tangent types and
 * the explicit breakdown flag; a new key gets the item's tangents or the channel's defaults. Returns the key records
 * written (each curve and frame once, however often the items name it) and the curves created.
 */
export function writeKeys(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  items: readonly PlannedKey[],
): { readonly written: number; readonly curvesCreated: number } {
  const defaults = app.prefs.getState().defaultTangents;
  const byCurve = new Map<string, PlannedKey[]>();
  for (const item of items) {
    const id = `${item.control}\u0000${item.channel}`;
    const list = byCurve.get(id);
    if (list === undefined) byCurve.set(id, [item]);
    else list.push(item);
  }
  let curvesCreated = 0;
  let written = 0;
  for (const list of byCurve.values()) {
    const { control: controlId, channel } = list[0] as PlannedKey;
    const control = tx.get('controls', controlId);
    if (control === undefined) throw new EkzaError('invalid-record', `Control ${controlId} does not exist`);
    if (baseCurveIn(tx, clip, controlId, channel) === undefined) curvesCreated++;
    const curve = ensureCurve(app, tx, clip.id, controlId, channel);
    const fallback = newKeyTangents(control, channel, defaults);
    const atFrame = new Map<number, KeyRecord>();
    for (const key of tx.query.keysOfCurve(curve)) atFrame.set(frameSlot(key.t), key);
    const final = new Map<KeyId, KeyRecord>();
    for (const item of list) {
      const existing = keyNear(atFrame, item.frame);
      const next = existing === undefined ? newKey(app, clip, curve, item, fallback) : rewrittenKey(existing, item);
      atFrame.set(frameSlot(next.t), next);
      final.set(next.id, next);
    }
    for (const record of final.values()) {
      const before = tx.get('keys', record.id);
      if (before === undefined || JSON.stringify(before) !== JSON.stringify(record)) tx.put('keys', record);
    }
    written += final.size;
  }
  return { written, curvesCreated };
}

/** The slot of a key time in a per-curve frame map (1e-6 frames). */
function frameSlot(t: Frame): number {
  return Math.round(t / SAME_FRAME_EPS);
}

/** The key within 1e-6 frames of `t` (the earliest, as `writeKeyAt` finds it), or undefined. */
function keyNear(atFrame: ReadonlyMap<number, KeyRecord>, t: Frame): KeyRecord | undefined {
  const slot = frameSlot(t);
  for (const candidate of [slot - 1, slot, slot + 1]) {
    const key = atFrame.get(candidate);
    if (key !== undefined && Math.abs(key.t - t) < SAME_FRAME_EPS) return key;
  }
  return undefined;
}

/** A new key of `key.write` (`writeKeyAt`'s new key: zero handles, unified, weight-locked; §4.11.1 rule 4). */
function newKey(
  app: EditorApp,
  clip: ClipRecord,
  curve: CurveRecord['id'],
  item: PlannedKey,
  fallback: { readonly in: TangentType; readonly out: TangentType },
): KeyRecord {
  return {
    id: newRecordId(app, 'key'),
    clip: clip.id,
    curve,
    t: item.frame,
    v: item.value,
    inType: item.inType ?? fallback.in,
    outType: item.outType ?? fallback.out,
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
    ...(item.breakdown === true ? { breakdown: true } : {}),
  };
}

/** A key already at the frame takes the value, the explicit tangent types and the explicit breakdown flag. */
function rewrittenKey(existing: KeyRecord, item: PlannedKey): KeyRecord {
  const next: KeyRecord = {
    ...existing,
    v: item.value,
    inType: item.inType ?? existing.inType,
    outType: item.outType ?? existing.outType,
  };
  if (item.breakdown === undefined || (existing.breakdown === true) === item.breakdown) return next;
  if (item.breakdown) return { ...next, breakdown: true };
  const { breakdown: _flag, ...rest } = next;
  return rest;
}

export function keyDelete(app: EditorApp, maybe: Tx | null, args: OperatorArgs<'key.delete'>) {
  const tx = txOf(maybe, 'key.delete');
  const clip = requireClipIn(tx, args.clip);
  let deleted = 0;
  for (const [curve, ids] of deletePlan(tx, clip, args)) deleted += deleteCurveKeys(app, tx, curve, ids).length;
  return { deleted };
}

export function keyAdjust(app: EditorApp, maybe: Tx | null, args: OperatorArgs<'key.adjust'>) {
  const tx = txOf(maybe, 'key.adjust');
  const clip = requireClipIn(tx, args.clip);
  const plan = adjustPlan(app, tx, clip, args);
  for (const key of plan.writes) tx.put('keys', key);
  return { keys: plan.writes.length, curves: plan.curves, skipped: plan.skipped };
}

export function keyRetime(app: EditorApp, maybe: Tx | null, args: OperatorArgs<'key.retime'>) {
  const tx = txOf(maybe, 'key.retime');
  const clip = requireClipIn(tx, args.clip);
  const curves = retimeCurves(tx, clip, args.targets);
  const snap = args.snapToFrames !== false;
  const allCurves = (() => {
    const keyed = keyedBaseCurves(tx, clip);
    return keyed.length > 0 && keyed.every((id) => curves.some((curve) => curve.id === id));
  })();
  let moved = 0;
  let merged = 0;
  let clamped = 0;
  let snapped = 0;
  // Breakdowns are not edited: they follow their anchors proportionally (M2A-SPEC §5.12) unless
  // `retimeBreakdowns: false`, which leaves them where they are.
  const keys = curves.flatMap((curve) => {
    const all = tx.query.keysOfCurve(curve.id);
    const anchors = all.filter((key) => key.breakdown !== true);
    return (anchors.length > 0 ? anchors : all).map((key) => key.id);
  });
  const opts: KeyEditOptions = {
    snap: false,
    resolveCollisions: true,
    ripple: args.ripple === true,
    ...(args.retimeBreakdowns === false ? { retimeBreakdowns: false } : {}),
  };
  const scope = { curves: curves.map((curve) => curve.id) };
  switch (args.mode) {
    case 'offset': {
      const offset = args.offset ?? 0;
      if (args.wrap === true) {
        for (const curve of curves) {
          const result = wrapOffsetCurve(app, tx, curve, clip, offset);
          moved += result.moved;
          merged += result.merged;
        }
      } else {
        const before = new Map(keys.map((id) => [id, tx.get('keys', id)?.t ?? 0]));
        const result = moveKeys(app, tx, keys, offset, 0, opts, scope);
        moved = result.moved;
        merged = result.deleted.length;
        clamped = countClamped(tx, before, (t) => t + offset);
      }
      break;
    }
    case 'scale': {
      const pivot = args.pivot ?? clip.range.start;
      const factor = args.factor ?? 1;
      const target = (t: number): number => pivot + (t - pivot) * factor;
      const before = new Map(keys.map((id) => [id, tx.get('keys', id)?.t ?? 0]));
      if (snap) {
        for (const t of before.values()) if (Math.abs(target(t) - Math.round(target(t))) > 1e-9) snapped++;
      }
      const result = scaleKeys(app, tx, keys, pivot, factor, { ...opts, snap }, scope);
      moved = result.moved;
      merged = result.deleted.length;
      clamped = countClamped(tx, before, (t) => (snap ? Math.round(target(t)) : target(t)));
      break;
    }
    case 'insertTime':
    case 'deleteTime': {
      const frames = (args.mode === 'insertTime' ? 1 : -1) * (args.frames ?? 0);
      const result = insertTimeOn(app, tx, curves, args.at ?? 0, frames);
      moved = result.moved;
      merged = result.deleted.length;
      break;
    }
    case 'warp':
      throw new EkzaError('unsupported', `warp is ${NOT_AVAILABLE_YET}`);
  }
  let contactFrame = clip.contact;
  if (allCurves && (args.mode === 'offset' || args.mode === 'scale')) {
    const next = movedContact(clip, args, snap);
    if (next !== clip.contact) tx.patch('clips', clip.id, { contact: next });
    contactFrame = next;
  }
  return { moved, merged, clamped, snapped, contactFrame };
}

// ---------- poses ----------

/** Writes a key and, when `tangent` is given, also sets it on a key that was already there. */
function keyAt(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  control: ControlRecord,
  channel: ChannelId,
  frame: Frame,
  value: number,
  tangent?: TangentType,
): void {
  const curve = ensureCurve(app, tx, clip.id, control.id, channel);
  const defaults = newKeyTangents(control, channel, app.prefs.getState().defaultTangents);
  const tangents = tangent === undefined ? defaults : { in: tangent, out: tangent };
  const id = writeKeyAt(app, tx, curve, frame, value, tangents);
  if (tangent === undefined) return;
  const key = tx.get('keys', id);
  if (key !== undefined && (key.inType !== tangent || key.outType !== tangent)) {
    tx.put('keys', { ...key, inType: tangent, outType: tangent });
  }
}

/** `{mode: 'key'}`: always keys (`key: 'force'` semantics) and, with `syncRotation`, the other rotation axes. */
function setKeys(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  args: SetAtArgs,
  usable: readonly { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[],
  skipped: readonly Skip[],
) {
  if (args.extendRange === true) extendClipRange(tx, clip, [args.frame]);
  const edited = new Map<ControlId, Set<ChannelId>>();
  for (const { control, channel } of usable) {
    const set = edited.get(control.id) ?? new Set<ChannelId>();
    set.add(channel);
    edited.set(control.id, set);
  }
  // The other rotation axes key at their keyed values at the frame (read before any write).
  const synced: { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[] = [];
  if (args.syncRotation !== false) {
    const runtime = requireRuntime(app, clip);
    const rotated = usable.filter((edit) => (ROTATE_CHANNELS as readonly string[]).includes(edit.channel));
    const controls = [...new Map(rotated.map((edit) => [edit.control.id, edit.control])).values()];
    const values = keyedValuesAt(
      runtime,
      clip,
      args.frame,
      controls.map((control) => control.id),
      tx,
    );
    for (const control of controls) {
      for (const channel of ROTATE_CHANNELS) {
        if (edited.get(control.id)?.has(channel) === true || skipOf(control, channel) !== null) continue;
        const value = values.get(control.id)?.[channel];
        if (value !== undefined) synced.push({ control, channel, value });
      }
    }
  }
  const tangent = args.tangent === undefined ? {} : { inType: args.tangent, outType: args.tangent };
  writeKeys(
    app,
    tx,
    clip,
    [...usable, ...synced].map((edit) => ({
      control: edit.control.id,
      channel: edit.channel,
      frame: args.frame,
      value: edit.value,
      ...tangent,
    })),
  );
  return {
    keyed: usable.length,
    synced: synced.length,
    statics: 0,
    skipped,
    hiddenByOverrides: hiddenByOverrides(
      app,
      clip,
      [...usable, ...synced].map((edit) => ({ control: edit.control.id, channel: edit.channel, frame: args.frame })),
    ),
  };
}

/** `{mode: 'static'}`: the base value of channels without keys; animated channels are skipped. */
function setStatics(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  usable: readonly { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[],
  skippedSoFar: readonly Skip[],
) {
  const skipped = [...skippedSoFar];
  let statics = 0;
  for (const { control, channel, value } of usable) {
    const existing = baseCurveIn(tx, clip, control.id, channel);
    if (existing !== undefined && tx.query.keysOfCurve(existing.id).length > 0) {
      skipped.push({ control: control.id, channel, reason: 'animated' });
      continue;
    }
    const curve = existing?.id ?? ensureCurve(app, tx, clip.id, control.id, channel);
    if (tx.get('curves', curve)?.staticValue !== value) tx.patch('curves', curve, { staticValue: value });
    statics++;
  }
  return { keyed: 0, synced: 0, statics, skipped, hiddenByOverrides: [] };
}

/**
 * `{mode: 'propose'}` (View access): unkeyed overrides at the user's current frame, which the user keys with `S` or
 * discards by changing frame. Every edited channel becomes an override (also an unanimated one, where the editor's
 * `key: 'none'` policy would set a static value): a proposal never changes the document.
 */
function propose(
  ctx: OperatorContext,
  usable: readonly { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[],
  skipped: readonly Skip[],
) {
  const session = ctx.app.session;
  const overrides = new Map(session.getState().overrides);
  for (const { control, channel, value } of usable) {
    overrides.set(control.id, { ...overrides.get(control.id), [channel]: value });
  }
  if (usable.length > 0) session.setState({ overrides });
  return { keyed: 0, synced: 0, statics: 0, skipped, hiddenByOverrides: [] };
}

/** Keyable, unlocked channels of `values` (a control's solved channels); locked ones keep their values. */
function writableChannels(app: EditorApp): ChannelFilter {
  return (id, values) => {
    const control = app.store.get('controls', id);
    if (control === undefined) return {};
    const out: Record<string, number> = {};
    for (const [channel, value] of Object.entries(values) as [ChannelId, number | undefined][]) {
      if (value === undefined || !Number.isFinite(value) || skipOf(control, channel) !== null) continue;
      out[channel] = value;
    }
    return out;
  };
}

/** A channel's value at a frame as the transaction sees it (the curves written so far). */
function txValue(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  control: ControlRecord,
  channel: ChannelId,
  frame: Frame,
): number | null {
  const curve = baseCurveIn(tx, clip, control.id, channel);
  if (curve === undefined) return null;
  const { keys, compiled } = compileInTx(app, tx, curve);
  if (keys.length === 0) return curve.staticValue;
  return internalsOf(app).deps.curves.engine.evaluate(compiled, frame);
}

/**
 * `ensureIk: 'auto'` (§4.10): switches only `range` to IK. The IK control (and pole) match the FK pose at the range
 * ends and are keyed there; `@ikFk` keys 1 at both ends and 0 at `start − 1` and `end + 1` when those frames lie in
 * the clip (step tangents), its keys strictly between are removed, so FK keys outside `[start − 1, end + 1]` keep
 * playing unchanged. Returns the keys written.
 */
function switchRangeToIk(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  limb: LimbDesc,
  range: { readonly start: Frame; readonly end: Frame },
): number {
  let keyed = 0;
  for (const frame of new Set([range.start, range.end])) {
    const limbCtx = limbContext(app, limb.id, clip.character, { clip: clip.id, frame });
    if (typeof limbCtx === 'string') throw new EkzaError('unsupported', limbCtx);
    const matched = matchAt(app, limbCtx, 'ik', channelsAt(app, limbCtx, frame, false));
    for (const edit of matchEdits(app, matched.values)) {
      const control = tx.get('controls', edit.control);
      if (control === undefined) continue;
      keyAt(app, tx, clip, control, edit.channel, frame, edit.value);
      keyed++;
    }
  }
  const ikControl = tx.get('controls', limb.params.ikControl);
  if (ikControl === undefined) return keyed;
  const curve = ensureCurve(app, tx, clip.id, ikControl.id, '@ikFk');
  for (const key of tx.query.keysOfCurve(curve)) {
    const between = key.t > range.start - 1 + SAME_FRAME_EPS && key.t < range.end + 1 - SAME_FRAME_EPS;
    const atEnd = Math.abs(key.t - range.start) < SAME_FRAME_EPS || Math.abs(key.t - range.end) < SAME_FRAME_EPS;
    if (between && !atEnd) tx.remove('keys', key.id);
  }
  const writes: [Frame, number][] = [
    [range.start, 1],
    [range.end, 1],
  ];
  if (range.start - 1 >= clip.range.start - SAME_FRAME_EPS) writes.push([range.start - 1, 0]);
  if (range.end + 1 <= clip.range.end + SAME_FRAME_EPS) writes.push([range.end + 1, 0]);
  for (const [frame, value] of writes) {
    const id = writeKeyAt(app, tx, curve, frame, value, { in: 'flat', out: 'step' });
    const key = tx.get('keys', id) as KeyRecord;
    if (key.outType !== 'step') tx.put('keys', { ...key, outType: 'step' });
    keyed++;
  }
  return keyed;
}

function writeChannels(state: GoalState, control: ControlId, values: ChannelValues): void {
  if (state.program.controlIndex.has(control)) writeControlChannels(state.program, state.ch, control, values);
}

export function poseSetAt(ctx: OperatorContext & { readonly tx: Tx | null }, args: SetAtArgs) {
  const { app } = ctx;
  const tx = txOf(ctx.tx, 'pose.setAt');
  const clip = requireClipIn(tx, args.clip);
  const skipped: Skip[] = [];
  const usable: { readonly control: ControlRecord; readonly channel: ChannelId; readonly value: number }[] = [];
  for (const edit of args.edits) {
    const control = tx.get('controls', edit.control);
    if (control === undefined) throw new EkzaError('invalid-record', `Control ${edit.control} does not exist`);
    const reason = skipOf(control, edit.channel);
    if (reason !== null) skipped.push({ control: control.id, channel: edit.channel, reason });
    else usable.push({ control, channel: edit.channel, value: edit.value });
  }
  if (args.mode === 'propose') return propose(ctx, usable, skipped);
  if (args.mode === 'static') return setStatics(app, tx, clip, usable, skipped);
  return setKeys(app, tx, clip, args, usable, skipped);
}

export function poseTransfer(app: EditorApp, maybe: Tx | null, args: TransferArgs) {
  const tx = txOf(maybe, 'pose.transfer');
  const clip = requireClipIn(tx, args.clip);
  const values = transferValues(app, tx, args);
  if (args.extendRange === true) extendClipRange(tx, clip, args.toFrames);
  const items: PlannedKey[] = [];
  for (const [id, pose] of values) {
    const control = tx.get('controls', id);
    if (control === undefined) continue;
    for (const channel of transferChannels(control)) {
      const value = pose[channel];
      if (value === undefined || !Number.isFinite(value)) continue;
      if (baseCurveIn(tx, clip, id, channel)?.locked === true) continue;
      for (const frame of new Set(args.toFrames)) items.push({ control: id, channel, frame, value });
    }
  }
  return { keyed: writeKeys(app, tx, clip, items).written };
}

export function poseGoals(app: EditorApp, maybe: Tx | null, args: GoalsArgs) {
  const tx = txOf(maybe, 'pose.goals');
  const clip = requireClipIn(tx, args.clip);
  const runtime = requireRuntime(app, clip);
  const program = runtime.program;
  if (args.extendRange === true) extendClipRange(tx, clip, [args.frame]);
  const state: GoalState = {
    program,
    ch: keyedChannels(runtime, clip, args.frame),
    pose: program.allocPose(),
    solved: new Map(),
  };
  program.evaluate(state.ch, state.pose);
  const rest = restPoseOf(program);
  const filter = writableChannels(app);
  // Aims, parents first (node indices are topological).
  const aims: AimRequest[] = (args.aims ?? [])
    .map((aim) => ({
      node: boneNode(runtime, aim.bone),
      bone: aim.bone,
      direction: aim.direction,
      keepTwist: aim.keepTwist,
      weight: aim.weight,
      ...(aim.split === undefined ? {} : { split: aim.split }),
    }))
    .sort((a, b) => a.node - b.node);
  for (const aim of aims) applyAim(state, rest, runtime, aim, filter);
  const aimResults = aims.map((aim) => {
    const result = aimResult(state, rest, runtime, aim);
    return { bone: aim.bone, control: drivingControl(program, aim.node) as ControlId, ...result };
  });
  // IK goals, after any range switch they need.
  let keyed = 0;
  const ikResults: {
    limb: LimbId;
    reached: boolean;
    errorM: number;
    switched: { start: Frame; end: Frame } | null;
  }[] = [];
  for (const goal of args.ik ?? []) {
    const limb = program.limbs.find((candidate) => candidate.id === goal.limb) as LimbDesc;
    let switched: { start: Frame; end: Frame } | null = null;
    if (goal.ensureIk === 'auto' && ikFkIn(limb, state.ch) < IK_FROM && goal.switchRange !== undefined) {
      keyed += switchRangeToIk(app, tx, clip, limb, goal.switchRange);
      switched = { start: goal.switchRange.start, end: goal.switchRange.end };
      // The IK side at the frame as the switch keyed it (the pole interpolates between the matched ends).
      for (const id of [limb.params.ikControl, limb.params.pole]) {
        const control = tx.get('controls', id);
        if (control === undefined) continue;
        const values: Partial<Record<ChannelId, number>> = {};
        for (const channel of ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const) {
          const value = txValue(app, tx, clip, control, channel, args.frame);
          if (value !== null) values[channel] = value;
        }
        writeChannels(state, id, values);
      }
    }
    const errorM = applyIkGoal(app, state, limb, goal, filter);
    ikResults.push({ limb: goal.limb, reached: errorM <= REACHED_M, errorM, switched });
  }
  // Key every solved channel at the frame.
  for (const [id, values] of state.solved) {
    const control = tx.get('controls', id);
    if (control === undefined) continue;
    for (const [channel, value] of Object.entries(values) as [ChannelId, number | undefined][]) {
      if (value === undefined) continue;
      keyAt(app, tx, clip, control, channel, args.frame, value);
      keyed++;
    }
  }
  return { aims: aimResults, ik: ikResults, keyed };
}

// ---------- clips ----------

const METHOD_TEXT: Readonly<Record<LoopMethod, string>> = {
  matchEnds: 'match ends',
  blend: 'blend',
  cycleOnly: 'cycle only',
};
/** Rows of `SeamMetrics.worst`. */
const WORST_ROWS = 5;
/**
 * The controls whose X/Z translation is the clip's root travel: the in-place node's driver (hips on humanoids,
 * §4.11.10) and the space controls above it (`cog`, `root`), which move it too.
 */
function travelControls(app: EditorApp, clip: ClipRecord): ReadonlySet<ControlId> {
  const out = new Set<ControlId>();
  const runtime = app.characters.get(clip.character);
  if (runtime === undefined) return out;
  const node = inPlaceNode(app.store, runtime.program, clip);
  let control = node === null ? null : drivingControl(runtime.program, node);
  while (control !== null && !out.has(control)) {
    out.add(control);
    control = app.store.get('controls', control)?.parent ?? null;
  }
  return out;
}

function metricsOf(values: readonly SeamValue[]): SeamMetrics {
  let maxC0 = 0;
  let maxC1 = 0;
  for (const value of values) {
    maxC0 = Math.max(maxC0, value.c0);
    maxC1 = Math.max(maxC1, value.c1);
  }
  const worst: ChannelTarget[] = [...values]
    .filter((value) => value.c0 + value.c1 > 1e-9)
    .sort((a, b) => b.c0 + b.c1 - (a.c0 + a.c1))
    .slice(0, WORST_ROWS)
    .map((value) => ({ control: value.control, channel: value.channel }));
  return { maxC0, maxC1, worst };
}

interface LoopArgs {
  readonly method: LoopMethod;
  readonly blendFrames?: number;
  readonly rootTravel: RootTravel;
}

/** The plan of every animated base curve of the clip. */
function planClip(app: EditorApp, view: Tx | EditorApp['store'], clip: ClipRecord, args: LoopArgs): LoopCurvePlan[] {
  const layer = view.query.baseLayer(clip.id);
  if (layer === undefined) return [];
  const travel = travelControls(app, clip);
  const blendFrames = args.blendFrames ?? DEFAULT_BLEND_FRAMES;
  return view.query
    .curvesOfClip(clip.id)
    .filter((curve) => curve.layer === layer.id && view.query.keysOfCurve(curve.id).length > 0)
    .map((curve) =>
      planLoopCurve(app, view, clip, curve, {
        method: args.method,
        rootTravel: args.rootTravel,
        travel: travel.has(curve.control) && (curve.channel === 'tx' || curve.channel === 'tz'),
        blendFrames,
      }),
    );
}

/** Writes one curve plan: removed keys go, planned keys are put (new ones get ids), infinities follow. */
function writePlan(app: EditorApp, tx: Tx, plan: LoopCurvePlan): void {
  const planned = new Set(plan.keys.map((key) => key.id).filter((id) => id !== null));
  for (const key of tx.query.keysOfCurve(plan.curve.id)) if (!planned.has(key.id)) tx.remove('keys', key.id);
  for (const key of plan.keys) {
    const existing = key.id === null ? undefined : tx.get('keys', key.id);
    const record: KeyRecord = {
      ...key.data,
      id: existing?.id ?? newRecordId(app, 'key'),
      clip: plan.curve.clip,
      curve: plan.curve.id,
    };
    if (existing === undefined || JSON.stringify(existing) !== JSON.stringify({ ...existing, ...record })) {
      tx.put('keys', existing === undefined ? record : { ...existing, ...record });
    }
  }
  if (plan.pre !== plan.curve.pre || plan.post !== plan.curve.post) {
    tx.patch('curves', plan.curve.id, { pre: plan.pre, post: plan.post });
  }
}

export function makeLoop(app: EditorApp, tx: Tx | null, args: OperatorArgs<'clip.makeLoop'>) {
  if (tx === null) throw new EkzaError('internal', 'clip.makeLoop runs in a transaction');
  const clip = tx.get('clips', args.clip);
  if (clip === undefined) throw new EkzaError('invalid-record', `Clip ${args.clip} does not exist`);
  const plans = planClip(app, tx, clip, args);
  const before = metricsOf(seamValues(app, tx, clip, plans, 'before'));
  const after = metricsOf(seamValues(app, tx, clip, plans, 'after'));
  const changed = plans.filter((plan) => plan.changed);
  if (args.dryRun !== true) {
    for (const plan of changed) writePlan(app, tx, plan);
    if (!clip.loop) tx.patch('clips', clip.id, { loop: true });
    // §5.6: `Make Loop "walk" (match ends)` (agent runs get the runner's `AI: ` prefix).
    tx.annotate({ label: `Make Loop "${clip.name}" (${METHOD_TEXT[args.method]})` });
  }
  return { before, after, curvesChanged: changed.length };
}

const METHODS: readonly LoopMethod[] = ['matchEnds', 'blend', 'cycleOnly'];
const TRAVEL: readonly RootTravel[] = ['cycleOffset', 'inPlace', 'keep'];

/**
 * An upper bound of the key records `clip.makeLoop` writes or deletes (§5.5), from the curves alone (no planning):
 * per animated, unlocked base curve the two seam keys; a root travel curve made in place rewrites every key; `blend`
 * (except on cycleOffset travel curves) bakes one key per whole frame of the tail, adds the key where the tail starts
 * and replaces the keys inside it.
 */
function loopWriteCount(app: EditorApp, clip: ClipRecord, args: LoopArgs): number {
  const view = app.store;
  const layer = view.query.baseLayer(clip.id);
  if (layer === undefined) return 0;
  const travel = travelControls(app, clip);
  const { start, end } = clip.range;
  const from = Math.max(start, end - (args.blendFrames ?? DEFAULT_BLEND_FRAMES));
  const baked = Math.max(0, Math.floor(end + SAME_FRAME_EPS) - Math.floor(from + SAME_FRAME_EPS));
  let count = 0;
  for (const curve of view.query.curvesOfClip(clip.id)) {
    if (curve.layer !== layer.id || curve.locked) continue;
    const keys = view.query.keysOfCurve(curve.id);
    if (keys.length === 0) continue;
    const isTravel = travel.has(curve.control) && (curve.channel === 'tx' || curve.channel === 'tz');
    if (isTravel && args.rootTravel === 'keep') continue;
    if (isTravel && args.rootTravel === 'inPlace') count += keys.length + 2;
    else if (args.method !== 'cycleOnly') count += 2;
    if (args.method === 'blend' && !(isTravel && args.rootTravel === 'cycleOffset')) {
      count += baked + 1;
      for (const key of keys) if (key.t > from + SAME_FRAME_EPS && key.t <= end + SAME_FRAME_EPS) count++;
    }
    if (count > AGENT_WRITE_LIMIT) break;
  }
  return count;
}

function pollMakeLoop(ctx: OperatorContext, raw: unknown): PollResult {
  const { app } = ctx;
  const base = pollAgentClip(app, raw);
  if (base !== true) return base;
  const args = raw as Readonly<Record<string, unknown>>;
  if (!METHODS.includes(args['method'] as LoopMethod)) return fail(`method is one of ${METHODS.join(', ')}`);
  if (!TRAVEL.includes(args['rootTravel'] as RootTravel)) return fail(`rootTravel is one of ${TRAVEL.join(', ')}`);
  if (args['dryRun'] !== undefined && typeof args['dryRun'] !== 'boolean') return fail('dryRun must be a boolean');
  const clip = clipArg(app.store, raw) as ClipRecord;
  const span = clip.range.end - clip.range.start;
  const blend = args['blendFrames'];
  if (blend !== undefined && (!isFiniteNumber(blend) || blend < 1 || blend > Math.max(1, span))) {
    return fail(`blendFrames must lie in 1…${Math.max(1, span)} (the clip length)`);
  }
  if (!(span > 0)) return fail('The clip range is empty');
  if (isActorRun(ctx) && span > AGENT_SPAN_LIMIT) return fail(`The clip spans more than ${AGENT_SPAN_LIMIT} frames`);
  if (loopWriteCount(app, clip, raw as LoopArgs) <= AGENT_WRITE_LIMIT) return OK;
  return fail(
    args['method'] === 'blend'
      ? `Blending would write more than ${AGENT_WRITE_LIMIT} keys; pass fewer blendFrames`
      : `The loop would write more than ${AGENT_WRITE_LIMIT} keys`,
  );
}

// ---------- history ----------

export function revertSteps(ctx: ApplyContext, args: OperatorArgs<'edit.revertSteps'>) {
  const { app, tx } = ctx;
  if (tx === null) throw new EkzaError('internal', 'edit.revertSteps runs in a transaction');
  const steps = revertible(app.history.entries().undo, args.steps);
  if (typeof steps === 'string') throw new EkzaError('unsupported', steps);
  const reverted: number[] = [];
  const skipped: { step: number; reason: string }[] = [];
  const skippedFields: { table: string; id: string; fields: readonly string[] | null }[] = [];
  // Newest first, each against the document as the earlier reverts left it (the transaction's view).
  for (const step of [...steps].sort((a, b) => b.id - a.id)) {
    const plan = planRestore(restoreHostOf(tx), step.changes ?? [], 'undo');
    const written = applyRestorePlan(tx, plan);
    for (const skip of plan.skipped) {
      skippedFields.push({ table: skip.change.table, id: String(skip.change.id), fields: skip.fields });
    }
    if (written > 0) reverted.push(step.id);
    else skipped.push({ step: step.id, reason: plan.skipped.length > 0 ? 'changed since' : 'nothing to revert' });
  }
  // Labels (§4.10): agent runs `AI: Revert N steps` (the runner adds the prefix); user runs name the AI step.
  if (!isActorRun(ctx)) {
    const only = steps.length === 1 ? steps[0] : undefined;
    tx.annotate({ label: only === undefined ? `Revert ${steps.length} AI steps` : `Revert AI step: ${only.label}` });
  }
  return { reverted: reverted.sort((a, b) => a - b), skipped, skippedFields };
}

export function restoreDocument(tx: Tx | null, args: OperatorArgs<'edit.restoreDocument'>) {
  if (tx === null) throw new EkzaError('internal', 'edit.restoreDocument runs in a transaction');
  return { writes: applyRestorePlan(tx, planSnapshotRestore(restoreHostOf(tx), args.snapshot)) };
}

/** The full polls of the operators `agentLoad.ts` defines (their shape check answers until this module loads). */
export const AGENT_POLLS = {
  'key.write': pollKeyWrite,
  'key.delete': pollKeyDelete,
  'key.adjust': pollKeyAdjust,
  'key.retime': pollKeyRetime,
  'pose.setAt': pollPoseSetAt,
  'pose.goals': pollPoseGoals,
  'pose.transfer': pollPoseTransfer,
  'clip.makeLoop': pollMakeLoop,
} as const satisfies Partial<Readonly<Record<keyof OperatorMap, (ctx: OperatorContext, raw: unknown) => PollResult>>>;
