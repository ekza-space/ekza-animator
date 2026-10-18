import type { Mat4, ReadonlyVec3, ReadonlyXf, Vec3, Xf } from '../types';
import { xfIdentity } from './xf';

// Column-major 4×4 matrices (three.js `Matrix4.elements` layout): element (row r, column c) is m[c * 4 + r].
// Every function that takes `out` reads all inputs before writing, so `out` may alias an input.

export function mat4Identity(out: Mat4 = new Float64Array(16)): Mat4 {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

/** T·R·S from a transform; `xf.q` must be a unit quaternion. */
export function mat4Compose(xf: ReadonlyXf, out: Mat4 = new Float64Array(16)): Mat4 {
  const x = xf.q[0];
  const y = xf.q[1];
  const z = xf.q[2];
  const w = xf.q[3];
  const sx = xf.s[0];
  const sy = xf.s[1];
  const sz = xf.s[2];
  const tx = xf.t[0];
  const ty = xf.t[1];
  const tz = xf.t[2];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = tx;
  out[13] = ty;
  out[14] = tz;
  out[15] = 1;
  return out;
}

/**
 * Translation, rotation and per-axis scale of an affine matrix. Shear is dropped: the rotation is extracted
 * from the scale-normalized columns and renormalized. A negative determinant flips the X scale (three.js
 * convention). A zero scale column leaves the rotation undefined; identity is returned for it.
 */
export function mat4Decompose(m: Mat4, out: Xf = xfIdentity()): Xf {
  const m00 = m[0] as number;
  const m10 = m[1] as number;
  const m20 = m[2] as number;
  const m01 = m[4] as number;
  const m11 = m[5] as number;
  const m21 = m[6] as number;
  const m02 = m[8] as number;
  const m12 = m[9] as number;
  const m22 = m[10] as number;
  let sx = Math.hypot(m00, m10, m20);
  const sy = Math.hypot(m01, m11, m21);
  const sz = Math.hypot(m02, m12, m22);
  const det = m00 * (m11 * m22 - m21 * m12) - m01 * (m10 * m22 - m20 * m12) + m02 * (m10 * m21 - m20 * m11);
  if (det < 0) sx = -sx;

  out.t[0] = m[12] as number;
  out.t[1] = m[13] as number;
  out.t[2] = m[14] as number;
  out.s[0] = sx;
  out.s[1] = sy;
  out.s[2] = sz;

  const q = out.q;
  if (sx === 0 || sy === 0 || sz === 0) {
    q[0] = 0;
    q[1] = 0;
    q[2] = 0;
    q[3] = 1;
    return out;
  }
  const ix = 1 / sx;
  const iy = 1 / sy;
  const iz = 1 / sz;
  // Rotation matrix r_rc with columns divided by their scale.
  const r00 = m00 * ix;
  const r10 = m10 * ix;
  const r20 = m20 * ix;
  const r01 = m01 * iy;
  const r11 = m11 * iy;
  const r21 = m21 * iy;
  const r02 = m02 * iz;
  const r12 = m12 * iz;
  const r22 = m22 * iz;
  // Shepperd's method: branch on the largest diagonal term for numerical stability.
  const trace = r00 + r11 + r22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q[3] = 0.25 / s;
    q[0] = (r21 - r12) * s;
    q[1] = (r02 - r20) * s;
    q[2] = (r10 - r01) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    q[3] = (r21 - r12) / s;
    q[0] = 0.25 * s;
    q[1] = (r01 + r10) / s;
    q[2] = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    q[3] = (r02 - r20) / s;
    q[0] = (r01 + r10) / s;
    q[1] = 0.25 * s;
    q[2] = (r12 + r21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
    q[3] = (r10 - r01) / s;
    q[0] = (r02 + r20) / s;
    q[1] = (r12 + r21) / s;
    q[2] = 0.25 * s;
  }
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  q[0] /= len;
  q[1] /= len;
  q[2] /= len;
  q[3] /= len;
  return out;
}

/** `a·b` (`b` is applied first), equal to three.js `multiplyMatrices(a, b)`. */
export function mat4Multiply(a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  const a00 = a[0] as number;
  const a10 = a[1] as number;
  const a20 = a[2] as number;
  const a30 = a[3] as number;
  const a01 = a[4] as number;
  const a11 = a[5] as number;
  const a21 = a[6] as number;
  const a31 = a[7] as number;
  const a02 = a[8] as number;
  const a12 = a[9] as number;
  const a22 = a[10] as number;
  const a32 = a[11] as number;
  const a03 = a[12] as number;
  const a13 = a[13] as number;
  const a23 = a[14] as number;
  const a33 = a[15] as number;
  for (let c = 0; c < 4; c++) {
    const o = c * 4;
    const b0 = b[o] as number;
    const b1 = b[o + 1] as number;
    const b2 = b[o + 2] as number;
    const b3 = b[o + 3] as number;
    // Column c of b is read before column c of out is written; earlier columns of out no longer matter.
    out[o] = a00 * b0 + a01 * b1 + a02 * b2 + a03 * b3;
    out[o + 1] = a10 * b0 + a11 * b1 + a12 * b2 + a13 * b3;
    out[o + 2] = a20 * b0 + a21 * b1 + a22 * b2 + a23 * b3;
    out[o + 3] = a30 * b0 + a31 * b1 + a32 * b2 + a33 * b3;
  }
  return out;
}

/** General inverse by cofactors; null when the determinant is exactly zero (or not finite). */
export function mat4Invert(m: Mat4, out: Mat4 = new Float64Array(16)): Mat4 | null {
  const n11 = m[0] as number;
  const n21 = m[1] as number;
  const n31 = m[2] as number;
  const n41 = m[3] as number;
  const n12 = m[4] as number;
  const n22 = m[5] as number;
  const n32 = m[6] as number;
  const n42 = m[7] as number;
  const n13 = m[8] as number;
  const n23 = m[9] as number;
  const n33 = m[10] as number;
  const n43 = m[11] as number;
  const n14 = m[12] as number;
  const n24 = m[13] as number;
  const n34 = m[14] as number;
  const n44 = m[15] as number;

  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (det === 0 || !Number.isFinite(det)) return null;
  const d = 1 / det;

  out[0] = t11 * d;
  out[1] =
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
  out[2] =
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
  out[3] =
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
  out[4] = t12 * d;
  out[5] =
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
  out[6] =
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
  out[7] =
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
  out[8] = t13 * d;
  out[9] =
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
  out[10] =
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
  out[11] =
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
  out[12] = t14 * d;
  out[13] =
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
  out[14] =
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
  out[15] =
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
  return out;
}

/** Transforms a point (w = 1) and divides by the resulting w (1 for affine matrices). */
export function mat4TransformPoint(m: Mat4, p: ReadonlyVec3, out: Vec3 = [0, 0, 0]): Vec3 {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  const w = (m[3] as number) * x + (m[7] as number) * y + (m[11] as number) * z + (m[15] as number);
  const iw = 1 / w;
  out[0] = ((m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number)) * iw;
  out[1] = ((m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number)) * iw;
  out[2] = ((m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number)) * iw;
  return out;
}
