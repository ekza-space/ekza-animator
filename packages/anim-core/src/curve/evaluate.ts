import { EkzaError } from '../errors';
import type { CompiledAnimCurve, Frame, InfinityMode, SegmentKind } from '../types';
import { Segment } from '../types';
import {
  bezierParameter,
  bezierSlopeAt,
  evaluateBezierSegment,
  evaluateHermiteSegment,
  hermiteSlope,
  INFINITY_MAP,
  mapCyclicInfinity,
} from './animx';
import { COEF_STRIDE, type CompiledCurve, coefficientsOf } from './compile';
import { KEY_TIME_EPSILON, lowerBound, upperBound } from './keys';

/** AnimX `equivalent()` tolerance: a time this close to a key returns the key's value. */
const KEY_SNAP_EPSILON = 1e-10;

function isCyclicMode(mode: InfinityMode): mode is 'cycle' | 'cycleOffset' | 'oscillate' {
  return mode === 'cycle' || mode === 'cycleOffset' || mode === 'oscillate';
}

/** Slope (value per frame) of segment `k` at `frame`. */
function segmentSlope(c: CompiledAnimCurve, coef: Float64Array, k: number, frame: number): number {
  const t0 = c.t[k]!;
  const t1 = c.t[k + 1]!;
  switch (c.segment[k] as SegmentKind) {
    case Segment.Linear:
      return t0 === t1 ? 0 : (c.v[k + 1]! - c.v[k]!) / (t1 - t0);
    case Segment.Step:
    case Segment.StepNext:
      return 0;
    case Segment.Bezier: {
      const o = k * COEF_STRIDE;
      return bezierSlopeAt(coef, o, t0, t1, bezierParameter(coef, o, t0, t1, frame));
    }
    case Segment.Hermite:
    default:
      return hermiteSlope(coef, k * COEF_STRIDE, frame - t0);
  }
}

/** Prepared coefficients without the `coefficientsOf` checks on the hot path (own compiled curves carry them). */
function coefficientsFast(c: CompiledAnimCurve): Float64Array {
  return (c as Partial<CompiledCurve>).coef ?? coefficientsOf(c);
}

/** AnimX `evaluateCurve` inside [first, last] (and constant infinities outside). */
function evaluateInRange(c: CompiledAnimCurve, frame: number): number {
  const t = c.t;
  const n = c.keyCount;
  // first key at or after `frame` (AnimX `keyframe(time)`)
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < frame) lo = mid + 1;
    else hi = mid;
  }
  if (lo === n) return c.v[n - 1]!;
  if (Math.abs(t[lo]! - frame) <= KEY_SNAP_EPSILON || lo === 0) return c.v[lo]!;
  const k = lo - 1;
  switch (c.segment[k] as SegmentKind) {
    case Segment.Hermite: {
      const coef = coefficientsFast(c);
      const o = k * COEF_STRIDE;
      const s = frame - t[k]!;
      return s * (s * (s * coef[o]! + coef[o + 1]!) + coef[o + 2]!) + coef[o + 3]!;
    }
    case Segment.Linear: {
      const t0 = t[k]!;
      const t1 = t[lo]!;
      const v0 = c.v[k]!;
      return t0 === t1 ? v0 : v0 + ((frame - t0) / (t1 - t0)) * (c.v[lo]! - v0);
    }
    case Segment.Step:
      return c.v[k]!;
    case Segment.StepNext:
      return c.v[lo]!;
    case Segment.Bezier:
      return evaluateBezierSegment(coefficientsFast(c), k * COEF_STRIDE, t[k]!, t[lo]!, frame);
    default:
      return evaluateHermiteSegment(coefficientsFast(c), k * COEF_STRIDE, frame - t[k]!);
  }
}

/** Segment whose slope applies at `frame` ∈ [first, last]: the one starting there (the last one at the last key). */
function slopeSegmentAt(c: CompiledAnimCurve, frame: number): number {
  return Math.min(Math.max(upperBound(c.t, c.keyCount, frame) - 1, 0), c.keyCount - 2);
}

function slopeInRange(c: CompiledAnimCurve, coef: Float64Array, frame: number): number {
  if (c.keyCount < 2) return 0;
  return segmentSlope(c, coef, slopeSegmentAt(c, frame), frame);
}

/**
 * Writes the infinity mapping of `frame` into INFINITY_MAP ([in-range frame, value offset, mirrored]); returns
 * false when `frame` is inside the key range (or the curve is empty).
 */
function mapInfinity(c: CompiledAnimCurve, frame: number): boolean {
  const n = c.keyCount;
  if (n === 0) return false;
  const first = c.t[0]!;
  const last = c.t[n - 1]!;
  const pre = frame < first;
  if (!pre && !(frame > last)) return false;
  const mode = pre ? c.pre : c.post;
  const boundary = pre ? first : last;
  if (mode === 'linear') {
    INFINITY_MAP[0] = boundary;
    INFINITY_MAP[1] = pre ? -(first - frame) * c.inSlope[0]! : (frame - last) * c.outSlope[n - 1]!;
    INFINITY_MAP[2] = 0;
  } else if (isCyclicMode(mode) && last > first) {
    mapCyclicInfinity(frame, first, last, mode, pre);
    INFINITY_MAP[1] = INFINITY_MAP[1]! * (c.v[n - 1]! - c.v[0]!);
  } else {
    // constant, or a cyclic mode on a single key (AnimX returns 0 there; the key value is the sane limit)
    INFINITY_MAP[0] = boundary;
    INFINITY_MAP[1] = 0;
    INFINITY_MAP[2] = 0;
  }
  return true;
}

/**
 * Value of a compiled curve at `frame` with AnimX semantics: key values within 1e-10 of a key time, the span rules,
 * Hermite/Bézier segments, and pre/post infinity. An empty curve evaluates to 0. Allocation-free.
 */
export function evaluateAnimCurve(c: CompiledAnimCurve, frame: Frame): number {
  const n = c.keyCount;
  if (n === 0) return 0;
  const t = c.t;
  if (frame < t[0]!) {
    if (c.pre === 'constant') return c.v[0]!;
  } else if (frame > t[n - 1]!) {
    if (c.post === 'constant') return c.v[n - 1]!;
  } else {
    return evaluateInRange(c, frame);
  }
  mapInfinity(c, frame);
  const offset = INFINITY_MAP[1]!;
  return evaluateInRange(c, INFINITY_MAP[0]!) + offset;
}

/**
 * Slope in value per frame at `frame`: the right derivative at a key (the left one at the last key); 0 on step
 * spans, constant infinity and empty or single-key curves (except linear infinity); mirrored under oscillation.
 */
export function evaluateAnimCurveSlope(c: CompiledAnimCurve, frame: Frame): number {
  const n = c.keyCount;
  if (n === 0) return 0;
  const coef = coefficientsOf(c);
  if (mapInfinity(c, frame)) {
    const pre = frame < c.t[0]!;
    const mode = pre ? c.pre : c.post;
    if (mode === 'linear') return pre ? c.inSlope[0]! : c.outSlope[n - 1]!;
    if (!isCyclicMode(mode) || n < 2) return 0;
    const mirrored = INFINITY_MAP[2] === 1;
    const slope = slopeInRange(c, coef, INFINITY_MAP[0]!);
    return mirrored ? -slope : slope;
  }
  return slopeInRange(c, coef, frame);
}

/** `out[i] = evaluateAnimCurve(c, start + i·step)` for i < count. Allocation-free. */
export function sampleAnimCurve(
  c: CompiledAnimCurve,
  start: Frame,
  step: number,
  count: number,
  out: Float64Array,
): void {
  if (!Number.isInteger(count) || count < 0 || count > out.length) {
    throw new EkzaError('unsupported', `sampleAnimCurve: count ${count} does not fit an output of ${out.length}`);
  }
  for (let i = 0; i < count; i++) out[i] = evaluateAnimCurve(c, start + i * step);
}

/**
 * Bézier control points of segment i in (frame, value): [t0, v0, t1, v1, t2, v2, t3, v3]. Curve segments give the
 * exact cubic that is evaluated (Hermite: from its polynomial, including AnimX's straight-line short-circuit;
 * Bézier: the monotonic-X corrected handles). Linear spans give the straight line. Step spans give their
 * horizontal run (step: at v_i ending at t_{i+1}; step-next: at v_{i+1} starting at t_i); the vertical jump is
 * at t_{i+1} (step) or t_i (step-next).
 */
export function segmentControlPoints(c: CompiledAnimCurve, i: number, out: Float64Array): void {
  if (!Number.isInteger(i) || i < 0 || i >= c.keyCount - 1 || out.length < 8) {
    throw new EkzaError('unsupported', `segmentControlPoints: no segment ${i} (keys: ${c.keyCount})`);
  }
  const t0 = c.t[i]!;
  const t1 = c.t[i + 1]!;
  const v0 = c.v[i]!;
  const v1 = c.v[i + 1]!;
  const span = t1 - t0;
  out[0] = t0;
  out[2] = t0 + span / 3;
  out[4] = t1 - span / 3;
  out[6] = t1;
  switch (c.segment[i] as SegmentKind) {
    case Segment.Linear:
      out[1] = v0;
      out[3] = v0 + (v1 - v0) / 3;
      out[5] = v1 - (v1 - v0) / 3;
      out[7] = v1;
      return;
    case Segment.Step:
      out[1] = v0;
      out[3] = v0;
      out[5] = v0;
      out[7] = v0;
      return;
    case Segment.StepNext:
      out[1] = v1;
      out[3] = v1;
      out[5] = v1;
      out[7] = v1;
      return;
    case Segment.Bezier:
      out[1] = v0;
      out[2] = t0 + c.outDt[i]!;
      out[3] = v0 + c.outDv[i]!;
      out[4] = t1 + c.inDt[i + 1]!;
      out[5] = v1 + c.inDv[i + 1]!;
      out[7] = v1;
      return;
    case Segment.Hermite:
    default: {
      // power basis a + b·s + c·s² + d·s³ on s ∈ [0, span] → Bézier ordinates
      const coef = coefficientsOf(c);
      const o = i * COEF_STRIDE;
      const quadratic = coef[o + 1]!;
      const linear = coef[o + 2]!;
      const constant = coef[o + 3]!;
      out[1] = constant;
      out[3] = constant + (linear * span) / 3;
      out[5] = constant + (2 * linear * span) / 3 + (quadratic * span * span) / 3;
      out[7] = v1;
      return;
    }
  }
}

/** Kind of the span containing `frame` (the span starting at a key's time); null outside the key range. */
export function spanKindAt(c: CompiledAnimCurve, frame: Frame): SegmentKind | null {
  const n = c.keyCount;
  if (n < 2 || !(frame >= c.t[0]!) || !(frame <= c.t[n - 1]!)) return null;
  return c.segment[slopeSegmentAt(c, frame)] as SegmentKind;
}

/**
 * Maps a frame outside the key range to the in-range frame and value offset per the infinity mode
 * (value = evaluate(mapped frame) + valueOffset). Inside the range it is the identity. Constant and linear map to the
 * end key (linear: valueOffset = slope·distance); `mirrored` is true where oscillation plays the curve backwards.
 */
export function infinityMap(
  c: CompiledAnimCurve,
  frame: Frame,
): { readonly frame: Frame; readonly valueOffset: number; readonly mirrored: boolean } {
  if (!mapInfinity(c, frame)) return { frame, valueOffset: 0, mirrored: false };
  return { frame: INFINITY_MAP[0]!, valueOffset: INFINITY_MAP[1]!, mirrored: INFINITY_MAP[2] === 1 };
}

/** Index of the key nearest to `frame` within `epsilon` (default 1e-6 frames), −1 if none. */
export function keyIndexAt(c: CompiledAnimCurve, frame: Frame, epsilon: number = KEY_TIME_EPSILON): number {
  const n = c.keyCount;
  if (n === 0 || !(epsilon >= 0)) return -1;
  const i = lowerBound(c.t, n, frame);
  const below = i > 0 ? Math.abs(c.t[i - 1]! - frame) : Number.POSITIVE_INFINITY;
  const above = i < n ? Math.abs(c.t[i]! - frame) : Number.POSITIVE_INFINITY;
  if (above <= below) return above <= epsilon ? i : -1;
  return below <= epsilon ? i - 1 : -1;
}

/**
 * Smallest inclusive key-index range [lo, hi] covering every segment that intersects the frame window [f0, f1]:
 * lo = the last key at or before f0 (else 0), hi = the first key at or after f1 (else the last key). Painters draw
 * keys lo…hi and segments lo…hi−1 (plus infinity outside the keys). An empty curve gives [0, −1].
 */
export function visibleKeyRange(c: CompiledAnimCurve, f0: Frame, f1: Frame): readonly [lo: number, hi: number] {
  const n = c.keyCount;
  if (n === 0) return [0, -1];
  const a = Math.min(f0, f1);
  const b = Math.max(f0, f1);
  const lo = Math.max(upperBound(c.t, n, a) - 1, 0);
  const hi = Math.max(Math.min(lowerBound(c.t, n, b), n - 1), lo);
  return [lo, hi];
}
