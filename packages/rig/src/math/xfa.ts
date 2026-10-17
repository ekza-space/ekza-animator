import type { Mat4, ReadonlyXf, Xf } from '@ekza-animator/anim-core';

// Structure-of-arrays similarity transforms (t, q, s) used by the kernel and the solvers. Element `i` occupies
// t[3i..3i+2], q[4i..4i+3] (x, y, z, w) and s[3i..3i+2]. Composition follows research 07 §1.2 and anim-core `xf`:
// `a·b = (t_a + q_a ⊗ (s_a ∘ t_b), q_a·q_b, s_a ∘ s_b)`, exact for uniform scale (humanoid rigs) and an
// approximation of the matrix product otherwise (the compiler warns about non-uniform scale).
// Every function reads all of its inputs before writing, so the output may alias an input element.

export interface XfArrays {
  readonly t: Float64Array;
  readonly q: Float64Array;
  readonly s: Float64Array;
}

export function allocXfArrays(count: number): XfArrays {
  const xf: XfArrays = {
    t: new Float64Array(count * 3),
    q: new Float64Array(count * 4),
    s: new Float64Array(count * 3),
  };
  for (let i = 0; i < count; i++) {
    xf.q[i * 4 + 3] = 1;
    xf.s[i * 3] = 1;
    xf.s[i * 3 + 1] = 1;
    xf.s[i * 3 + 2] = 1;
  }
  return xf;
}

/** Writes an object transform into element `i`; the rotation is normalized (zero quaternion → identity). */
export function xfaSet(o: XfArrays, i: number, xf: ReadonlyXf): void {
  o.t[i * 3] = xf.t[0];
  o.t[i * 3 + 1] = xf.t[1];
  o.t[i * 3 + 2] = xf.t[2];
  const x = xf.q[0];
  const y = xf.q[1];
  const z = xf.q[2];
  const w = xf.q[3];
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (len === 0 || !Number.isFinite(len)) {
    o.q[i * 4] = 0;
    o.q[i * 4 + 1] = 0;
    o.q[i * 4 + 2] = 0;
    o.q[i * 4 + 3] = 1;
  } else {
    o.q[i * 4] = x / len;
    o.q[i * 4 + 1] = y / len;
    o.q[i * 4 + 2] = z / len;
    o.q[i * 4 + 3] = w / len;
  }
  o.s[i * 3] = xf.s[0];
  o.s[i * 3 + 1] = xf.s[1];
  o.s[i * 3 + 2] = xf.s[2];
}

/** Element `i` as a fresh object transform. */
export function xfaGet(a: XfArrays, i: number): Xf {
  return {
    t: [a.t[i * 3] as number, a.t[i * 3 + 1] as number, a.t[i * 3 + 2] as number],
    q: [a.q[i * 4] as number, a.q[i * 4 + 1] as number, a.q[i * 4 + 2] as number, a.q[i * 4 + 3] as number],
    s: [a.s[i * 3] as number, a.s[i * 3 + 1] as number, a.s[i * 3 + 2] as number],
  };
}

export function xfaCopy(a: XfArrays, ai: number, o: XfArrays, oi: number): void {
  o.t[oi * 3] = a.t[ai * 3] as number;
  o.t[oi * 3 + 1] = a.t[ai * 3 + 1] as number;
  o.t[oi * 3 + 2] = a.t[ai * 3 + 2] as number;
  o.q[oi * 4] = a.q[ai * 4] as number;
  o.q[oi * 4 + 1] = a.q[ai * 4 + 1] as number;
  o.q[oi * 4 + 2] = a.q[ai * 4 + 2] as number;
  o.q[oi * 4 + 3] = a.q[ai * 4 + 3] as number;
  o.s[oi * 3] = a.s[ai * 3] as number;
  o.s[oi * 3 + 1] = a.s[ai * 3 + 1] as number;
  o.s[oi * 3 + 2] = a.s[ai * 3 + 2] as number;
}

export function xfaIdentity(o: XfArrays, i: number): void {
  o.t[i * 3] = 0;
  o.t[i * 3 + 1] = 0;
  o.t[i * 3 + 2] = 0;
  o.q[i * 4] = 0;
  o.q[i * 4 + 1] = 0;
  o.q[i * 4 + 2] = 0;
  o.q[i * 4 + 3] = 1;
  o.s[i * 3] = 1;
  o.s[i * 3 + 1] = 1;
  o.s[i * 3 + 2] = 1;
}

/** `o[oi] = a[ai] · b[bi]` (`b` applied first). The rotation is renormalized to stop drift along long chains. */
export function xfaMul(a: XfArrays, ai: number, b: XfArrays, bi: number, o: XfArrays, oi: number): void {
  const at = a.t;
  const aq = a.q;
  const as = a.s;
  const a3 = ai * 3;
  const a4 = ai * 4;
  const b3 = bi * 3;
  const b4 = bi * 4;
  const qx = aq[a4] as number;
  const qy = aq[a4 + 1] as number;
  const qz = aq[a4 + 2] as number;
  const qw = aq[a4 + 3] as number;
  const asx = as[a3] as number;
  const asy = as[a3 + 1] as number;
  const asz = as[a3 + 2] as number;
  const vx = asx * (b.t[b3] as number);
  const vy = asy * (b.t[b3 + 1] as number);
  const vz = asz * (b.t[b3 + 2] as number);
  const bqx = b.q[b4] as number;
  const bqy = b.q[b4 + 1] as number;
  const bqz = b.q[b4 + 2] as number;
  const bqw = b.q[b4 + 3] as number;
  const bsx = b.s[b3] as number;
  const bsy = b.s[b3 + 1] as number;
  const bsz = b.s[b3 + 2] as number;
  const atx = at[a3] as number;
  const aty = at[a3 + 1] as number;
  const atz = at[a3 + 2] as number;
  // v rotated by q (see anim-core quatRotateVec3).
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  const o3 = oi * 3;
  const o4 = oi * 4;
  o.t[o3] = atx + vx + qw * tx + (qy * tz - qz * ty);
  o.t[o3 + 1] = aty + vy + qw * ty + (qz * tx - qx * tz);
  o.t[o3 + 2] = atz + vz + qw * tz + (qx * ty - qy * tx);
  const rx = qx * bqw + qw * bqx + qy * bqz - qz * bqy;
  const ry = qy * bqw + qw * bqy + qz * bqx - qx * bqz;
  const rz = qz * bqw + qw * bqz + qx * bqy - qy * bqx;
  const rw = qw * bqw - qx * bqx - qy * bqy - qz * bqz;
  const inv = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
  o.q[o4] = rx * inv;
  o.q[o4 + 1] = ry * inv;
  o.q[o4 + 2] = rz * inv;
  o.q[o4 + 3] = rw * inv;
  o.s[o3] = asx * bsx;
  o.s[o3 + 1] = asy * bsy;
  o.s[o3 + 2] = asz * bsz;
}

/** `o[oi] = a[ai]⁻¹ · b[bi]`. */
export function xfaInvMul(a: XfArrays, ai: number, b: XfArrays, bi: number, o: XfArrays, oi: number): void {
  const a3 = ai * 3;
  const a4 = ai * 4;
  const b3 = bi * 3;
  const b4 = bi * 4;
  // a⁻¹ = (−s⁻¹ ∘ (q⁻¹ ⊗ t), q⁻¹, s⁻¹), so a⁻¹·b = (s⁻¹ ∘ (q⁻¹ ⊗ (t_b − t_a)), q⁻¹·q_b, s⁻¹ ∘ s_b).
  const qx = -(a.q[a4] as number);
  const qy = -(a.q[a4 + 1] as number);
  const qz = -(a.q[a4 + 2] as number);
  const qw = a.q[a4 + 3] as number;
  const isx = 1 / (a.s[a3] as number);
  const isy = 1 / (a.s[a3 + 1] as number);
  const isz = 1 / (a.s[a3 + 2] as number);
  const vx = (b.t[b3] as number) - (a.t[a3] as number);
  const vy = (b.t[b3 + 1] as number) - (a.t[a3 + 1] as number);
  const vz = (b.t[b3 + 2] as number) - (a.t[a3 + 2] as number);
  const bqx = b.q[b4] as number;
  const bqy = b.q[b4 + 1] as number;
  const bqz = b.q[b4 + 2] as number;
  const bqw = b.q[b4 + 3] as number;
  const bsx = b.s[b3] as number;
  const bsy = b.s[b3 + 1] as number;
  const bsz = b.s[b3 + 2] as number;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  const o3 = oi * 3;
  const o4 = oi * 4;
  o.t[o3] = (vx + qw * tx + (qy * tz - qz * ty)) * isx;
  o.t[o3 + 1] = (vy + qw * ty + (qz * tx - qx * tz)) * isy;
  o.t[o3 + 2] = (vz + qw * tz + (qx * ty - qy * tx)) * isz;
  const rx = qx * bqw + qw * bqx + qy * bqz - qz * bqy;
  const ry = qy * bqw + qw * bqy + qz * bqx - qx * bqz;
  const rz = qz * bqw + qw * bqz + qx * bqy - qy * bqx;
  const rw = qw * bqw - qx * bqx - qy * bqy - qz * bqz;
  const inv = 1 / Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw);
  o.q[o4] = rx * inv;
  o.q[o4 + 1] = ry * inv;
  o.q[o4 + 2] = rz * inv;
  o.q[o4 + 3] = rw * inv;
  o.s[o3] = isx * bsx;
  o.s[o3 + 1] = isy * bsy;
  o.s[o3 + 2] = isz * bsz;
}

/** `o[oi] = a[ai] · b[bi]⁻¹`. */
export function xfaMulInv(a: XfArrays, ai: number, b: XfArrays, bi: number, o: XfArrays, oi: number): void {
  const b3 = bi * 3;
  const b4 = bi * 4;
  // b⁻¹ = (−s⁻¹ ∘ (q⁻¹ ⊗ t), q⁻¹, s⁻¹); computed into the scratch element and multiplied.
  const qx = -(b.q[b4] as number);
  const qy = -(b.q[b4 + 1] as number);
  const qz = -(b.q[b4 + 2] as number);
  const qw = b.q[b4 + 3] as number;
  const isx = 1 / (b.s[b3] as number);
  const isy = 1 / (b.s[b3 + 1] as number);
  const isz = 1 / (b.s[b3 + 2] as number);
  const vx = -(b.t[b3] as number);
  const vy = -(b.t[b3 + 1] as number);
  const vz = -(b.t[b3 + 2] as number);
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  const s = INVERSE_SCRATCH;
  s.t[0] = (vx + qw * tx + (qy * tz - qz * ty)) * isx;
  s.t[1] = (vy + qw * ty + (qz * tx - qx * tz)) * isy;
  s.t[2] = (vz + qw * tz + (qx * ty - qy * tx)) * isz;
  s.q[0] = qx;
  s.q[1] = qy;
  s.q[2] = qz;
  s.q[3] = qw;
  s.s[0] = isx;
  s.s[1] = isy;
  s.s[2] = isz;
  xfaMul(a, ai, s, 0, o, oi);
}

const INVERSE_SCRATCH: XfArrays = allocXfArrays(1);

/** Column-major T·R·S of element `i` into `out[offset .. offset + 15]` (three.js `Matrix4.compose`). */
export function xfaToMat4(a: XfArrays, i: number, out: Float64Array, offset: number): void {
  const x = a.q[i * 4] as number;
  const y = a.q[i * 4 + 1] as number;
  const z = a.q[i * 4 + 2] as number;
  const w = a.q[i * 4 + 3] as number;
  const sx = a.s[i * 3] as number;
  const sy = a.s[i * 3 + 1] as number;
  const sz = a.s[i * 3 + 2] as number;
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
  out[offset] = (1 - (yy + zz)) * sx;
  out[offset + 1] = (xy + wz) * sx;
  out[offset + 2] = (xz - wy) * sx;
  out[offset + 3] = 0;
  out[offset + 4] = (xy - wz) * sy;
  out[offset + 5] = (1 - (xx + zz)) * sy;
  out[offset + 6] = (yz + wx) * sy;
  out[offset + 7] = 0;
  out[offset + 8] = (xz + wy) * sz;
  out[offset + 9] = (yz - wx) * sz;
  out[offset + 10] = (1 - (xx + yy)) * sz;
  out[offset + 11] = 0;
  out[offset + 12] = a.t[i * 3] as number;
  out[offset + 13] = a.t[i * 3 + 1] as number;
  out[offset + 14] = a.t[i * 3 + 2] as number;
  out[offset + 15] = 1;
}

/**
 * Decomposes the affine matrix at `m[offset ..]` into element `i` (shear dropped, negative determinant flips the X
 * scale, as anim-core `mat4Decompose`).
 */
export function xfaFromMat4(m: Mat4 | Float64Array, offset: number, o: XfArrays, i: number): void {
  const m00 = m[offset] as number;
  const m10 = m[offset + 1] as number;
  const m20 = m[offset + 2] as number;
  const m01 = m[offset + 4] as number;
  const m11 = m[offset + 5] as number;
  const m21 = m[offset + 6] as number;
  const m02 = m[offset + 8] as number;
  const m12 = m[offset + 9] as number;
  const m22 = m[offset + 10] as number;
  let sx = Math.hypot(m00, m10, m20);
  const sy = Math.hypot(m01, m11, m21);
  const sz = Math.hypot(m02, m12, m22);
  const det = m00 * (m11 * m22 - m21 * m12) - m01 * (m10 * m22 - m20 * m12) + m02 * (m10 * m21 - m20 * m11);
  if (det < 0) sx = -sx;
  o.t[i * 3] = m[offset + 12] as number;
  o.t[i * 3 + 1] = m[offset + 13] as number;
  o.t[i * 3 + 2] = m[offset + 14] as number;
  o.s[i * 3] = sx;
  o.s[i * 3 + 1] = sy;
  o.s[i * 3 + 2] = sz;
  const q4 = i * 4;
  if (sx === 0 || sy === 0 || sz === 0) {
    o.q[q4] = 0;
    o.q[q4 + 1] = 0;
    o.q[q4 + 2] = 0;
    o.q[q4 + 3] = 1;
    return;
  }
  const r00 = m00 / sx;
  const r10 = m10 / sx;
  const r20 = m20 / sx;
  const r01 = m01 / sy;
  const r11 = m11 / sy;
  const r21 = m21 / sy;
  const r02 = m02 / sz;
  const r12 = m12 / sz;
  const r22 = m22 / sz;
  const trace = r00 + r11 + r22;
  let qx: number;
  let qy: number;
  let qz: number;
  let qw: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s;
    qx = (r21 - r12) * s;
    qy = (r02 - r20) * s;
    qz = (r10 - r01) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    qw = (r21 - r12) / s;
    qx = 0.25 * s;
    qy = (r01 + r10) / s;
    qz = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    qw = (r02 - r20) / s;
    qx = (r01 + r10) / s;
    qy = 0.25 * s;
    qz = (r12 + r21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
    qw = (r10 - r01) / s;
    qx = (r02 + r20) / s;
    qy = (r12 + r21) / s;
    qz = 0.25 * s;
  }
  const len = Math.hypot(qx, qy, qz, qw);
  o.q[q4] = qx / len;
  o.q[q4 + 1] = qy / len;
  o.q[q4 + 2] = qz / len;
  o.q[q4 + 3] = qw / len;
}

/** Flips the quaternion of element `i` into the hemisphere of `ref[ri]` (dot ≥ 0). */
export function xfaAlignQuat(a: XfArrays, i: number, ref: Float64Array, ri: number): void {
  const q4 = i * 4;
  const r4 = ri * 4;
  const dot =
    (a.q[q4] as number) * (ref[r4] as number) +
    (a.q[q4 + 1] as number) * (ref[r4 + 1] as number) +
    (a.q[q4 + 2] as number) * (ref[r4 + 2] as number) +
    (a.q[q4 + 3] as number) * (ref[r4 + 3] as number);
  if (dot < 0) {
    a.q[q4] = -(a.q[q4] as number);
    a.q[q4 + 1] = -(a.q[q4 + 1] as number);
    a.q[q4 + 2] = -(a.q[q4 + 2] as number);
    a.q[q4 + 3] = -(a.q[q4 + 3] as number);
  }
}
