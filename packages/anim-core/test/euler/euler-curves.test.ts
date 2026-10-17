import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AnimCurve,
  compileAnimCurve,
  eulerFilterCurves,
  eulerToQuat,
  evaluateAnimCurve,
  type KeyData,
  type Quat,
  quatMultiply,
  quatSlerp,
  quatToEuler,
  type RotateOrder,
  rotateOrderAxes,
  type Vec3,
} from '../../src';
import { curve, key } from '../curve/arbitraries';
import { quatDistance, ROTATE_ORDERS, unitQuat } from '../math/helpers';

const axisCurves = (samples: readonly Vec3[], times: readonly number[]): [AnimCurve, AnimCurve, AnimCurve] =>
  [0, 1, 2].map((axis) => curve(samples.map((e, n) => key(times[n] as number, e[axis] as number, 'linear')))) as [
    AnimCurve,
    AnimCurve,
    AnimCurve,
  ];

describe('eulerFilterCurves (MVP-SPEC §4.11.5)', () => {
  it('random smooth quaternion walks: no per-key jump > π and quat(euler) ≡ q at every key', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROTATE_ORDERS),
        unitQuat,
        fc.array(unitQuat, { minLength: 40, maxLength: 40 }),
        (order, start, kicks) => {
          const q: Quat = [...start];
          const step: Quat = [0, 0, 0, 1];
          const quats: Quat[] = [];
          const samples: Vec3[] = [];
          for (const kick of kicks) {
            quatSlerp([0, 0, 0, 1], kick, 0.05, step);
            quatMultiply(step, q, q);
            quats.push([...q]);
            samples.push(quatToEuler(q, order));
          }
          const times = samples.map((_, n) => n * 2);
          const filtered = eulerFilterCurves(axisCurves(samples, times), order);
          for (let n = 0; n < samples.length; n++) {
            const e: Vec3 = [filtered[0][n]!.v, filtered[1][n]!.v, filtered[2][n]!.v];
            expect(quatDistance(eulerToQuat(e, order), quats[n] as Quat)).toBeLessThan(1e-9);
            if (n === 0) continue;
            for (const axis of [0, 1, 2] as const) {
              expect(Math.abs(filtered[axis][n]!.v - filtered[axis][n - 1]!.v)).toBeLessThanOrEqual(Math.PI);
            }
          }
          // times, tangent types and the other key fields are unchanged
          for (const axis of [0, 1, 2] as const) {
            expect(filtered[axis].map((k) => k.t)).toEqual(times);
            expect(filtered[axis].every((k) => k.inType === 'linear' && k.outType === 'linear')).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('samples at the union of key times and writes each curve only at its own keys', () => {
    // rx wraps by 2π between 10 and 20; ry has an extra key at 5; rz has only end keys
    const rx = curve([key(0, 3, 'linear'), key(10, 3.1, 'linear'), key(20, 3.2 - 2 * Math.PI, 'linear')]);
    const ry = curve([key(0, 0.1, 'linear'), key(5, 0.12, 'linear'), key(10, 0.1, 'linear'), key(20, 0.1, 'linear')]);
    const rz = curve([key(0, 0.5, 'linear'), key(20, 0.5, 'linear')]);
    const [fx, fy, fz] = eulerFilterCurves([rx, ry, rz], 'xyz');
    expect(fx.map((k) => k.t)).toEqual([0, 10, 20]);
    expect(fx[2]!.v).toBeCloseTo(3.2, 12);
    expect(fx[0]).toBe(rx.keys[0]); // unchanged keys are the same objects
    expect(fy.map((k) => k.v)).toEqual([0.1, 0.12, 0.1, 0.1]);
    expect(fz).toEqual(rz.keys);
  });

  it('negates the middle axis fixed handles where a key switches to the alternate triple', () => {
    const order: RotateOrder = 'xyz';
    const [i, j, k] = rotateOrderAxes(order);
    // a path whose second sample was written in the alternate branch (a + π, π − b, c + π)
    const clean: Vec3[] = [
      [0.1, 0.2, 0.3],
      [0.15, 0.25, 0.35],
      [0.2, 0.3, 0.4],
    ];
    const corrupted = clean.map((e, n): Vec3 => {
      if (n === 0) return [...e];
      const out: Vec3 = [...e];
      out[i] = e[i] + Math.PI;
      out[j] = Math.PI - e[j];
      out[k] = e[k] + Math.PI;
      return out;
    });
    const curves = [0, 1, 2].map((axis) =>
      curve(
        corrupted.map(
          (e, n): KeyData => ({
            ...key(n * 10, e[axis] as number, 'fixed'),
            inHandle: { dt: -3, dv: -0.5 },
            outHandle: { dt: 3, dv: 0.5 },
          }),
        ),
      ),
    ) as [AnimCurve, AnimCurve, AnimCurve];
    const filtered = eulerFilterCurves(curves, order);
    for (let n = 0; n < 3; n++) {
      for (const axis of [0, 1, 2] as const) expect(filtered[axis][n]!.v).toBeCloseTo(clean[n]![axis], 12);
    }
    expect(filtered[j][1]!.outHandle).toEqual({ dt: 3, dv: -0.5 });
    expect(filtered[j][1]!.inHandle).toEqual({ dt: -3, dv: 0.5 });
    expect(filtered[i][1]!.outHandle).toEqual({ dt: 3, dv: 0.5 });
    expect(filtered[j][0]).toBe(curves[j].keys[0]);
  });

  it('empty channels sample as 0 and come back empty; the result is deterministic', () => {
    const rx = curve([key(0, 0.5), key(10, 7)]);
    const empty = curve([]);
    const a = eulerFilterCurves([rx, empty, empty], 'zxy');
    expect(a[1]).toEqual([]);
    expect(a[2]).toEqual([]);
    expect(eulerFilterCurves([rx, empty, empty], 'zxy')).toEqual(a);
    // 7 rad unwrapped towards 0.5 → 7 − 2π
    expect(a[0][1]!.v).toBeCloseTo(7 - 2 * Math.PI, 12);
    const c = compileAnimCurve({ ...rx, keys: a[0] });
    expect(evaluateAnimCurve(c, 0)).toBe(0.5);
  });
});
