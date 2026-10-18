import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AnimCurve,
  compileAnimCurve,
  evaluateAnimCurve,
  evaluateAnimCurveSlope,
  type Fps,
  handleFromFields,
  type KeyData,
  makeKeyData,
  resolveKeyHandles,
  tangentFields,
} from '../../src';
import { curve, curveArbitrary, DEG, key, TANGENT_TYPES, waveCurve } from './arbitraries';

const FPS30: Fps = { num: 30, den: 1 };
const K = 180 / Math.PI;

describe('tangent rules for the documented approximations (research 01 §5.4)', () => {
  it('spline: (ny − py)/(nx − px) inside, the one-sided chord at the ends', () => {
    const c = compileAnimCurve(curve([key(0, 0, 'spline'), key(4, 2, 'spline'), key(10, 5, 'spline')]));
    expect(c.outSlope[1]).toBeCloseTo(5 / 10, 15);
    expect(c.inSlope[1]).toBeCloseTo(5 / 10, 15);
    expect(c.outSlope[0]).toBeCloseTo(2 / 4, 15);
    expect(c.inSlope[2]).toBeCloseTo(3 / 6, 15);
  });

  it('clamped: the spline slope, but flat when a neighbour value is within 1e-5·max(1, |range|)', () => {
    const c = compileAnimCurve(curve([key(0, 0, 'clamped'), key(4, 2, 'clamped'), key(10, 2 + 5e-6, 'clamped')]));
    expect(c.outSlope[1]).toBe(0);
    expect(c.inSlope[2]).toBe(0);
    const far = compileAnimCurve(curve([key(0, 0, 'clamped'), key(4, 2, 'clamped'), key(10, 2.1, 'clamped')]));
    expect(far.outSlope[1]).toBeCloseTo(2.1 / 10, 15);
  });

  it('plateau (M1-stretch) uses the AnimX legacy auto rule', () => {
    fc.assert(
      fc.property(curveArbitrary({ types: ['plateau'] }), (anim) => {
        const auto: AnimCurve = { ...anim, keys: anim.keys.map((k) => ({ ...k, inType: 'auto', outType: 'auto' })) };
        const a = compileAnimCurve(anim);
        const b = compileAnimCurve(auto);
        expect(Array.from(a.inSlope)).toEqual(Array.from(b.inSlope));
        expect(Array.from(a.outSlope)).toEqual(Array.from(b.outSlope));
      }),
      { numRuns: 100 },
    );
  });

  it('linear end keys continue their span into linear infinity', () => {
    const c = compileAnimCurve(curve([key(0, 1, 'linear'), key(10, 6, 'linear')], { pre: 'linear', post: 'linear' }));
    expect(c.inSlope[0]).toBeCloseTo(0.5, 15);
    expect(c.outSlope[1]).toBeCloseTo(0.5, 15);
  });

  it('fixed non-weighted handles use only their direction; |dt| is at least 1e-6 frames', () => {
    const short = { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: 0.5, dv: 1 } };
    const long = { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: 5, dv: 10 } };
    const a = compileAnimCurve(curve([short, key(10, 3, 'flat')]));
    const b = compileAnimCurve(curve([long, key(10, 3, 'flat')]));
    for (let f = 0; f <= 10; f += 0.5) expect(evaluateAnimCurve(a, f)).toBeCloseTo(evaluateAnimCurve(b, f), 12);
    const vertical = { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: 0, dv: 1 } };
    expect(compileAnimCurve(curve([vertical, key(10, 3)])).outSlope[0]).toBe(1e6);
    const backwards = { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: -2, dv: 1 } };
    expect(compileAnimCurve(curve([backwards, key(10, 3)])).outSlope[0]).toBe(1e6);
  });

  it('non-weighted resolved handles are a third of the span on each side', () => {
    const c = compileAnimCurve(curve([key(0, 0), key(6, 3), key(15, 2)]));
    expect(c.outDt[0]).toBeCloseTo(2, 15);
    expect(c.inDt[1]).toBeCloseTo(-2, 15);
    expect(c.outDt[1]).toBeCloseTo(3, 15);
    expect(c.inDt[0]).toBeCloseTo(-2, 15); // an end key's outer side copies the other side's span
    expect(c.outDt[2]).toBeCloseTo(3, 15);
  });

  it('makeKeyData builds key.set defaults and rejects non-finite input', () => {
    expect(makeKeyData(5, 1)).toEqual({
      t: 5,
      v: 1,
      inType: 'auto',
      outType: 'auto',
      inHandle: { dt: 0, dv: 0 },
      outHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    });
    expect(makeKeyData(0, 0, { in: 'linear', out: 'step' })).toMatchObject({ inType: 'linear', outType: 'step' });
    expect(() => makeKeyData(Number.NaN, 0)).toThrow(expect.objectContaining({ code: 'invalid-record' }));
  });
});

describe('resolveKeyHandles', () => {
  /** Every key's sides set to `fixed` with the resolved handles. */
  function freezeAll(anim: AnimCurve): AnimCurve {
    const keys = anim.keys.map((k, i): KeyData => {
      const h = resolveKeyHandles(anim, i);
      const step = k.outType === 'step' || k.outType === 'stepNext';
      return {
        ...k,
        inType: 'fixed',
        inHandle: h.inHandle,
        outType: step ? k.outType : 'fixed',
        outHandle: step ? k.outHandle : h.outHandle,
      };
    });
    return { ...anim, keys };
  }

  it('property: writing the resolved handles as fixed leaves the curve unchanged (all types, weighted and not)', () => {
    fc.assert(
      fc.property(curveArbitrary({ types: TANGENT_TYPES.filter((t) => t !== 'linear') }), (anim) => {
        const before = compileAnimCurve(anim);
        const after = compileAnimCurve(freezeAll(anim));
        const first = before.t[0] as number;
        const last = before.t[before.keyCount - 1] as number;
        for (let i = 0; i <= 200; i++) {
          const f = first - 3 + ((last - first + 6) * i) / 200;
          expect(Math.abs(evaluateAnimCurve(before, f) - evaluateAnimCurve(after, f))).toBeLessThan(1e-12);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('property: no resolved handle dv is −0 (weighted and not, every tangent type)', () => {
    fc.assert(
      fc.property(curveArbitrary({ types: TANGENT_TYPES }), (anim) => {
        const compiled = compileAnimCurve(anim);
        // Stored weighted fixed sides are the document's own values: only computed sides are checked.
        const negative: string[] = [];
        for (let i = 0; i < compiled.keyCount; i++) {
          const fixedIn = anim.keys[i]?.inType === 'fixed' && anim.weighted;
          const fixedOut = anim.keys[i]?.outType === 'fixed' && anim.weighted;
          if (!fixedIn && Object.is(compiled.inDv[i], -0)) negative.push(`in ${i}`);
          if (!fixedOut && Object.is(compiled.outDv[i], -0)) negative.push(`out ${i}`);
        }
        expect(negative).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('weighted fixed sides return the stored handle; computed sides a third of the span', () => {
    const k0 = { ...key(0, 0, 'flat', 'fixed'), outHandle: { dt: 4.5, dv: 2 } };
    const c = curve([k0, key(9, 3, 'auto')], { weighted: true });
    expect(resolveKeyHandles(c, 0).outHandle).toEqual({ dt: 4.5, dv: 2 });
    const h = resolveKeyHandles(c, 1);
    expect(h.inHandle.dt).toBeCloseTo(-3, 15);
    // Auto end key: flat, at +0 (never −0: frozen into a document it must survive a JSON round trip, M2A-INT-16).
    expect(Object.is(h.inHandle.dv, 0)).toBe(true);
    expect(() => resolveKeyHandles(c, 2)).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });
});

describe('numeric tangent fields (MVP-SPEC §4.11.4, Maya convention)', () => {
  it('out-angle = atan2(dv·k, dt/fps), in-angle on the forward-pointing vector, weight = 3·hypot', () => {
    const out = tangentFields({ dt: 3, dv: 0.1 }, 'out', FPS30, K);
    expect(out.angleDeg).toBeCloseTo(Math.atan2(0.1 * K, 3 / 30) * K, 12);
    expect(out.weight).toBeCloseTo(3 * Math.hypot(3 / 30, 0.1 * K), 12);
    const inn = tangentFields({ dt: -3, dv: -0.1 }, 'in', FPS30, K);
    expect(inn.angleDeg).toBeCloseTo(out.angleDeg, 12); // same rising direction
    const falling = tangentFields({ dt: -3, dv: 0.1 }, 'in', FPS30, K);
    expect(falling.angleDeg).toBeLessThan(0);
  });

  it('|dt| < 1e-6 frames reads as ±90°', () => {
    expect(tangentFields({ dt: 0, dv: 1 }, 'out', FPS30, 1).angleDeg).toBe(90);
    expect(tangentFields({ dt: 0, dv: 1 }, 'in', FPS30, 1).angleDeg).toBe(-90);
    expect(tangentFields({ dt: 0, dv: 0 }, 'out', FPS30, 1).angleDeg).toBe(0);
  });

  it('E2E-12: in-angle 30° on a rising curve gives the in-slope tan(30°)/(30·k) rad per frame', () => {
    // key rz = 60° at frame 40 rising from 30° at 30; non-weighted resolved |dt| = span/3
    const c = curve([key(30, 30 * DEG), key(40, 60 * DEG)]);
    const current = resolveKeyHandles(c, 1).inHandle;
    const h = handleFromFields({ angleDeg: 30 }, current, 'in', FPS30, K);
    expect(h.dt).toBeCloseTo(current.dt, 15);
    const fixed: AnimCurve = { ...c, keys: [c.keys[0]!, { ...c.keys[1]!, inType: 'fixed', inHandle: h }] };
    const slope = compileAnimCurve(fixed).inSlope[1] as number;
    expect(slope).toBeGreaterThan(0);
    expect(Math.abs(slope - Math.tan(30 * DEG) / (30 * K))).toBeLessThan(1e-9);
    expect(tangentFields(h, 'in', FPS30, K).angleDeg).toBeCloseTo(30, 10);
  });

  it('E2E-12: out-angle 0 gives a flat out side', () => {
    const h = handleFromFields({ angleDeg: 0 }, { dt: 5, dv: 0.3 }, 'out', FPS30, K);
    expect(h).toEqual({ dt: 5, dv: 0 });
  });

  it('property: angle and weight round-trip through handleFromFields (both sides, any fps and scale)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: 0.01, max: 50, noNaN: true }),
        fc.constantFrom<'in' | 'out'>('in', 'out'),
        fc.constantFrom<Fps>({ num: 24, den: 1 }, { num: 30000, den: 1001 }, { num: 60, den: 1 }),
        fc.constantFrom(1, K),
        (angleDeg, weight, side, fps, k) => {
          const current = { dt: side === 'out' ? 2 : -2, dv: 0.5 };
          const h = handleFromFields({ angleDeg, weight }, current, side, fps, k);
          const back = tangentFields(h, side, fps, k);
          expect(back.angleDeg).toBeCloseTo(angleDeg, 8);
          expect(back.weight).toBeCloseTo(weight, 8);
          expect(Math.sign(h.dt)).toBe(side === 'out' ? 1 : -1);
          const angleOnly = handleFromFields({ angleDeg }, current, side, fps, k);
          expect(Math.abs(angleOnly.dt)).toBe(2);
          expect(tangentFields(angleOnly, side, fps, k).angleDeg).toBeCloseTo(angleDeg, 8);
          const weightOnly = handleFromFields({ weight }, current, side, fps, k);
          expect(tangentFields(weightOnly, side, fps, k).weight).toBeCloseTo(weight, 8);
          expect(tangentFields(weightOnly, side, fps, k).angleDeg).toBeCloseTo(
            tangentFields(current, side, fps, k).angleDeg,
            8,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('typed angles beyond ±90° are clamped to a finite near-vertical handle; bad input throws', () => {
    const h = handleFromFields({ angleDeg: 120 }, { dt: 1, dv: 0 }, 'out', FPS30, 1);
    expect(Number.isFinite(h.dv)).toBe(true);
    expect(tangentFields(h, 'out', FPS30, 1).angleDeg).toBeCloseTo(90, 5);
    expect(handleFromFields({}, { dt: 1, dv: 2 }, 'out', FPS30, 1)).toEqual({ dt: 1, dv: 2 });
    expect(() => tangentFields({ dt: 1, dv: 0 }, 'out', { num: 0, den: 1 }, 1)).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
    expect(() => handleFromFields({ weight: -1 }, { dt: 1, dv: 0 }, 'out', FPS30, 1)).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });
});

describe('cycle-aware auto tangents (FR-GE-17, M1-stretch)', () => {
  it('both infinities cycling: the loop is C¹ at the seam (1e-9)', () => {
    fc.assert(
      fc.property(
        // one auto type per curve: the seam joins the last key's in side to the first key's out side
        fc
          .constantFrom('auto' as const, 'autoMix' as const, 'autoEase' as const)
          .chain((type) => curveArbitrary({ types: [type], modes: ['cycleOffset'], minKeys: 3 })),
        (anim) => {
          const c = compileAnimCurve(anim, { cycleAwareAuto: true });
          const first = c.t[0] as number;
          const last = c.t[c.keyCount - 1] as number;
          // the curve's slope arriving at the last key (left derivative) == leaving the first key (right one)
          const arriving = evaluateAnimCurveSlope(c, last);
          const leaving = evaluateAnimCurveSlope(c, first);
          const scale = Math.max(1, Math.abs(leaving));
          expect(Math.abs((c.inSlope[c.keyCount - 1] as number) - (c.outSlope[0] as number))).toBeLessThan(
            1e-9 * scale,
          );
          expect(Math.abs(arriving - leaving)).toBeLessThan(1e-9 * scale);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('applies only when both infinities cycle; off by default', () => {
    const wave = waveCurve('auto', { pre: 'cycle', post: 'cycle' });
    const ramp = curve([key(0, 0), key(5, 3), key(10, 4)], { pre: 'cycleOffset', post: 'cycleOffset' });
    expect(compileAnimCurve(ramp).outSlope[0]).toBe(0);
    expect(compileAnimCurve(ramp, { cycleAwareAuto: true }).outSlope[0]).toBeGreaterThan(0);
    const half = { ...ramp, post: 'constant' as const };
    expect(compileAnimCurve(half, { cycleAwareAuto: true }).outSlope[0]).toBe(0);
    // the wave's end keys are extremes of the loop: still flat
    expect(compileAnimCurve(wave, { cycleAwareAuto: true }).outSlope[0]).toBe(0);
  });
});
