import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AnimCurve,
  type CompiledAnimCurve,
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
        curveArbitrary({ types: ['auto', 'autoMix', 'autoEase', 'spline', 'linear'], modes: ['cycle', 'cycleOffset'] }),
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
