import fc from 'fast-check';
import { Euler, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';
import {
  eulerFilter,
  eulerNear,
  eulerToQuat,
  fromThreeEulerOrder,
  gimbalAxes,
  quatFromAxisAngle,
  quatMultiply,
  quatSlerp,
  quatToEuler,
  type RotateOrder,
  rotateOrderAxes,
  toThreeEulerOrder,
  type Vec3,
} from '../../src';
import { angle, angleDiff, quatDistance, ROTATE_ORDERS, unitQuat, vec3 } from './helpers';

const HALF_PI = Math.PI / 2;

describe('rotate-order table (research 07 §1.3)', () => {
  it('pins DCC ↔ three.js orders and role axes', () => {
    const table: readonly [RotateOrder, string, readonly [number, number, number]][] = [
      ['xyz', 'ZYX', [0, 1, 2]],
      ['yzx', 'XZY', [1, 2, 0]],
      ['zxy', 'YXZ', [2, 0, 1]],
      ['xzy', 'YZX', [0, 2, 1]],
      ['yxz', 'ZXY', [1, 0, 2]],
      ['zyx', 'XYZ', [2, 1, 0]],
    ];
    for (const [dcc, three, axes] of table) {
      expect(toThreeEulerOrder(dcc)).toBe(three);
      expect(fromThreeEulerOrder(toThreeEulerOrder(dcc))).toBe(dcc);
      expect(rotateOrderAxes(dcc)).toEqual(axes);
    }
  });

  it('rejects unknown orders with EkzaError("unsupported")', () => {
    expect(() => toThreeEulerOrder('xxy' as RotateOrder)).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });

  it.each(ROTATE_ORDERS)('eulerToQuat matches three.js Euler + Quaternion for %s', (order) => {
    fc.assert(
      fc.property(vec3(Math.PI), (e) => {
        const ours = eulerToQuat(e, order);
        const three = new Quaternion().setFromEuler(new Euler(e[0], e[1], e[2], toThreeEulerOrder(order)));
        expect(quatDistance(ours, [three.x, three.y, three.z, three.w])).toBeLessThan(1e-12);
      }),
      { numRuns: 500 },
    );
  });

  it.each(ROTATE_ORDERS)('quatToEuler matches three.js setFromQuaternion away from gimbal lock for %s', (order) => {
    fc.assert(
      fc.property(unitQuat, (q) => {
        const ours = quatToEuler(q, order);
        const three = new Euler().setFromQuaternion(new Quaternion(...q), toThreeEulerOrder(order));
        fc.pre(Math.abs(Math.cos(three.toArray()[rotateOrderAxes(order)[1]])) > 1e-3);
        expect(Math.abs(angleDiff(ours[0], three.x))).toBeLessThan(1e-9);
        expect(Math.abs(angleDiff(ours[1], three.y))).toBeLessThan(1e-9);
        expect(Math.abs(angleDiff(ours[2], three.z))).toBeLessThan(1e-9);
      }),
      { numRuns: 500 },
    );
  });
});

describe('Euler ↔ quaternion round trips', () => {
  it.each(ROTATE_ORDERS)('quat → euler → quat reproduces the rotation for %s', (order) => {
    fc.assert(
      fc.property(unitQuat, (q) => {
        expect(quatDistance(eulerToQuat(quatToEuler(q, order), order), q)).toBeLessThan(1e-12);
      }),
      { numRuns: 1000 },
    );
  });

  it.each(ROTATE_ORDERS)('euler → quat → euler is the identity on principal angles for %s', (order) => {
    const [i, j, k] = rotateOrderAxes(order);
    fc.assert(
      fc.property(angle(Math.PI - 1e-6), angle(HALF_PI - 1e-3), angle(Math.PI - 1e-6), (a, b, c) => {
        const e: Vec3 = [0, 0, 0];
        e[i] = a;
        e[j] = b;
        e[k] = c;
        const back = quatToEuler(eulerToQuat(e, order), order);
        expect(back[0]).toBeCloseTo(e[0], 9);
        expect(back[1]).toBeCloseTo(e[1], 9);
        expect(back[2]).toBeCloseTo(e[2], 9);
      }),
      { numRuns: 500 },
    );
  });

  it.each(ROTATE_ORDERS)('handles exact gimbal lock (middle ±90°) for %s', (order) => {
    const [i, j, k] = rotateOrderAxes(order);
    fc.assert(
      fc.property(angle(), fc.constantFrom(HALF_PI, -HALF_PI), angle(), (a, b, c) => {
        const e: Vec3 = [0, 0, 0];
        e[i] = a;
        e[j] = b;
        e[k] = c;
        const q = eulerToQuat(e, order);
        const back = quatToEuler(q, order);
        expect(back[j]).toBeCloseTo(b, 7);
        expect(back[i]).toBe(0);
        expect(quatDistance(eulerToQuat(back, order), q)).toBeLessThan(1e-12);
      }),
      { numRuns: 300 },
    );
  });
});

describe('eulerNear (research 07 §14.3)', () => {
  it.each(ROTATE_ORDERS)('reproduces the rotation and stays within π of the reference for %s', (order) => {
    fc.assert(
      fc.property(unitQuat, vec3(20), (q, reference) => {
        const e = eulerNear(q, order, reference);
        expect(quatDistance(eulerToQuat(e, order), q)).toBeLessThan(1e-9);
        // Each candidate is unwrapped to within π of the reference.
        for (const n of [0, 1, 2] as const) expect(Math.abs(e[n] - reference[n])).toBeLessThanOrEqual(Math.PI + 1e-9);
      }),
      { numRuns: 500 },
    );
  });

  it('returns the reference itself when it already represents the rotation', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROTATE_ORDERS), vec3(12), (order, reference) => {
        const e = eulerNear(eulerToQuat(reference, order), order, reference);
        expect(e[0]).toBeCloseTo(reference[0], 9);
        expect(e[1]).toBeCloseTo(reference[1], 9);
        expect(e[2]).toBeCloseTo(reference[2], 9);
      }),
      { numRuns: 300 },
    );
  });

  it.each(ROTATE_ORDERS)('is continuous along a smooth rotation path away from gimbal lock (%s)', (order) => {
    const j = rotateOrderAxes(order)[1];
    fc.assert(
      fc.property(unitQuat, unitQuat, (from, to) => {
        let previous = quatToEuler(from, order);
        let maxJump = 0;
        const q: [number, number, number, number] = [0, 0, 0, 1];
        for (let step = 1; step <= 200; step++) {
          quatSlerp(from, to, step / 200, q);
          const e = eulerNear(q, order, previous);
          // Near gimbal lock large inner/outer changes are legitimate; measure only clear of it.
          const clear = Math.abs(Math.cos(e[j])) > 0.2 && Math.abs(Math.cos(previous[j])) > 0.2;
          const jump = Math.max(...[0, 1, 2].map((n) => Math.abs((e[n] as number) - (previous[n] as number))));
          maxJump = clear ? Math.max(maxJump, jump) : maxJump;
          previous = e;
        }
        expect(maxJump).toBeLessThan(0.2);
      }),
      { numRuns: 60 },
    );
  });

  it.each(ROTATE_ORDERS)('keeps the reference inner angle at exact gimbal lock (%s)', (order) => {
    const [i, j, k] = rotateOrderAxes(order);
    fc.assert(
      fc.property(angle(), fc.constantFrom(HALF_PI, -HALF_PI), angle(), angle(HALF_PI), (a, b, c, drift) => {
        const e: Vec3 = [0, 0, 0];
        e[i] = a;
        e[j] = b;
        e[k] = c;
        const q = eulerToQuat(e, order);
        // The reference is the previous pose of a drag: same middle and outer, inner off by less than 90°.
        const reference: Vec3 = [...e];
        reference[i] = a + drift;
        const near = eulerNear(q, order, reference);
        expect(near[i]).toBeCloseTo(reference[i], 12);
        expect(quatDistance(eulerToQuat(near, order), q)).toBeLessThan(1e-8);
        expect(Math.abs(near[k] - reference[k])).toBeLessThanOrEqual(Math.abs(drift) + 1e-9);
      }),
      { numRuns: 300 },
    );
  });
});

describe('eulerFilter (research 07 §14.2)', () => {
  it.each(ROTATE_ORDERS)('removes 2π wraps and alternate-triple flips from a smooth path (%s)', (order) => {
    const [i, j, k] = rotateOrderAxes(order);
    fc.assert(
      fc.property(
        vec3(2),
        vec3(0.02),
        fc.array(fc.tuple(fc.integer({ min: -2, max: 2 }), fc.boolean()), { minLength: 50, maxLength: 50 }),
        (start, velocity, corruptions) => {
          const clean: Vec3[] = [];
          for (let n = 0; n < 50; n++) {
            const e: Vec3 = [start[0] + velocity[0] * n, start[1] + velocity[1] * n, start[2] + velocity[2] * n];
            e[j] = Math.max(-1.2, Math.min(1.2, e[j])); // stay clear of gimbal lock
            clean.push(e);
          }
          const corrupted = clean.map((e, n): Vec3 => {
            if (n === 0) return [...e];
            const [wraps, alternate] = corruptions[n] ?? [0, false];
            const out: Vec3 = [...e];
            if (alternate) {
              out[i] = e[i] + Math.PI;
              out[j] = Math.PI - e[j];
              out[k] = e[k] + Math.PI;
            }
            out[i] += 2 * Math.PI * wraps;
            out[k] -= 2 * Math.PI * wraps;
            return out;
          });
          eulerFilter(corrupted, order);
          for (let n = 0; n < clean.length; n++) {
            for (const c of [0, 1, 2] as const) {
              expect(corrupted[n]?.[c]).toBeCloseTo(clean[n]?.[c] as number, 9);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('never leaves a per-sample jump above π on a random quaternion walk', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROTATE_ORDERS),
        unitQuat,
        fc.array(unitQuat, { minLength: 40, maxLength: 40 }),
        (order, start, kicks) => {
          const q: [number, number, number, number] = [...start];
          const samples: Vec3[] = [];
          const step: [number, number, number, number] = [0, 0, 0, 1];
          for (const kick of kicks) {
            quatSlerp([0, 0, 0, 1], kick, 0.05, step);
            quatMultiply(step, q, q);
            samples.push(quatToEuler(q, order));
          }
          const quats = samples.map((e) => eulerToQuat(e, order));
          eulerFilter(samples, order);
          for (let n = 0; n < samples.length; n++) {
            expect(
              quatDistance(eulerToQuat(samples[n] as Vec3, order), quats[n] as [number, number, number, number]),
            ).toBeLessThan(1e-9);
          }
          for (let n = 1; n < samples.length; n++) {
            for (const c of [0, 1, 2] as const) {
              expect(Math.abs((samples[n] as Vec3)[c] - (samples[n - 1] as Vec3)[c])).toBeLessThanOrEqual(Math.PI);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('gimbalAxes', () => {
  it.each(ROTATE_ORDERS)('match the instantaneous rotation axis of each channel (central differences, %s)', (order) => {
    const h = 1e-5;
    fc.assert(
      fc.property(vec3(Math.PI), (e) => {
        const axes = gimbalAxes(e, order);
        for (const n of [0, 1, 2] as const) {
          const plus: Vec3 = [...e];
          const minus: Vec3 = [...e];
          plus[n] += h;
          minus[n] -= h;
          const back = eulerToQuat(minus, order);
          // R(e + h)·R(e − h)⁻¹ is a rotation by 2h about the channel's axis (to O(h²)): its vector part is sin(h)·axis.
          const delta = quatMultiply(eulerToQuat(plus, order), [-back[0], -back[1], -back[2], back[3]]);
          const sign = delta[3] < 0 ? -1 : 1;
          const axis = axes[n];
          expect(Math.hypot(...axis)).toBeCloseTo(1, 12);
          for (const c of [0, 1, 2] as const) expect((sign * delta[c]) / Math.sin(h)).toBeCloseTo(axis[c], 8);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('puts the outer axis at the parent frame axis', () => {
    const axes = gimbalAxes([0.3, -0.7, 1.1], 'xyz');
    expect(axes[2]).toEqual([0, 0, 1]);
    const expected = quatFromAxisAngle([0, 0, 1], 1.1);
    expect(axes[1][0]).toBeCloseTo(-2 * expected[2] * expected[3], 12);
  });
});
