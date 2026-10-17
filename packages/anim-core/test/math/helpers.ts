import fc from 'fast-check';
import type { Quat, ReadonlyQuat, RotateOrder, Vec3 } from '../../src';

export const ROTATE_ORDERS: readonly RotateOrder[] = ['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx'];

export const angle = (limit = Math.PI): fc.Arbitrary<number> =>
  fc.double({ min: -limit, max: limit, noNaN: true, noDefaultInfinity: true });

export const vec3 = (limit = 10): fc.Arbitrary<Vec3> => fc.tuple(angle(limit), angle(limit), angle(limit));

/** Uniformly distributed unit quaternions (normalized Gaussian-like samples, rejecting tiny norms). */
export const unitQuat: fc.Arbitrary<Quat> = fc
  .tuple(angle(1), angle(1), angle(1), angle(1))
  .filter(([x, y, z, w]) => Math.hypot(x, y, z, w) > 0.1)
  .map(([x, y, z, w]) => {
    const n = Math.hypot(x, y, z, w);
    return [x / n, y / n, z / n, w / n] as Quat;
  });

/** Max component difference after aligning hemispheres: q and −q are the same rotation. */
export function quatDistance(a: ReadonlyQuat, b: ReadonlyQuat): number {
  const sign = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  return Math.max(
    Math.abs(a[0] - sign * b[0]),
    Math.abs(a[1] - sign * b[1]),
    Math.abs(a[2] - sign * b[2]),
    Math.abs(a[3] - sign * b[3]),
  );
}

/** Angle difference folded into [−π, π]. */
export function angleDiff(a: number, b: number): number {
  const d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) return d - 2 * Math.PI;
  if (d < -Math.PI) return d + 2 * Math.PI;
  return d;
}

export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs((a[i] as number) - (b[i] as number)));
  return max;
}
