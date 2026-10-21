import {
  type AnimCurve,
  type CompiledAnimCurve,
  compileAnimCurve,
  EkzaError,
  evaluateAnimCurve,
  type InfinityMode,
  type KeyData,
  Segment,
  segmentControlPoints,
} from '@ekza-studio/anim-core';
import { naiveCurveEngine } from '@ekza-studio/editor-core/testing';
import { describe, expect, it } from 'vitest';
import {
  bezierParamAt,
  drawnValueAt,
  infinityMapping,
  lowerBound,
  newInfinityMapping,
  segmentBezier,
  segmentIndexAt,
  segmentValueAt,
  visibleRange,
} from '../src/graph/geometry';
import { key } from './support/app';

const curve = (keys: ReturnType<typeof key>[], pre: InfinityMode = 'constant', post: InfinityMode = 'constant') =>
  naiveCurveEngine.compile({ keys, weighted: false, pre, post });

const WAVE_KEYS = () => [key(0, 0.5), key(15, -0.5), key(30, 0.5)];
const scratch = new Float64Array(8);

describe('drawn-curve geometry', () => {
  it('builds the Bézier of a Hermite segment from the compiled handles (P1, P2 at Δ/3)', () => {
    const c = curve([key(0, 1, 'linear'), key(12, 4, 'linear', 'auto'), key(30, -2)]);
    segmentBezier(c, 0, scratch);
    expect([...scratch]).toEqual([0, 1, 4, 2, 8, 3, 12, 4]);
  });

  it('evaluates exactly what the engine evaluates on Hermite, linear and stepped spans', () => {
    const cases: CompiledAnimCurve[] = [
      curve(WAVE_KEYS()),
      curve([key(0, 0, 'spline'), key(7, 2, 'spline'), key(10, -1, 'spline'), key(24, 3, 'spline')]),
      curve([key(0, 0, 'linear'), key(10, 5, 'linear'), key(20, 1, 'flat')]),
      curve([key(0, 1, 'auto', 'step'), key(10, 5, 'auto', 'stepNext'), key(20, -3, 'auto')]),
      curve([key(-5, 2, 'fixed', 'fixed'), key(5, 2.5, 'clamped'), key(9, 0, 'auto')]),
    ];
    for (const c of cases) {
      const first = c.t[0] as number;
      const last = c.t[c.keyCount - 1] as number;
      for (let f = first; f <= last; f += 0.125) {
        const i = segmentIndexAt(c, f);
        expect(segmentValueAt(c, i, f, scratch)).toBeCloseTo(naiveCurveEngine.evaluate(c, f), 12);
      }
    }
  });

  it('keeps the stepped span rules: step holds the start value, stepNext jumps right after the start key', () => {
    const c = curve([key(0, 1, 'auto', 'step'), key(10, 5, 'auto', 'stepNext'), key(20, -3)]);
    expect(c.segment[0]).toBe(Segment.Step);
    expect(segmentValueAt(c, 0, 9.999, scratch)).toBe(1);
    expect(segmentValueAt(c, 0, 10, scratch)).toBe(5);
    expect(c.segment[1]).toBe(Segment.StepNext);
    expect(segmentValueAt(c, 1, 10, scratch)).toBe(5);
    expect(segmentValueAt(c, 1, 10.001, scratch)).toBe(-3);
  });

  it('solves x(u) = frame on weighted Béziers whose handles are not at Δ/3', () => {
    const bezier = new Float64Array([0, 0, 1, 3, 8, -2, 10, 1]);
    for (let f = 0; f <= 10; f += 0.37) {
      const u = bezierParamAt(bezier, f);
      const w = 1 - u;
      const x = 3 * w * w * u * 1 + 3 * w * u * u * 8 + u * u * u * 10; // P0.x = 0
      expect(Math.abs(x - f)).toBeLessThan(1e-11);
    }
    expect(bezierParamAt(bezier, -1)).toBe(0);
    expect(bezierParamAt(bezier, 11)).toBe(1);
  });

  it('maps infinity like the engine: constant, linear, cycle, cycle with offset and oscillate (negative times too)', () => {
    const mapping = newInfinityMapping();
    const modes: InfinityMode[] = ['constant', 'linear', 'cycle', 'cycleOffset', 'oscillate'];
    for (const pre of modes) {
      for (const post of modes) {
        const c = curve([key(2, 0.3, 'linear', 'auto'), key(9, 1.4), key(20, -0.8, 'auto', 'linear')], pre, post);
        for (let f = -75.5; f <= 95; f += 0.75) {
          expect(drawnValueAt(c, f, scratch, mapping)).toBeCloseTo(naiveCurveEngine.evaluate(c, f), 9);
        }
      }
    }
  });

  it('reports the cycle and mirroring of a mapped frame', () => {
    const c = curve(WAVE_KEYS(), 'oscillate', 'cycleOffset');
    const m = newInfinityMapping();
    infinityMapping(c, -10, m);
    expect(m).toEqual({ frame: 10, offset: 0, mirrored: true, cycle: -1 });
    infinityMapping(c, 75, m);
    expect(m.cycle).toBe(2);
    expect(m.frame).toBe(15);
    expect(m.offset).toBe(0); // first and last keys are equal
    infinityMapping(c, 12, m);
    expect(m).toEqual({ frame: 12, offset: 0, mirrored: false, cycle: 0 });
  });

  it('finds segments and visible key ranges by binary search', () => {
    const c = curve([key(0, 0), key(10, 1), key(20, 2), key(30, 3), key(40, 4)]);
    expect(segmentIndexAt(c, -5)).toBe(0);
    expect(segmentIndexAt(c, 10)).toBe(1);
    expect(segmentIndexAt(c, 39)).toBe(3);
    expect(segmentIndexAt(c, 40)).toBe(3);
    expect(lowerBound(c, 10)).toBe(1);
    expect(lowerBound(c, 10.5)).toBe(2);
    expect(lowerBound(c, 99)).toBe(5);
    expect(visibleRange(c, 12, 28)).toEqual([1, 3]);
    expect(visibleRange(c, -50, -10)).toEqual([0, 0]);
    expect(visibleRange(c, 45, 50)).toEqual([4, 4]);
    expect(visibleRange(curve([]), 0, 1)).toEqual([0, -1]);
  });

  it('returns NaN for curves without keys and the key value for single-key curves', () => {
    const mapping = newInfinityMapping();
    expect(drawnValueAt(curve([]), 3, scratch, mapping)).toBeNaN();
    expect(drawnValueAt(curve([key(4, 2)], 'cycle', 'oscillate'), -30, scratch, mapping)).toBe(2);
  });
});

/** Deterministic random curves of every tangent type, weighted and not, with fixed handles of any length. */
function randomCurves(count: number): AnimCurve[] {
  let seed = 0x6b8b4567;
  const random = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  const types = ['auto', 'spline', 'clamped', 'linear', 'flat', 'step', 'stepNext', 'fixed', 'autoEase', 'autoMix'];
  const modes: InfinityMode[] = ['constant', 'linear', 'cycle', 'cycleOffset', 'oscillate'];
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  return Array.from({ length: count }, () => {
    let t = -5 + random() * 10;
    const keys: KeyData[] = [];
    const n = 2 + Math.floor(random() * 6);
    for (let i = 0; i < n; i++) {
      t += 0.5 + random() * 12;
      keys.push({
        ...key(t, (random() - 0.5) * 4, pick(types) as KeyData['inType'], pick(types) as KeyData['outType']),
        inHandle: { dt: -(0.1 + random() * 9), dv: (random() - 0.5) * 3 },
        outHandle: { dt: 0.1 + random() * 9, dv: (random() - 0.5) * 3 },
        broken: random() < 0.5,
        weightLocked: random() < 0.5,
      });
    }
    return { keys, weighted: random() < 0.5, pre: pick(modes), post: pick(modes) };
  });
}

/** WP-1's AnimX engine is implemented (until then anim-core's curve functions are stubs). */
const ENGINE_READY = (() => {
  try {
    compileAnimCurve({ keys: [], weighted: false, pre: 'constant', post: 'constant' });
    return true;
  } catch (error) {
    return !(error instanceof EkzaError && error.code === 'not-implemented');
  }
})();

describe.skipIf(!ENGINE_READY)('[needs WP-1] drawn geometry equals the anim-core engine', () => {
  const fixed = (t: number, v: number, inDv: number, outDv: number, weightLocked = false): KeyData => ({
    ...key(t, v, 'fixed'),
    inHandle: { dt: -2, dv: inDv },
    outHandle: { dt: 3, dv: outDv },
    broken: true,
    weightLocked,
  });
  const curves: AnimCurve[] = [
    { keys: [key(0, 0.5), key(15, -0.5), key(30, 0.5)], weighted: false, pre: 'cycle', post: 'oscillate' },
    {
      keys: [key(0, 0, 'spline'), key(4, 2, 'clamped'), key(9, 2, 'linear'), key(20, -1, 'flat', 'step'), key(25, 3)],
      weighted: false,
      pre: 'linear',
      post: 'cycleOffset',
    },
    {
      keys: [fixed(0, 0, 0.4, 1.2), fixed(10, 1, -0.5, 0.3), fixed(14, -2, 0.9, -0.1)],
      weighted: true,
      pre: 'constant',
      post: 'linear',
    },
    // Weighted handles a hair off the thirds: AnimX evaluates these spans linear in time (`fLinear`).
    {
      keys: [
        { ...key(0, 0, 'fixed'), outHandle: { dt: 10 / 3 + 4e-6, dv: 0.8 }, broken: true, weightLocked: false },
        { ...key(10, 1, 'fixed'), inHandle: { dt: -10 / 3 - 3e-6, dv: 0.9 }, broken: true, weightLocked: false },
      ],
      weighted: true,
      pre: 'constant',
      post: 'constant',
    },
    ...randomCurves(24),
  ];

  it('segment control points match segmentControlPoints', () => {
    const ours = new Float64Array(8);
    const theirs = new Float64Array(8);
    for (const source of curves) {
      const c = compileAnimCurve(source);
      for (let i = 0; i + 1 < c.keyCount; i++) {
        if (c.segment[i] !== Segment.Hermite && c.segment[i] !== Segment.Bezier) continue;
        segmentBezier(c, i, ours);
        segmentControlPoints(c, i, theirs);
        for (let j = 0; j < 8; j++) expect(ours[j]).toBeCloseTo(theirs[j] as number, 12);
      }
    }
  });

  it('values on the drawn curve (key range and infinity) match evaluateAnimCurve', () => {
    const mapping = newInfinityMapping();
    for (const source of curves) {
      const c = compileAnimCurve(source);
      for (let f = -40; f <= 70; f += 0.37) {
        expect(drawnValueAt(c, f, scratch, mapping)).toBeCloseTo(evaluateAnimCurve(c, f), 9);
      }
    }
  });
});
