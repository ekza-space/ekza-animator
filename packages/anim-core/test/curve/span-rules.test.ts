import { describe, expect, it } from 'vitest';
import {
  type AnimCurve,
  compileAnimCurve,
  evaluateAnimCurve,
  type KeyData,
  Segment,
  spanKindAt,
  type TangentType,
} from '../../src';
import { curve, DEG, key, waveCurve } from './arbitraries';

/** Sets both sides of the given keys (all keys by default) to `type`; step types set the out side only. */
function withTypes(c: AnimCurve, type: TangentType, indices?: readonly number[]): AnimCurve {
  const keys = c.keys.map((k, i): KeyData => {
    if (indices !== undefined && !indices.includes(i)) return k;
    if (type === 'step' || type === 'stepNext') return { ...k, outType: type };
    return { ...k, inType: type, outType: type };
  });
  return { ...c, keys };
}

const value = (c: AnimCurve, frame: number): number => evaluateAnimCurve(compileAnimCurve(c), frame);

describe('E2E-08 / US-08 numbers on the wave clip (30° / −30° / 30° at 0 / 15 / 30)', () => {
  const wave = waveCurve();

  it('linear on all keys: v(7.5) = mean(v0, v15) = 0°', () => {
    expect(Math.abs(value(withTypes(wave, 'linear'), 7.5))).toBeLessThan(1e-9);
  });

  it('step on all keys: v(14) = v0 and v(29) = v15', () => {
    const stepped = withTypes(wave, 'step');
    expect(value(stepped, 14)).toBeCloseTo(30 * DEG, 12);
    expect(value(stepped, 29)).toBeCloseTo(-30 * DEG, 12);
    // key values at the keys themselves
    expect(value(stepped, 15)).toBe(-30 * DEG);
    expect(value(stepped, 30)).toBe(30 * DEG);
  });

  it('auto: key 15 is a local extremum with zero slope; end keys are flat', () => {
    const c = compileAnimCurve(withTypes(wave, 'auto'));
    expect(c.inSlope[1]).toBe(0);
    expect(c.outSlope[1]).toBe(0);
    expect(c.outSlope[0]).toBe(0);
    expect(c.inSlope[2]).toBe(0);
  });

  it('linear on key 15 only: v(7.5) = 7.5° (Hermite with the flat auto end key 0)', () => {
    const c = withTypes(wave, 'linear', [1]);
    expect(Math.abs(value(c, 7.5) - 7.5 * DEG)).toBeLessThan(1e-9);
    // the span is not linear: key 0's out side is auto
    expect(spanKindAt(compileAnimCurve(c), 7.5)).toBe(Segment.Hermite);
  });
});

describe('span rules (AnimX, MVP-SPEC §4.11.4)', () => {
  it('a span is linear only if the start key out side and the end key in side are both linear', () => {
    const cases: [TangentType, TangentType, number][] = [
      ['linear', 'linear', Segment.Linear],
      ['linear', 'auto', Segment.Hermite],
      ['auto', 'linear', Segment.Hermite],
      ['linear', 'flat', Segment.Hermite],
      ['fixed', 'linear', Segment.Hermite],
    ];
    for (const [out, inn, kind] of cases) {
      const c = compileAnimCurve(curve([key(0, 0, 'auto', out), key(10, 5, inn, 'auto')]));
      expect([out, inn, c.segment[0]]).toEqual([out, inn, kind]);
      const w = compileAnimCurve(curve([key(0, 0, 'auto', out), key(10, 5, inn, 'auto')], { weighted: true }));
      expect([out, inn, w.segment[0]]).toEqual([out, inn, kind === Segment.Hermite ? Segment.Bezier : kind]);
    }
  });

  it('a linear side alone contributes its one-sided chord slope to a Hermite span', () => {
    const c = compileAnimCurve(curve([key(0, 0, 'flat'), key(10, 5, 'linear', 'flat'), key(12, 0, 'flat')]));
    expect(c.inSlope[1]).toBeCloseTo(0.5, 15); // chord to the previous key
    expect(c.outSlope[1]).toBe(0); // flat
    const linearOut = compileAnimCurve(curve([key(0, 0, 'flat'), key(10, 5, 'flat', 'linear'), key(12, 0, 'flat')]));
    expect(linearOut.outSlope[1]).toBeCloseTo(-2.5, 15); // chord to the next key
  });

  it('step / stepNext are read from the start key out side and affect only the following span', () => {
    const keys = [key(0, 0, 'auto'), key(10, 4, 'auto', 'step'), key(20, -2, 'auto'), key(30, 6, 'auto')];
    const c = compileAnimCurve(curve(keys));
    expect(Array.from(c.segment)).toEqual([Segment.Hermite, Segment.Step, Segment.Hermite]);
    expect(evaluateAnimCurve(c, 19.999)).toBe(4);
    expect(evaluateAnimCurve(c, 20)).toBe(-2);
    // the previous span is untouched by the step flag (compare with the same curve without it)
    const plain = compileAnimCurve(curve([keys[0]!, key(10, 4, 'auto'), keys[2]!, keys[3]!]));
    for (let f = 0; f <= 10; f += 0.5) expect(evaluateAnimCurve(c, f)).toBe(evaluateAnimCurve(plain, f));
    for (let f = 20; f <= 30; f += 0.5) expect(evaluateAnimCurve(c, f)).toBe(evaluateAnimCurve(plain, f));

    const next = compileAnimCurve(curve([key(0, 0, 'auto', 'stepNext'), key(10, 4, 'auto')]));
    expect(next.segment[0]).toBe(Segment.StepNext);
    expect(evaluateAnimCurve(next, 0)).toBe(0);
    expect(evaluateAnimCurve(next, 1e-6)).toBe(4);
    expect(evaluateAnimCurve(next, 9.5)).toBe(4);
  });

  it('a step type on the in side behaves as flat and never steps the previous span', () => {
    const c = compileAnimCurve(curve([key(0, 0, 'auto'), key(10, 4, 'step', 'auto')]));
    expect(c.segment[0]).toBe(Segment.Hermite);
    expect(c.inSlope[1]).toBe(0);
  });

  it('auto end keys are flat for every auto type, weighted or not', () => {
    for (const type of ['auto', 'autoMix', 'autoEase', 'plateau'] as const) {
      for (const weighted of [false, true]) {
        const c = compileAnimCurve(curve([key(0, 0, type), key(5, 3, type), key(9, 7, type)], { weighted }));
        expect(c.inSlope[0]).toBe(0);
        expect(c.outSlope[0]).toBe(0);
        expect(c.inSlope[2]).toBe(0);
        expect(c.outSlope[2]).toBe(0);
        expect(c.outSlope[1]).toBeGreaterThan(0);
      }
    }
  });
});
