// Small float64 linear algebra for `mesh.transformComponents`: row-major 3×3 matrices and 3×4 affines
// ([L | t], p ↦ L·p + t), quaternions in anim-core order [x, y, z, w].
import { kernelError } from '../../kernel';

export type M3 = Float64Array; // 9, row-major
export type A34 = Float64Array; // 12, row-major [L | t]

export function m3(): M3 {
  return Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
}

export function m3Mul(a: M3, b: M3): M3 {
  const out = new Float64Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[3 * i + j] =
        (a[3 * i] as number) * (b[j] as number) +
        (a[3 * i + 1] as number) * (b[3 + j] as number) +
        (a[3 * i + 2] as number) * (b[6 + j] as number);
    }
  }
  return out;
}

export function m3Transpose(a: M3): M3 {
  return Float64Array.of(
    a[0] as number,
    a[3] as number,
    a[6] as number,
    a[1] as number,
    a[4] as number,
    a[7] as number,
    a[2] as number,
    a[5] as number,
    a[8] as number,
  );
}

export function m3Vec(a: M3, x: number, y: number, z: number): [number, number, number] {
  return [
    (a[0] as number) * x + (a[1] as number) * y + (a[2] as number) * z,
    (a[3] as number) * x + (a[4] as number) * y + (a[5] as number) * z,
    (a[6] as number) * x + (a[7] as number) * y + (a[8] as number) * z,
  ];
}

/** Rotation of a unit quaternion [x, y, z, w] (normalized first; identity when degenerate). */
export function m3FromQuat(q: readonly number[]): M3 {
  let [x, y, z, w] = [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1];
  const len = Math.hypot(x, y, z, w);
  if (!(len > 0) || !Number.isFinite(len)) [x, y, z, w] = [0, 0, 0, 1];
  else [x, y, z, w] = [x / len, y / len, z / len, w / len];
  return Float64Array.of(
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  );
}

/** The quaternion of a rotation matrix (Shepperd's method), w ≥ 0. */
export function quatFromM3(r: M3): [number, number, number, number] {
  const m00 = r[0] as number;
  const m01 = r[1] as number;
  const m02 = r[2] as number;
  const m10 = r[3] as number;
  const m11 = r[4] as number;
  const m12 = r[5] as number;
  const m20 = r[6] as number;
  const m21 = r[7] as number;
  const m22 = r[8] as number;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const len = Math.hypot(x, y, z, w);
  const sign = w < 0 ? -1 : 1;
  return [(sign * x) / len, (sign * y) / len, (sign * z) / len, (sign * w) / len];
}

/** R = Rz·Ry·Rx (rotate order xyz, as the extrude frame of §5.8). */
export function m3EulerXyz(rx: number, ry: number, rz: number): M3 {
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)];
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)];
  const [cz, sz] = [Math.cos(rz), Math.sin(rz)];
  const X = Float64Array.of(1, 0, 0, 0, cx, -sx, 0, sx, cx);
  const Y = Float64Array.of(cy, 0, sy, 0, 1, 0, -sy, 0, cy);
  const Z = Float64Array.of(cz, -sz, 0, sz, cz, 0, 0, 0, 1);
  return m3Mul(Z, m3Mul(Y, X));
}

export function m3Diag(x: number, y: number, z: number): M3 {
  return Float64Array.of(x, 0, 0, 0, y, 0, 0, 0, z);
}

/** Inverse of a 3×3 matrix; throws `invalid-argument` when singular. */
export function m3Invert(a: M3): M3 {
  const at = (i: number): number => a[i] as number;
  const c00 = at(4) * at(8) - at(5) * at(7);
  const c01 = at(5) * at(6) - at(3) * at(8);
  const c02 = at(3) * at(7) - at(4) * at(6);
  const det = at(0) * c00 + at(1) * c01 + at(2) * c02;
  if (!(Math.abs(det) > 0) || !Number.isFinite(det)) throw kernelError('invalid-argument', 'singular placement matrix');
  const inv = 1 / det;
  return Float64Array.of(
    c00 * inv,
    (at(2) * at(7) - at(1) * at(8)) * inv,
    (at(1) * at(5) - at(2) * at(4)) * inv,
    c01 * inv,
    (at(0) * at(8) - at(2) * at(6)) * inv,
    (at(2) * at(3) - at(0) * at(5)) * inv,
    c02 * inv,
    (at(1) * at(6) - at(0) * at(7)) * inv,
    (at(0) * at(4) - at(1) * at(3)) * inv,
  );
}

/** Affine [L | t]. */
export function a34(l: M3, t: readonly [number, number, number]): A34 {
  return Float64Array.of(
    l[0] as number,
    l[1] as number,
    l[2] as number,
    t[0],
    l[3] as number,
    l[4] as number,
    l[5] as number,
    t[1],
    l[6] as number,
    l[7] as number,
    l[8] as number,
    t[2],
  );
}

export function a34Linear(a: A34): M3 {
  return Float64Array.of(
    a[0] as number,
    a[1] as number,
    a[2] as number,
    a[4] as number,
    a[5] as number,
    a[6] as number,
    a[8] as number,
    a[9] as number,
    a[10] as number,
  );
}

export function a34Translation(a: A34): [number, number, number] {
  return [a[3] as number, a[7] as number, a[11] as number];
}

/** a ∘ b (apply b first). */
export function a34Mul(a: A34, b: A34): A34 {
  const l = m3Mul(a34Linear(a), a34Linear(b));
  const [bx, by, bz] = a34Translation(b);
  const t = a34Point(a, bx, by, bz);
  return a34(l, t);
}

export function a34Point(a: A34, x: number, y: number, z: number): [number, number, number] {
  return [
    (a[0] as number) * x + (a[1] as number) * y + (a[2] as number) * z + (a[3] as number),
    (a[4] as number) * x + (a[5] as number) * y + (a[6] as number) * z + (a[7] as number),
    (a[8] as number) * x + (a[9] as number) * y + (a[10] as number) * z + (a[11] as number),
  ];
}

export function a34Invert(a: A34): A34 {
  const li = m3Invert(a34Linear(a));
  const [tx, ty, tz] = a34Translation(a);
  const [x, y, z] = m3Vec(li, tx, ty, tz);
  return a34(li, [-x, -y, -z]);
}
