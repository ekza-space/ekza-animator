import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AnimCurve,
  type CompiledAnimCurve,
  compileAnimCurve,
  curveEngine,
  evaluateAnimCurve,
  evaluateAnimCurveSlope,
  infinityMap,
  keyIndexAt,
  sampleAnimCurve,
  Segment,
  segmentControlPoints,
  spanKindAt,
  visibleKeyRange,
} from '../../src';
import { COMPUTED_TYPES, curve, curveArbitrary, DEG, key, waveCurve } from './arbitraries';

const NON_STEP_TYPES = [...COMPUTED_TYPES, 'fixed'] as const;

function bezierAt(p: Float64Array, u: number, axis: 0 | 1): number {
  const w = 1 - u;
  return (
    w * w * w * (p[axis] as number) +
    3 * w * w * u * (p[2 + axis] as number) +
    3 * w * u * u * (p[4 + axis] as number) +
    u * u * u * (p[6 + axis] as number)
  );
}

describe('evaluation basics', () => {
  it('an empty curve evaluates to 0; a single key is constant (all infinities but linear)', () => {
    expect(evaluateAnimCurve(compileAnimCurve(curve([])), 3)).toBe(0);
    expect(evaluateAnimCurveSlope(compileAnimCurve(curve([])), 3)).toBe(0);
    for (const mode of ['constant', 'cycle', 'cycleOffset', 'oscillate'] as const) {
      const c = compileAnimCurve(curve([key(4, 1.25)], { pre: mode, post: mode }));
      for (const f of [-100, 0, 4, 9, 1000]) expect(evaluateAnimCurve(c, f)).toBe(1.25);
    }
  });

  it('linear infinity on a single key follows its tangent (AnimX returns 0 there; deviation documented)', () => {
    const fixedKey = { ...key(4, 1, 'fixed'), inHandle: { dt: -1, dv: -2 }, outHandle: { dt: 1, dv: 0.5 } };
    const c = compileAnimCurve(curve([fixedKey], { pre: 'linear', post: 'linear' }));
    expect(evaluateAnimCurve(c, 2)).toBeCloseTo(1 - 2 * 2, 12);
    expect(evaluateAnimCurve(c, 8)).toBeCloseTo(1 + 4 * 0.5, 12);
    expect(evaluateAnimCurveSlope(c, 8)).toBeCloseTo(0.5, 12);
  });

  it('returns the key value at (and within 1e-10 of) a key time', () => {
    const c = compileAnimCurve(waveCurve('spline'));
    expect(evaluateAnimCurve(c, 15)).toBe(-30 * DEG);
    expect(evaluateAnimCurve(c, 15 - 5e-11)).toBe(-30 * DEG);
  });

  it('repairs document content: unsorted and duplicate keys, non-finite keys, unknown types and infinities', () => {
    const messy = {
      keys: [key(10, 3), key(0, 1), key(5, 2), key(5, 7), { ...key(7, Number.NaN) }, { ...key(8, 1), inType: 'magic' }],
      weighted: false,
      pre: 'spiral',
      post: 'constant',
    } as unknown as AnimCurve;
    const c = compileAnimCurve(messy);
    expect(Array.from(c.t)).toEqual([0, 5, 8, 10]);
    expect(Array.from(c.v)).toEqual([1, 7, 1, 3]); // the later duplicate wins
    expect(c.pre).toBe('constant');
    const clean = compileAnimCurve(curve([key(0, 1), key(5, 7), key(8, 1), key(10, 3)]));
    for (let f = -2; f <= 12; f += 0.5) expect(evaluateAnimCurve(c, f)).toBe(evaluateAnimCurve(clean, f));
  });

  it('curveEngine implements the injectable CurveEngine contract', () => {
    const wave = waveCurve();
    const c = curveEngine.compile(wave);
    expect(curveEngine.evaluate(c, 7)).toBe(evaluateAnimCurve(compileAnimCurve(wave), 7));
  });

  it('evaluates CompiledAnimCurve objects built elsewhere from their contract arrays', () => {
    fc.assert(
      fc.property(curveArbitrary(), (anim) => {
        const own = compileAnimCurve(anim);
        // strip the private coefficients: a plain object with only the contract fields
        const foreign: CompiledAnimCurve = {
          keyCount: own.keyCount,
          t: own.t,
          v: own.v,
          inSlope: own.inSlope,
          outSlope: own.outSlope,
          inDt: own.inDt,
          inDv: own.inDv,
          outDt: own.outDt,
          outDv: own.outDv,
          segment: own.segment,
          weighted: own.weighted,
          pre: own.pre,
          post: own.post,
        };
        const first = own.t[0] as number;
        const last = own.t[own.keyCount - 1] as number;
        for (let i = 0; i <= 40; i++) {
          const f = first - 5 + ((last - first + 10) * i) / 40;
          expect(Math.abs(evaluateAnimCurve(foreign, f) - evaluateAnimCurve(own, f))).toBeLessThan(1e-9);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('sampleAnimCurve fills `count` samples without drift and rejects a short output', () => {
    const c = compileAnimCurve(waveCurve());
    const out = new Float64Array(31);
    sampleAnimCurve(c, 0, 1, 31, out);
    for (let i = 0; i <= 30; i++) expect(out[i]).toBe(evaluateAnimCurve(c, i));
    expect(() => sampleAnimCurve(c, 0, 1, 32, out)).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });
});

describe('infinity (research 01 §5.6, AnimX evaluateInfinity)', () => {
  const base = [key(0, 1, 'auto'), key(4, 3, 'auto'), key(10, 2, 'auto')];

  it('cycle repeats the range, cycleOffset adds the value delta per cycle, oscillate mirrors', () => {
    const cycle = compileAnimCurve(curve(base, { pre: 'cycle', post: 'cycle' }));
    const offset = compileAnimCurve(curve(base, { pre: 'cycleOffset', post: 'cycleOffset' }));
    const osc = compileAnimCurve(curve(base, { pre: 'oscillate', post: 'oscillate' }));
    const inRange = compileAnimCurve(curve(base));
    for (const f of [0.5, 3, 7.25, 9.9]) {
      const v = evaluateAnimCurve(inRange, f);
      for (const n of [-3, -2, -1, 1, 2, 3]) {
        expect(evaluateAnimCurve(cycle, f + 10 * n)).toBeCloseTo(v, 12);
        expect(evaluateAnimCurve(offset, f + 10 * n)).toBeCloseTo(v + n * (2 - 1), 12);
      }
      expect(evaluateAnimCurve(osc, 20 - f)).toBeCloseTo(v, 12); // first reflection after the end
      expect(evaluateAnimCurve(osc, -f)).toBeCloseTo(v, 12); // first reflection before the start
      expect(evaluateAnimCurve(osc, f + 20)).toBeCloseTo(v, 12);
      expect(evaluateAnimCurve(osc, f - 20)).toBeCloseTo(v, 12);
    }
  });

  it('linear extends the end slopes; constant holds the end values', () => {
    const lin = compileAnimCurve(curve([key(0, 1, 'linear'), key(4, 3, 'linear')], { pre: 'linear', post: 'linear' }));
    expect(evaluateAnimCurve(lin, -6)).toBeCloseTo(1 - 3, 12);
    expect(evaluateAnimCurve(lin, 10)).toBeCloseTo(3 + 3, 12);
    const auto = compileAnimCurve(curve(base, { pre: 'linear', post: 'linear' }));
    expect(evaluateAnimCurve(auto, -50)).toBe(1); // auto end keys are flat
    const constant = compileAnimCurve(curve([key(0, 1, 'linear'), key(4, 3, 'linear')]));
    expect(evaluateAnimCurve(constant, -6)).toBe(1);
    expect(evaluateAnimCurve(constant, 60)).toBe(3);
  });

  it('infinityMap reports the in-range frame, value offset and mirroring', () => {
    const offset = compileAnimCurve(curve(base, { pre: 'cycleOffset', post: 'cycleOffset' }));
    const near = (frame: number, valueOffset: number, mirrored: boolean) => ({
      frame: expect.closeTo(frame, 12) as number,
      valueOffset: expect.closeTo(valueOffset, 12) as number,
      mirrored,
    });
    expect(infinityMap(offset, 5)).toEqual({ frame: 5, valueOffset: 0, mirrored: false });
    expect(infinityMap(offset, 23)).toEqual(near(3, 2, false));
    expect(infinityMap(offset, -7)).toEqual(near(3, -1, false));
    const osc = compileAnimCurve(curve(base, { pre: 'oscillate', post: 'oscillate' }));
    expect(infinityMap(osc, 13)).toEqual(near(7, 0, true));
    expect(infinityMap(osc, 23)).toEqual(near(3, 0, false));
    expect(infinityMap(osc, -3)).toEqual(near(3, 0, true));
    const lin = compileAnimCurve(curve([key(0, 1, 'linear'), key(4, 3, 'linear')], { post: 'linear' }));
    const mapped = infinityMap(lin, 6);
    expect(mapped.frame).toBe(4);
    expect(mapped.valueOffset).toBeCloseTo(1, 14);
    expect(infinityMap(lin, -5)).toEqual({ frame: 0, valueOffset: 0, mirrored: false });
  });

  it('a cyclic time that maps onto a step-next key gives that key value (mapping rounding error is snapped)', () => {
    // regression: 58 used to map to 10.000000000000002, just past key 10, so the step-next span gave the next key
    const keys = [
      key(3, -4, 'flat', 'stepNext'),
      key(10, 6, 'flat', 'stepNext'),
      key(19, -8, 'flat', 'stepNext'),
      key(27, -9, 'flat', 'stepNext'),
    ];
    const cycle = compileAnimCurve(curve(keys, { pre: 'cycle', post: 'cycle' }));
    const osc = compileAnimCurve(curve(keys, { pre: 'oscillate', post: 'oscillate' }));
    const offset = compileAnimCurve(curve(keys, { pre: 'cycleOffset', post: 'cycleOffset' }));
    for (const f of [34, 58, 82, -14, -38, 10 + 24 * 50_000, 10 - 24 * 50_000]) {
      expect(evaluateAnimCurve(cycle, f)).toBe(6);
      expect(infinityMap(cycle, f).frame).toBe(10);
    }
    expect(evaluateAnimCurve(osc, 58)).toBe(6);
    expect(evaluateAnimCurve(osc, 44)).toBe(6); // first reflection: 27 + (27 − 10)
    expect(evaluateAnimCurve(osc, -4)).toBe(6); // first reflection before the start: 3 − (10 − 3)
    expect(evaluateAnimCurve(offset, 58)).toBe(6 + 2 * (-9 - -4));
    // a genuine offset past the key is not snapped: the step-next span holds the next key there, as in range
    expect(evaluateAnimCurve(cycle, 10 + 1e-6)).toBe(-8);
    expect(evaluateAnimCurve(cycle, 58 + 1e-6)).toBe(-8);
  });

  it('property: stepped spans under cyclic infinities repeat the in-range values exactly at whole frames', () => {
    // integer keys, so the mapped whole frames are exact: post T → first + (T − last) mod R (cycle; oscillate
    // alternates last − …), pre T → last − (first − T) mod R; cycle-with-offset adds numCycles · Δv
    const stepped = fc.record({
      start: fc.integer({ min: -30, max: 30 }),
      gaps: fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 5 }),
      values: fc.array(fc.integer({ min: -64, max: 64 }), { minLength: 6, maxLength: 6 }),
      outTypes: fc.array(fc.constantFrom('step' as const, 'stepNext' as const), { minLength: 6, maxLength: 6 }),
      pre: fc.constantFrom('cycle' as const, 'cycleOffset' as const, 'oscillate' as const),
      post: fc.constantFrom('cycle' as const, 'cycleOffset' as const, 'oscillate' as const),
    });
    fc.assert(
      fc.property(stepped, ({ start, gaps, values, outTypes, pre, post }) => {
        const times = [start];
        for (const g of gaps) times.push((times[times.length - 1] as number) + g);
        const keys = times.map((t, i) => key(t, (values[i] as number) / 8, 'flat', outTypes[i]));
        const c = compileAnimCurve(curve(keys, { pre, post }));
        const first = times[0] as number;
        const last = times[times.length - 1] as number;
        const range = last - first;
        const dv = (c.v[c.keyCount - 1] as number) - (c.v[0] as number);
        for (let f = first - 4 * range - 1; f <= last + 4 * range + 1; f++) {
          if (f >= first && f <= last) continue;
          const isPre = f < first;
          const d = isPre ? first - f : f - last;
          const integral = Math.trunc(d / range);
          const rem = d - integral * range;
          const cycles = integral + 1;
          const mode = isPre ? pre : post;
          let mapped: number;
          if (mode === 'oscillate') mapped = (cycles % 2 === 1) === isPre ? first + rem : last - rem;
          else mapped = isPre ? last - rem : first + rem;
          const offset = mode === 'cycleOffset' ? (isPre ? -cycles : cycles) * dv : 0;
          expect(evaluateAnimCurve(c, f)).toBe(evaluateAnimCurve(c, mapped) + offset);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('property: evaluate = evaluate(infinityMap.frame) + valueOffset everywhere', () => {
    fc.assert(
      fc.property(curveArbitrary(), fc.double({ min: -200, max: 200, noNaN: true }), (anim, f) => {
        const c = compileAnimCurve(anim);
        const m = infinityMap(c, f);
        expect(evaluateAnimCurve(c, f)).toBeCloseTo(evaluateAnimCurve(c, m.frame) + m.valueOffset, 9);
      }),
      { numRuns: 500 },
    );
  });
});

describe('queries', () => {
  const c = compileAnimCurve(
    curve([key(0, 0, 'auto', 'step'), key(10, 1, 'linear'), key(20, 0, 'linear', 'auto'), key(30, 1)], {
      weighted: false,
    }),
  );

  it('spanKindAt: the span starting at a key; null outside the range', () => {
    expect(spanKindAt(c, -1)).toBeNull();
    expect(spanKindAt(c, 0)).toBe(Segment.Step);
    expect(spanKindAt(c, 9.99)).toBe(Segment.Step);
    expect(spanKindAt(c, 10)).toBe(Segment.Linear);
    expect(spanKindAt(c, 25)).toBe(Segment.Hermite);
    expect(spanKindAt(c, 30)).toBe(Segment.Hermite);
    expect(spanKindAt(c, 30.01)).toBeNull();
    expect(spanKindAt(compileAnimCurve(curve([key(1, 1)])), 1)).toBeNull();
  });

  it('keyIndexAt finds the nearest key within epsilon', () => {
    expect(keyIndexAt(c, 10)).toBe(1);
    expect(keyIndexAt(c, 10 + 9e-7)).toBe(1);
    expect(keyIndexAt(c, 10 + 2e-6)).toBe(-1);
    expect(keyIndexAt(c, 10.4, 0.5)).toBe(1);
    expect(keyIndexAt(c, 14.9, 5)).toBe(1);
    expect(keyIndexAt(c, 15.1, 5)).toBe(2);
    expect(keyIndexAt(c, -0.3, 0.5)).toBe(0);
    expect(keyIndexAt(c, 31, 0.5)).toBe(-1);
    expect(keyIndexAt(compileAnimCurve(curve([])), 0)).toBe(-1);
  });

  it('visibleKeyRange covers every segment intersecting the window', () => {
    expect(visibleKeyRange(c, 12, 18)).toEqual([1, 2]);
    expect(visibleKeyRange(c, 10, 20)).toEqual([1, 2]);
    expect(visibleKeyRange(c, 9, 21)).toEqual([0, 3]);
    expect(visibleKeyRange(c, 18, 12)).toEqual([1, 2]);
    expect(visibleKeyRange(c, -50, -40)).toEqual([0, 0]);
    expect(visibleKeyRange(c, 40, 50)).toEqual([3, 3]);
    expect(visibleKeyRange(c, -50, 50)).toEqual([0, 3]);
    expect(visibleKeyRange(compileAnimCurve(curve([])), 0, 1)).toEqual([0, -1]);
  });

  it('segmentControlPoints reproduce the evaluated curve for every segment kind', () => {
    fc.assert(
      fc.property(curveArbitrary(), (anim) => {
        const compiled = compileAnimCurve(anim);
        const p = new Float64Array(8);
        for (let i = 0; i < compiled.keyCount - 1; i++) {
          segmentControlPoints(compiled, i, p);
          const kind = compiled.segment[i];
          const t0 = compiled.t[i] as number;
          const t1 = compiled.t[i + 1] as number;
          expect(p[0]).toBe(t0);
          expect(p[6]).toBe(t1);
          const tolerance = kind === Segment.Bezier || kind === Segment.Hermite ? 1e-9 : 1e-12;
          for (let j = 1; j < 10; j++) {
            const u = j / 10;
            const tu = bezierAt(p, u, 0);
            expect(Math.abs(bezierAt(p, u, 1) - evaluateAnimCurve(compiled, tu))).toBeLessThan(tolerance);
          }
        }
      }),
      { numRuns: 300 },
    );
    // AnimX evaluates a weighted span whose handle times are within 1e-6 of the thirds linear in time; the control
    // points then carry the thirds, so the drawn cubic is still the evaluated one
    const nearThirds = compileAnimCurve(
      curve(
        [
          { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: 10 * (1 / 3 + 9e-7), dv: 2 } },
          { ...key(10, 1, 'fixed', 'flat'), inHandle: { dt: -10 * (1 / 3 - 9e-7), dv: 3 } },
        ],
        { weighted: true },
      ),
    );
    const q = new Float64Array(8);
    segmentControlPoints(nearThirds, 0, q);
    expect([q[2], q[4]]).toEqual([10 / 3, 10 - 10 / 3]);
    for (let j = 1; j < 10; j++) {
      const tu = bezierAt(q, j / 10, 0);
      expect(Math.abs(bezierAt(q, j / 10, 1) - evaluateAnimCurve(nearThirds, tu))).toBeLessThan(1e-12);
    }
    expect(() => segmentControlPoints(c, 3, new Float64Array(8))).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });
});

describe('slopes', () => {
  it('property: evaluateAnimCurveSlope matches central differences inside spans', () => {
    fc.assert(
      fc.property(curveArbitrary(), fc.double({ min: 0.05, max: 0.95, noNaN: true }), (anim, where) => {
        const c = compileAnimCurve(anim);
        const i = Math.floor(where * (c.keyCount - 1));
        const t0 = c.t[i] as number;
        const t1 = c.t[i + 1] as number;
        const f = t0 + (t1 - t0) * (where * (c.keyCount - 1) - i) * 0.9 + (t1 - t0) * 0.05;
        const h = 1e-5 * (t1 - t0);
        const numeric = (evaluateAnimCurve(c, f + h) - evaluateAnimCurve(c, f - h)) / (2 * h);
        const analytic = evaluateAnimCurveSlope(c, f);
        expect(Math.abs(analytic - numeric)).toBeLessThan(1e-4 * Math.max(1, Math.abs(numeric)));
      }),
      { numRuns: 500 },
    );
  });

  it('slopes are mirrored under oscillation and zero on step spans and constant infinity', () => {
    const base = [key(0, 0, 'linear'), key(10, 5, 'linear')];
    const osc = compileAnimCurve(curve(base, { post: 'oscillate' }));
    expect(evaluateAnimCurveSlope(osc, 5)).toBeCloseTo(0.5, 14);
    expect(evaluateAnimCurveSlope(osc, 15)).toBeCloseTo(-0.5, 14);
    expect(evaluateAnimCurveSlope(osc, 25)).toBeCloseTo(0.5, 14);
    expect(evaluateAnimCurveSlope(compileAnimCurve(curve(base)), 50)).toBe(0);
    expect(evaluateAnimCurveSlope(compileAnimCurve(curve([key(0, 0, 'flat', 'step'), key(5, 1)])), 2)).toBe(0);
  });
});

describe('curve properties (MVP-SPEC §7 WP-1 tests)', () => {
  it('continuity: non-stepped curves are continuous across keys', () => {
    fc.assert(
      fc.property(curveArbitrary({ types: NON_STEP_TYPES }), (anim) => {
        const c = compileAnimCurve(anim);
        // slopes stay below ~2e3 for these curves, so a 1e-9 step moves the value by less than 1e-5
        const eps = 1e-9;
        let jump = 0;
        for (let i = 0; i < c.keyCount; i++) {
          const t = c.t[i] as number;
          const v = c.v[i] as number;
          if (i > 0) jump = Math.max(jump, Math.abs(evaluateAnimCurve(c, t - eps) - v));
          if (i < c.keyCount - 1) jump = Math.max(jump, Math.abs(evaluateAnimCurve(c, t + eps) - v));
        }
        expect(jump).toBeLessThan(1e-5);
      }),
      { numRuns: 500 },
    );
  });

  it('monotonic time after the weighted correction: v(t) is a function (time never runs backwards)', () => {
    // weighted handles up to 3× the span force the monotonic-X correction
    const handle = fc.double({ min: 0.01, max: 3, noNaN: true });
    fc.assert(
      fc.property(handle, handle, fc.double({ min: -5, max: 5, noNaN: true }), (a, b, dv) => {
        const k0 = { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: 10 * a, dv } };
        const k1 = { ...key(10, 1, 'fixed', 'flat'), inHandle: { dt: -10 * b, dv: -dv } };
        const c = compileAnimCurve(curve([k0, k1], { weighted: true }));
        const p = new Float64Array(8);
        segmentControlPoints(c, 0, p);
        // the corrected control polygon gives X(u) with X'(u) ≥ 0 on [0, 1]
        let previous = -Infinity;
        for (let j = 0; j <= 200; j++) {
          const x = bezierAt(p, j / 200, 0);
          expect(x).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = x;
        }
        // and the evaluated curve hits the key values at the ends and stays finite
        expect(evaluateAnimCurve(c, 0)).toBe(0);
        expect(evaluateAnimCurve(c, 10)).toBe(1);
        for (let f = 0; f <= 10; f += 0.25) expect(Number.isFinite(evaluateAnimCurve(c, f))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('auto types never overshoot their neighbours (weighted and not)', () => {
    fc.assert(
      fc.property(curveArbitrary({ types: ['auto', 'autoMix', 'autoEase', 'plateau'] }), (anim) => {
        const c = compileAnimCurve(anim);
        for (let i = 0; i < c.keyCount - 1; i++) {
          const lo = Math.min(c.v[i] as number, c.v[i + 1] as number);
          const hi = Math.max(c.v[i] as number, c.v[i + 1] as number);
          const t0 = c.t[i] as number;
          const t1 = c.t[i + 1] as number;
          for (let j = 0; j <= 50; j++) {
            // Clamped to t1: t0 + (t1 − t0) can round one ulp past t1, which on the last span of a curve with a cyclic
            // post infinity is the next cycle (the first key's value), not this span (seed −160331587, below).
            const v = evaluateAnimCurve(c, Math.min(t1, t0 + ((t1 - t0) * j) / 50));
            expect(v).toBeGreaterThanOrEqual(lo - 1e-12 * Math.max(1, Math.abs(lo)));
            expect(v).toBeLessThanOrEqual(hi + 1e-12 * Math.max(1, Math.abs(hi)));
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('clamped is flat between equal keys (no foot slide)', () => {
    fc.assert(
      fc.property(curveArbitrary({ types: ['clamped'], equalValues: true, minKeys: 3 }), (anim) => {
        const c = compileAnimCurve(anim);
        for (let i = 0; i < c.keyCount - 1; i++) {
          if (c.v[i] !== c.v[i + 1]) continue;
          const t0 = c.t[i] as number;
          const t1 = c.t[i + 1] as number;
          for (let j = 0; j <= 20; j++) {
            // Clamped to t1 like the overshoot property (seed 1584343940, below).
            const t = Math.min(t1, t0 + ((t1 - t0) * j) / 20);
            expect(Math.abs(evaluateAnimCurve(c, t) - (c.v[i] as number))).toBeLessThan(1e-12);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('the last key of a curve with a cyclic post infinity (integration: the two property seeds pinned)', () => {
  // fast-check counterexamples of the properties above (A2 notes, open issue 3): five keys whose last span ends at
  // t1 with the first key's value differing by 1e-12.
  const lastSpan = (type: 'auto' | 'clamped', t: readonly number[], v: readonly number[]): AnimCurve =>
    curve(
      t.map((time, i) => key(time, v[i] as number, type, type)),
      { post: 'cycle' },
    );
  // [curve, the property's sample count n]: the property sampled t0 + (t1 − t0)·n/n.
  const cases: readonly (readonly [AnimCurve, number])[] = [
    [
      lastSpan(
        'auto',
        [0, 0.25, 0.5, 0.75, 7.767877633356686],
        [0, 0, 0, -1.0000000000000002e-12, -1.0000000000000002e-12],
      ),
      50,
    ],
    [lastSpan('clamped', [0, 0.25, 0.5, 1.5191503347374793, 9.10301953012267], [0, 0, 0, -1e-12, -1e-12]), 20],
  ];

  it('t exactly at the last key belongs to the last span (its value), one ulp past it to the next cycle', () => {
    for (const [anim, n] of cases) {
      const c = compileAnimCurve(anim);
      const t0 = c.t[c.keyCount - 2] as number;
      const t1 = c.t[c.keyCount - 1] as number;
      const last = c.v[c.keyCount - 1] as number;
      expect(evaluateAnimCurve(c, t1)).toBe(last);
      // The rounding the properties hit: one ulp past t1 is the next cycle, which starts at the first key's value.
      const past = t0 + ((t1 - t0) * n) / n;
      expect(past).toBeGreaterThan(t1);
      expect(evaluateAnimCurve(c, past)).toBeCloseTo(c.v[0] as number, 9);
      // Inside the span the curve stays between its (equal) end values.
      for (let j = 0; j <= 50; j++) {
        expect(Math.abs(evaluateAnimCurve(c, Math.min(t1, t0 + ((t1 - t0) * j) / 50)) - last)).toBeLessThan(1e-12);
      }
    }
  });
});

describe('glTF CUBICSPLINE equivalence (research 01 §5.11)', () => {
  it('non-weighted Hermite segments equal the glTF cubic with per-second tangents ≤ 1e-9', () => {
    let straight = 0;
    let cubic = 0;
    fc.assert(
      fc.property(
        curveArbitrary({ weighted: false, types: NON_STEP_TYPES }),
        fc.constantFrom(24, 25, 30, 60),
        (anim, fps) => {
          const c = compileAnimCurve(anim);
          let worst = 0;
          for (let i = 0; i < c.keyCount - 1; i++) {
            if (c.segment[i] !== Segment.Hermite) continue;
            const t0 = c.t[i] as number;
            const t1 = c.t[i + 1] as number;
            const v0 = c.v[i] as number;
            const v1 = c.v[i + 1] as number;
            const dx = t1 - t0;
            const dy = v1 - v0;
            let m0 = c.outSlope[i] as number;
            let m1 = c.inSlope[i + 1] as number;
            // AnimX draws a span whose tangents are both within 2e-7 (relative) of the chord as a straight line; its
            // exact glTF form then uses the chord slope for both tangents
            if (
              Math.abs(dx * m0 - dy) <= Math.abs(2e-7 * dx * m0) &&
              Math.abs(dx * m1 - dy) <= Math.abs(2e-7 * dx * m1)
            ) {
              m0 = dy / dx;
              m1 = dy / dx;
              straight++;
            } else {
              cubic++;
            }
            const td = dx / fps; // seconds
            const bk = m0 * fps; // out-tangent, value per second
            const ak = m1 * fps; // in-tangent of the next key
            for (let j = 0; j <= 20; j++) {
              const s = j / 20;
              const gltf =
                (2 * s ** 3 - 3 * s ** 2 + 1) * v0 +
                td * (s ** 3 - 2 * s ** 2 + s) * bk +
                (-2 * s ** 3 + 3 * s ** 2) * v1 +
                td * (s ** 3 - s ** 2) * ak;
              worst = Math.max(worst, Math.abs(gltf - evaluateAnimCurve(c, t0 + dx * s)));
            }
          }
          expect(worst).toBeLessThanOrEqual(1e-9);
        },
      ),
      { numRuns: 500 },
    );
    expect(cubic).toBeGreaterThan(500);
    expect(straight).toBeGreaterThan(0);
  });
});
