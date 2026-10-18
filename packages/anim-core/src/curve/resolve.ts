import type { InfinityMode, KeyData, SegmentKind, TangentType } from '../types';
import { Segment } from '../types';
import { autoTangentSlope } from './animx';
import { finiteOr, MIN_HANDLE_DT, ONE_THIRD, tangentTypeOf } from './keys';

/**
 * Tangent resolution for every `TangentType` (MVP-SPEC §4.11.4, research 01 §5.4):
 *
 * - `auto` / `autoMix` / `autoEase`: AnimX, clamped; end keys flat. `plateau` (M1-stretch) uses the AnimX legacy
 *   auto rule, which already is "spline-like, flat at extrema and between equal keys, flat end keys, never
 *   overshoots" (documented approximation).
 * - `spline`: (ny − py)/(nx − px) inside, the one-sided chord at an end key, 0 for a single key.
 * - `clamped`: the spline slope, but 0 when a neighbour's value is within 1e-5·max(1, |range|) of the key's value
 *   (`range` = max − min of the curve's key values). Documented approximation.
 * - `linear`: the one-sided chord (in: to the previous key, out: to the next key); a missing neighbour uses the
 *   other side's chord, so a linear end key extends its span into linear infinity.
 * - `flat`, `step`, `stepNext`: 0 (step types only matter as the out side's interpolation flag).
 * - `fixed`: the stored handle's direction; |dt| is at least 1e-6 frames (in: dt ≤ −1e-6, out: dt ≥ 1e-6).
 *
 * Handles: computed sides span a third of the span to the neighbour on that side (an end key's outer side copies
 * the other side's span, a single key uses 1 frame), as AnimX's `span · (1/3)`. Non-weighted fixed sides are
 * normalized to the same length; weighted fixed sides keep the stored handle (the monotonic-X correction runs per
 * segment when compiling).
 */
export interface ResolvedTangents {
  readonly inSlope: Float64Array;
  readonly outSlope: Float64Array;
  readonly inDt: Float64Array;
  readonly inDv: Float64Array;
  readonly outDt: Float64Array;
  readonly outDv: Float64Array;
}

/** Options shared by compile, handle resolution and insert. */
export interface CurveOptions {
  /** Cycle-aware auto tangents (FR-GE-17, M1-stretch): when `pre` and `post` both cycle, the first and last keys
   *  of the auto family use wrapped neighbours, which makes the loop C¹ at the seam. */
  readonly cycleAwareAuto?: boolean;
}

export function isCyclic(mode: InfinityMode): boolean {
  return mode === 'cycle' || mode === 'cycleOffset';
}

/** Resolves the slopes and (uncorrected) handles of every key of `keys` (sorted, unique, finite). */
export function resolveTangents(
  keys: readonly KeyData[],
  weighted: boolean,
  pre: InfinityMode,
  post: InfinityMode,
  opts?: CurveOptions,
): ResolvedTangents {
  const n = keys.length;
  const out: ResolvedTangents = {
    inSlope: new Float64Array(n),
    outSlope: new Float64Array(n),
    inDt: new Float64Array(n),
    inDv: new Float64Array(n),
    outDt: new Float64Array(n),
    outDv: new Float64Array(n),
  };
  if (n === 0) return out;

  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;
  for (const key of keys) {
    if (key.v < vMin) vMin = key.v;
    if (key.v > vMax) vMax = key.v;
  }
  const clampedEpsilon = 1e-5 * Math.max(1, Math.abs(vMax - vMin));

  const first = keys[0]!;
  const last = keys[n - 1]!;
  const cycleRange = last.t - first.t;
  const cyclic = opts?.cycleAwareAuto === true && n >= 2 && cycleRange > 0 && isCyclic(pre) && isCyclic(post);
  const valueRange = last.v - first.v;
  const preOffset = pre === 'cycleOffset' ? valueRange : 0;
  const postOffset = post === 'cycleOffset' ? valueRange : 0;

  for (let i = 0; i < n; i++) {
    const key = keys[i]!;
    const prev = keys[i - 1];
    const next = keys[i + 1];
    const x = key.t;
    const y = key.v;
    const chordIn = prev === undefined ? Number.NaN : (y - prev.v) / (x - prev.t);
    const chordOut = next === undefined ? Number.NaN : (next.v - y) / (next.t - x);
    const spanIn = prev !== undefined ? x - prev.t : next !== undefined ? next.t - x : 1;
    const spanOut = next !== undefined ? next.t - x : prev !== undefined ? x - prev.t : 1;

    const sideSlope = (type: TangentType, side: 'in' | 'out'): number => {
      switch (type) {
        case 'fixed': {
          const handle = side === 'in' ? key.inHandle : key.outHandle;
          const dt = finiteOr(handle.dt, 0);
          const dv = finiteOr(handle.dv, 0);
          return side === 'in' ? dv / Math.min(dt, -MIN_HANDLE_DT) : dv / Math.max(dt, MIN_HANDLE_DT);
        }
        case 'flat':
        case 'step':
        case 'stepNext':
          return 0;
        case 'linear':
          if (side === 'in') return prev !== undefined ? chordIn : next !== undefined ? chordOut : 0;
          return next !== undefined ? chordOut : prev !== undefined ? chordIn : 0;
        case 'spline':
          return splineSlope();
        case 'clamped':
          if (prev !== undefined && Math.abs(y - prev.v) <= clampedEpsilon) return 0;
          if (next !== undefined && Math.abs(next.v - y) <= clampedEpsilon) return 0;
          return splineSlope();
        case 'auto':
        case 'autoMix':
        case 'autoEase':
        case 'plateau':
          return autoSlope(type);
      }
    };

    const splineSlope = (): number => {
      if (prev !== undefined && next !== undefined) return (next.v - prev.v) / (next.t - prev.t);
      if (prev !== undefined) return chordIn;
      if (next !== undefined) return chordOut;
      return 0;
    };

    const autoSlope = (type: 'auto' | 'autoMix' | 'autoEase' | 'plateau'): number => {
      let px = prev?.t;
      let py = prev?.v;
      let nx = next?.t;
      let ny = next?.v;
      if (cyclic && i === 0) {
        const wrapped = keys[n - 2]!;
        px = wrapped.t - cycleRange;
        py = wrapped.v - preOffset;
      }
      if (cyclic && i === n - 1) {
        const wrapped = keys[1]!;
        nx = wrapped.t + cycleRange;
        ny = wrapped.v + postOffset;
      }
      if (px === undefined || py === undefined || nx === undefined || ny === undefined) return 0;
      return autoTangentSlope(type === 'plateau' ? 'auto' : type, x, px, nx, y, py, ny);
    };

    const inType = tangentTypeOf(key.inType);
    const outType = tangentTypeOf(key.outType);
    const inSlope = sideSlope(inType, 'in');
    const outSlope = sideSlope(outType, 'out');
    out.inSlope[i] = inSlope;
    out.outSlope[i] = outSlope;

    if (weighted && inType === 'fixed') {
      out.inDt[i] = finiteOr(key.inHandle.dt, 0);
      out.inDv[i] = finiteOr(key.inHandle.dv, 0);
    } else if (weighted) {
      // AnimX: tangent (x, y) = (span, slope·span); the control point sits at a third of it.
      out.inDt[i] = -(spanIn * ONE_THIRD);
      out.inDv[i] = -(inSlope * spanIn * ONE_THIRD);
    } else {
      const dt = -(spanIn * ONE_THIRD);
      out.inDt[i] = dt;
      out.inDv[i] = inSlope * dt;
    }
    if (weighted && outType === 'fixed') {
      out.outDt[i] = finiteOr(key.outHandle.dt, 0);
      out.outDv[i] = finiteOr(key.outHandle.dv, 0);
    } else if (weighted) {
      out.outDt[i] = spanOut * ONE_THIRD;
      out.outDv[i] = outSlope * spanOut * ONE_THIRD;
    } else {
      const dt = spanOut * ONE_THIRD;
      out.outDt[i] = dt;
      out.outDv[i] = outSlope * dt;
    }
  }
  return out;
}

/** AnimX span rules (MVP-SPEC §4.11.4): linear only if both sides are linear; step types come from the out side. */
export function segmentKindOf(outType: TangentType, nextInType: TangentType, weighted: boolean): SegmentKind {
  if (outType === 'linear' && nextInType === 'linear') return Segment.Linear;
  if (outType === 'step') return Segment.Step;
  if (outType === 'stepNext') return Segment.StepNext;
  return weighted ? Segment.Bezier : Segment.Hermite;
}

/** True for the two curve kinds (whose shape depends on the bounding tangents). */
export function isCurveSegment(kind: number): boolean {
  return kind === Segment.Hermite || kind === Segment.Bezier;
}
