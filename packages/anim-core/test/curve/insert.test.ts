import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AnimCurve,
  type CompiledAnimCurve,
  type Handle,
  type KeyData,
  compileAnimCurve,
  evaluateAnimCurve,
  insertKeyPreservingShape,
  Segment,
} from '../../src';
import { curve, curveArbitrary, DEG, key, TANGENT_TYPES, waveCurve } from './arbitraries';

/** Max |before − after| over `count` uniform samples of [first − R, last + R] plus every key time. */
function maxDeviation(before: CompiledAnimCurve, after: CompiledAnimCurve, count = 1000): number {
  const first = before.t[0] as number;
  const last = before.t[before.keyCount - 1] as number;
  const range = Math.max(last - first, 1);
  const lo = first - range;
  const hi = last + range;
  let max = 0;
  for (let i = 0; i <= count; i++) {
    const f = lo + ((hi - lo) * i) / count;
    max = Math.max(max, Math.abs(evaluateAnimCurve(before, f) - evaluateAnimCurve(after, f)));
  }
  for (const f of after.t) max = Math.max(max, Math.abs(evaluateAnimCurve(before, f) - evaluateAnimCurve(after, f)));
  return max;
}

function insertAndCompare(c: AnimCurve, frame: number, opts?: { readonly cycleAwareAuto?: boolean }): number {
  const before = compileAnimCurve(c, opts);
  const result = insertKeyPreservingShape(c, frame, opts);
  const after = compileAnimCurve({ ...c, keys: result.keys }, opts);
  return maxDeviation(before, after);
}

describe('insertKeyPreservingShape (MVP-SPEC §4.11.4)', () => {
  it('property: any curve, every tangent type, weighted and not, insert anywhere in range → |Δ| ≤ 1e-12', () => {
    fc.assert(
      fc.property(curveArbitrary(), fc.double({ min: 0, max: 1, noNaN: true }), (c, where) => {
        const first = c.keys[0]!.t;
        const last = c.keys[c.keys.length - 1]!.t;
        const frame = first + (last - first) * where;
        expect(insertAndCompare(c, frame)).toBeLessThanOrEqual(1e-12);
      }),
      { numRuns: 2000 },
    );
  });

  it.each(TANGENT_TYPES)('property per tangent type %s (weighted and not)', (type) => {
    fc.assert(
      fc.property(curveArbitrary({ types: [type] }), fc.double({ min: 0, max: 1, noNaN: true }), (c, where) => {
        const first = c.keys[0]!.t;
        const last = c.keys[c.keys.length - 1]!.t;
        expect(insertAndCompare(c, first + (last - first) * where)).toBeLessThanOrEqual(1e-12);
      }),
      { numRuns: 300 },
    );
  });

  it('property: cycle-aware auto keeps the loop when the wrapped neighbours change', () => {
    fc.assert(
      fc.property(
        curveArbitrary({
          types: ['auto', 'autoMix', 'autoEase', 'plateau', 'spline', 'linear'],
          modes: ['cycle', 'cycleOffset'],
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (c, where) => {
          const first = c.keys[0]!.t;
          const last = c.keys[c.keys.length - 1]!.t;
          const frame = first + (last - first) * where;
          expect(insertAndCompare(c, frame, { cycleAwareAuto: true })).toBeLessThanOrEqual(1e-12);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('E2E-11: inserting at frame 22 on the wave clip keeps 0…30 step 0.25 unchanged', () => {
    const wave = waveCurve();
    const result = insertKeyPreservingShape(wave, 22);
    expect(result.index).toBe(2);
    expect(result.keys.map((k) => k.t)).toEqual([0, 15, 22, 30]);
    expect(result.keys[2]).toMatchObject({ inType: 'fixed', outType: 'fixed', broken: false });
    // key 15 is still an extremum and key 30 still a flat end key: nothing to freeze
    expect(result.frozen).toEqual([]);
    const before = compileAnimCurve(wave);
    const after = compileAnimCurve({ ...wave, keys: result.keys });
    for (let f = 0; f <= 30; f += 0.25) {
      expect(Math.abs(evaluateAnimCurve(after, f) - evaluateAnimCurve(before, f))).toBeLessThan(1e-12);
    }
  });

  it('step / stepNext / linear spans get a key on the span without changing its neighbours', () => {
    const step = insertKeyPreservingShape(curve([key(0, 1, 'flat', 'step'), key(10, 5, 'flat')]), 4);
    expect(step.keys[1]).toMatchObject({ t: 4, v: 1, inType: 'flat', outType: 'step' });
    expect(step.frozen).toEqual([]);
    const next = insertKeyPreservingShape(curve([key(0, 1, 'flat', 'stepNext'), key(10, 5, 'flat')]), 4);
    expect(next.keys[1]).toMatchObject({ t: 4, v: 5, inType: 'flat', outType: 'stepNext' });
    expect(next.frozen).toEqual([]);
    const linear = insertKeyPreservingShape(curve([key(0, 1, 'linear'), key(10, 6, 'linear')]), 4);
    expect(linear.keys[1]).toMatchObject({ t: 4, inType: 'linear', outType: 'linear' });
    expect(linear.keys[1]!.v).toBeCloseTo(3, 14);
    expect(linear.frozen).toEqual([]);
    expect(Array.from(compileAnimCurve({ ...curve([]), keys: linear.keys }).segment)).toEqual([
      Segment.Linear,
      Segment.Linear,
    ]);
  });

  it('freezes the computed neighbour sides whose slope changes, with their pre-insert handles', () => {
    // a monotonic auto ramp: inserting near key 1 changes key 1's and key 2's auto slopes
    const c = curve([key(0, 0), key(10, 2), key(20, 8), key(30, 9)]);
    const result = insertKeyPreservingShape(c, 14);
    expect(result.index).toBe(2);
    expect(result.frozen).toEqual([1, 3]);
    expect(result.keys[1]).toMatchObject({ inType: 'fixed', outType: 'fixed' });
    expect(result.keys[3]).toMatchObject({ inType: 'fixed', outType: 'fixed' });
    expect(result.keys[0]).toBe(c.keys[0]);
    expect(result.keys[4]).toBe(c.keys[3]);
    const before = compileAnimCurve(c);
    expect(result.keys[1]!.outHandle.dv / result.keys[1]!.outHandle.dt).toBeCloseTo(before.outSlope[1] as number, 14);
  });

  it('weighted curves split with de Casteljau: neighbours adjacent to the split take the outer sub-handles', () => {
    const k0 = { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: 4, dv: 3 } };
    const k1 = { ...key(9, 2, 'fixed', 'flat'), inHandle: { dt: -2, dv: 1.5 } };
    const c = curve([k0, k1], { weighted: true });
    const result = insertKeyPreservingShape(c, 3);
    expect(result.frozen).toEqual([0, 2]);
    const [a, m, b] = result.keys;
    // sub-handles are shorter than the originals and still point the same way
    expect(a!.outHandle.dt).toBeGreaterThan(0);
    expect(a!.outHandle.dt).toBeLessThan(4);
    expect(a!.outHandle.dv / a!.outHandle.dt).toBeCloseTo(3 / 4, 12);
    expect(b!.inHandle.dv / b!.inHandle.dt).toBeCloseTo(1.5 / -2, 12);
    // the new key's handles are collinear (unified)
    expect(m!.inHandle.dv / m!.inHandle.dt).toBeCloseTo(m!.outHandle.dv / m!.outHandle.dt, 10);
    expect(insertAndCompare(c, 3)).toBeLessThanOrEqual(1e-12);
  });

  it('inserts within a few micro-frames of a key stay exact (non-weighted handles keep |dt| ≥ 1e-6)', () => {
    // regression: the new key's thirds (|dt| < 1e-6) were resolved with dt clamped to 1e-6, halving the slope
    const window = (c: AnimCurve, keys: readonly KeyData[], lo: number, hi: number): number => {
      const before = compileAnimCurve(c);
      const after = compileAnimCurve({ ...c, keys });
      let max = 0;
      for (let i = 0; i <= 2000; i++) {
        const f = lo + ((hi - lo) * i) / 2000;
        max = Math.max(max, Math.abs(evaluateAnimCurve(before, f) - evaluateAnimCurve(after, f)));
      }
      return max;
    };
    const spline = curve([key(0, 0, 'spline'), key(10, 3, 'spline'), key(20, -1, 'spline')]);
    for (const offset of [1.5e-6, -1.5e-6, 2e-6, -2e-6, 2.9e-6]) {
      const result = insertKeyPreservingShape(spline, 10 + offset);
      expect(window(spline, result.keys, 10 - 1e-5, 10 + 1e-5), `at 10 + ${offset}`).toBeLessThanOrEqual(1e-12);
      expect(insertAndCompare(spline, 10 + offset)).toBeLessThanOrEqual(1e-12);
    }
    // a frozen neighbour side whose old span is shorter than 3e-6 frames
    const close = curve([
      key(0, 0, 'spline'),
      key(10, 3, 'spline'),
      key(10 + 2.5e-6, 3.5, 'spline'),
      key(20, -1, 'spline'),
    ]);
    const frozen = insertKeyPreservingShape(close, 15);
    expect(frozen.frozen).toContain(2);
    expect(window(close, frozen.keys, 10, 10 + 2.5e-6)).toBeLessThanOrEqual(1e-12);
    // outside the key range, just past the end key, under linear infinity
    const linear = curve([key(0, 0, 'spline'), key(10, 3, 'spline')], { pre: 'linear', post: 'linear' });
    for (const frame of [10 + 1.5e-6, -1.5e-6]) {
      const result = insertKeyPreservingShape(linear, frame);
      expect(window(linear, result.keys, frame - 1e-5, frame + 1e-5)).toBeLessThanOrEqual(1e-12);
      expect(insertAndCompare(linear, frame)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('a key already at the frame (within 1e-6) is returned unchanged', () => {
    const c = waveCurve();
    const result = insertKeyPreservingShape(c, 15 + 5e-7);
    expect(result).toEqual({ keys: [...c.keys], index: 1, frozen: [] });
  });

  it('outside the key range it preserves constant and linear infinities', () => {
    for (const mode of ['constant', 'linear'] as const) {
      for (const weighted of [false, true]) {
        for (const type of ['spline', 'auto', 'linear', 'clamped'] as const) {
          const c = curve([key(0, 1, type), key(6, 4, type), key(10, 2, type)], { weighted, pre: mode, post: mode });
          for (const frame of [-7, 15.5]) {
            const result = insertKeyPreservingShape(c, frame);
            expect(result.index).toBe(frame < 0 ? 0 : 3);
            expect(insertAndCompare(c, frame), `${mode} ${type} weighted=${weighted} @${frame}`).toBeLessThan(1e-12);
          }
        }
      }
    }
  });

  it('inserting on a single-key curve keeps its constant value', () => {
    const c = curve([key(5, 2 * DEG)]);
    const result = insertKeyPreservingShape(c, 9);
    expect(result.keys.map((k) => [k.t, k.v])).toEqual([
      [5, 2 * DEG],
      [9, 2 * DEG],
    ]);
    expect(insertAndCompare(c, 9)).toBe(0);
  });

  it('rejects an empty curve and a non-finite frame', () => {
    expect(() => insertKeyPreservingShape(curve([]), 3)).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(() => insertKeyPreservingShape(waveCurve(), Number.NaN)).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });
});

/** Two-key weighted span with fixed handles (frames, value offsets). */
function weightedSpan(span: number, out: Handle, inn: Handle, v1 = 1): AnimCurve {
  return curve(
    [
      { ...key(0, 0, 'flat', 'fixed'), outHandle: out },
      { ...key(span, v1, 'fixed', 'flat'), inHandle: inn },
    ],
    { weighted: true },
  );
}

/** Max |before − after| over [first, last] (1,000 samples) after inserting at `frame`. */
function spanDeviation(c: AnimCurve, frame: number): { readonly deviation: number; readonly resnapped: boolean } {
  const before = compileAnimCurve(c);
  const result = insertKeyPreservingShape(c, frame);
  const after = compileAnimCurve({ ...c, keys: result.keys });
  // a weighted half re-corrected by AnimX compiles to handles that differ from the stored split sub-handles
  let resnapped = false;
  if (c.weighted) {
    result.keys.forEach((k, i) => {
      if (k.inType === 'fixed' && i > 0 && after.inDt[i] !== k.inHandle.dt) resnapped = true;
      if (k.outType === 'fixed' && i < result.keys.length - 1 && after.outDt[i] !== k.outHandle.dt) resnapped = true;
    });
  }
  const first = before.t[0] as number;
  const last = before.t[before.keyCount - 1] as number;
  let deviation = 0;
  for (let i = 0; i <= 1000; i++) {
    const f = first + ((last - first) * i) / 1000;
    deviation = Math.max(deviation, Math.abs(evaluateAnimCurve(before, f) - evaluateAnimCurve(after, f)));
  }
  return { deviation, resnapped };
}

describe('insert at AnimX snapping thresholds (wp-notes W1-22)', () => {
  it('weighted spans that AnimX evaluates linear in time (handles within 1e-6 of the thirds) split exactly', () => {
    // regression: δ = 9e-7 used to give a 1.2e-6 error (the halves left the 1e-6 band and were root-solved)
    expect(
      spanDeviation(weightedSpan(10, { dt: 10 * (1 / 3 + 9e-7), dv: 2 }, { dt: -10 / 3, dv: 3 }), 2.5).deviation,
    ).toBeLessThanOrEqual(1e-12);
    const delta = fc.double({ min: -0.99e-6, max: 0.99e-6, noNaN: true });
    const dv = fc.double({ min: -8, max: 8, noNaN: true });
    fc.assert(
      fc.property(delta, delta, dv, dv, fc.double({ min: 0.01, max: 0.99, noNaN: true }), (d0, d1, dv0, dv1, where) => {
        const span = 7;
        const c = weightedSpan(span, { dt: span * (1 / 3 + d0), dv: dv0 }, { dt: -span * (1 / 3 + d1), dv: dv1 });
        expect(spanDeviation(c, span * where).deviation).toBeLessThanOrEqual(1e-12);
      }),
      { numRuns: 500 },
    );
  });

  it('weighted spans beyond the monotonic limit: exact unless AnimX re-corrects a half by its 1e-10 margin', () => {
    // Handles up to 4× the span force the monotonic-X correction. The halves of a corrected span lie on the monotonic
    // boundary, where AnimX's `kDblEpsilon` margin can move a control point again (~5 % of these cases; measured
    // ≤ 3.3e-8 on 30,000). Deterministic sample (fixed seed).
    let exact = 0;
    let resnappedCount = 0;
    const length = fc.double({ min: 0.02, max: 4, noNaN: true });
    const dv = fc.double({ min: -8, max: 8, noNaN: true });
    fc.assert(
      fc.property(
        length,
        length,
        dv,
        dv,
        fc.double({ min: 0.001, max: 0.999, noNaN: true }),
        (a, b, dv0, dv1, where) => {
          const span = 10;
          const { deviation, resnapped } = spanDeviation(
            weightedSpan(span, { dt: span * a, dv: dv0 }, { dt: -span * b, dv: dv1 }),
            span * where,
          );
          if (resnapped) resnappedCount++;
          else exact++;
          // not re-corrected: rounding only, amplified by the near-vertical stretch of a corrected span (≤ 5.6e-12)
          expect(deviation).toBeLessThanOrEqual(resnapped ? 1e-6 : 1e-11);
        },
      ),
      { numRuns: 3000, seed: 20261017 },
    );
    expect(exact).toBeGreaterThan(2500);
    expect(resnappedCount).toBeGreaterThan(0);
  });

  it('halves that cross a snapping threshold the span did not deviate by less than that threshold', () => {
    // Hermite: tangents within (2e-7, ~1e-5) of the chord; a half whose tangents fall within 2e-7 of its own chord is
    // drawn as a straight line by AnimX, which differs from the cubic by at most ~5e-8 of its value change
    for (const [d0, d1] of [
      [3e-7, 3e-7],
      [3e-7, -3e-7],
      [1e-6, -1e-6],
      [1.9e-7, 5e-7],
    ] as const) {
      const c = curve([
        { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: 1, dv: 0.5 * (1 + d0) } },
        { ...key(10, 5, 'fixed', 'flat'), inHandle: { dt: -1, dv: -0.5 * (1 + d1) } },
      ]);
      for (const frame of [0.3, 2.5, 5, 9.1]) expect(spanDeviation(c, frame).deviation).toBeLessThanOrEqual(1e-7 * 5);
    }
    // Bézier: handle times 2e-6…1e-5 off the thirds; a half that falls inside AnimX's 1e-6 band is evaluated linear in
    // time, which differs from the root-solved cubic by at most 7.5e-7 of the span's normalized time
    for (const delta of [2e-6, 5e-6, 1e-5]) {
      const c = weightedSpan(10, { dt: 10 * (1 / 3 + delta), dv: 2 }, { dt: -10 / 3, dv: 3 });
      for (const frame of [0.3, 2.5, 5, 9.1]) expect(spanDeviation(c, frame).deviation).toBeLessThanOrEqual(1e-6);
    }
  });
});
