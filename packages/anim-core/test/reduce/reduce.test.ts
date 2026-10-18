import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AnimCurve,
  compileAnimCurve,
  evaluateAnimCurve,
  type KeyData,
  reduceKeys,
  type TangentType,
} from '../../src';
import { curve, curveArbitrary, key } from '../curve/arbitraries';

/** Max |reduced − original| at every original key time and every integer frame in range. */
function measuredError(original: AnimCurve, keys: readonly KeyData[]): number {
  const a = compileAnimCurve(original);
  const b = compileAnimCurve({ ...original, keys });
  const first = original.keys[0]!.t;
  const last = original.keys[original.keys.length - 1]!.t;
  let max = 0;
  for (const k of original.keys) max = Math.max(max, Math.abs(evaluateAnimCurve(a, k.t) - evaluateAnimCurve(b, k.t)));
  for (let f = Math.ceil(first); f <= last; f++) {
    max = Math.max(max, Math.abs(evaluateAnimCurve(a, f) - evaluateAnimCurve(b, f)));
  }
  return max;
}

/** A dense "imported" curve: one key per frame sampled from a smooth function. */
function sampled(fn: (f: number) => number, frames: number, type: TangentType): AnimCurve {
  const keys: KeyData[] = [];
  for (let f = 0; f <= frames; f++) keys.push(key(f, fn(f), type));
  return curve(keys);
}

describe('reduceKeys (MVP-SPEC §4.11.4 Simplify)', () => {
  it('property: error ≤ tolerance at the original key times and integer frames; the reported max error is exact', () => {
    fc.assert(
      fc.property(
        curveArbitrary({ minKeys: 3, maxKeys: 12 }),
        fc.constantFrom(1e-4, 1e-2, 0.1, 1),
        (anim, tolerance) => {
          const result = reduceKeys(anim, { tolerance });
          const error = measuredError(anim, result.keys);
          expect(error).toBeLessThanOrEqual(tolerance);
          expect(error).toBe(result.maxError);
          expect(result.removed).toBe(anim.keys.length - result.keys.length);
          // first and last keys always survive, unchanged and in order
          expect(result.keys[0]).toBe(anim.keys[0]);
          expect(result.keys[result.keys.length - 1]).toBe(anim.keys[anim.keys.length - 1]);
          for (const k of result.keys) expect(anim.keys).toContain(k);
          for (let i = 1; i < result.keys.length; i++) expect(result.keys[i]!.t).toBeGreaterThan(result.keys[i - 1]!.t);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('reduces a dense idle-like import below a third of its keys (0.1° tolerance) and is deterministic', () => {
    const tolerance = 0.0017453292519943296; // DEFAULT_REDUCE.rotationRad
    for (const type of ['auto', 'autoEase', 'spline'] as const) {
      const dense = sampled((f) => 0.3 * Math.sin(f / 20) + 0.05 * Math.sin(f / 7), 240, type);
      const a = reduceKeys(dense, { tolerance });
      const b = reduceKeys(dense, { tolerance });
      expect(a).toEqual(b);
      expect(a.keys.length).toBeLessThan(dense.keys.length / 3);
      expect(measuredError(dense, a.keys)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('keeps the keys at `keep` frames (within 1e-6) and ignores keep frames without a key', () => {
    const dense = sampled((f) => f * 0.01, 60, 'linear');
    const plain = reduceKeys(dense, { tolerance: 1e-6 });
    expect(plain.keys.map((k) => k.t)).toEqual([0, 60]);
    const kept = reduceKeys(dense, { tolerance: 1e-6, keep: [17 + 5e-7, 33, 12.5, Number.NaN] });
    expect(kept.keys.map((k) => k.t)).toEqual([0, 17, 33, 60]);
    expect(kept.removed).toBe(57);
  });

  it('keeps step discontinuities through the error bound', () => {
    const keys = [
      key(0, 0, 'flat', 'step'),
      key(10, 0, 'flat', 'step'),
      key(20, 5, 'flat', 'step'),
      key(30, 5, 'flat'),
    ];
    const result = reduceKeys(curve(keys), { tolerance: 0.01 });
    expect(result.keys.map((k) => k.t)).toEqual([0, 20, 30]);
    expect(result.maxError).toBe(0);
  });

  it('tolerance 0 keeps exactly what is needed to reproduce the curve', () => {
    const c = curve([key(0, 0, 'linear'), key(5, 5, 'linear'), key(10, 10, 'linear'), key(15, 0, 'linear')]);
    const result = reduceKeys(c, { tolerance: 0 });
    expect(result.keys.map((k) => k.t)).toEqual([0, 10, 15]);
    expect(result.maxError).toBe(0);
  });

  it('leaves curves of up to two keys alone and rejects an invalid tolerance', () => {
    const two = curve([key(0, 1), key(4, 2)]);
    expect(reduceKeys(two, { tolerance: 1 })).toEqual({ keys: [...two.keys], removed: 0, maxError: 0 });
    expect(reduceKeys(curve([]), { tolerance: 1 })).toEqual({ keys: [], removed: 0, maxError: 0 });
    expect(() => reduceKeys(two, { tolerance: -1 })).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(() => reduceKeys(two, { tolerance: Number.NaN })).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });

  it('bound: a 1,000-key clamped import (value-range sensitive tangents) stays within tolerance', () => {
    const dense = sampled((f) => Math.round(Math.sin(f / 30) * 40) / 40, 1000, 'clamped');
    const result = reduceKeys(dense, { tolerance: 0.005 });
    expect(measuredError(dense, result.keys)).toBeLessThanOrEqual(0.005);
    expect(result.keys.length).toBeLessThan(dense.keys.length);
  });
});
