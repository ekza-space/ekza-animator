import type { Quat, ReadonlyQuat, ReadonlyVec3, Vec3 } from '../types';

// Quaternions are [x, y, z, w] (glTF/three order). Products follow three.js: `a·b` applies `b` first.
// Every function that takes `out` reads all inputs before writing, so `out` may alias an input.

/** Hamilton product `a·b` (`b` is applied first), equal to three.js `a.clone().multiply(b)`. */
export function quatMultiply(a: ReadonlyQuat, b: ReadonlyQuat, out: Quat = [0, 0, 0, 1]): Quat {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  out[0] = ax * bw + aw * bx + ay * bz - az * by;
  out[1] = ay * bw + aw * by + az * bx - ax * bz;
  out[2] = az * bw + aw * bz + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Multiplicative inverse (conjugate divided by the squared norm). The zero quaternion maps to identity. */
export function quatInvert(q: ReadonlyQuat, out: Quat = [0, 0, 0, 1]): Quat {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const lenSq = x * x + y * y + z * z + w * w;
  if (lenSq === 0) return setIdentity(out);
  const inv = 1 / lenSq;
  out[0] = -x * inv;
  out[1] = -y * inv;
  out[2] = -z * inv;
  out[3] = w * inv;
  return out;
}

/** Unit quaternion with the same rotation. The zero quaternion maps to identity. */
export function quatNormalize(q: ReadonlyQuat, out: Quat = [0, 0, 0, 1]): Quat {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (len === 0) return setIdentity(out);
  const inv = 1 / len;
  out[0] = x * inv;
  out[1] = y * inv;
  out[2] = z * inv;
  out[3] = w * inv;
  return out;
}

export function quatDot(a: ReadonlyQuat, b: ReadonlyQuat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Shortest-path spherical interpolation between unit quaternions; the result is normalized. */
export function quatSlerp(a: ReadonlyQuat, b: ReadonlyQuat, t: number, out: Quat = [0, 0, 0, 1]): Quat {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cos = -cos;
  }
  let wa: number;
  let wb: number;
  const sinSq = 1 - cos * cos;
  if (sinSq <= Number.EPSILON) {
    // Nearly identical orientations: linear interpolation is exact to rounding and avoids 0/0.
    wa = 1 - t;
    wb = t;
  } else {
    const sin = Math.sqrt(sinSq);
    const angle = Math.atan2(sin, cos);
    wa = Math.sin((1 - t) * angle) / sin;
    wb = Math.sin(t * angle) / sin;
  }
  out[0] = wa * ax + wb * bx;
  out[1] = wa * ay + wb * by;
  out[2] = wa * az + wb * bz;
  out[3] = wa * aw + wb * bw;
  return quatNormalize(out, out);
}

/** Rotation by `angle` radians about `axis` (normalized here; a zero axis gives identity). */
export function quatFromAxisAngle(axis: ReadonlyVec3, angle: number, out: Quat = [0, 0, 0, 1]): Quat {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len === 0) return setIdentity(out);
  const half = angle * 0.5;
  const s = Math.sin(half) / len;
  out[0] = axis[0] * s;
  out[1] = axis[1] * s;
  out[2] = axis[2] * s;
  out[3] = Math.cos(half);
  return out;
}

/** Rotates `v` by the unit quaternion `q` (`q·v·q⁻¹`). */
export function quatRotateVec3(q: ReadonlyQuat, v: ReadonlyVec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  const vx = v[0];
  const vy = v[1];
  const vz = v[2];
  // t = 2·(q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/** Shortest angle in radians between two orientations (sign of either quaternion ignored), in [0, π]. */
export function quatAngle(a: ReadonlyQuat, b: ReadonlyQuat): number {
  // r = conj(a)·b; atan2 keeps full precision near 0 and π, unlike acos(dot).
  const ax = -a[0];
  const ay = -a[1];
  const az = -a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  const rx = ax * bw + aw * bx + ay * bz - az * by;
  const ry = ay * bw + aw * by + az * bx - ax * bz;
  const rz = az * bw + aw * bz + ax * by - ay * bx;
  const rw = aw * bw - ax * bx - ay * by - az * bz;
  return 2 * Math.atan2(Math.sqrt(rx * rx + ry * ry + rz * rz), Math.abs(rw));
}

/** `q` or `−q`, whichever lies in the same hemisphere as `prev` (dot ≥ 0): sample continuity for tracks. */
export function quatEnsureHemisphere(prev: ReadonlyQuat, q: ReadonlyQuat, out: Quat = [0, 0, 0, 1]): Quat {
  const s = quatDot(prev, q) < 0 ? -1 : 1;
  out[0] = q[0] * s;
  out[1] = q[1] * s;
  out[2] = q[2] * s;
  out[3] = q[3] * s;
  return out;
}

/** Minimal rotation taking the direction of `from` to the direction of `to` (zero vectors give identity). */
export function quatShortestArc(from: ReadonlyVec3, to: ReadonlyVec3, out: Quat = [0, 0, 0, 1]): Quat {
  const fx = from[0];
  const fy = from[1];
  const fz = from[2];
  const tx = to[0];
  const ty = to[1];
  const tz = to[2];
  const lengths = Math.hypot(fx, fy, fz) * Math.hypot(tx, ty, tz);
  if (lengths === 0) return setIdentity(out);
  // (f × t, |f||t| + f·t) = 2|f||t|·cos(θ/2)·(sin(θ/2)·n, cos(θ/2)): normalizing yields the rotation by θ about n.
  const w = lengths + (fx * tx + fy * ty + fz * tz);
  // w = |f||t|(1 + cos θ) carries a rounding error of a few ε·|f||t|. Within that noise the vectors are opposite
  // (θ > π − 4.5e-8) and the axis f × t is meaningless, so any axis perpendicular to `from` is used.
  if (w <= 1e-15 * lengths) {
    if (Math.abs(fx) > Math.abs(fz)) {
      out[0] = -fy;
      out[1] = fx;
      out[2] = 0;
    } else {
      out[0] = 0;
      out[1] = -fz;
      out[2] = fy;
    }
    out[3] = 0;
    return quatNormalize(out, out);
  }
  out[0] = fy * tz - fz * ty;
  out[1] = fz * tx - fx * tz;
  out[2] = fx * ty - fy * tx;
  out[3] = w;
  return quatNormalize(out, out);
}

function setIdentity(out: Quat): Quat {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 1;
  return out;
}
