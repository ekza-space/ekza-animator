import type { ReadonlyXf, Xf } from '../types';

// Transforms are (t, q, s) = T·R·S. Composition and inversion are exact for uniform scale, which is what
// humanoid rigs use (VRM requires positive uniform node scale); with non-uniform scale the translation stays
// exact but the rotation/scale split is an approximation. `out` may alias an input.

export function xfIdentity(): Xf {
  return { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
}

/** `a·b` (`b` is applied first): (t₁ + q₁ ⊗ (s₁ ∘ t₂), q₁q₂, s₁ ∘ s₂). */
export function xfMultiply(a: ReadonlyXf, b: ReadonlyXf, out: Xf = xfIdentity()): Xf {
  const qx = a.q[0];
  const qy = a.q[1];
  const qz = a.q[2];
  const qw = a.q[3];
  const bqx = b.q[0];
  const bqy = b.q[1];
  const bqz = b.q[2];
  const bqw = b.q[3];
  const atx = a.t[0];
  const aty = a.t[1];
  const atz = a.t[2];
  const asx = a.s[0];
  const asy = a.s[1];
  const asz = a.s[2];
  const bsx = b.s[0];
  const bsy = b.s[1];
  const bsz = b.s[2];
  // v = s₁ ∘ t₂, rotated by q₁ (see quatRotateVec3).
  const vx = asx * b.t[0];
  const vy = asy * b.t[1];
  const vz = asz * b.t[2];
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out.t[0] = atx + vx + qw * tx + (qy * tz - qz * ty);
  out.t[1] = aty + vy + qw * ty + (qz * tx - qx * tz);
  out.t[2] = atz + vz + qw * tz + (qx * ty - qy * tx);
  out.q[0] = qx * bqw + qw * bqx + qy * bqz - qz * bqy;
  out.q[1] = qy * bqw + qw * bqy + qz * bqx - qx * bqz;
  out.q[2] = qz * bqw + qw * bqz + qx * bqy - qy * bqx;
  out.q[3] = qw * bqw - qx * bqx - qy * bqy - qz * bqz;
  out.s[0] = asx * bsx;
  out.s[1] = asy * bsy;
  out.s[2] = asz * bsz;
  return out;
}

/** Inverse of a unit-quaternion transform: (−s⁻¹ ∘ (q⁻¹ ⊗ t), q⁻¹, s⁻¹). */
export function xfInvert(a: ReadonlyXf, out: Xf = xfIdentity()): Xf {
  const qx = -a.q[0];
  const qy = -a.q[1];
  const qz = -a.q[2];
  const qw = a.q[3];
  const isx = 1 / a.s[0];
  const isy = 1 / a.s[1];
  const isz = 1 / a.s[2];
  const vx = -a.t[0];
  const vy = -a.t[1];
  const vz = -a.t[2];
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out.t[0] = (vx + qw * tx + (qy * tz - qz * ty)) * isx;
  out.t[1] = (vy + qw * ty + (qz * tx - qx * tz)) * isy;
  out.t[2] = (vz + qw * tz + (qx * ty - qy * tx)) * isz;
  out.q[0] = qx;
  out.q[1] = qy;
  out.q[2] = qz;
  out.q[3] = qw;
  out.s[0] = isx;
  out.s[1] = isy;
  out.s[2] = isz;
  return out;
}
