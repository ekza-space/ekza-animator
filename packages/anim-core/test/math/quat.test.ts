import fc from 'fast-check';
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  quatAngle,
  quatDot,
  quatEnsureHemisphere,
  quatFromAxisAngle,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  quatShortestArc,
  quatSlerp,
} from '../../src';
import { angle, maxAbsDiff, quatDistance, unitQuat, vec3 } from './helpers';

const three = (q: readonly number[]): Quaternion => new Quaternion(q[0], q[1], q[2], q[3]);
const arr = (q: Quaternion): [number, number, number, number] => [q.x, q.y, q.z, q.w];

describe('quaternions (cross-checked with three.js)', () => {
  it('multiply matches three.js and is safe when out aliases an input', () => {
    fc.assert(
      fc.property(unitQuat, unitQuat, (a, b) => {
        const expected = arr(three(a).multiply(three(b)));
        expect(maxAbsDiff(quatMultiply(a, b), expected)).toBeLessThan(1e-15);
        const aliased: [number, number, number, number] = [...a];
        expect(maxAbsDiff(quatMultiply(aliased, b, aliased), expected)).toBeLessThan(1e-15);
      }),
    );
  });

  it('invert and normalize', () => {
    fc.assert(
      fc.property(unitQuat, angle(3), (q, scale) => {
        fc.pre(Math.abs(scale) > 1e-3);
        const scaled: [number, number, number, number] = [q[0] * scale, q[1] * scale, q[2] * scale, q[3] * scale];
        expect(quatDistance(quatNormalize(scaled), q)).toBeLessThan(1e-14);
        expect(quatDistance(quatMultiply(scaled, quatInvert(scaled)), [0, 0, 0, 1])).toBeLessThan(1e-14);
      }),
    );
    expect(quatNormalize([0, 0, 0, 0])).toEqual([0, 0, 0, 1]);
    expect(quatInvert([0, 0, 0, 0])).toEqual([0, 0, 0, 1]);
  });

  it('slerp moves along the shortest arc at constant angular speed', () => {
    fc.assert(
      fc.property(unitQuat, unitQuat, fc.double({ min: 0, max: 1, noNaN: true }), (a, b, t) => {
        const q = quatSlerp(a, b, t);
        const total = quatAngle(a, b);
        expect(Math.hypot(...q)).toBeCloseTo(1, 14);
        expect(quatAngle(a, q)).toBeCloseTo(t * total, 9);
        expect(quatAngle(q, b)).toBeCloseTo((1 - t) * total, 9);
      }),
    );
    expect(quatSlerp([0, 0, 0, 1], [0, 0, 0, 1], 0.5)).toEqual([0, 0, 0, 1]);
  });

  it('slerp matches three.js where three.js does not fall back to nlerp', () => {
    fc.assert(
      fc.property(unitQuat, unitQuat, fc.double({ min: 0, max: 1, noNaN: true }), (a, b, t) => {
        // three.js switches to normalized lerp (an approximation) when |dot| ≥ 0.9995.
        fc.pre(Math.abs(three(a).dot(three(b))) < 0.9995);
        expect(quatDistance(quatSlerp(a, b, t), arr(three(a).slerp(three(b), t)))).toBeLessThan(1e-9);
      }),
    );
  });

  it('axis-angle, rotation of vectors and angles match three.js', () => {
    fc.assert(
      fc.property(vec3(1), angle(), vec3(5), (axis, theta, v) => {
        fc.pre(Math.hypot(...axis) > 1e-3);
        const q = quatFromAxisAngle(axis, theta);
        const expected = new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(), theta);
        expect(quatDistance(q, arr(expected))).toBeLessThan(1e-14);
        const rotated = new Vector3(...v).applyQuaternion(expected);
        expect(maxAbsDiff(quatRotateVec3(q, v), rotated.toArray())).toBeLessThan(1e-12);
        expect(quatAngle([0, 0, 0, 1], q)).toBeCloseTo(Math.abs(theta), 12);
      }),
    );
  });

  it('angle between orientations is the relative rotation angle and ignores the quaternion sign', () => {
    fc.assert(
      fc.property(unitQuat, vec3(1), fc.double({ min: 0, max: Math.PI, noNaN: true }), (a, axis, theta) => {
        fc.pre(Math.hypot(...axis) > 1e-3);
        const b = quatMultiply(a, quatFromAxisAngle(axis, theta));
        const negB: [number, number, number, number] = [-b[0], -b[1], -b[2], -b[3]];
        expect(quatAngle(a, b)).toBeCloseTo(theta, 12);
        expect(quatAngle(a, negB)).toBeCloseTo(theta, 12);
        // three.js uses 2·acos(|dot|), which loses precision near 0, hence the looser bound.
        expect(Math.abs(quatAngle(a, b) - three(a).angleTo(three(b)))).toBeLessThan(1e-7);
      }),
    );
  });

  it('ensureHemisphere keeps the rotation and makes the dot product non-negative', () => {
    fc.assert(
      fc.property(unitQuat, unitQuat, (prev, q) => {
        const out = quatEnsureHemisphere(prev, q);
        expect(quatDot(prev, out)).toBeGreaterThanOrEqual(0);
        expect(quatDistance(out, q)).toBeLessThan(1e-15);
      }),
    );
  });

  it('shortest arc maps the direction of `from` onto `to`, including opposite vectors', () => {
    const direction = (v: readonly number[]): number[] => v.map((x) => x / Math.hypot(...v));
    fc.assert(
      fc.property(vec3(3), vec3(3), (from, to) => {
        fc.pre(Math.hypot(...from) > 1e-3 && Math.hypot(...to) > 1e-3);
        const mapped = quatRotateVec3(quatShortestArc(from, to), from);
        // Nearly opposite vectors are ill-conditioned for a minimal arc; the direction error stays below 1e-7.
        expect(maxAbsDiff(direction(mapped), direction(to))).toBeLessThan(1e-7);
      }),
    );
    const flip = quatShortestArc([1, 2, 3], [-2, -4, -6]);
    expect(maxAbsDiff(quatRotateVec3(flip, [1, 2, 3]), [-1, -2, -3])).toBeLessThan(1e-12);
    expect(quatShortestArc([0, 0, 0], [1, 0, 0])).toEqual([0, 0, 0, 1]);
  });

  it('shortest arc matches three.js setFromUnitVectors outside its opposite-vector snap zone', () => {
    fc.assert(
      fc.property(vec3(3), vec3(3), (from, to) => {
        fc.pre(Math.hypot(...from) > 1e-3 && Math.hypot(...to) > 1e-3);
        const unitFrom = new Vector3(...from).normalize();
        const unitTo = new Vector3(...to).normalize();
        // three.js snaps nearly opposite vectors (1 + cos θ < 1e-8) to an exact π turn.
        fc.pre(unitFrom.dot(unitTo) + 1 > 1e-6);
        const expected = new Quaternion().setFromUnitVectors(unitFrom, unitTo);
        expect(quatDistance(quatShortestArc(from, to), arr(expected))).toBeLessThan(1e-9);
      }),
    );
  });
});
