// Curve cleanup tools (MCP-SPEC §6.5 tools 19–21): each runs one scope-ready operator (P1) with a run scope of the
// resolved keys — curves_set_interpolation maps its one change kind to graph.tangent.set, graph.keys.setFields
// (handle angles in degrees as the Graph Editor shows them, and weights), graph.tangent.break/unify,
// graph.curve.setWeighted or graph.infinity.set; curves_euler_filter runs graph.eulerFilter; curves_simplify runs
// graph.curves.simplify (a dry run measures the same reduction without writing).
import {
  type AnimCurve,
  compileAnimCurve,
  DEG2RAD,
  evaluateAnimCurve,
  type InfinityMode,
  RAD2DEG,
  reduceKeys,
} from '@ekza-studio/anim-core';
import type { CurveRecord, KeyId, KeyRecord } from '@ekza-studio/doc';
import { DEFAULT_REDUCE } from '@ekza-studio/rig';
import { controlKeyOf } from '../../resolve/resolver';
import {
  type ChannelTargetRef,
  channelTargets,
  curveOf,
  keySelection,
  keysOfTargets,
  rangeArg,
  resolveControls,
  type TargetsArg,
} from '../../resolve/targets';
import { addressed, plural, staleCheck, valueOf, writeResult } from '../../runtime/toolkit';
import { AgentToolFailure, type AgentToolContext, type AgentToolResult } from '../../types';
import { isRotationChannel, isTranslationChannel, roundTo } from '../../units/units';

const INFINITY: Readonly<Record<string, InfinityMode>> = {
  constant: 'constant',
  linear: 'linear',
  cycle: 'cycle',
  cycle_offset: 'cycleOffset',
  oscillate: 'oscillate',
};

/** Every base-layer curve of a clip, or the curves of the targets (existing curves only). */
function curvesFor(
  ctx: AgentToolContext,
  target: ReturnType<typeof addressed>,
  targets: TargetsArg | undefined,
  filter: (curve: CurveRecord) => boolean = () => true,
): { readonly curves: CurveRecord[]; readonly refs: ChannelTargetRef[] } {
  if (targets === undefined) {
    const layer = ctx.app.store.query.baseLayer(target.clip.id);
    const curves =
      layer === undefined
        ? []
        : ctx.app.store.query.curvesOfClip(target.clip.id).filter((curve) => curve.layer === layer.id && filter(curve));
    const refs = curves.flatMap((curve) => {
      const control = ctx.app.store.get('controls', curve.control);
      return control === undefined ? [] : [{ control, channel: curve.channel }];
    });
    return { curves, refs };
  }
  const controls = resolveControls(ctx.app, ctx.resolve, target.character.id, targets.controls, targets.bodyParts);
  const refs = channelTargets(controls, targets.channels, { includeModes: targets.channels !== undefined });
  const curves: CurveRecord[] = [];
  const kept: ChannelTargetRef[] = [];
  for (const ref of refs) {
    const curve = curveOf(ctx.app, target.clip.id, ref.control.id, ref.channel);
    if (curve === undefined || !filter(curve)) continue;
    curves.push(curve);
    kept.push(ref);
  }
  return { curves, refs: kept };
}

function scopeOf(target: ReturnType<typeof addressed>, keys: readonly KeyId[], refs: readonly ChannelTargetRef[]) {
  return {
    character: target.character.id,
    clip: target.clip.id,
    selection: {
      controls: [...new Set(refs.map((ref) => ref.control.id))],
      keys: keySelection(keys),
      channels: refs.map((ref) => ({ control: ref.control.id, channel: ref.channel })),
    },
  };
}

// ---------- curves_set_interpolation ----------
export interface CurvesSetInterpolationArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly targets: TargetsArg;
  readonly frames?: readonly number[] | undefined;
  readonly rangeFrames?: readonly [number, number] | undefined;
  readonly tangent?: string | undefined;
  readonly side: 'both' | 'in' | 'out';
  readonly handles?:
    | {
        readonly inAngleDeg?: number | undefined;
        readonly outAngleDeg?: number | undefined;
        readonly inWeight?: number | undefined;
        readonly outWeight?: number | undefined;
      }
    | undefined;
  readonly broken?: boolean | undefined;
  readonly weighted?: boolean | undefined;
  readonly preInfinity?: string | undefined;
  readonly postInfinity?: string | undefined;
}

export async function curvesSetInterpolation(
  ctx: AgentToolContext,
  args: CurvesSetInterpolationArgs,
): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const controls = resolveControls(
    ctx.app,
    ctx.resolve,
    target.character.id,
    args.targets.controls,
    args.targets.bodyParts,
  );
  const refs = channelTargets(controls, args.targets.channels, { includeModes: args.targets.channels !== undefined });
  const range = args.rangeFrames === undefined ? undefined : rangeArg(args.rangeFrames, 'rangeFrames');
  const where = args.frames !== undefined ? { frames: args.frames } : range === undefined ? {} : { range };
  const found = keysOfTargets(ctx.app, target.clip.id, refs, where);
  const keyIds = found.flatMap((entry) => entry.keys.map((key) => key.id));
  const curves = found.map((entry) => entry.curve);
  const curveLevel = args.weighted !== undefined || args.preInfinity !== undefined || args.postInfinity !== undefined;
  if (curves.length === 0 || (!curveLevel && keyIds.length === 0)) {
    throw new AgentToolFailure(
      'invalid_args',
      curves.length === 0 ? 'The targets have no curves in this clip.' : 'No keys of the targets in those frames.',
      'check the keys with keys_read or curves_summary',
      { detail: { path: curves.length === 0 ? 'targets' : args.frames !== undefined ? 'frames' : 'rangeFrames' } },
    );
  }
  // curve-level changes act on whole curves: every key of the curves is in scope
  const scopeKeys = curveLevel
    ? curves.flatMap((curve) => ctx.app.store.query.keysOfCurve(curve.id).map((key) => key.id))
    : keyIds;
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curves.map((curve) => curve.id),
    clipRecord: false,
  });
  let operator: string;
  let opArgs: Record<string, unknown>;
  if (args.tangent !== undefined) {
    operator = 'graph.tangent.set';
    opArgs = { type: args.tangent, side: args.side };
  } else if (args.handles !== undefined) {
    operator = 'graph.keys.setFields';
    opArgs = { ...args.handles };
  } else if (args.broken !== undefined) {
    operator = args.broken ? 'graph.tangent.break' : 'graph.tangent.unify';
    opArgs = {};
  } else if (args.weighted !== undefined) {
    operator = 'graph.curve.setWeighted';
    opArgs = { weighted: args.weighted };
  } else {
    operator = 'graph.infinity.set';
    opArgs = {
      ...(args.preInfinity === undefined ? {} : { pre: INFINITY[args.preInfinity] }),
      ...(args.postInfinity === undefined ? {} : { post: INFINITY[args.postInfinity] }),
    };
  }
  ctx.focus(
    { character: target.character.id, clip: target.clip.id, controls: controls.map((c) => c.id), frame: null },
    `Tangents (${plural(keyIds.length, 'key')})`,
  );
  const run = await ctx.run(operator, opArgs, { runScope: scopeOf(target, scopeKeys, refs) });
  valueOf(operator, run);
  return writeResult(
    ctx,
    target.clip.id,
    run,
    { keys: curveLevel ? scopeKeys.length : keyIds.length, curves: curves.length },
    [stale],
  );
}

// ---------- curves_euler_filter ----------
export interface CurvesEulerFilterArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly targets?: TargetsArg | undefined;
}

export async function curvesEulerFilter(
  ctx: AgentToolContext,
  args: CurvesEulerFilterArgs,
): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const { curves, refs } = curvesFor(ctx, target, args.targets, (curve) => isRotationChannel(curve.channel));
  if (curves.length === 0) {
    return writeResult(ctx, target.clip.id, null, { flipsFixed: [], total: 0 }, [
      'the targets have no rotation curves; nothing to filter',
    ]);
  }
  const before = new Map(curves.map((curve) => [curve.id, ctx.app.store.query.keysOfCurve(curve.id)]));
  const keys = [...before.values()].flat().map((key) => key.id);
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curves.map((c) => c.id),
    clipRecord: false,
  });
  ctx.focus(
    {
      character: target.character.id,
      clip: target.clip.id,
      controls: [...new Set(refs.map((r) => r.control.id))],
      frame: null,
    },
    `Euler filter (${plural(curves.length, 'curve')})`,
  );
  const run = await ctx.run('graph.eulerFilter', undefined, { runScope: scopeOf(target, keys, refs) });
  const value = valueOf<{ readonly count: number }>('graph.eulerFilter', run);
  const flipsFixed = [];
  for (const curve of curves) {
    const old = new Map((before.get(curve.id) ?? []).map((key) => [key.id, key.v]));
    let count = 0;
    for (const key of ctx.app.store.query.keysOfCurve(curve.id)) {
      const was = old.get(key.id);
      if (was !== undefined && Math.abs(was - key.v) > 1e-9) count++;
    }
    if (count === 0) continue;
    const control = ctx.app.store.get('controls', curve.control);
    flipsFixed.push({
      control: control === undefined ? curve.control : controlKeyOf(control),
      channel: curve.channel,
      count,
    });
  }
  return writeResult(ctx, target.clip.id, run, { flipsFixed: flipsFixed.slice(0, 60), total: value.count }, [stale]);
}

// ---------- curves_simplify ----------
export interface CurvesSimplifyArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly targets?: TargetsArg | undefined;
  readonly toleranceDeg: number;
  readonly toleranceM: number;
  readonly dryRun: boolean;
}

function animCurveOf(curve: CurveRecord, keys: readonly KeyRecord[]): AnimCurve {
  return { keys, weighted: curve.weighted, pre: curve.pre, post: curve.post };
}

/** Largest |a − b| over the integer frames between the first and last key (stored units). */
function maxDeviation(a: AnimCurve, b: AnimCurve): number {
  if (a.keys.length === 0) return 0;
  const ca = compileAnimCurve(a);
  const cb = compileAnimCurve(b);
  const first = a.keys[0]?.t ?? 0;
  const last = a.keys.at(-1)?.t ?? 0;
  let worst = 0;
  const step = Math.max(1, Math.ceil((last - first + 1) / 20_000));
  for (let f = Math.ceil(first); f <= last; f += step) {
    worst = Math.max(worst, Math.abs(evaluateAnimCurve(ca, f) - evaluateAnimCurve(cb, f)));
  }
  return worst;
}

export async function curvesSimplify(
  ctx: AgentToolContext,
  args: CurvesSimplifyArgs,
): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const { curves, refs } = curvesFor(ctx, target, args.targets);
  const tolerance = { ...DEFAULT_REDUCE, rotationRad: args.toleranceDeg * DEG2RAD, translationM: args.toleranceM };
  const toleranceFor = (channel: string): number =>
    isRotationChannel(channel)
      ? tolerance.rotationRad
      : isTranslationChannel(channel)
        ? tolerance.translationM
        : tolerance.scale;
  const original = new Map(curves.map((curve) => [curve.id, ctx.app.store.query.keysOfCurve(curve.id)]));
  const before = [...original.values()].reduce((sum, keys) => sum + keys.length, 0);
  const measure = (after: (curve: CurveRecord) => AnimCurve) => {
    let deg = 0;
    let m = 0;
    let count = 0;
    for (const curve of curves) {
      const reduced = after(curve);
      count += reduced.keys.length;
      const error = maxDeviation(animCurveOf(curve, original.get(curve.id) ?? []), reduced);
      if (isRotationChannel(curve.channel)) deg = Math.max(deg, error * RAD2DEG);
      else if (isTranslationChannel(curve.channel)) m = Math.max(m, error);
    }
    return { after: count, maxErrorDeg: roundTo(deg, 0.0001), maxErrorM: roundTo(m, 0.00001) };
  };
  if (args.dryRun) {
    const result = measure((curve) => {
      const keys = original.get(curve.id) ?? [];
      const reduced = reduceKeys(animCurveOf(curve, keys), { tolerance: toleranceFor(curve.channel) });
      return { ...animCurveOf(curve, keys), keys: reduced.keys };
    });
    return writeResult(ctx, target.clip.id, null, { before, ...result, dryRun: true });
  }
  const keys = [...original.values()].flat().map((key) => key.id);
  const stale = staleCheck(ctx, target.clip.id, args.ifClipRevision, {
    curves: curves.map((c) => c.id),
    clipRecord: false,
  });
  ctx.focus(
    {
      character: target.character.id,
      clip: target.clip.id,
      controls: [...new Set(refs.map((r) => r.control.id))],
      frame: null,
    },
    `Simplify ${plural(curves.length, 'curve')}`,
  );
  const run = await ctx.run('graph.curves.simplify', { tolerance }, { runScope: scopeOf(target, keys, refs) });
  valueOf('graph.curves.simplify', run);
  const result = measure((curve) => {
    const now = ctx.app.store.get('curves', curve.id) ?? curve;
    return animCurveOf(now, ctx.app.store.query.keysOfCurve(curve.id));
  });
  return writeResult(ctx, target.clip.id, run, { before, ...result, dryRun: false }, [stale]);
}
