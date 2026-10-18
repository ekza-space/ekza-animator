// Naive curve engine of the shared test kit (MVP-SPEC §7 WP-0b). It implements the `CurveEngine` contract with
// cubic Hermite segments and simple tangent rules so the fake app can evaluate clips before WP-1's AnimX port lands.
// It is an approximation: auto/clamped/plateau tangents are clamped Catmull-Rom slopes (flat at extremes and end
// keys), spline tangents are Catmull-Rom, tangent weights are ignored. Use the real `curveEngine` for exact values.
import {
  type AnimCurve,
  type CompiledAnimCurve,
  type CurveEngine,
  type Frame,
  type KeyData,
  Segment,
  type SegmentKind,
  type TangentType,
} from '@ekza-animator/anim-core';

export const naiveCurveEngine: CurveEngine = {
  compile: (curve) => compileNaiveCurve(curve),
  evaluate: evaluateNaiveCurve,
};

/**
 * The naive engine with cycle-aware auto tangents (M2A-SPEC §5.23), as the editor's kernel uses it: on curves whose
 * pre and post infinities both cycle, the end keys of the auto family take the wrapped neighbours.
 */
export const naiveCycleAwareCurveEngine: CurveEngine = {
  compile: (curve) => compileNaiveCurve(curve, { cycleAwareAuto: true }),
  evaluate: evaluateNaiveCurve,
};

const isCyclic = (mode: string): boolean => mode === 'cycle' || mode === 'cycleOffset';

export function compileNaiveCurve(curve: AnimCurve, opts?: { readonly cycleAwareAuto?: boolean }): CompiledAnimCurve {
  const keys = curve.keys;
  const n = keys.length;
  const span = n >= 2 ? (keys[n - 1] as KeyData).t - (keys[0] as KeyData).t : 0;
  const cyclic = opts?.cycleAwareAuto === true && n >= 2 && span > 0 && isCyclic(curve.pre) && isCyclic(curve.post);
  const valueRange = n >= 2 ? (keys[n - 1] as KeyData).v - (keys[0] as KeyData).v : 0;
  const t = new Float64Array(n);
  const v = new Float64Array(n);
  const inSlope = new Float64Array(n);
  const outSlope = new Float64Array(n);
  const inDt = new Float64Array(n);
  const inDv = new Float64Array(n);
  const outDt = new Float64Array(n);
  const outDv = new Float64Array(n);
  const segment = new Uint8Array(Math.max(n - 1, 0));
  keys.forEach((key, i) => {
    t[i] = key.t;
    v[i] = key.v;
  });
  for (let i = 0; i < n; i++) {
    const key = keys[i] as KeyData;
    const prev = keys[i - 1];
    const next = keys[i + 1];
    const left = prev === undefined ? null : (key.v - prev.v) / (key.t - prev.t);
    const right = next === undefined ? null : (next.v - key.v) / (next.t - key.t);
    const catmullRom = prev !== undefined && next !== undefined ? (next.v - prev.v) / (next.t - prev.t) : null;
    inSlope[i] = slopeFor(key.inType, 'in', key, left, right, catmullRom);
    outSlope[i] = slopeFor(key.outType, 'out', key, left, right, catmullRom);
    if (cyclic && (i === 0 || i === n - 1)) {
      // Wrapped neighbours for the auto family at the seam (as anim-core's cycleAwareAuto).
      const wrapPrev = i === 0 ? (keys[n - 2] as KeyData) : (prev as KeyData);
      const wrapNext = i === n - 1 ? (keys[1] as KeyData) : (next as KeyData);
      const pt = i === 0 ? wrapPrev.t - span : wrapPrev.t;
      const pv = i === 0 ? wrapPrev.v - (curve.pre === 'cycleOffset' ? valueRange : 0) : wrapPrev.v;
      const nt = i === n - 1 ? wrapNext.t + span : wrapNext.t;
      const nv = i === n - 1 ? wrapNext.v + (curve.post === 'cycleOffset' ? valueRange : 0) : wrapNext.v;
      const wrappedLeft = (key.v - pv) / (key.t - pt);
      const wrappedRight = (nv - key.v) / (nt - key.t);
      const wrappedCr = (nv - pv) / (nt - pt);
      if (AUTO_FAMILY.has(key.inType)) {
        inSlope[i] = slopeFor(key.inType, 'in', key, wrappedLeft, wrappedRight, wrappedCr);
      }
      if (AUTO_FAMILY.has(key.outType)) {
        outSlope[i] = slopeFor(key.outType, 'out', key, wrappedLeft, wrappedRight, wrappedCr);
      }
    }
    const inSpan = prev === undefined ? (next === undefined ? 1 : next.t - key.t) : key.t - prev.t;
    const outSpan = next === undefined ? inSpan : next.t - key.t;
    inDt[i] = -inSpan / 3;
    inDv[i] = (inSlope[i] as number) * (inDt[i] as number);
    outDt[i] = outSpan / 3;
    outDv[i] = (outSlope[i] as number) * (outDt[i] as number);
    if (next !== undefined) segment[i] = segmentKind(key.outType, next.inType);
  }
  return {
    keyCount: n,
    t,
    v,
    inSlope,
    outSlope,
    inDt,
    inDv,
    outDt,
    outDv,
    segment,
    weighted: curve.weighted,
    pre: curve.pre,
    post: curve.post,
  };
}

const AUTO_FAMILY: ReadonlySet<TangentType> = new Set<TangentType>(['auto', 'autoEase', 'autoMix', 'plateau']);

function slopeFor(
  type: TangentType,
  side: 'in' | 'out',
  key: KeyData,
  left: number | null,
  right: number | null,
  catmullRom: number | null,
): number {
  switch (type) {
    case 'linear':
      return side === 'in' ? (left ?? right ?? 0) : (right ?? left ?? 0);
    case 'flat':
    case 'step':
    case 'stepNext':
      return 0;
    case 'fixed': {
      const handle = side === 'in' ? key.inHandle : key.outHandle;
      return handle.dt === 0 ? 0 : handle.dv / handle.dt;
    }
    case 'spline':
      return catmullRom ?? left ?? right ?? 0;
    case 'auto':
    case 'autoEase':
    case 'autoMix':
    case 'clamped':
    case 'plateau': {
      // Flat at end keys and at extremes; otherwise Catmull-Rom limited so the segment cannot overshoot.
      if (left === null || right === null || catmullRom === null || left * right <= 0) return 0;
      const limit = 3 * Math.min(Math.abs(left), Math.abs(right));
      return Math.sign(catmullRom) * Math.min(Math.abs(catmullRom), limit);
    }
  }
}

function segmentKind(outType: TangentType, nextInType: TangentType): SegmentKind {
  if (outType === 'step') return Segment.Step;
  if (outType === 'stepNext') return Segment.StepNext;
  if (outType === 'linear' && nextInType === 'linear') return Segment.Linear;
  return Segment.Hermite;
}

export function evaluateNaiveCurve(c: CompiledAnimCurve, frame: Frame): number {
  const n = c.keyCount;
  if (n === 0) return 0;
  const first = c.t[0] as number;
  const last = c.t[n - 1] as number;
  const v0 = c.v[0] as number;
  const vn = c.v[n - 1] as number;
  if (n === 1 || (frame >= first && frame <= last)) return evaluateInRange(c, frame);
  const span = last - first;
  const before = frame < first;
  const mode = before ? c.pre : c.post;
  switch (mode) {
    case 'constant':
      return before ? v0 : vn;
    case 'linear':
      return before
        ? v0 + (frame - first) * (c.inSlope[0] as number)
        : vn + (frame - last) * (c.outSlope[n - 1] as number);
    case 'cycle':
    case 'cycleOffset':
    case 'oscillate': {
      if (span <= 0) return v0;
      const cycles = Math.floor((frame - first) / span);
      const local = frame - first - cycles * span;
      if (mode === 'cycle') return evaluateInRange(c, first + local);
      if (mode === 'cycleOffset') return evaluateInRange(c, first + local) + cycles * (vn - v0);
      return evaluateInRange(c, cycles % 2 === 0 ? first + local : last - local);
    }
  }
}

function evaluateInRange(c: CompiledAnimCurve, frame: Frame): number {
  const n = c.keyCount;
  if (frame <= (c.t[0] as number)) return c.v[0] as number;
  if (frame >= (c.t[n - 1] as number)) return c.v[n - 1] as number;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((c.t[mid] as number) <= frame) lo = mid;
    else hi = mid;
  }
  const t0 = c.t[lo] as number;
  const t1 = c.t[hi] as number;
  const v0 = c.v[lo] as number;
  const v1 = c.v[hi] as number;
  const h = t1 - t0;
  const s = (frame - t0) / h;
  switch (c.segment[lo] as SegmentKind) {
    case Segment.Step:
      return v0;
    case Segment.StepNext:
      return frame > t0 ? v1 : v0;
    case Segment.Linear:
      return v0 + (v1 - v0) * s;
    case Segment.Hermite:
    case Segment.Bezier: {
      const s2 = s * s;
      const s3 = s2 * s;
      const m0 = (c.outSlope[lo] as number) * h;
      const m1 = (c.inSlope[hi] as number) * h;
      return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1;
    }
  }
}
