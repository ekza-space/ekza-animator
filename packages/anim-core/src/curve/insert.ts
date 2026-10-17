import { EkzaError } from '../errors';
import type { AnimCurve, Frame, Handle, KeyData, SegmentKind, TangentType } from '../types';
import { Segment } from '../types';
import { bezierParameter, bezierValueAt } from './animx';
import { COEF_STRIDE, compileAnimCurve } from './compile';
import { evaluateAnimCurve, evaluateAnimCurveSlope, keyIndexAt } from './evaluate';
import { infinityModeOf, makeKeyData, normalizeKeys, ONE_THIRD, tangentTypeOf, upperBound } from './keys';
import { type CurveOptions, isCurveSegment, resolveTangents, segmentKindOf } from './resolve';

type Side = 'in' | 'out';

function withFixedSide(key: KeyData, side: Side, handle: Handle): KeyData {
  return side === 'in'
    ? { ...key, inType: 'fixed', inHandle: handle }
    : { ...key, outType: 'fixed', outHandle: handle };
}

function fixedKey(t: Frame, v: number, inHandle: Handle, outHandle: Handle): KeyData {
  return { t, v, inType: 'fixed', outType: 'fixed', inHandle, outHandle, broken: false, weightLocked: true };
}

function sideType(key: KeyData, side: Side): TangentType {
  return tangentTypeOf(side === 'in' ? key.inType : key.outType);
}

/**
 * Inserts a key at `frame` without changing the curve (MVP-SPEC §4.11.4, ADR 0003's explicit exception to "never
 * write computed tangents"):
 *
 * 1. Step / step-next spans get a key holding the span's value (`flat` in, `step`/`stepNext` out); linear spans a
 *    `linear`/`linear` key on the line.
 * 2. Hermite spans get v(t*) with both sides `fixed` along v′(t*); weighted (Bézier) spans are split with de
 *    Casteljau at the parameter of t* (after the monotonic correction): the new key takes the inner sub-handles and
 *    the two neighbour sides adjacent to the split take the outer ones (as `fixed`).
 * 3. Every other computed side whose resolved slope changes because its neighbourhood changed — and that still
 *    shapes the curve (a side of a Hermite/Bézier span, or an end key's outer side under linear infinity) — becomes
 *    `fixed` with its pre-insert handle. This also covers the wrapped end keys under cycle-aware auto, the step and
 *    linear cases (their neighbours' other sides can still change), and keeps linear spans linear.
 *
 * Outside the key range the key takes the infinity's value and slope; the old end key's outer side is fixed to the
 * infinity slope, so constant and linear infinities are preserved exactly (cyclic ones cannot be, since the cycle
 * range changes). A key already within 1e-6 of `frame` is returned unchanged.
 *
 * `frozen`: indices (in the result) of pre-existing keys whose data changed. Throws `EkzaError('unsupported')` on a
 * curve without keys (its value is the channel's static value, which the curve does not know).
 */
export function insertKeyPreservingShape(
  curve: AnimCurve,
  frame: Frame,
  opts?: CurveOptions,
): { readonly keys: KeyData[]; readonly index: number; readonly frozen: readonly number[] } {
  if (!Number.isFinite(frame)) throw new EkzaError('unsupported', `insertKeyPreservingShape: invalid frame ${frame}`);
  const keys = normalizeKeys(curve.keys);
  const n = keys.length;
  if (n === 0) throw new EkzaError('unsupported', 'insertKeyPreservingShape: the curve has no keys');
  const weighted = curve.weighted === true;
  const pre = infinityModeOf(curve.pre);
  const post = infinityModeOf(curve.post);
  const compiled = compileAnimCurve({ keys, weighted, pre, post }, opts);

  const existing = keyIndexAt(compiled, frame);
  if (existing >= 0) return { keys: keys.slice(), index: existing, frozen: [] };

  const p = upperBound(compiled.t, n, frame);
  const result: KeyData[] = keys.slice();
  const modified = new Set<number>();
  // Sides set explicitly above (`${oldIndex}:${side}`); the general freeze leaves them alone.
  const explicit = new Set<string>();
  const setSide = (index: number, side: Side, handle: Handle): void => {
    result[index] = withFixedSide(result[index]!, side, handle);
    modified.add(index);
    explicit.add(`${index}:${side}`);
  };

  let inserted: KeyData;
  if (p > 0 && p < n) {
    const k = p - 1;
    const t0 = compiled.t[k]!;
    const t1 = compiled.t[k + 1]!;
    const v0 = compiled.v[k]!;
    const v1 = compiled.v[k + 1]!;
    switch (compiled.segment[k] as SegmentKind) {
      case Segment.Step:
        inserted = makeKeyData(frame, v0, { in: 'flat', out: 'step' });
        break;
      case Segment.StepNext:
        inserted = makeKeyData(frame, v1, { in: 'flat', out: 'stepNext' });
        break;
      case Segment.Linear:
        inserted = makeKeyData(frame, evaluateAnimCurve(compiled, frame), { in: 'linear', out: 'linear' });
        break;
      case Segment.Bezier: {
        const o = k * COEF_STRIDE;
        const u = bezierParameter(compiled.coef, o, t0, t1, frame);
        const value = bezierValueAt(compiled.coef, o, u);
        const x1 = t0 + compiled.outDt[k]!;
        const y1 = v0 + compiled.outDv[k]!;
        const x2 = t1 + compiled.inDt[k + 1]!;
        const y2 = v1 + compiled.inDv[k + 1]!;
        // de Casteljau at u
        const x01 = t0 + (x1 - t0) * u;
        const y01 = v0 + (y1 - v0) * u;
        const x12 = x1 + (x2 - x1) * u;
        const y12 = y1 + (y2 - y1) * u;
        const x23 = x2 + (t1 - x2) * u;
        const y23 = y2 + (v1 - y2) * u;
        const x012 = x01 + (x12 - x01) * u;
        const y012 = y01 + (y12 - y01) * u;
        const x123 = x12 + (x23 - x12) * u;
        const y123 = y12 + (y23 - y12) * u;
        inserted = fixedKey(
          frame,
          value,
          { dt: x012 - frame, dv: y012 - value },
          { dt: x123 - frame, dv: y123 - value },
        );
        setSide(k, 'out', { dt: x01 - t0, dv: y01 - v0 });
        setSide(k + 1, 'in', { dt: x23 - t1, dv: y23 - v1 });
        break;
      }
      case Segment.Hermite:
      default: {
        const value = evaluateAnimCurve(compiled, frame);
        const slope = evaluateAnimCurveSlope(compiled, frame);
        const dtIn = (frame - t0) * ONE_THIRD;
        const dtOut = (t1 - frame) * ONE_THIRD;
        inserted = fixedKey(frame, value, { dt: -dtIn, dv: -slope * dtIn }, { dt: dtOut, dv: slope * dtOut });
      }
    }
  } else {
    const value = evaluateAnimCurve(compiled, frame);
    const slope = evaluateAnimCurveSlope(compiled, frame);
    const before = p === 0;
    const gap = (before ? compiled.t[0]! - frame : frame - compiled.t[n - 1]!) * ONE_THIRD;
    inserted = fixedKey(frame, value, { dt: -gap, dv: -slope * gap }, { dt: gap, dv: slope * gap });
    const mode = before ? pre : post;
    if (mode === 'constant' || mode === 'linear') {
      const endSlope = mode === 'constant' ? 0 : before ? compiled.inSlope[0]! : compiled.outSlope[n - 1]!;
      if (before) setSide(0, 'in', { dt: -gap, dv: -endSlope * gap });
      else setSide(n - 1, 'out', { dt: gap, dv: endSlope * gap });
    }
  }

  const out: KeyData[] = [...result.slice(0, p), inserted, ...result.slice(p)];
  const m = out.length;
  const beforeTangents = resolveTangents(keys, weighted, pre, post, opts);
  const afterTangents = resolveTangents(out, weighted, pre, post, opts);
  const shapes = (index: number, side: Side): boolean => {
    if (side === 'out') {
      if (index === m - 1) return post === 'linear';
      return isCurveSegment(segmentKindOf(sideType(out[index]!, 'out'), sideType(out[index + 1]!, 'in'), weighted));
    }
    if (index === 0) return pre === 'linear';
    return isCurveSegment(segmentKindOf(sideType(out[index - 1]!, 'out'), sideType(out[index]!, 'in'), weighted));
  };

  for (let j = 0; j < n; j++) {
    const jj = j < p ? j : j + 1;
    for (const side of ['in', 'out'] as const) {
      if (explicit.has(`${j}:${side}`) || sideType(out[jj]!, side) === 'fixed' || !shapes(jj, side)) continue;
      const beforeSlope = side === 'in' ? beforeTangents.inSlope[j] : beforeTangents.outSlope[j];
      const afterSlope = side === 'in' ? afterTangents.inSlope[jj] : afterTangents.outSlope[jj];
      if (beforeSlope === afterSlope) continue;
      const handle: Handle =
        side === 'in'
          ? { dt: beforeTangents.inDt[j]!, dv: beforeTangents.inDv[j]! }
          : { dt: beforeTangents.outDt[j]!, dv: beforeTangents.outDv[j]! };
      out[jj] = withFixedSide(out[jj]!, side, handle);
      modified.add(j);
    }
  }

  const frozen = [...modified].map((j) => (j < p ? j : j + 1)).sort((a, b) => a - b);
  return { keys: out, index: p, frozen };
}
