import { type CompiledAnimCurve, type InfinityMode, Segment } from '@ekza-animator/anim-core';
import { naiveCurveEngine } from '@ekza-animator/editor-core/testing';
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
