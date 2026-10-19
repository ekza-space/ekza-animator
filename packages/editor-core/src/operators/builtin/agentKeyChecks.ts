// The polls of the M-AI explicit-target key operators (MCP-SPEC §4.10, §5.5) and the plans they share with the applies:
// `key.write` (the keys it writes), `key.delete` (the keys it deletes), `key.adjust` (the keys it can change),
// `key.retime` (the keys it moves and where they land). Loaded with the implementation (`agentLoad.ts`); the
// definitions live in `agentKeys.ts`.
import type { Frame, TangentType } from '@ekza-animator/anim-core';
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
import { isKeyable, isLocked } from '../../edit/channelMeta';
import { SAME_FRAME_EPS } from '../../edit/context';
import type { EditorApp, OperatorArgs, OperatorContext, PollResult } from '../../types';
import type { AdjustOffsets } from '../../workflows/adjust';
import type { ChannelTarget, KeyChannels, KeyWriteItem } from '../args';
import {
  baseCurveIn,
  controlOfClip,
  keyedValuesAt,
  labelProblem,
  rangeExtensionProblem,
  rangeProblem,
  runtimeOfClip,
  targetsProblem,
  uniqueTargets,
} from './agentCommon';
import {
  AGENT_FRAME_LIMIT,
  AGENT_SPAN_LIMIT,
  AGENT_WRITE_LIMIT,
  clipArg,
  frameProblem,
  framesProblem,
  pollAgentClip,
} from './agentLoad';
import { fail, isFiniteNumber, isRecord, OK } from './define';
import { keyChannelsOf } from './key';
import { NOT_AVAILABLE_YET } from './stub';

/** Tangent types a key argument may name. */
export const TANGENTS: readonly TangentType[] = [
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

export interface WriteArgs {
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
export interface PlannedKey extends ChannelTarget {
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
export function planWrite(app: EditorApp, clip: ClipRecord, args: WriteArgs): PlannedKey[] | string {
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

export function pollKeyWrite({ app }: OperatorContext, raw: unknown): PollResult {
  const base = pollAgentClip(app, raw);
  if (base !== true) return base;
  const problem = writeProblem(app, raw);
  return problem === null ? OK : fail(problem);
}

// ---------- key.delete ----------

/**
 * Whether a key time is one of `frames` (exact, ±1e-6): sorted once, then a binary search per key, so matching many
 * keys against many frames stays O((keys + frames) · log frames).
 */
export function frameMatcher(frames: readonly Frame[]): (t: Frame) => boolean {
  const sorted = [...frames].sort((a, b) => a - b);
  return (t) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((sorted[mid] as number) < t - SAME_FRAME_EPS) lo = mid + 1;
      else hi = mid;
    }
    return lo < sorted.length && Math.abs((sorted[lo] as number) - t) < SAME_FRAME_EPS;
  };
}

/** The keys `key.delete` deletes, per curve: at `frames` or inside `range` (§4.10: nothing else). */
export function deletePlan(
  view: Tx | EditorApp['store'],
  clip: ClipRecord,
  args: {
    readonly targets: readonly ChannelTarget[];
    readonly frames?: readonly Frame[];
    readonly range?: { readonly start: Frame; readonly end: Frame };
  },
): Map<CurveRecord, KeyId[]> {
  const plan = new Map<CurveRecord, KeyId[]>();
  const atFrame = args.frames === undefined ? null : frameMatcher(args.frames);
  const range = args.range;
  const matches = (key: KeyRecord): boolean => {
    if (atFrame !== null) return atFrame(key.t);
    return range !== undefined && key.t >= range.start - SAME_FRAME_EPS && key.t <= range.end + SAME_FRAME_EPS;
  };
  for (const target of uniqueTargets(args.targets)) {
    const curve = baseCurveIn(view, clip, target.control, target.channel);
    if (curve === undefined || curve.locked) continue;
    const ids = view.query
      .keysOfCurve(curve.id)
      .filter(matches)
      .map((key) => key.id);
    if (ids.length > 0) plan.set(curve, ids);
  }
  return plan;
}

export function pollKeyDelete({ app }: OperatorContext, raw: unknown): PollResult {
  const base = pollAgentClip(app, raw);
  if (base !== true) return base;
  const args = raw as Readonly<Record<string, unknown>>;
  const clip = clipArg(app.store, raw) as ClipRecord;
  const problem =
    labelProblem(args) ??
    targetsProblem(app.store, clip, args['targets']) ??
    (args['frames'] !== undefined && args['range'] !== undefined ? 'expects frames or range, not both' : null) ??
    (args['frames'] === undefined ? null : framesProblem(args['frames'], 'frames')) ??
    (args['range'] === undefined ? null : rangeProblem(args['range']));
  if (problem !== null) return fail(problem);
  if ((args['targets'] as readonly unknown[]).length === 0) return fail('targets is empty');
  if (args['frames'] === undefined && args['range'] === undefined) {
    return fail('expects frames or range (key.delete deletes only the keys at frames or inside a range)');
  }
  let count = 0;
  for (const ids of deletePlan(app.store, clip, raw as OperatorArgs<'key.delete'>).values()) count += ids.length;
  return count > AGENT_WRITE_LIMIT ? fail(`The call would delete more than ${AGENT_WRITE_LIMIT} keys`) : OK;
}

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

/** Keys a `key.adjust` call can change (inside the range and its falloff, or at the frames): the §5.5 write bound. */
function adjustedCount(app: EditorApp, clip: ClipRecord, args: Readonly<Record<string, unknown>>): number {
  const frames = args['frames'] as readonly Frame[] | undefined;
  const range = (args['range'] as { readonly start: Frame; readonly end: Frame } | undefined) ?? clip.range;
  const falloff = (args['falloffFrames'] as number | undefined) ?? 0;
  const atFrame = frames === undefined ? null : frameMatcher(frames);
  let count = 0;
  for (const target of uniqueTargets(args['targets'] as readonly ChannelTarget[])) {
    const curve = baseCurveIn(app.store, clip, target.control, target.channel);
    if (curve === undefined) continue;
    for (const key of app.store.query.keysOfCurve(curve.id)) {
      const inside =
        atFrame === null
          ? key.t >= range.start - falloff - SAME_FRAME_EPS && key.t <= range.end + falloff + SAME_FRAME_EPS
          : atFrame(key.t);
      if (inside) count++;
    }
  }
  return count;
}

export function pollKeyAdjust({ app }: OperatorContext, raw: unknown): PollResult {
  const base = pollAgentClip(app, raw);
  if (base !== true) return base;
  const clip = clipArg(app.store, raw) as ClipRecord;
  const problem = adjustProblem(app, clip, raw as Readonly<Record<string, unknown>>);
  if (problem !== null) return fail(problem);
  return adjustedCount(app, clip, raw as Readonly<Record<string, unknown>>) > AGENT_WRITE_LIMIT
    ? fail(`The call would change more than ${AGENT_WRITE_LIMIT} keys`)
    : OK;
}

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

/** `a mod p` in [0, p). */
function mod(a: number, p: number): number {
  const r = a % p;
  return r < 0 ? r + p : r;
}

/**
 * Where `key.retime` puts the time of a key it moves (`undefined`: the key stays; `null`: the key is deleted), the
 * mirror of the apply's modes: `offset` (cyclic with `wrap`), `scale` about `pivot` (snapped to whole frames unless
 * `snapToFrames: false`), `insertTime` moves the keys after `at`, `deleteTime` deletes the keys in `(at, at + frames]`
 * and moves the later ones back.
 */
function retimeTarget(
  clip: ClipRecord,
  args: Readonly<Record<string, unknown>>,
): (t: Frame) => Frame | null | undefined {
  const { start, end } = clip.range;
  switch (args['mode']) {
    case 'offset': {
      const offset = args['offset'] as number;
      if (args['wrap'] !== true) return (t) => t + offset;
      const period = end - start;
      if (!(period > 0)) return () => undefined;
      const shift = mod(offset, period);
      return (t) => start + mod(t - start + shift, period);
    }
    case 'scale': {
      const pivot = (args['pivot'] as Frame | undefined) ?? start;
      const factor = args['factor'] as number;
      const snap = args['snapToFrames'] !== false;
      return (t) => {
        const next = pivot + (t - pivot) * factor;
        return snap ? Math.round(next) : next;
      };
    }
    case 'insertTime': {
      const at = args['at'] as Frame;
      const frames = args['frames'] as number;
      return (t) => (t > at + SAME_FRAME_EPS ? t + frames : undefined);
    }
    default: {
      const at = args['at'] as Frame;
      const frames = args['frames'] as number;
      return (t) => {
        if (t <= at + SAME_FRAME_EPS) return undefined;
        return t <= at + frames + SAME_FRAME_EPS ? null : t - frames;
      };
    }
  }
}

/**
 * §5.5 for `key.retime`: the keys the call moves or deletes (with `wrap` also the seam keys it writes, three per
 * curve) stay ≤ 50,000, and every key it moves lands inside ±100,000 frames and at most 100,000 frames outside the
 * clip range (other operators loop over the key span, so a retime must not stretch it without bound). Null when the
 * call may run.
 */
function retimeBoundProblem(app: EditorApp, clip: ClipRecord, args: Readonly<Record<string, unknown>>): string | null {
  const target = retimeTarget(clip, args);
  const timeOnly = args['mode'] === 'insertTime' || args['mode'] === 'deleteTime';
  const breakdownsStay = args['retimeBreakdowns'] === false;
  const wrap = args['mode'] === 'offset' && args['wrap'] === true;
  const lo = Math.max(-AGENT_FRAME_LIMIT, clip.range.start - AGENT_SPAN_LIMIT);
  const hi = Math.min(AGENT_FRAME_LIMIT, clip.range.end + AGENT_SPAN_LIMIT);
  const seen = new Set<string>();
  let count = 0;
  for (const item of uniqueTargets(args['targets'] as readonly ChannelTarget[])) {
    const curve = baseCurveIn(app.store, clip, item.control, item.channel);
    if (curve === undefined || curve.locked || seen.has(curve.id)) continue;
    seen.add(curve.id);
    const keys = app.store.query.keysOfCurve(curve.id);
    // Offsets and scales move the anchors and the breakdowns that follow them (all keys of a curve of breakdowns).
    const anchored = keys.some((key) => key.breakdown !== true);
    if (wrap && keys.length > 0) count += 3;
    for (const key of keys) {
      if (!timeOnly && breakdownsStay && anchored && key.breakdown === true) continue;
      const t = target(key.t);
      if (t === undefined) continue;
      if (++count > AGENT_WRITE_LIMIT) return `The call would move more than ${AGENT_WRITE_LIMIT} keys`;
      if (t === null || (t >= lo - SAME_FRAME_EPS && t <= hi + SAME_FRAME_EPS)) continue;
      const at = Math.round(t * 1000) / 1000;
      return Math.abs(t) > AGENT_FRAME_LIMIT
        ? `A key would land at frame ${at}, outside ±${AGENT_FRAME_LIMIT} frames`
        : `A key would land at frame ${at}, more than ${AGENT_SPAN_LIMIT} frames outside the clip range ${clip.range.start}…${clip.range.end}`;
    }
  }
  return null;
}

export function pollKeyRetime({ app }: OperatorContext, raw: unknown): PollResult {
  const base = pollAgentClip(app, raw);
  if (base !== true) return base;
  const clip = clipArg(app.store, raw) as ClipRecord;
  const args = raw as Readonly<Record<string, unknown>>;
  const problem = retimeProblem(app, clip, args) ?? retimeBoundProblem(app, clip, args);
  return problem === null ? OK : fail(problem);
}
