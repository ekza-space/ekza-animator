import { type AnimCurve, curveEngine, eulerToQuat, type KeyData, type RotateOrder } from '@ekza-animator/anim-core';
import { describe, expect, it } from 'vitest';
import { convertRotateOrderKeys } from '../src';
import { pendingStub, quatAngleBetween } from './helpers';

const ORDERS: readonly RotateOrder[] = ['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx'];

function key(t: number, v: number, type: KeyData['inType'] = 'linear'): KeyData {
  return { t, v, inType: type, outType: type, inHandle: { dt: 0, dv: 0 }, outHandle: { dt: 0, dv: 0 }, broken: false, weightLocked: true };
}

function curve(keys: KeyData[]): AnimCurve {
  return { keys, weighted: false, pre: 'constant', post: 'constant' };
}

describe('convertRotateOrderKeys (M1-stretch, MVP-SPEC §4.11.5)', () => {
  it('preserves the rotation at every key time of synchronized curves, for every order pair', () => {
    const times = [0, 5, 10, 20];
    const rx = curve(times.map((t, i) => key(t, Math.sin(i + 1) * 1.2)));
    const ry = curve(times.map((t, i) => key(t, Math.cos(i * 2) * 0.9, 'auto')));
    const rz = curve(times.map((t, i) => key(t, (i - 1.5) * 0.7, 'step')));
    for (const from of ORDERS) {
      for (const to of ORDERS) {
        const [x, y, z] = convertRotateOrderKeys([rx, ry, rz], from, to);
        expect(x.map((k) => k.t)).toEqual(times);
        times.forEach((_, i) => {
          const before = eulerToQuat([rx.keys[i]?.v ?? 0, ry.keys[i]?.v ?? 0, rz.keys[i]?.v ?? 0], from);
          const after = eulerToQuat([x[i]?.v ?? 0, y[i]?.v ?? 0, z[i]?.v ?? 0], to);
          expect(quatAngleBetween(before, after)).toBeLessThan(1e-9);
        });
        // Existing keys keep their tangent types.
        expect(y.every((k) => k.inType === 'auto')).toBe(true);
        expect(z.every((k) => k.outType === 'step')).toBe(true);
      }
    }
  });

  it('keeps successive samples continuous (Euler filter)', () => {
    const times = Array.from({ length: 20 }, (_, i) => i);
    const ry = curve(times.map((t) => key(t, t * 0.4)));
    const zero = curve(times.map((t) => key(t, 0)));
    const [, y] = convertRotateOrderKeys([zero, ry, zero], 'xyz', 'zxy');
    for (let i = 1; i < y.length; i++) expect(Math.abs((y[i]?.v ?? 0) - (y[i - 1]?.v ?? 0))).toBeLessThan(1);
  });

  it.skipIf(pendingStub(() => curveEngine.compile(curve([]))))(
    'synchronizes unsynchronized curves at the union of key times (needs WP-1 curve engine)',
    () => {
      const rx = curve([key(0, 0.2), key(10, 0.8)]);
      const ry = curve([key(0, 0.1), key(4, -0.5), key(10, 0.3)]);
      const rz = curve([key(0, 0), key(7, 0.6), key(10, 0)]);
      const [x, y, z] = convertRotateOrderKeys([rx, ry, rz], 'xyz', 'yzx');
      expect(x.map((k) => k.t)).toEqual([0, 4, 7, 10]);
      expect(y.map((k) => k.t)).toEqual([0, 4, 7, 10]);
      const compiled = [rx, ry, rz].map((c) => curveEngine.compile(c));
      [0, 4, 7, 10].forEach((t, i) => {
        const before = eulerToQuat(compiled.map((c) => curveEngine.evaluate(c, t)) as [number, number, number], 'xyz');
        const after = eulerToQuat([x[i]?.v ?? 0, y[i]?.v ?? 0, z[i]?.v ?? 0], 'yzx');
        expect(quatAngleBetween(before, after)).toBeLessThan(1e-6);
      });
      expect(x[1]?.inType).toBe('auto');
    },
  );

  it('returns empty curves for empty input', () => {
    expect(convertRotateOrderKeys([curve([]), curve([]), curve([])], 'xyz', 'zyx')).toEqual([[], [], []]);
  });
});
