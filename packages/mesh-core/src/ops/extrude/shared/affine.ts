// Affine maps of mesh-local points (row-major 3×3 linear part + translation), float64. Used by the extrude cap
// transform (§5.8 step 5), its mirror conjugation (§5.14: the partner region's transform is S ∘ T ∘ S) and the
// world-space variant (args in world axes, positions in mesh-local coordinates).
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import type { V3 } from './util';

export interface Affine {
  /** Row-major 3×3. */
  readonly m: readonly number[];
  readonly t: readonly [number, number, number];
}

export const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

export function apply(a: Affine, p: Readonly<V3>): V3 {
  const m = a.m;
  return [
    (m[0] as number) * p[0] + (m[1] as number) * p[1] + (m[2] as number) * p[2] + a.t[0],
    (m[3] as number) * p[0] + (m[4] as number) * p[1] + (m[5] as number) * p[2] + a.t[1],
    (m[6] as number) * p[0] + (m[7] as number) * p[1] + (m[8] as number) * p[2] + a.t[2],
  ];
}

export function applyDir(a: Affine, d: Readonly<V3>): V3 {
  const m = a.m;
  return [
    (m[0] as number) * d[0] + (m[1] as number) * d[1] + (m[2] as number) * d[2],
    (m[3] as number) * d[0] + (m[4] as number) * d[1] + (m[5] as number) * d[2],
    (m[6] as number) * d[0] + (m[7] as number) * d[1] + (m[8] as number) * d[2],
  ];
}

export function mul3(a: readonly number[], b: readonly number[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let k = 0; k < 3; k++) acc += (a[3 * r + k] as number) * (b[3 * k + c] as number);
      out[3 * r + c] = acc;
    }
  }
  return out;
}

/** a ∘ b (apply b first). */
export function compose(a: Affine, b: Affine): Affine {
  const t = apply(a, b.t);
  return { m: mul3(a.m, b.m), t };
}

export function inverse3(m: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-300) || !Number.isFinite(det)) return null;
  const s = 1 / det;
  return [
    A * s,
    -(b * i - c * h) * s,
    (b * f - c * e) * s,
    B * s,
    (a * i - c * g) * s,
    -(a * f - c * d) * s,
    C * s,
    -(a * h - b * g) * s,
    (a * e - b * d) * s,
  ];
}

export function invert(a: Affine): Affine | null {
  const m = inverse3(a.m);
  if (m === null) return null;
  const t = applyDir({ m, t: [0, 0, 0] }, a.t);
  return { m, t: [-t[0], -t[1], -t[2]] };
}

/** Columns X, Y, Z as a row-major matrix (frame → mesh). */
export function fromColumns(x: Readonly<V3>, y: Readonly<V3>, z: Readonly<V3>): number[] {
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

export function transpose3(m: readonly number[]): number[] {
  return [
    m[0] as number,
    m[3] as number,
    m[6] as number,
    m[1] as number,
    m[4] as number,
    m[7] as number,
    m[2] as number,
    m[5] as number,
    m[8] as number,
  ];
}

/** R = Rz·Ry·Rx (rotate order xyz: x first), radians. */
export function rotationXYZ(rx: number, ry: number, rz: number): number[] {
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)];
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)];
  const [cz, sz] = [Math.cos(rz), Math.sin(rz)];
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Rz, mul3(Ry, Rx));
}

/** The placement as an affine map (world from mesh-local): t + Q·S·p. */
export function placementAffine(xf: ReadonlyXf): Affine {
  const [qx, qy, qz, qw] = xf.q;
  const R = [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy - qz * qw),
    2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw),
    2 * (qy * qz + qx * qw),
    1 - 2 * (qx * qx + qy * qy),
  ];
  const s = xf.s;
  const m = R.map((value, i) => value * (s[i % 3] as number));
  return { m, t: [xf.t[0], xf.t[1], xf.t[2]] };
}
