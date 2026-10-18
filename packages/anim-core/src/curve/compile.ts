import type { AnimCurve, CompiledAnimCurve } from '../types';
import { Segment } from '../types';
import { BEZIER_CORRECTED, BEZIER_STRIDE, prepareBezierSegment, prepareHermiteSegment } from './animx';
import { infinityModeOf, normalizeKeys, tangentTypeOf } from './keys';
import { type CurveOptions, resolveTangents, segmentKindOf } from './resolve';

/** Per-segment coefficient stride (Hermite uses the first 4, Bézier all 8; see `animx/bezier.ts`). */
export const COEF_STRIDE = BEZIER_STRIDE;

/**
 * What `compileAnimCurve` returns: the contract's arrays plus per-segment coefficients prepared once, so evaluation
 * is a binary search and a polynomial (Hermite) or a cubic root solve (Bézier). Compiled curves are immutable.
 */
export interface CompiledCurve extends CompiledAnimCurve {
  /** Segment i at `coef[8i …]`: Hermite [c0, c1, c2, c3]; Bézier [x3, x2, x1, y3, y2, y1, y0, linear]. */
  readonly coef: Float64Array;
  readonly cycleAwareAuto: boolean;
  /**
   * Segment of the last key lookup (M2A-SPEC §5.21.3, M-3): `keyAtOrAfter` tries it and the next segment before a
   * binary search. A cache, not state: values never depend on it.
   */
  segmentHint: number;
}

/**
 * Compiles a stored curve into the evaluation-ready struct-of-arrays form (ADR 0003): resolves every tangent
 * (AnimX auto family, documented Spline/Clamped approximations, linear chords, flat, fixed), applies the AnimX span
 * rules, the monotonic-X correction of weighted segments, and prepares each segment's coefficients. Document content
 * is repaired, never rejected: unsorted or duplicate keys are sorted and deduplicated, non-finite keys dropped,
 * unknown tangent types read as `auto` and unknown infinities as `constant`.
 */
export function compileAnimCurve(curve: AnimCurve, opts?: CurveOptions): CompiledCurve {
  const keys = normalizeKeys(curve.keys);
  const weighted = curve.weighted === true;
  const pre = infinityModeOf(curve.pre);
  const post = infinityModeOf(curve.post);
  const n = keys.length;
  const r = resolveTangents(keys, weighted, pre, post, opts);
  const t = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = keys[i]!.t;
    v[i] = keys[i]!.v;
  }
  const segments = Math.max(n - 1, 0);
  const segment = new Uint8Array(segments);
  const coef = new Float64Array(segments * COEF_STRIDE);
  for (let k = 0; k < segments; k++) {
    const kind = segmentKindOf(tangentTypeOf(keys[k]!.outType), tangentTypeOf(keys[k + 1]!.inType), weighted);
    segment[k] = kind;
    prepareSegment(kind, k, t, v, r.outSlope, r.inSlope, r.outDt, r.outDv, r.inDt, r.inDv, coef, true);
  }
  return {
    keyCount: n,
    t,
    v,
    inSlope: r.inSlope,
    outSlope: r.outSlope,
    inDt: r.inDt,
    inDv: r.inDv,
    outDt: r.outDt,
    outDv: r.outDv,
    segment,
    weighted,
    pre,
    post,
    coef,
    cycleAwareAuto: opts?.cycleAwareAuto === true,
    segmentHint: 0,
  };
}

/**
 * Prepares segment `k`'s coefficients. For Bézier segments `writeCorrected` stores the monotonic-X corrected
 * handles back into the handle arrays (the contract exposes corrected handles to painters and editors).
 */
function prepareSegment(
  kind: number,
  k: number,
  t: Float64Array,
  v: Float64Array,
  outSlope: Float64Array,
  inSlope: Float64Array,
  outDt: Float64Array,
  outDv: Float64Array,
  inDt: Float64Array,
  inDv: Float64Array,
  coef: Float64Array,
  writeCorrected: boolean,
): void {
  const o = k * COEF_STRIDE;
  const t0 = t[k]!;
  const t1 = t[k + 1]!;
  const v0 = v[k]!;
  const v1 = v[k + 1]!;
  if (kind === Segment.Hermite) {
    prepareHermiteSegment(t0, v0, outSlope[k]!, inSlope[k + 1]!, t1, v1, coef, o);
  } else if (kind === Segment.Bezier) {
    const x1 = t0 + outDt[k]!;
    const y1 = v0 + outDv[k]!;
    const x2 = t1 + inDt[k + 1]!;
    const y2 = v1 + inDv[k + 1]!;
    prepareBezierSegment(t0, v0, x1, y1, x2, y2, t1, v1, coef, o);
    if (writeCorrected) {
      if (BEZIER_CORRECTED[0] !== x1 || BEZIER_CORRECTED[1] !== y1) {
        outDt[k] = BEZIER_CORRECTED[0]! - t0;
        outDv[k] = BEZIER_CORRECTED[1]! - v0;
      }
      if (BEZIER_CORRECTED[2] !== x2 || BEZIER_CORRECTED[3] !== y2) {
        inDt[k + 1] = BEZIER_CORRECTED[2]! - t1;
        inDv[k + 1] = BEZIER_CORRECTED[3]! - v1;
      }
    }
  }
}

const foreignCoefficients = new WeakMap<CompiledAnimCurve, Float64Array>();

/**
 * Segment coefficients of any `CompiledAnimCurve`: the prepared ones for curves from `compileAnimCurve`, otherwise
 * derived once from the contract arrays (slopes for Hermite, handles for Bézier) and cached per object.
 */
export function coefficientsOf(c: CompiledAnimCurve): Float64Array {
  const own = (c as Partial<CompiledCurve>).coef;
  const segments = Math.max(c.keyCount - 1, 0);
  if (own instanceof Float64Array && own.length >= segments * COEF_STRIDE) return own;
  let coef = foreignCoefficients.get(c);
  if (coef === undefined) {
    coef = new Float64Array(segments * COEF_STRIDE);
    for (let k = 0; k < segments; k++) {
      prepareSegment(c.segment[k]!, k, c.t, c.v, c.outSlope, c.inSlope, c.outDt, c.outDv, c.inDt, c.inDv, coef, false);
    }
    foreignCoefficients.set(c, coef);
  }
  return coef;
}
