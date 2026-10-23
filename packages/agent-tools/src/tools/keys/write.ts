// Keys and timing tools (MCP-SPEC §6.4 tools 14–18, §4.10): keys_set (key.write), keys_delete (key.delete),
// keys_adjust (key.adjust), keys_retime (key.retime) and keys_tween (key.tween {frames} over a run scope). Every call
// is one operator run, one `AI: …` step; values in the channel's unit (degrees, metres, factor) become stored units.
import { evaluateAnimCurve, type TangentType } from '@ekza-studio/anim-core';
import type { ChannelId, ControlId, ControlRecord } from '@ekza-studio/doc';
import { isKeyable, isLocked, type TweenMode } from '@ekza-studio/editor-core';
import { controlKeyOf } from '../../resolve/resolver';
import {
  type ChannelTargetRef,
  channelTargets,
  checkFrames,
  curveOf,
  curvesOfTargets,
  keyableChannelsOf,
  keysOfTargets,
  rangeArg,
  resolveControls,
  type TargetsArg,
} from '../../resolve/targets';
import { addressed, plural, staleCheck, valueOf, writeResult } from '../../runtime/toolkit';
import { quoteName } from '../../sanitize/sanitize';
import { FRAME_MAX } from '../../schemas/common';
import { AgentToolFailure, type AgentToolContext, type AgentToolResult, type ConfirmPrompt } from '../../types';
import {
  isRotationChannel,
  keyTime,
  looksLikeRadians,
  outValue,
  RADIANS_WARNING,
  toStoredValue,
  toToolValue,
  unitOfChannel,
} from '../../units/units';

/** Deleting more keys than this in one call is consequential (§5.5, §5.9). */
export const DELETE_CONFIRM_KEYS = 500;
/** keys_adjust: at most this many curves after resolution (§5.5). */
export const ADJUST_CURVES_MAX = 200;
/** Amplitude rows of keys_adjust. */
const AMPLITUDE_ROWS = 20;
/** Key records a write may touch at most (§5.5). */
export const WRITE_KEYS_MAX = 50_000;

/** `fk.hand.L rz` names of explicit channel targets returned by the operators. */
export function targetNames(
  ctx: AgentToolContext,
  targets: readonly { readonly control: ControlId; readonly channel: ChannelId }[],
): string[] {
  return targets.map((target) => {
    const control = ctx.app.store.get('controls', target.control);
    return `${control === undefined ? target.control : controlKeyOf(control)} ${target.channel}`;
  });
}

/** The warning of keys hidden behind the user's unkeyed overrides (§5.12). */
export function hiddenWarnings(names: readonly string[], frame?: number): string[] {
  if (names.length === 0) return [];
  const where = frame === undefined ? 'at the user’s frame' : `at frame ${frame}`;
  const listed = names.slice(0, 4).join(', ');
  const more = names.length > 4 ? ` and ${names.length - 4} more` : '';
  return [
    `${listed}${more}: the user has an unkeyed edit ${where}; your key is hidden until the user changes frame or keys`,
  ];
}

const channelTarget = (t: ChannelTargetRef) => ({ control: t.control.id, channel: t.channel });

// ---------- keys_set ----------
export interface KeysSetArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly keys?:
    | readonly {
        readonly control: string;
        readonly channel: string;
        readonly frame: number;
        readonly value: number;
        readonly tangent?: string | undefined;
        readonly breakdown?: boolean | undefined;
      }[]
    | undefined;
  readonly keyPoseAt?:
    | {
        readonly controls?: readonly string[] | undefined;
        readonly bodyParts?: readonly string[] | undefined;
        readonly frames: readonly number[];
      }
    | undefined;
  readonly extendRange: boolean;
}

/** One explicit channel of a control by name, keyable and unlocked, else `not_keyable` / `locked_channel`. */
export function writableChannel(control: ControlRecord, channel: string, path: string): ChannelId {
  const id = channel as ChannelId;
  if (!isKeyable(control, id)) {
    throw new AgentToolFailure(
      'not_keyable',
      `${controlKeyOf(control)} has no keyable channel ${quoteName(channel)}.`,
      `use a keyable channel of the control (rig_describe): ${keyableChannelsOf(control, { includeModes: true }).join(' ')}`,
      { candidates: keyableChannelsOf(control, { includeModes: true }).slice(0, 5), detail: { path } },
    );
  }
  if (isLocked(control, id)) {
    throw new AgentToolFailure(
      'locked_channel',
      `${controlKeyOf(control)} ${channel} is locked.`,
      `the user locked it: key another channel (${keyableChannelsOf(control)
        .filter((c) => !isLocked(control, c))
        .join(' ')}) or ask the user to unlock it`,
      { detail: { path } },
    );
  }
  return id;
}

export async function keysSet(ctx: AgentToolContext, args: KeysSetArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const warnings: (string | null)[] = [];
  if (args.keys !== undefined) {
    const items = args.keys.map((item, i) => {
      const control = ctx.resolve.control(target.character.id, item.control);
      const record = ctx.app.store.get('controls', control.id) as ControlRecord;
      const channel = writableChannel(record, item.channel, `keys[${i}].channel`);
      const unit = unitOfChannel(record, channel);
      return {
        record,
        item: {
          control: control.id,
          channel,
          frame: keyTime(item.frame),
          value: toStoredValue(unit, item.value),
          ...(item.tangent === undefined
            ? {}
            : { inType: item.tangent as TangentType, outType: item.tangent as TangentType }),
          ...(item.breakdown === undefined ? {} : { breakdown: item.breakdown }),
        },
      };
    });
    const rotations = args.keys.filter((item) => isRotationChannel(item.channel)).map((item) => item.value);
    if (looksLikeRadians(rotations)) warnings.push(RADIANS_WARNING);
    checkFrames(
      target.record,
      items.map((i) => i.item.frame),
      { extendRange: args.extendRange, path: 'keys' },
    );
    const pairs = new Map<string, ChannelTargetRef>();
    for (const { record, item } of items)
      pairs.set(`${record.id} ${item.channel}`, { control: record, channel: item.channel });
    warnings.push(
      staleCheck(ctx, target.clip.id, args.ifClipRevision, {
        curves: curvesOfTargets(ctx.app, target.clip.id, [...pairs.values()]),
        clipRecord: args.extendRange,
      }),
    );
    const frames = [...new Set(items.map((i) => i.item.frame))];
    ctx.focus(
      {
        character: target.character.id,
        clip: target.clip.id,
        controls: [...new Set(items.map((i) => i.record.id))],
        frame: frames.length === 1 ? (frames[0] as number) : null,
      },
      `Set keys (${items.length})`,
    );
    const run = await ctx.run('key.write', {
      clip: target.clip.id,
      keys: items.map((i) => i.item),
      extendRange: args.extendRange,
      label: `Set keys (${items.length} on ${plural(pairs.size, 'curve')})`,
    });
    return keyWriteResult(ctx, target.clip.id, run, warnings, frames.length === 1 ? frames[0] : undefined);
  }
  const pose = args.keyPoseAt;
  if (pose === undefined) throw new AgentToolFailure('invalid_args', 'Pass keys or keyPoseAt.', 'see detail.example');
  const controls = resolveControls(ctx.app, ctx.resolve, target.character.id, pose.controls, pose.bodyParts);
  const frames = pose.frames.map(keyTime);
  checkFrames(target.record, frames, { extendRange: args.extendRange, path: 'keyPoseAt.frames' });
  const targets = channelTargets(controls, undefined, { skipLocked: true });
  if (targets.length * frames.length > WRITE_KEYS_MAX) {
    throw new AgentToolFailure(
      'limit',
      `The call writes ${targets.length * frames.length} keys; the limit is ${WRITE_KEYS_MAX}.`,
      'split it by frames or body parts',
    );
  }
  warnings.push(
    staleCheck(ctx, target.clip.id, args.ifClipRevision, {
      curves: curvesOfTargets(ctx.app, target.clip.id, targets),
      clipRecord: args.extendRange,
    }),
  );
  ctx.focus(
    {
      character: target.character.id,
      clip: target.clip.id,
      controls: controls.map((c) => c.id),
      frame: frames.length === 1 ? (frames[0] as number) : null,
    },
    `Key pose (${plural(controls.length, 'control')})`,
  );
  const run = await ctx.run('key.write', {
    clip: target.clip.id,
    poseAt: { controls: controls.map((c) => c.id), frames },
    extendRange: args.extendRange,
    label: `Key pose (${plural(controls.length, 'control')}, ${plural(frames.length, 'frame')})`,
  });
  return keyWriteResult(ctx, target.clip.id, run, warnings, frames.length === 1 ? frames[0] : undefined);
}

function keyWriteResult(
  ctx: AgentToolContext,
  clip: Parameters<typeof writeResult>[1],
  run: Awaited<ReturnType<AgentToolContext['run']>>,
  warnings: (string | null)[],
  frame: number | undefined,
): AgentToolResult<unknown> {
  const value = valueOf<{
    readonly written: number;
    readonly curvesCreated: number;
    readonly rangeExtended: boolean;
    readonly hiddenByOverrides: readonly { readonly control: ControlId; readonly channel: ChannelId }[];
  }>('key.write', run);
  const hidden = targetNames(ctx, value.hiddenByOverrides);
  return writeResult(
    ctx,
    clip,
    run,
    {
      written: value.written,
      curvesCreated: value.curvesCreated,
      rangeExtended: value.rangeExtended,
      hiddenByOverrides: hidden.slice(0, 60),
    },
    [...warnings, ...hiddenWarnings(hidden, frame)],
  );
}

// ---------- keys_delete ----------
export interface KeysDeleteArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly targets: TargetsArg;
  readonly frames?: readonly number[] | undefined;
  readonly rangeFrames?: readonly [number, number] | undefined;
  readonly confirm?: boolean | undefined;
}

function deletePlan(ctx: AgentToolContext, args: KeysDeleteArgs) {
  const target = addressed(ctx, args);
  const controls = resolveControls(
    ctx.app,
    ctx.resolve,
    target.character.id,
    args.targets.controls,
    args.targets.bodyParts,
  );
  const targets = channelTargets(controls, args.targets.channels, {
    includeModes: args.targets.channels !== undefined,
  });
  const range = args.rangeFrames === undefined ? undefined : rangeArg(args.rangeFrames, 'rangeFrames');
  const where = args.frames !== undefined ? { frames: args.frames } : range === undefined ? {} : { range };
  const found = keysOfTargets(ctx.app, target.clip.id, targets, where);
  const count = found.reduce((sum, entry) => sum + entry.keys.length, 0);
  return { target, controls, targets, range, count, curves: found.filter((entry) => entry.keys.length > 0) };
}

export function keysDeleteConfirm(ctx: AgentToolContext, args: KeysDeleteArgs): ConfirmPrompt | null {
  const plan = deletePlan(ctx, args);
  if (plan.count <= DELETE_CONFIRM_KEYS) return null;
  return {
    title: `AI wants to delete ${plan.count} keys`,
    detail: `${plan.count} keys on ${plural(plan.curves.length, 'curve')} of clip ${quoteName(plan.target.clip.name)}. Undo restores them.`,
    danger: true,
  };
}

export async function keysDelete(ctx: AgentToolContext, args: KeysDeleteArgs): Promise<AgentToolResult<unknown>> {
  const plan = deletePlan(ctx, args);
  if (plan.count > WRITE_KEYS_MAX) {
    throw new AgentToolFailure(
      'limit',
      `The call deletes ${plan.count} keys; the limit is ${WRITE_KEYS_MAX}.`,
      'split it by rangeFrames or targets',
    );
  }
  const stale = staleCheck(ctx, plan.target.clip.id, args.ifClipRevision, {
    curves: plan.curves.map((entry) => entry.curve.id),
    clipRecord: false,
  });
  if (plan.count === 0) {
    return writeResult(ctx, plan.target.clip.id, null, { deleted: 0 }, [
      stale,
      'no keys of the targets matched; nothing was deleted',
    ]);
  }
  ctx.focus(
    {
      character: plan.target.character.id,
      clip: plan.target.clip.id,
      controls: plan.controls.map((c) => c.id),
      frame: null,
    },
    `Delete keys (${plan.count})`,
  );
  const run = await ctx.run('key.delete', {
    clip: plan.target.clip.id,
    targets: plan.curves.map((entry) => channelTarget(entry.target)),
    ...(args.frames !== undefined ? { frames: args.frames } : {}),
    ...(plan.range !== undefined ? { range: { start: plan.range[0], end: plan.range[1] } } : {}),
    label: `Delete keys (${plan.count} on ${plural(plan.curves.length, 'curve')})`,
  });
  const value = valueOf<{ readonly deleted: number }>('key.delete', run);
  return writeResult(ctx, plan.target.clip.id, run, { deleted: value.deleted }, [stale]);
}

// ---------- keys_adjust ----------
export interface KeysAdjustArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly targets: TargetsArg;
  readonly rangeFrames?: readonly [number, number] | undefined;
  readonly frames?: readonly number[] | undefined;
  readonly scalePercent?: number | undefined;
  readonly pivot: 'rest' | 'mean' | 'range_start' | { readonly frame: number };
  readonly offsetDeg?: number | undefined;
  readonly offsetM?: number | undefined;
  readonly offsetFactor?: number | undefined;
  readonly falloffFrames: number;
}

/** Peak-to-peak of a curve over `[start, end]` sampled per frame (stored units). */
function peakToPeak(ctx: AgentToolContext, curve: string, range: readonly [number, number]): number {
  const compiled = ctx.app.evaluation.compiledCurve(curve as never);
  if (compiled.keyCount === 0) return 0;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const step = Math.max(1, Math.ceil((range[1] - range[0] + 1) / 20_000));
  for (let f = Math.ceil(range[0]); f <= range[1]; f += step) {
    const v = evaluateAnimCurve(compiled, f);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return Number.isFinite(lo) ? hi - lo : 0;
}

export async function keysAdjust(ctx: AgentToolContext, args: KeysAdjustArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const controls = resolveControls(
    ctx.app,
    ctx.resolve,
    target.character.id,
    args.targets.controls,
    args.targets.bodyParts,
  );
  const targets = channelTargets(controls, args.targets.channels, {
    includeModes: args.targets.channels !== undefined,
  });
  if (targets.length > ADJUST_CURVES_MAX) {
    throw new AgentToolFailure(
      'limit',
      `The call names ${targets.length} curves; the limit is ${ADJUST_CURVES_MAX}.`,
      'split it by body part or name channels',
    );
  }
  const range = args.rangeFrames === undefined ? undefined : rangeArg(args.rangeFrames, 'rangeFrames');
  const span: readonly [number, number] = range ?? [target.record.range.start, target.record.range.end];
  // Attribute offsets (the operator takes one number for every attribute, in stored units).
  let attr: number | undefined;
  const attrUnits = new Set(
    targets.filter((t) => t.channel.startsWith('@')).map((t) => unitOfChannel(t.control, t.channel)),
  );
  if (attrUnits.has('deg') && args.offsetDeg !== undefined) attr = toStoredValue('deg', args.offsetDeg);
  if (attrUnits.has('m') && args.offsetM !== undefined) {
    if (attr !== undefined) {
      throw new AgentToolFailure(
        'invalid_args',
        'Angle and distance attributes cannot be offset in one call.',
        'split the call: one for the angle attributes (offsetDeg), one for the distance attributes (offsetM)',
        { detail: { path: 'targets.channels' } },
      );
    }
    attr = args.offsetM;
  }
  const offset = {
    ...(args.offsetDeg === undefined ? {} : { rotate: toStoredValue('deg', args.offsetDeg) }),
    ...(args.offsetM === undefined ? {} : { translate: args.offsetM }),
    ...(args.offsetFactor === undefined ? {} : { scale: args.offsetFactor }),
    ...(attr === undefined ? {} : { attr }),
  };
  const pivot =
    args.pivot === 'rest'
      ? { kind: 'rest' as const }
      : args.pivot === 'mean'
        ? { kind: 'mean' as const }
        : args.pivot === 'range_start'
          ? { kind: 'rangeStart' as const }
          : { kind: 'frame' as const, frame: args.pivot.frame };
  const curves = curvesOfTargets(ctx.app, target.clip.id, targets);
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, { curves, clipRecord: false });
  const rows = targets
    .map((t) => ({ t, curve: curveOf(ctx.app, target.clip.id, t.control.id, t.channel) }))
    .filter((row) => row.curve !== undefined)
    .slice(0, AMPLITUDE_ROWS);
  const amplitude = () =>
    rows.map(({ t, curve }) => {
      const unit = unitOfChannel(t.control, t.channel);
      return {
        control: controlKeyOf(t.control),
        channel: t.channel,
        peakToPeak: outValue(unit, toToolValue(unit, peakToPeak(ctx, curve?.id as string, span))),
        unit,
      };
    });
  const amplitudeBefore = amplitude();
  ctx.focus(
    { character: target.character.id, clip: target.clip.id, controls: controls.map((c) => c.id), frame: null },
    'Adjust keys',
  );
  const what =
    args.scalePercent !== undefined
      ? `${args.scalePercent > 100 ? '+' : ''}${Math.round((args.scalePercent - 100) * 10) / 10} %`
      : 'offset';
  const run = await ctx.run('key.adjust', {
    clip: target.clip.id,
    targets: targets.map(channelTarget),
    ...(range === undefined ? {} : { range: { start: range[0], end: range[1] } }),
    ...(args.frames === undefined ? {} : { frames: args.frames }),
    ...(Object.keys(offset).length === 0 ? {} : { offset }),
    ...(args.scalePercent === undefined ? {} : { factor: args.scalePercent / 100 }),
    pivot,
    falloffFrames: args.falloffFrames,
    label: `Adjust ${plural(curves.length, 'curve')} ${what}`,
  });
  const value = valueOf<{
    readonly keys: number;
    readonly curves: number;
    readonly skipped: readonly {
      readonly control: ControlId;
      readonly channel: ChannelId;
      readonly reason: 'locked' | 'no_keys';
    }[];
  }>('key.adjust', run);
  return writeResult(
    ctx,
    target.clip.id,
    run,
    {
      keys: value.keys,
      curves: value.curves,
      skipped: value.skipped.slice(0, 60).map((skip) => {
        const control = ctx.app.store.get('controls', skip.control);
        return {
          control: control === undefined ? skip.control : controlKeyOf(control),
          channel: skip.channel,
          reason: skip.reason,
        };
      }),
      amplitudeBefore,
      amplitudeAfter: amplitude(),
    },
    [stale],
  );
}

// ---------- keys_retime ----------
export interface KeysRetimeArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly targets: TargetsArg;
  readonly mode: 'offset' | 'scale' | 'insert_time' | 'delete_time';
  readonly offsetFrames?: number | undefined;
  readonly wrap: boolean;
  readonly factor?: number | undefined;
  readonly pivotFrame?: number | undefined;
  readonly atFrame?: number | undefined;
  readonly frames?: number | undefined;
  readonly ripple: boolean;
  readonly retimeBreakdowns: boolean;
  readonly snapToFrames: boolean;
}

/** `arm.L`, `fk.hand.L`, `3 controls` (labels). */
function targetsLabel(args: TargetsArg, controls: readonly ControlRecord[]): string {
  if (args.bodyParts !== undefined && args.bodyParts.length === 1 && args.controls === undefined)
    return args.bodyParts[0] as string;
  if (controls.length === 1) return controlKeyOf(controls[0] as ControlRecord);
  return plural(controls.length, 'control');
}

export async function keysRetime(ctx: AgentToolContext, args: KeysRetimeArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const controls = resolveControls(
    ctx.app,
    ctx.resolve,
    target.character.id,
    args.targets.controls,
    args.targets.bodyParts,
  );
  const targets = channelTargets(controls, args.targets.channels, {
    includeModes: args.targets.channels !== undefined,
  });
  if (args.wrap && args.mode === 'offset' && !target.record.loop) {
    throw new AgentToolFailure(
      'invalid_args',
      'wrap works on loop clips only.',
      'make the clip a loop first (clip_update {loop: true} or clip_make_loop), or leave wrap out',
      { detail: { path: 'wrap' } },
    );
  }
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curvesOfTargets(ctx.app, target.clip.id, targets),
    clipRecord: false,
  });
  const landing = retimeLanding(ctx, target, targets, args);
  const name = targetsLabel(args.targets, controls);
  let mode: 'offset' | 'scale' | 'insertTime' | 'deleteTime';
  let detail: Record<string, unknown>;
  let label: string;
  switch (args.mode) {
    case 'offset':
      mode = 'offset';
      detail = { offset: args.offsetFrames, wrap: args.wrap };
      label = `Retime ${name} ${(args.offsetFrames ?? 0) >= 0 ? '+' : ''}${args.offsetFrames} frames${args.wrap ? ' (wrap)' : ''}`;
      break;
    case 'scale':
      mode = 'scale';
      detail = { factor: args.factor, pivot: args.pivotFrame ?? target.record.range.start };
      label = `Retime ${name} ×${args.factor}`;
      break;
    case 'insert_time':
      mode = 'insertTime';
      detail = { at: args.atFrame, frames: args.frames };
      label = `Insert ${args.frames} frames @ f${args.atFrame} (${name})`;
      break;
    case 'delete_time':
      mode = 'deleteTime';
      detail = { at: args.atFrame, frames: args.frames };
      label = `Delete ${args.frames} frames @ f${args.atFrame} (${name})`;
      break;
  }
  ctx.focus(
    { character: target.character.id, clip: target.clip.id, controls: controls.map((c) => c.id), frame: null },
    label,
  );
  const run = await ctx.run('key.retime', {
    clip: target.clip.id,
    targets: targets.map(channelTarget),
    mode,
    ...detail,
    ripple: args.ripple,
    retimeBreakdowns: args.retimeBreakdowns,
    snapToFrames: args.snapToFrames,
    label,
  });
  const value = valueOf<{
    readonly moved: number;
    readonly merged: number;
    readonly clamped: number;
    readonly snapped: number;
    readonly contactFrame: number | null;
  }>('key.retime', run);
  return writeResult(
    ctx,
    target.clip.id,
    run,
    {
      moved: value.moved,
      merged: value.merged,
      clamped: value.clamped,
      snapped: value.snapped,
      contactFrame: value.contactFrame,
    },
    [
      stale,
      value.merged > 0 ? `${value.merged} keys landed on the same frame as another key and were merged` : null,
      landing,
    ],
  );
}

/** Where a retime moves a key time (offset with wrap stays inside the loop range). */
function retimedFrame(t: number, args: KeysRetimeArgs, record: { readonly range: { readonly start: number } }) {
  switch (args.mode) {
    case 'offset':
      return t + (args.offsetFrames ?? 0);
    case 'scale': {
      const pivot = args.pivotFrame ?? record.range.start;
      return pivot + (args.factor ?? 1) * (t - pivot);
    }
    case 'insert_time':
      return t >= (args.atFrame ?? 0) - 1e-6 ? t + (args.frames ?? 0) : t;
    case 'delete_time': {
      const at = args.atFrame ?? 0;
      const frames = args.frames ?? 0;
      if (t < at - 1e-6) return t;
      return t < at + frames - 1e-6 ? null : t - frames;
    }
  }
}

/**
 * Where the retimed keys land (§5.2, §5.5): beyond ±100,000 frames the call answers `limit`; keys that leave the clip
 * range give a warning (they play only once the range covers them). Offsets with `wrap` stay inside the loop.
 */
function retimeLanding(
  ctx: AgentToolContext,
  target: ReturnType<typeof addressed>,
  targets: readonly ChannelTargetRef[],
  args: KeysRetimeArgs,
): string | null {
  if (args.mode === 'offset' && args.wrap) return null;
  const { start, end } = target.record.range;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let outside = 0;
  for (const entry of keysOfTargets(ctx.app, target.clip.id, targets, {})) {
    for (const key of entry.keys) {
      const t = retimedFrame(key.t, args, target.record);
      if (t === null) continue;
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
      if (t < start - 1e-6 || t > end + 1e-6) outside++;
    }
  }
  if (!Number.isFinite(lo)) return null;
  if (lo < -FRAME_MAX || hi > FRAME_MAX) {
    throw new AgentToolFailure(
      'limit',
      `The retime would put keys at f${Math.round(lo)}…f${Math.round(hi)}; key frames stay within ±${FRAME_MAX.toLocaleString('en')}.`,
      'use a smaller offset or factor, or another pivotFrame',
      { detail: { path: args.mode === 'scale' ? 'factor' : args.mode === 'offset' ? 'offsetFrames' : 'frames' } },
    );
  }
  if (outside === 0) return null;
  return `${outside} retimed key${outside === 1 ? '' : 's'} now lie outside the clip range ${start}…${end} (keys span f${Math.round(lo)}…f${Math.round(hi)}); they play only once the range covers them: clip_update {rangeFrames}`;
}

// ---------- keys_tween ----------
export interface KeysTweenArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly targets: TargetsArg;
  readonly frames: readonly number[];
  readonly mode: 'tween' | 'neighbor' | 'ease' | 'push_pull' | 'to_default';
  readonly amountPercent: number;
  readonly breakdown: boolean;
}

const TWEEN_MODE: Readonly<Record<KeysTweenArgs['mode'], TweenMode>> = {
  tween: 'tween',
  neighbor: 'neighbor',
  ease: 'ease',
  push_pull: 'pushPull',
  to_default: 'toDefault',
};

export async function keysTween(ctx: AgentToolContext, args: KeysTweenArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const controls = resolveControls(
    ctx.app,
    ctx.resolve,
    target.character.id,
    args.targets.controls,
    args.targets.bodyParts,
  );
  const frames = [...new Set(args.frames.map(keyTime))].sort((a, b) => a - b);
  checkFrames(target.record, frames, { extendRange: false, path: 'frames' });
  const targets = channelTargets(controls, args.targets.channels, {
    includeModes: args.targets.channels !== undefined,
  });
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curvesOfTargets(ctx.app, target.clip.id, targets),
    clipRecord: false,
  });
  const warnings: (string | null)[] = [stale];
  if (Math.abs(args.amountPercent) > 100 && !ctx.app.prefs.getState().tweenOvershoot) {
    warnings.push(
      'amounts beyond ±100 % overshoot only with the user’s Tween overshoot preference; the editor may clamp them to ±100 %',
    );
  }
  ctx.focus(
    {
      character: target.character.id,
      clip: target.clip.id,
      controls: controls.map((c) => c.id),
      frame: frames.length === 1 ? (frames[0] as number) : null,
    },
    `Tween ${plural(frames.length, 'frame')}`,
  );
  const run = await ctx.run(
    'key.tween',
    {
      mode: TWEEN_MODE[args.mode],
      amount: args.amountPercent,
      target: 'frame',
      breakdown: args.breakdown,
      frames,
    },
    {
      runScope: {
        character: target.character.id,
        clip: target.clip.id,
        selection: {
          controls: controls.map((c) => c.id),
          ...(args.targets.channels === undefined ? {} : { channels: targets.map(channelTarget) }),
        },
      },
    },
  );
  const value = valueOf<{ readonly count: number }>('key.tween', run);
  return writeResult(ctx, target.clip.id, run, { keyed: value.count, frames }, warnings);
}
