// M-AI explicit-target key operators (MCP-SPEC §4.10): `key.write`, `key.delete`, `key.adjust`, `key.retime`. They take
// stored units and explicit targets (never the session's selection, playhead or overrides) and their `label` argument
// is set by the tool layer. One transaction each; `internal` (hidden from menus, palette and keymaps).
import { EkzaError, type Frame, type TangentType } from '@ekza-animator/anim-core';
import type {
  ChannelId,
  ClipRecord,
  ControlId,
  ControlRecord,
  CurveRecord,
  KeyId,
  KeyRecord,
  Tx,
} from '@ekza-animator/doc';
import { isKeyable, isLocked, newKeyTangents } from '../../edit/channelMeta';
import { compileInTx, SAME_FRAME_EPS } from '../../edit/context';
import { ensureCurve, moveKeys, scaleKeys, writeKeyAt } from '../../edit/keys';
import { internalsOf } from '../../app/internals';
import { type EditorApp, GLOBAL_SCOPE, type KeyEditOptions } from '../../types';
import {
  type AdjustOffsets,
  type AdjustWhere,
  adjustedKey,
  adjustKindOf,
  adjustWeight,
  offsetFor,
  pivotValueOf,
} from '../../workflows/adjust';
import { deleteCurveKeys, insertTimeOn, keyedBaseCurves, wrapOffsetCurve } from '../../workflows/retime';
import type { AdjustPivot, ChannelTarget, KeyChannels, KeyWriteItem } from '../args';
import {
  AGENT_SPAN_LIMIT,
  AGENT_WRITE_LIMIT,
  baseCurveIn,
  clipArg,
  controlOfClip,
  extendClipRange,
  frameProblem,
  framesProblem,
  hiddenByOverrides,
  keyedValuesAt,
  labelOf,
  labelProblem,
  pollAgentClip,
  rangeExtensionProblem,
  rangeProblem,
  runtimeOfClip,
  targetsProblem,
  uniqueTargets,
} from './agentCommon';
import { type AnyOperator, defineOperator, fail, isFiniteNumber, isRecord, OK } from './define';
import { keyChannelsOf } from './key';
import { NOT_AVAILABLE_YET } from './stub';

const AGENT = { category: 'key', scope: GLOBAL_SCOPE, flags: { undo: true, internal: true } } as const;

const TANGENTS: readonly TangentType[] = [
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
const POSE_CHANNELS: readonly KeyChannels[] = ['all', 'translate', 'rotate', 'scale', 'attributes'];

function requireClipIn(tx: Tx, clip: ClipRecord['id']): ClipRecord {
  const record = tx.get('clips', clip);
  if (record === undefined) throw new EkzaError('invalid-record', `Clip ${clip} does not exist`);
  return record;
}

function txOf(tx: Tx | null, id: string): Tx {
  if (tx === null) throw new EkzaError('internal', `${id} runs in a transaction`);
  return tx;
}

/** `control.channel` as the messages name it (`fk.hand.L.rz`). */
function channelName(control: ControlRecord, channel: ChannelId): string {
  return `${control.key}.${channel}`;
}

/** Why a channel cannot be written: locked or non-keyable (null when it can). */
function writeRefusal(control: ControlRecord, channel: ChannelId): string | null {
  if (!isKeyable(control, channel)) return `${channelName(control, channel)} is not keyable`;
  if (isLocked(control, channel)) return `${channelName(control, channel)} is locked`;
  return null;
}

// ---------- key.write ----------

interface WriteArgs {
  readonly clip: ClipRecord['id'];
  readonly keys?: readonly KeyWriteItem[];
  readonly poseAt?: {
    readonly controls: readonly ControlId[];
    readonly frames: readonly Frame[];
    readonly channels?: KeyChannels;
  };
  readonly extendRange?: boolean;
}

/** One planned key of `key.write`. */
interface PlannedKey extends ChannelTarget {
  readonly frame: Frame;
  readonly value: number;
  readonly inType?: TangentType;
  readonly outType?: TangentType;
  readonly breakdown?: boolean;
}

function keyItemProblem(app: EditorApp, clip: ClipRecord, item: unknown, name: string): string | null {
  if (!isRecord(item)) return `${name} must be { control, channel, frame, value, … }`;
  const control = controlOfClip(app.store, clip, item['control']);
  if (control === undefined) return `${name}: the control is not one of the clip's character`;
  const channel = item['channel'];
  if (typeof channel !== 'string' || !(channel.startsWith('@') || /^[trs][xyz]$/.test(channel))) {
    return `${name}: unknown channel ${String(channel)}`;
  }
  const refused = writeRefusal(control, channel as ChannelId);
  if (refused !== null) return `${name}: ${refused}`;
  const frame = frameProblem(item['frame'], `${name}.frame`);
  if (frame !== null) return frame;
  if (!isFiniteNumber(item['value'])) return `${name}.value must be a finite number`;
  for (const side of ['inType', 'outType'] as const) {
    const type = item[side];
    if (type !== undefined && !TANGENTS.includes(type as TangentType)) return `${name}.${side}: unknown tangent`;
  }
  if (item['breakdown'] !== undefined && typeof item['breakdown'] !== 'boolean') {
    return `${name}.breakdown must be a boolean`;
  }
  const curve = baseCurveIn(app.store, clip, control.id, channel as ChannelId);
  if (curve?.locked === true) return `${name}: the curve ${channelName(control, channel as ChannelId)} is locked`;
  return null;
}

/** The keys `key.write` writes (pose keys are planned from the committed keyed pose). */
function planWrite(app: EditorApp, clip: ClipRecord, args: WriteArgs): PlannedKey[] | string {
  if (args.keys !== undefined) return args.keys.map((item) => ({ ...item }));
  const poseAt = args.poseAt;
  if (poseAt === undefined) return [];
  const runtime = runtimeOfClip(app, clip);
  if (typeof runtime === 'string') return runtime;
  const which = poseAt.channels ?? 'all';
  const controls = poseAt.controls
    .map((id) => app.store.get('controls', id))
    .filter((control) => control !== undefined);
  const out: PlannedKey[] = [];
  for (const frame of new Set(poseAt.frames)) {
    const values = keyedValuesAt(
      runtime,
      clip,
      frame,
      controls.map((control) => control.id),
      app.store,
    );
    for (const control of controls) {
      const pose = values.get(control.id);
      if (pose === undefined) continue;
      // `keyChannelsOf` with an explicit (empty) channel choice: no session read; keyAll: false modes stay unkeyed.
      for (const channel of keyChannelsOf(app, control, which, new Set())) {
        const value = pose[channel];
        if (value === undefined || !Number.isFinite(value)) continue;
        if (baseCurveIn(app.store, clip, control.id, channel)?.locked === true) continue;
        out.push({ control: control.id, channel, frame, value });
      }
    }
  }
  return out;
}

function writeProblem(app: EditorApp, raw: unknown): string | null {
  if (!isRecord(raw)) return 'expects { clip, keys | poseAt, extendRange? }';
  const clip = clipArg(app.store, raw) as ClipRecord;
  const label = labelProblem(raw);
  if (label !== null) return label;
  if ((raw['keys'] === undefined) === (raw['poseAt'] === undefined)) return 'expects exactly one of keys or poseAt';
  if (raw['extendRange'] !== undefined && typeof raw['extendRange'] !== 'boolean') {
    return 'extendRange must be a boolean';
  }
  const frames: Frame[] = [];
  if (raw['keys'] !== undefined) {
    if (!Array.isArray(raw['keys'])) return 'keys must be a list';
    const keys = raw['keys'] as readonly unknown[];
    if (keys.length === 0) return 'keys is empty';
    if (keys.length > AGENT_WRITE_LIMIT) return `keys has more than ${AGENT_WRITE_LIMIT} entries`;
    for (let i = 0; i < keys.length; i++) {
      const problem = keyItemProblem(app, clip, keys[i], `keys[${i}]`);
      if (problem !== null) return problem;
      frames.push((keys[i] as { readonly frame: Frame }).frame);
    }
  } else {
    const poseAt = raw['poseAt'];
    if (!isRecord(poseAt)) return 'poseAt must be { controls, frames, channels? }';
    if (!Array.isArray(poseAt['controls']) || (poseAt['controls'] as readonly unknown[]).length === 0) {
      return 'poseAt.controls must name at least one control';
    }
    for (const control of poseAt['controls'] as readonly unknown[]) {
      if (controlOfClip(app.store, clip, control) === undefined) {
        return "poseAt.controls: a control is not one of the clip's character";
      }
    }
    const problem = framesProblem(poseAt['frames'], 'poseAt.frames');
    if (problem !== null) return problem;
    const channels = poseAt['channels'];
    if (channels === 'selected') return "poseAt.channels 'selected' reads the user's channel selection; name the keys";
    if (channels !== undefined && !POSE_CHANNELS.includes(channels as KeyChannels)) {
      return `poseAt.channels is one of ${POSE_CHANNELS.join(', ')}`;
    }
    const runtime = runtimeOfClip(app, clip);
    if (typeof runtime === 'string') return runtime;
    frames.push(...(poseAt['frames'] as readonly Frame[]));
  }
  const range = rangeExtensionProblem(clip, frames, raw['extendRange'] === true);
  if (range !== null) return range;
  if (raw['poseAt'] !== undefined) {
    const planned = planWrite(app, clip, raw as unknown as WriteArgs);
    if (typeof planned === 'string') return planned;
    if (planned.length === 0) return 'Nothing to key: the controls have no keyable channels';
    if (planned.length > AGENT_WRITE_LIMIT) return `The pose would write more than ${AGENT_WRITE_LIMIT} keys`;
  }
  return null;
}

const keyWrite = defineOperator({
  ...AGENT,
  id: 'key.write',
  label: 'Set Keys',
  description: 'Write keys on explicit control channels at clip frames, or key the keyed pose of controls at frames.',
  undoLabel: (args) => labelOf(args, 'Set Keys'),
  poll({ app }, raw) {
    const base = pollAgentClip(app, raw);
    if (base !== true) return base;
    const problem = writeProblem(app, raw);
    return problem === null ? OK : fail(problem);
  },
  apply({ app, tx: maybe }, args) {
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
    const defaults = app.prefs.getState().defaultTangents;
    let curvesCreated = 0;
    for (const item of planned) {
      const control = tx.get('controls', item.control);
      if (control === undefined) throw new EkzaError('invalid-record', `Control ${item.control} does not exist`);
      if (baseCurveIn(tx, clip, item.control, item.channel) === undefined) curvesCreated++;
      const curve = ensureCurve(app, tx, clip.id, item.control, item.channel);
      const fallback = newKeyTangents(control, item.channel, defaults);
      const tangents = { in: item.inType ?? fallback.in, out: item.outType ?? fallback.out };
      const id = writeKeyAt(
        app,
        tx,
        curve,
        item.frame,
        item.value,
        tangents,
        item.breakdown === undefined ? undefined : { breakdown: item.breakdown, existing: 'set' },
      );
      // An explicit tangent also applies to a key that was already there.
      const written = tx.get('keys', id);
      if (written !== undefined && (item.inType !== undefined || item.outType !== undefined)) {
        const inType = item.inType ?? written.inType;
        const outType = item.outType ?? written.outType;
        if (inType !== written.inType || outType !== written.outType) tx.put('keys', { ...written, inType, outType });
      }
    }
    return {
      written: planned.length,
      curvesCreated,
      rangeExtended,
      hiddenByOverrides: hiddenByOverrides(app, clip, planned),
    };
  },
});

// ---------- key.delete ----------

/** The keys `key.delete` deletes, per curve. */
function deletePlan(
  view: Tx | EditorApp['store'],
  clip: ClipRecord,
  args: {
    readonly targets: readonly ChannelTarget[];
    readonly frames?: readonly Frame[];
    readonly range?: { readonly start: Frame; readonly end: Frame };
  },
): Map<CurveRecord, KeyId[]> {
  const plan = new Map<CurveRecord, KeyId[]>();
  for (const target of uniqueTargets(args.targets)) {
    const curve = baseCurveIn(view, clip, target.control, target.channel);
    if (curve === undefined || curve.locked) continue;
    const ids = view.query
      .keysOfCurve(curve.id)
      .filter((key) => keyMatches(key, args))
      .map((key) => key.id);
    if (ids.length > 0) plan.set(curve, ids);
  }
  return plan;
}

function keyMatches(
  key: KeyRecord,
  args: { readonly frames?: readonly Frame[]; readonly range?: { readonly start: Frame; readonly end: Frame } },
): boolean {
  if (args.frames !== undefined) return args.frames.some((frame) => Math.abs(frame - key.t) < SAME_FRAME_EPS);
  if (args.range !== undefined) {
    return key.t >= args.range.start - SAME_FRAME_EPS && key.t <= args.range.end + SAME_FRAME_EPS;
  }
  return true;
}

const keyDelete = defineOperator({
  ...AGENT,
  id: 'key.delete',
  label: 'Delete Keys',
  description: 'Delete keys of explicit control channels at frames or inside a frame range.',
  undoLabel: (args) => labelOf(args, 'Delete Keys'),
  poll({ app }, raw) {
    const base = pollAgentClip(app, raw);
    if (base !== true) return base;
    const args = raw as unknown as Readonly<Record<string, unknown>>;
    const clip = clipArg(app.store, raw) as ClipRecord;
    const problem =
      labelProblem(args) ??
      targetsProblem(app.store, clip, args['targets']) ??
      (args['frames'] !== undefined && args['range'] !== undefined ? 'expects frames or range, not both' : null) ??
      (args['frames'] === undefined ? null : framesProblem(args['frames'], 'frames')) ??
      (args['range'] === undefined ? null : rangeProblem(args['range']));
    if (problem !== null) return fail(problem);
    if ((args['targets'] as readonly unknown[]).length === 0) return fail('targets is empty');
    let count = 0;
    for (const ids of deletePlan(app.store, clip, raw as never).values()) count += ids.length;
    return count > AGENT_WRITE_LIMIT ? fail(`The call would delete more than ${AGENT_WRITE_LIMIT} keys`) : OK;
  },
  apply({ app, tx: maybe }, args) {
    const tx = txOf(maybe, 'key.delete');
    const clip = requireClipIn(tx, args.clip);
    let deleted = 0;
    for (const [curve, ids] of deletePlan(tx, clip, args)) deleted += deleteCurveKeys(app, tx, curve, ids).length;
    return { deleted };
  },
});

// ---------- key.adjust ----------

const PIVOTS = ['rest', 'mean', 'rangeStart', 'frame', 'value'] as const;
/** Offset bounds per kind in stored units (§5.5: ±3,600° and ±1,000 m; factors and attributes ±1,000). */
const OFFSET_LIMIT: Readonly<Record<keyof AdjustOffsets, number>> = {
  rotate: 20 * Math.PI,
  translate: 1000,
  scale: 1000,
  attr: 1000,
};

function adjustProblem(app: EditorApp, clip: ClipRecord, args: Readonly<Record<string, unknown>>): string | null {
  const problem =
    labelProblem(args) ??
    targetsProblem(app.store, clip, args['targets']) ??
    (args['frames'] !== undefined && args['range'] !== undefined ? 'expects range or frames, not both' : null) ??
    (args['frames'] === undefined ? null : framesProblem(args['frames'], 'frames')) ??
    (args['range'] === undefined ? null : rangeProblem(args['range']));
  if (problem !== null) return problem;
  if ((args['targets'] as readonly unknown[]).length === 0) return 'targets is empty';
  const factor = args['factor'];
  if (factor !== undefined && (!isFiniteNumber(factor) || factor < 0.01 || factor > 100)) {
    return 'factor must lie in 0.01…100';
  }
  const offset = args['offset'];
  if (offset !== undefined) {
    if (!isRecord(offset)) return 'offset is { rotate?, translate?, scale?, attr? }';
    for (const [kind, value] of Object.entries(offset)) {
      if (!Object.hasOwn(OFFSET_LIMIT, kind)) return `offset.${kind} is not an offset kind`;
      const limit = OFFSET_LIMIT[kind as keyof AdjustOffsets];
      if (value !== undefined && (!isFiniteNumber(value) || Math.abs(value) > limit)) {
        return `offset.${kind} must be a finite number within ±${limit}`;
      }
    }
  }
  const hasOffset = isRecord(offset) && Object.values(offset).some((value) => value !== undefined && value !== 0);
  if (factor === undefined && !hasOffset) return 'Nothing to adjust: pass factor or offset';
  const pivot = args['pivot'];
  if (pivot !== undefined) {
    if (!isRecord(pivot) || !PIVOTS.includes(pivot['kind'] as (typeof PIVOTS)[number])) {
      return `pivot.kind is one of ${PIVOTS.join(', ')}`;
    }
    if (pivot['kind'] === 'frame') {
      const frame = frameProblem(pivot['frame'], 'pivot.frame');
      if (frame !== null) return frame;
    }
    if (pivot['kind'] === 'value' && !isFiniteNumber(pivot['value'])) return 'pivot.value must be a finite number';
  }
  const falloff = args['falloffFrames'];
  if (falloff !== undefined && (!isFiniteNumber(falloff) || falloff < 0 || falloff > AGENT_SPAN_LIMIT)) {
    return `falloffFrames must lie in 0…${AGENT_SPAN_LIMIT}`;
  }
  const range = (args['range'] as { readonly start: Frame; readonly end: Frame } | undefined) ?? clip.range;
  if (
    (pivot as { readonly kind?: unknown } | undefined)?.kind === 'mean' &&
    range.end - range.start > AGENT_SPAN_LIMIT
  ) {
    return `The mean pivot samples at most ${AGENT_SPAN_LIMIT} frames; pass a shorter range`;
  }
  return null;
}

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

const keyAdjust = defineOperator({
  ...AGENT,
  id: 'key.adjust',
  label: 'Adjust Keys',
  description: 'Scale key values about a pivot or offset them over a frame range, keeping tangent shapes.',
  undoLabel: (args) => labelOf(args, 'Adjust Keys'),
  poll({ app }, raw) {
    const base = pollAgentClip(app, raw);
    if (base !== true) return base;
    const clip = clipArg(app.store, raw) as ClipRecord;
    const problem = adjustProblem(app, clip, raw as unknown as Readonly<Record<string, unknown>>);
    if (problem !== null) return fail(problem);
    const plan = adjustPlan(app, app.store, clip, raw as unknown as AdjustArgs);
    return plan.writes.length > AGENT_WRITE_LIMIT
      ? fail(`The call would change more than ${AGENT_WRITE_LIMIT} keys`)
      : OK;
  },
  apply({ app, tx: maybe }, args) {
    const tx = txOf(maybe, 'key.adjust');
    const clip = requireClipIn(tx, args.clip);
    const plan = adjustPlan(app, tx, clip, args);
    for (const key of plan.writes) tx.put('keys', key);
    return { keys: plan.writes.length, curves: plan.curves, skipped: plan.skipped };
  },
});

// ---------- key.retime ----------

const RETIME_MODES = ['offset', 'scale', 'insertTime', 'deleteTime', 'warp'] as const;

function retimeProblem(app: EditorApp, clip: ClipRecord, args: Readonly<Record<string, unknown>>): string | null {
  const problem = labelProblem(args) ?? targetsProblem(app.store, clip, args['targets']);
  if (problem !== null) return problem;
  if ((args['targets'] as readonly unknown[]).length === 0) return 'targets is empty';
  const mode = args['mode'];
  if (!RETIME_MODES.includes(mode as (typeof RETIME_MODES)[number])) return `mode is one of ${RETIME_MODES.join(', ')}`;
  for (const flag of ['wrap', 'ripple', 'retimeBreakdowns', 'snapToFrames'] as const) {
    if (args[flag] !== undefined && typeof args[flag] !== 'boolean') return `${flag} must be a boolean`;
  }
  switch (mode) {
    case 'offset': {
      const offset = args['offset'];
      if (!isFiniteNumber(offset) || Math.abs(offset) > AGENT_SPAN_LIMIT) {
        return `offset must be a number of frames within ±${AGENT_SPAN_LIMIT}`;
      }
      if (args['wrap'] === true && !clip.loop) return 'wrap needs a loop clip (clip settings › loop)';
      return null;
    }
    case 'scale': {
      const factor = args['factor'];
      if (!isFiniteNumber(factor) || factor < 0.01 || factor > 100) return 'factor must lie in 0.01…100';
      return args['pivot'] === undefined ? null : frameProblem(args['pivot'], 'pivot');
    }
    case 'insertTime':
    case 'deleteTime': {
      const at = frameProblem(args['at'], 'at');
      if (at !== null) return at;
      const frames = args['frames'];
      if (!isFiniteNumber(frames) || frames <= 0 || frames > AGENT_SPAN_LIMIT) {
        return `frames must be a positive number of frames ≤ ${AGENT_SPAN_LIMIT}`;
      }
      return null;
    }
    default:
      return `warp is ${NOT_AVAILABLE_YET} (M-AI stretch)`;
  }
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

const keyRetime = defineOperator({
  ...AGENT,
  id: 'key.retime',
  label: 'Retime Keys',
  description: 'Offset, scale, insert or delete time on the keys of explicit control channels.',
  undoLabel: (args) => labelOf(args, 'Retime Keys'),
  poll({ app }, raw) {
    const base = pollAgentClip(app, raw);
    if (base !== true) return base;
    const clip = clipArg(app.store, raw) as ClipRecord;
    const problem = retimeProblem(app, clip, raw as unknown as Readonly<Record<string, unknown>>);
    return problem === null ? OK : fail(problem);
  },
  apply({ app, tx: maybe }, args) {
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
  },
});

/** Keys (still there) whose final time differs from their target time: stopped by a key that did not move. */
function countClamped(tx: Tx, before: ReadonlyMap<KeyId, number>, target: (t: number) => number): number {
  let clamped = 0;
  for (const [id, t] of before) {
    const key = tx.get('keys', id);
    if (key !== undefined && Math.abs(key.t - target(t)) > SAME_FRAME_EPS) clamped++;
  }
  return clamped;
}

export const AGENT_KEY_OPERATORS: readonly AnyOperator[] = [keyWrite, keyDelete, keyAdjust, keyRetime];
