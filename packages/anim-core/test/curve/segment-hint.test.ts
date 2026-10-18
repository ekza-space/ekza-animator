// M2A-SPEC §5.21.3 (M-3): the per-curve segment hint is a cache, not state — any frame order gives the same values,
// bit for bit, as a freshly compiled curve; curves built outside `compileAnimCurve` are never written to.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CompiledAnimCurve, compileAnimCurve, evaluateAnimCurve } from '../../src';
import { curve, curveArbitrary, key } from './arbitraries';

const frameArbitrary = fc.oneof(
  fc.double({ min: -120, max: 120, noNaN: true, noDefaultInfinity: true }),
  fc.integer({ min: -120, max: 120 }),
);

/** The contract arrays of a compiled curve without the hint field (what another package might build). */
function foreignCopy(c: CompiledAnimCurve): CompiledAnimCurve {
  return {
    keyCount: c.keyCount,
    t: c.t,
    v: c.v,
    inSlope: c.inSlope,
    outSlope: c.outSlope,
    inDt: c.inDt,
    inDv: c.inDv,
    outDt: c.outDt,
    outDv: c.outDv,
    segment: c.segment,
    weighted: c.weighted,
    pre: c.pre,
    post: c.post,
  };
}

describe('segment hint (M-3)', () => {
  it('any frame order evaluates bit-identically to a fresh curve per frame', () => {
    fc.assert(
      fc.property(
        curveArbitrary({ maxKeys: 12 }),
        fc.array(frameArbitrary, { minLength: 1, maxLength: 40 }),
        (anim, frames) => {
          const warm = compileAnimCurve(anim);
          for (const frame of frames) {
            const fresh = compileAnimCurve(anim);
            expect(Object.is(evaluateAnimCurve(warm, frame), evaluateAnimCurve(fresh, frame))).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('monotonic playback, scrubbing back and jumps agree with a curve that never had a hint', () => {
    fc.assert(
      fc.property(
        curveArbitrary({ minKeys: 3, maxKeys: 10 }),
        fc.double({ min: 0.01, max: 3, noNaN: true }),
        (anim, step) => {
          const warm = compileAnimCurve(anim);
          const cold = foreignCopy(compileAnimCurve(anim));
          const first = warm.t[0] as number;
          const last = warm.t[warm.keyCount - 1] as number;
          const frames: number[] = [];
          for (let f = first - 5; f <= last + 5; f += step) frames.push(f);
          for (let f = last + 5; f >= first - 5; f -= step * 1.7) frames.push(f);
          frames.push(first, last, (first + last) / 2, first, last);
          for (const frame of frames) {
            expect(Object.is(evaluateAnimCurve(warm, frame), evaluateAnimCurve(cold, frame))).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('keys, frames within 1e-10 of a key and the segment boundaries take the same branch as the search', () => {
    const anim = curve([key(0, 0), key(10, 1, 'linear'), key(20, -1, 'step'), key(30, 2, 'stepNext'), key(40, 0)]);
    const warm = compileAnimCurve(anim);
    const cold = foreignCopy(compileAnimCurve(anim));
    const frames = [5, 10, 10 - 5e-11, 10 + 5e-11, 15, 20, 19.999999, 20.000001, 25, 30, 29.9999999, 35, 40, 0, 40, 10];
    for (const frame of frames) {
      expect(Object.is(evaluateAnimCurve(warm, frame), evaluateAnimCurve(cold, frame))).toBe(true);
    }
  });

  it('never adds a field to a curve built outside compileAnimCurve', () => {
    const cold = foreignCopy(compileAnimCurve(curve([key(0, 0), key(10, 1), key(20, 0)])));
    for (const frame of [1, 5, 12, 19, 3]) evaluateAnimCurve(cold, frame);
    expect('segmentHint' in cold).toBe(false);
  });

  it('a non-finite frame neither throws nor poisons the hint', () => {
    const anim = curve([key(0, 0), key(10, 1), key(20, 0)], { pre: 'cycle', post: 'oscillate' });
    const warm = compileAnimCurve(anim);
    const fresh = () => compileAnimCurve(anim);
    for (const frame of [5, Number.NaN, 15, Number.NEGATIVE_INFINITY, 7, Number.POSITIVE_INFINITY, 18]) {
      expect(Object.is(evaluateAnimCurve(warm, frame), evaluateAnimCurve(fresh(), frame))).toBe(true);
    }
  });
});
