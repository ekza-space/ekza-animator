// curves_summary (MCP-SPEC §6.2 tool 7): per curve the key count, the extremes over the range (value and frame),
// overshoot frames (the curve leaves the span of its two keys), Euler flip frames (rotation jumps above 90° per
// frame), tangent types, infinities, the static value and keys off whole frames — read before keys_read.
import { type CompiledAnimCurve, evaluateAnimCurve, RAD2DEG } from '@ekza-animator/anim-core';
import type { CurveRecord, KeyRecord } from '@ekza-animator/doc';
import { channelTargets, curveOf, rangeArg, resolveControls } from '../../resolve/targets';
import type { TargetsArg } from '../../resolve/targets';
import { controlKeyOf } from '../../resolve/resolver';
import { addressed, clipInfo } from '../../runtime/toolkit';
import { isRotationChannel, outFrame, outValue, toToolValue, unitOfChannel } from '../../units/units';
import type { AgentToolContext, AgentToolResult } from '../../types';
import { infinityName } from '../keys/read';

/** Rows listed before the result says `truncated` (§6.2). */
export const SUMMARY_ROWS_MAX = 120;
/** Frames listed per curve for overshoots and flips. */
const FRAMES_MAX = 10;
/** Frames sampled per curve at most (§5.5). */
const SAMPLE_MAX = 20_000;
/** A rotation jump above this per frame is an Euler flip (§5.16). */
const FLIP_DEG_PER_FRAME = 90;

export interface CurveStats {
  readonly keyCount: number;
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
  readonly overshootFrames: number[];
  readonly flipFrames: number[];
  readonly tangents: Record<string, number>;
  readonly subframeKeys: number;
}

/** Stats of one curve in stored units over `[start, end]` (integer frames and key times). */
export function curveStats(
  compiled: CompiledAnimCurve,
  curve: CurveRecord,
  keys: readonly KeyRecord[],
  range: readonly [number, number],
  rotation: boolean,
): CurveStats {
  const value = (frame: number): number =>
    keys.length === 0 ? (curve.staticValue ?? 0) : evaluateAnimCurve(compiled, frame);
  const start = Math.ceil(range[0]);
  const end = Math.floor(range[1]);
  const step = Math.max(1, Math.ceil((end - start + 1) / SAMPLE_MAX));
  let min: [number, number] = [range[0], value(range[0])];
  let max: [number, number] = [range[0], value(range[0])];
  const consider = (frame: number, v: number): void => {
    if (v < min[1]) min = [frame, v];
    if (v > max[1]) max = [frame, v];
  };
  const flipFrames: number[] = [];
  let previous: number | null = null;
  for (let frame = start; frame <= end; frame += step) {
    const v = value(frame);
    consider(frame, v);
    if (rotation && previous !== null && step === 1 && Math.abs(v - previous) * RAD2DEG > FLIP_DEG_PER_FRAME) {
      if (flipFrames.length < FRAMES_MAX) flipFrames.push(frame);
    }
    previous = v;
  }
  for (const key of keys) if (key.t >= range[0] && key.t <= range[1]) consider(key.t, key.v);
  // Overshoot: inside a span between two keys, the curve goes beyond both keys' values (spline tangents).
  const overshootFrames: number[] = [];
  for (let i = 0; i + 1 < keys.length && overshootFrames.length < FRAMES_MAX; i++) {
    const a = keys[i] as KeyRecord;
    const b = keys[i + 1] as KeyRecord;
    if (b.t < range[0] || a.t > range[1]) continue;
    const lo = Math.min(a.v, b.v);
    const hi = Math.max(a.v, b.v);
    const tolerance = Math.max(1e-9, (hi - lo) * 1e-3);
    let worst: number | null = null;
    let worstBy = 0;
    for (let frame = Math.ceil(a.t + 1e-6); frame < b.t - 1e-6; frame++) {
      const v = value(frame);
      const by = v > hi + tolerance ? v - hi : v < lo - tolerance ? lo - v : 0;
      if (by > worstBy) {
        worstBy = by;
        worst = frame;
      }
    }
    if (worst !== null) overshootFrames.push(worst);
  }
  const tangents: Record<string, number> = {};
  let subframeKeys = 0;
  for (const key of keys) {
    const type = key.inType === key.outType ? key.inType : `${key.inType}/${key.outType}`;
    tangents[type] = (tangents[type] ?? 0) + 1;
    if (Math.abs(key.t - Math.round(key.t)) > 1e-6) subframeKeys++;
  }
  return { keyCount: keys.length, min, max, overshootFrames, flipFrames, tangents, subframeKeys };
}

export interface CurvesSummaryArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly targets?: TargetsArg | undefined;
  readonly rangeFrames?: readonly [number, number] | undefined;
}

export function curvesSummary(ctx: AgentToolContext, args: CurvesSummaryArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  ctx.focus({ character: target.character.id, clip: target.clip.id, controls: [], frame: null }, 'Summarise curves');
  const range =
    args.rangeFrames === undefined
      ? ([target.record.range.start, target.record.range.end] as const)
      : rangeArg(args.rangeFrames, 'rangeFrames');
  const layer = ctx.app.store.query.baseLayer(target.clip.id);
  let curves: CurveRecord[];
  if (args.targets === undefined) {
    curves =
      layer === undefined ? [] : ctx.app.store.query.curvesOfClip(target.clip.id).filter((c) => c.layer === layer.id);
  } else {
    const controls = resolveControls(
      ctx.app,
      ctx.resolve,
      target.character.id,
      args.targets.controls,
      args.targets.bodyParts,
    );
    curves = channelTargets(controls, args.targets.channels, { includeModes: true })
      .map((t) => curveOf(ctx.app, target.clip.id, t.control.id, t.channel))
      .filter((c): c is CurveRecord => c !== undefined);
  }
  const rows = [];
  let subframeKeys = 0;
  for (const curve of curves) {
    const control = ctx.app.store.get('controls', curve.control);
    if (control === undefined) continue;
    const keys = ctx.app.store.query.keysOfCurve(curve.id);
    const stats = curveStats(
      ctx.app.evaluation.compiledCurve(curve.id),
      curve,
      keys,
      range,
      isRotationChannel(curve.channel),
    );
    subframeKeys += stats.subframeKeys;
    if (rows.length >= SUMMARY_ROWS_MAX) continue;
    const unit = unitOfChannel(control, curve.channel);
    const out = (v: number): number => outValue(unit, toToolValue(unit, v));
    rows.push({
      control: controlKeyOf(control),
      channel: curve.channel,
      unit,
      keyCount: stats.keyCount,
      min: [outFrame(stats.min[0]), out(stats.min[1])] as [number, number],
      max: [outFrame(stats.max[0]), out(stats.max[1])] as [number, number],
      overshootFrames: stats.overshootFrames.map(outFrame),
      flipFrames: stats.flipFrames.map(outFrame),
      tangents: stats.tangents,
      pre: infinityName(curve.pre),
      post: infinityName(curve.post),
      staticValue: curve.staticValue === null ? null : out(curve.staticValue),
      subframeKeys: stats.subframeKeys,
    });
  }
  const truncated = curves.length > rows.length;
  return Promise.resolve({
    ok: true,
    data: { curves: rows, subframeKeys, truncated },
    clip: clipInfo(ctx, target.clip.id),
    ...(truncated ? { next: `Only ${SUMMARY_ROWS_MAX} curves are listed: narrow with targets.` } : {}),
  });
}
