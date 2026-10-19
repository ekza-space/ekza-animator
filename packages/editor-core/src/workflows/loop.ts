// Loop methods of `clip.makeLoop` (MCP-SPEC §4.10, P1): plans per curve over plain key data, so a dry run measures
// the result without writing. `matchEnds` sets each animated curve's end key to its start value and gives both seam
// keys the start key's slope; `blend` cross-fades the last frames toward the continuation of the start pose before
// matching; `cycleOnly` only sets the loop flag and the cycle infinities (the editor then compiles cycle-aware auto
// tangents, M2A-SPEC §5.23). Root travel (the in-place node's X/Z translation): `cycleOffset` keeps the travel with
// cycleOffset infinities (slopes still match), `inPlace` removes the linear travel, `keep` leaves those curves alone.
import {
  type AnimCurve,
  type CompiledAnimCurve,
  evaluateAnimCurveSlope,
  type Frame,
  type InfinityMode,
  type KeyData,
} from '@ekza-animator/anim-core';
import type { ChannelId, ClipRecord, ControlId, CurveRecord, KeyId, ReadView } from '@ekza-animator/doc';
import { internalsOf } from '../app/internals';
import { keyDataOf, SAME_FRAME_EPS } from '../edit/context';
import type { EditorApp } from '../types';

export type LoopMethod = 'matchEnds' | 'blend' | 'cycleOnly';
export type RootTravel = 'cycleOffset' | 'inPlace' | 'keep';

/** A planned key: an existing key (its id) or a new one (null). */
export interface LoopKey {
  readonly id: KeyId | null;
  readonly data: KeyData;
}

export interface LoopCurvePlan {
  readonly curve: CurveRecord;
  /** Root travel curve (the in-place node's tx/tz). */
  readonly travel: boolean;
  readonly keys: readonly LoopKey[];
  readonly pre: InfinityMode;
  readonly post: InfinityMode;
  /** Whether the seam is measured (root travel kept as is is not a loop curve). */
  readonly measured: boolean;
  readonly changed: boolean;
}

export interface SeamValue {
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly c0: number;
  readonly c1: number;
}

function compile(
  app: EditorApp,
  keys: readonly LoopKey[],
  curve: CurveRecord,
  pre: InfinityMode,
  post: InfinityMode,
): CompiledAnimCurve {
  const anim: AnimCurve = { keys: keys.map((key) => key.data), weighted: curve.weighted, pre, post };
  return internalsOf(app).deps.curves.engine.compile(anim);
}

function indexAt(keys: readonly LoopKey[], t: Frame): number {
  return keys.findIndex((key) => Math.abs(key.data.t - t) < SAME_FRAME_EPS);
}

/** `keys` with a shape-preserving key at `t` (unchanged when one is there). */
function withKeyAt(
  app: EditorApp,
  keys: readonly LoopKey[],
  curve: CurveRecord,
  pre: InfinityMode,
  post: InfinityMode,
  t: Frame,
): LoopKey[] {
  if (indexAt(keys, t) !== -1) return [...keys];
  const anim: AnimCurve = { keys: keys.map((key) => key.data), weighted: curve.weighted, pre, post };
  const result = internalsOf(app).deps.curves.insertKeyPreservingShape(anim, t);
  const out: LoopKey[] = [];
  result.keys.forEach((data, i) => {
    if (i === result.index) out.push({ id: null, data });
    else out.push({ id: (keys[i < result.index ? i : i - 1] as LoopKey).id, data });
  });
  return out;
}

/** The seam C0/C1 of one curve over `[start, end]`: |v(end) − v(start)| and |slope⁻(end) − slope⁺(start)|. */
export function seamOf(
  app: EditorApp,
  keys: readonly LoopKey[],
  curve: CurveRecord,
  pre: InfinityMode,
  post: InfinityMode,
  range: { readonly start: Frame; readonly end: Frame },
  travel: boolean,
): { readonly c0: number; readonly c1: number } {
  if (keys.length === 0) return { c0: 0, c1: 0 };
  const compiled = compile(app, keys, curve, pre, post);
  const engine = internalsOf(app).deps.curves.engine;
  const first = indexAt(keys, range.start);
  const last = indexAt(keys, range.end);
  const right = first === -1 ? evaluateAnimCurveSlope(compiled, range.start) : (compiled.outSlope[first] as number);
  const left = last === -1 ? evaluateAnimCurveSlope(compiled, range.end) : (compiled.inSlope[last] as number);
  const c0 =
    travel && post === 'cycleOffset'
      ? 0
      : Math.abs(engine.evaluate(compiled, range.end) - engine.evaluate(compiled, range.start));
  return { c0, c1: Math.abs(left - right) };
}

function smoothstep(x: number): number {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
}

/** Removes the linear travel `v(end) − v(start)` from every key (values and handle slopes). */
function removeTravel(
  keys: readonly LoopKey[],
  range: { readonly start: Frame; readonly end: Frame },
  delta: number,
): LoopKey[] {
  const span = range.end - range.start;
  if (!(span > 0) || delta === 0) return [...keys];
  const rate = delta / span;
  return keys.map((key) => ({
    id: key.id,
    data: {
      ...key.data,
      v: key.data.v - rate * (key.data.t - range.start),
      inHandle: { dt: key.data.inHandle.dt, dv: key.data.inHandle.dv - rate * key.data.inHandle.dt },
      outHandle: { dt: key.data.outHandle.dt, dv: key.data.outHandle.dv - rate * key.data.outHandle.dt },
    },
  }));
}

/**
 * Freezes both seam keys to the start key's out slope (fixed handles keeping their resolved lengths), so
 * slope⁻(end) = slope⁺(start) exactly whatever the tangent types computed. Stepped seams are left alone.
 */
function matchSeamSlopes(
  app: EditorApp,
  keys: LoopKey[],
  curve: CurveRecord,
  pre: InfinityMode,
  post: InfinityMode,
  range: { readonly start: Frame; readonly end: Frame },
): LoopKey[] {
  const first = indexAt(keys, range.start);
  const last = indexAt(keys, range.end);
  if (first === -1 || last === -1 || first === last) return keys;
  const start = (keys[first] as LoopKey).data;
  const stepped = (type: string): boolean => type === 'step' || type === 'stepNext';
  if (stepped(start.outType) || stepped((keys[last] as LoopKey).data.outType)) return keys;
  const compiled = compile(app, keys, curve, pre, post);
  const slope = compiled.outSlope[first] as number;
  const fix = (index: number): void => {
    const key = keys[index] as LoopKey;
    const inDt = Math.min(compiled.inDt[index] as number, -1e-6);
    const outDt = Math.max(compiled.outDt[index] as number, 1e-6);
    keys[index] = {
      id: key.id,
      data: {
        ...key.data,
        inType: 'fixed',
        outType: 'fixed',
        inHandle: { dt: inDt, dv: slope * inDt },
        outHandle: { dt: outDt, dv: slope * outDt },
        broken: false,
      },
    };
  };
  fix(first);
  fix(last);
  return keys;
}

/**
 * `blend`: the keys inside the last `frames` frames are replaced by one key per whole frame that cross-fades
 * (smoothstep) from the curve toward the start pose continued backwards along the start slope, so the end meets the
 * start in value and slope.
 */
function blendTail(
  app: EditorApp,
  keys: readonly LoopKey[],
  curve: CurveRecord,
  pre: InfinityMode,
  post: InfinityMode,
  range: { readonly start: Frame; readonly end: Frame },
  frames: number,
): LoopKey[] {
  const from = Math.max(range.start, range.end - frames);
  let planned = withKeyAt(app, keys, curve, pre, post, from);
  const compiled = compile(app, planned, curve, pre, post);
  const engine = internalsOf(app).deps.curves.engine;
  const startIndex = indexAt(planned, range.start);
  const startValue = engine.evaluate(compiled, range.start);
  const startSlope =
    startIndex === -1 ? evaluateAnimCurveSlope(compiled, range.start) : (compiled.outSlope[startIndex] as number);
  const span = range.end - from;
  const baked: LoopKey[] = [];
  for (let f = Math.floor(from + SAME_FRAME_EPS) + 1; f <= range.end + SAME_FRAME_EPS; f++) {
    const w = span > 0 ? smoothstep((f - from) / span) : 1;
    const target = startValue + startSlope * (f - range.end);
    const value = (1 - w) * engine.evaluate(compiled, f) + w * target;
    const existing = planned[indexAt(planned, f)];
    const base = existing?.data ?? planned[planned.length - 1]?.data;
    baked.push({
      id: existing?.id ?? null,
      data: {
        t: f,
        v: value,
        inType: 'auto',
        outType: 'auto',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: base?.weightLocked ?? true,
      },
    });
  }
  planned = planned.filter((key) => key.data.t <= from + SAME_FRAME_EPS || key.data.t > range.end + SAME_FRAME_EPS);
  return [...planned, ...baked].sort((a, b) => a.data.t - b.data.t);
}

/** The loop plan of one curve. */
export function planLoopCurve(
  app: EditorApp,
  view: ReadView,
  clip: ClipRecord,
  curve: CurveRecord,
  opts: {
    readonly method: LoopMethod;
    readonly rootTravel: RootTravel;
    readonly travel: boolean;
    readonly blendFrames: number;
  },
): LoopCurvePlan {
  const original: LoopKey[] = view.query.keysOfCurve(curve.id).map((key) => ({ id: key.id, data: keyDataOf(key) }));
  const keepTravel = opts.travel && opts.rootTravel === 'keep';
  if (original.length === 0 || keepTravel || curve.locked) {
    return {
      curve,
      travel: opts.travel,
      keys: original,
      pre: curve.pre,
      post: curve.post,
      measured: !keepTravel,
      changed: false,
    };
  }
  const offset = opts.travel && opts.rootTravel === 'cycleOffset';
  const pre: InfinityMode = offset ? 'cycleOffset' : 'cycle';
  const post: InfinityMode = pre;
  const range = clip.range;
  let keys: LoopKey[] = original;
  if (opts.method !== 'cycleOnly' || (opts.travel && opts.rootTravel === 'inPlace')) {
    keys = withKeyAt(app, keys, curve, pre, post, range.start);
    keys = withKeyAt(app, keys, curve, pre, post, range.end);
  }
  if (opts.travel && opts.rootTravel === 'inPlace') {
    const engine = internalsOf(app).deps.curves.engine;
    const compiled = compile(app, keys, curve, pre, post);
    keys = removeTravel(keys, range, engine.evaluate(compiled, range.end) - engine.evaluate(compiled, range.start));
  }
  if (opts.method !== 'cycleOnly') {
    if (opts.method === 'blend' && !offset) keys = blendTail(app, keys, curve, pre, post, range, opts.blendFrames);
    const first = indexAt(keys, range.start);
    const last = indexAt(keys, range.end);
    if (!offset && first !== -1 && last !== -1) {
      const end = keys[last] as LoopKey;
      keys[last] = { id: end.id, data: { ...end.data, v: (keys[first] as LoopKey).data.v } };
    }
    keys = matchSeamSlopes(app, keys, curve, pre, post, range);
  }
  const changed =
    pre !== curve.pre ||
    post !== curve.post ||
    keys.length !== original.length ||
    keys.some((key, i) => key.id !== original[i]?.id || JSON.stringify(key.data) !== JSON.stringify(original[i]?.data));
  return { curve, travel: opts.travel, keys, pre, post, measured: true, changed };
}

/** The seam metrics over a set of curve plans (before: their original keys; after: the plans). */
export function seamValues(
  app: EditorApp,
  view: ReadView,
  clip: ClipRecord,
  plans: readonly LoopCurvePlan[],
  which: 'before' | 'after',
): SeamValue[] {
  const out: SeamValue[] = [];
  for (const plan of plans) {
    if (!plan.measured) continue;
    const keys =
      which === 'after'
        ? plan.keys
        : view.query.keysOfCurve(plan.curve.id).map((key) => ({ id: key.id, data: keyDataOf(key) }));
    if (keys.length === 0) continue;
    const pre = which === 'after' ? plan.pre : plan.curve.pre;
    const post = which === 'after' ? plan.post : plan.curve.post;
    const seam = seamOf(app, keys, plan.curve, pre, post, clip.range, plan.travel);
    out.push({ control: plan.curve.control, channel: plan.curve.channel, ...seam });
  }
  return out;
}
