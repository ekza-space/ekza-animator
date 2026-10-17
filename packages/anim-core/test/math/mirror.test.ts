import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEG2RAD,
  flipYawQuat,
  flipYawVec3,
  mat4Compose,
  mat4Multiply,
  mirrorQuatYZ,
  mirrorVec3YZ,
  quatFromAxisAngle,
  quatMultiply,
  quatRotateVec3,
  RAD2DEG,
} from '../../src';
import { maxAbsDiff, quatDistance, unitQuat, vec3 } from './helpers';

const MIRROR_X = Float64Array.from([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

describe('mirror and flip-yaw helpers', () => {
  it('are involutions', () => {
    fc.assert(
      fc.property(unitQuat, vec3(10), (q, v) => {
        expect(mirrorQuatYZ(mirrorQuatYZ(q))).toEqual(q);
        expect(flipYawQuat(flipYawQuat(q))).toEqual(q);
        expect(mirrorVec3YZ(mirrorVec3YZ(v))).toEqual(v);
        expect(flipYawVec3(flipYawVec3(v))).toEqual(v);
      }),
    );
  });

  it('mirrorQuatYZ is the reflection M·R·M with M = diag(−1, 1, 1) (research 07 §16.1)', () => {
    fc.assert(
      fc.property(unitQuat, (q) => {
        const reflected = mat4Multiply(
          mat4Multiply(MIRROR_X, mat4Compose({ t: [0, 0, 0], q, s: [1, 1, 1] })),
          MIRROR_X,
        );
        const mirrored = mat4Compose({ t: [0, 0, 0], q: mirrorQuatYZ(q), s: [1, 1, 1] });
        expect(maxAbsDiff(mirrored, reflected)).toBeLessThan(1e-14);
      }),
    );
  });

  it('flipYaw is conjugation by a π rotation about +Y', () => {
    const yaw = quatFromAxisAngle([0, 1, 0], Math.PI);
    const yawInv: [number, number, number, number] = [-yaw[0], -yaw[1], -yaw[2], yaw[3]];
    fc.assert(
      fc.property(unitQuat, vec3(10), (q, v) => {
        expect(quatDistance(flipYawQuat(q), quatMultiply(quatMultiply(yaw, q), yawInv))).toBeLessThan(1e-15);
        expect(maxAbsDiff(flipYawVec3(v), quatRotateVec3(yaw, v))).toBeLessThan(1e-14);
      }),
    );
  });

  it('degree conversion constants', () => {
    expect(180 * DEG2RAD).toBe(Math.PI);
    expect(Math.PI * RAD2DEG).toBe(180);
  });
});
