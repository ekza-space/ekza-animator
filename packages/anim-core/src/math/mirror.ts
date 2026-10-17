import type { Quat, ReadonlyQuat, ReadonlyVec3, Vec3 } from '../types';

// Reflections across the character's YZ plane (x → −x) and the π yaw between VRM 0.x and canonical space.
// Each is an involution; `out` may alias the input.

/** Reflects a rotation across the YZ plane: (x, −y, −z, w) (research 07 §16.1). */
export function mirrorQuatYZ(q: ReadonlyQuat, out: Quat = [0, 0, 0, 1]): Quat {
  out[0] = q[0];
  out[1] = -q[1];
  out[2] = -q[2];
  out[3] = q[3];
  return out;
}

/** Reflects a position across the YZ plane: (−x, y, z). */
export function mirrorVec3YZ(v: ReadonlyVec3, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = -v[0];
  out[1] = v[1];
  out[2] = v[2];
  return out;
}

/** Conjugates a rotation by a π yaw: (−x, y, −z, w). Maps VRM 0.x file space ↔ canonical space. */
export function flipYawQuat(q: ReadonlyQuat, out: Quat = [0, 0, 0, 1]): Quat {
  out[0] = -q[0];
  out[1] = q[1];
  out[2] = -q[2];
  out[3] = q[3];
  return out;
}

/** Rotates a position by a π yaw: (−x, y, −z). */
export function flipYawVec3(v: ReadonlyVec3, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = -v[0];
  out[1] = v[1];
  out[2] = -v[2];
  return out;
}
