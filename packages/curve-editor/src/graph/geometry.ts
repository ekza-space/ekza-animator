// Geometry of the drawn curve, read straight from the compiled curve's resolved handles (`CompiledAnimCurve` in
// MVP-SPEC §4.1: "resolved handle offsets … used by painters and editors"). Every Hermite or Bézier segment is the
// cubic Bézier P0 = key i, P1 = P0 + out handle, P2 = P3 + in handle, P3 = key i+1 in the (frame, value) plane, so the
// painter draws it exactly and this module evaluates the very curve on screen (ADR 0007 §3). Infinity regions repeat
// the key range per the pre/post modes. Nothing here allocates per call.
import { type CompiledAnimCurve, Segment, type SegmentKind } from '@ekza-animator/anim-core';

const at = (array: Float64Array, i: number): number => array[i] as number;

/** Kind of segment i (key i → key i+1). */
export function segmentKind(c: CompiledAnimCurve, i: number): SegmentKind {
  return c.segment[i] as SegmentKind;
}

/** Control points of segment i in (frame, value): out = [t0, v0, t1, v1, t2, v2, t3, v3]. */
export function segmentBezier(c: CompiledAnimCurve, i: number, out: Float64Array): void {
  const t0 = at(c.t, i);
  const v0 = at(c.v, i);
  const t3 = at(c.t, i + 1);
  const v3 = at(c.v, i + 1);
  out[0] = t0;
  out[1] = v0;
  out[2] = t0 + at(c.outDt, i);
  out[3] = v0 + at(c.outDv, i);
  out[4] = t3 + at(c.inDt, i + 1);
  out[5] = v3 + at(c.inDv, i + 1);
  out[6] = t3;
  out[7] = v3;
}

const cubic = (p0: number, p1: number, p2: number, p3: number, u: number): number => {
  const w = 1 - u;
  return w * w * w * p0 + 3 * w * w * u * p1 + 3 * w * u * u * p2 + u * u * u * p3;
};

const cubicDerivative = (p0: number, p1: number, p2: number, p3: number, u: number): number => {
  const w = 1 - u;
  return 3 * w * w * (p1 - p0) + 6 * w * u * (p2 - p1) + 3 * u * u * (p3 - p2);
};

/**
 * Bézier parameter u ∈ [0, 1] with x(u) = frame, for a segment whose x is monotonic (the engine guarantees it for
 * weighted curves; non-weighted handles sit at Δ/3, where x is linear in u and the answer is exact).
 */
export function bezierParamAt(b: Float64Array, frame: number): number {
  const t0 = b[0] as number;
  const t1 = b[2] as number;
  const t2 = b[4] as number;
  const t3 = b[6] as number;
  const span = t3 - t0;
  if (!(span > 0)) return 0;
  const linear = (frame - t0) / span;
  if (linear <= 0) return 0;
  if (linear >= 1) return 1;
  const third = span / 3;
  if (Math.abs(t1 - t0 - third) <= 1e-12 * span && Math.abs(t3 - t2 - third) <= 1e-12 * span) return linear;
  // Newton from the linear guess, kept inside a shrinking bracket (bisection when Newton leaves it).
  let lo = 0;
  let hi = 1;
  let u = linear;
  for (let iteration = 0; iteration < 64; iteration++) {
    const x = cubic(t0, t1, t2, t3, u) - frame;
    if (Math.abs(x) <= 1e-13 * Math.max(1, Math.abs(frame))) return u;
    if (x < 0) lo = u;
    else hi = u;
    const dx = cubicDerivative(t0, t1, t2, t3, u);
    let next = dx > 0 ? u - x / dx : Number.NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (hi - lo <= 1e-15) return next;
    u = next;
  }
  return u;
}

/** Value of segment i of the drawn curve at `frame` (t[i] ≤ frame ≤ t[i+1]); `scratch` holds 8 numbers. */
export function segmentValueAt(c: CompiledAnimCurve, i: number, frame: number, scratch: Float64Array): number {
  const t0 = at(c.t, i);
  const t3 = at(c.t, i + 1);
  const v0 = at(c.v, i);
  const v3 = at(c.v, i + 1);
  switch (segmentKind(c, i)) {
    case Segment.Step:
      return frame < t3 ? v0 : v3;
    case Segment.StepNext:
      return frame > t0 ? v3 : v0;
    case Segment.Linear:
      return t3 > t0 ? v0 + ((v3 - v0) * (frame - t0)) / (t3 - t0) : v0;
    case Segment.Hermite:
    case Segment.Bezier: {
      segmentBezier(c, i, scratch);
      const u = bezierParamAt(scratch, frame);
      return cubic(v0, scratch[3] as number, scratch[5] as number, v3, u);
    }
  }
}

/** Index i of the segment containing `frame` (t[i] ≤ frame < t[i+1]; the last segment includes its end). */
export function segmentIndexAt(c: CompiledAnimCurve, frame: number): number {
  const n = c.keyCount;
  if (n < 2) return -1;
  if (frame <= at(c.t, 0)) return 0;
  if (frame >= at(c.t, n - 1)) return n - 2;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(c.t, mid) <= frame) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** First key index with t ≥ frame (keyCount when none). */
export function lowerBound(c: CompiledAnimCurve, frame: number): number {
  let lo = 0;
  let hi = c.keyCount;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(c.t, mid) < frame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Key index range [lo, hi] whose segments touch the frame interval [f0, f1]: the keys inside it plus one neighbour on
 * each side, so the segments entering and leaving the interval are included. Empty range → lo > hi.
 */
export function visibleRange(c: CompiledAnimCurve, f0: number, f1: number): readonly [number, number] {
  const n = c.keyCount;
  if (n === 0) return [0, -1];
  const lo = Math.max(lowerBound(c, f0) - 1, 0);
  const hi = Math.min(lowerBound(c, f1), n - 1);
  return [lo, Math.max(hi, lo)];
}

/** Mapping of a frame outside the key range onto it (ADR 0003 infinity modes); identity inside the range. */
export interface InfinityMapping {
  frame: number;
  offset: number;
  mirrored: boolean;
  /** 0 inside the key range; the signed cycle index outside it (cycle modes) or ±1 (constant, linear). */
  cycle: number;
}

/** Fills `out` with the in-range frame and value offset of `frame` (constant: clamped; linear: see `drawnValueAt`). */
export function infinityMapping(c: CompiledAnimCurve, frame: number, out: InfinityMapping): InfinityMapping {
  const n = c.keyCount;
  out.frame = frame;
  out.offset = 0;
  out.mirrored = false;
  out.cycle = 0;
  if (n === 0) return out;
  const first = at(c.t, 0);
  const last = at(c.t, n - 1);
  if (frame >= first && frame <= last) return out;
  const before = frame < first;
  const mode = before ? c.pre : c.post;
  const span = last - first;
  if (mode === 'constant' || mode === 'linear' || !(span > 0)) {
    out.frame = before ? first : last;
    out.cycle = before ? -1 : 1;
    return out;
  }
  const cycle = Math.floor((frame - first) / span);
  const local = frame - first - cycle * span;
  out.cycle = cycle;
  if (mode === 'oscillate' && cycle % 2 !== 0) {
    out.frame = last - local;
    out.mirrored = true;
  } else {
    out.frame = first + local;
  }
  if (mode === 'cycleOffset') out.offset = cycle * (at(c.v, n - 1) - at(c.v, 0));
  return out;
}

/** Value of the drawn curve (key range and infinity regions) at any frame; NaN for a curve without keys. */
export function drawnValueAt(
  c: CompiledAnimCurve,
  frame: number,
  scratch: Float64Array,
  mapping: InfinityMapping,
): number {
  const n = c.keyCount;
  if (n === 0) return Number.NaN;
  const first = at(c.t, 0);
  const last = at(c.t, n - 1);
  if (frame < first && c.pre === 'linear') return at(c.v, 0) + (frame - first) * at(c.inSlope, 0);
  if (frame > last && c.post === 'linear') return at(c.v, n - 1) + (frame - last) * at(c.outSlope, n - 1);
  infinityMapping(c, frame, mapping);
  if (n === 1) return at(c.v, 0) + mapping.offset;
  const i = segmentIndexAt(c, mapping.frame);
  return segmentValueAt(c, i, mapping.frame, scratch) + mapping.offset;
}

export function newInfinityMapping(): InfinityMapping {
  return { frame: 0, offset: 0, mirrored: false, cycle: 0 };
}
