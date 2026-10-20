// Affine transforms of mesh data (M6A-SPEC §5.13): `mesh.applyTransform` (Freeze, Bake Pivot), Combine's placement
// change and `appendMesh`. Positions go through the full matrix; vector layers (morph deltas: point f32×3 layers with
// the 'negate-axis' mirror rule) through its linear part; custom normals (`normal.custom`) through the inverse
// transpose, renormalized (an all-zero "no custom normal" value stays zero); a negative determinant reverses every face,
// so a mirrored result still faces outward (§5.13 `appendMesh`, Freeze).
import { type Mat4, mat4Compose, type ReadonlyXf } from '@ekza-animator/anim-core';
import { NORMAL_CUSTOM } from '../layers/builtin';
import type { AttrLayer, EditMesh, LayerDef } from '../types';

/** Column-major 4×4 of a TRS placement. */
export function matrixOf(xf: ReadonlyXf): Mat4 {
  return mat4Compose(xf);
}

/** Determinant of the upper-left 3×3 (column-major). */
export function det3(m: ArrayLike<number>): number {
  const a = m[0] as number;
  const b = m[4] as number;
  const c = m[8] as number;
  const d = m[1] as number;
  const e = m[5] as number;
  const f = m[9] as number;
  const g = m[2] as number;
  const h = m[6] as number;
  const i = m[10] as number;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** The inverse transpose of the upper-left 3×3 as a column-major 3×3, or null when it is singular. */
export function normalMatrix(m: ArrayLike<number>): Float64Array | null {
  const det = det3(m);
  if (!(Math.abs(det) > 0) || !Number.isFinite(det)) return null;
  // Rows r of the 3×3 (row-major view of the column-major input): a b c / d e f / g h i.
  const a = m[0] as number;
  const b = m[4] as number;
  const c = m[8] as number;
  const d = m[1] as number;
  const e = m[5] as number;
  const f = m[9] as number;
  const g = m[2] as number;
  const h = m[6] as number;
  const i = m[10] as number;
  // inverse = adj / det; (inverse)^T = cofactor / det. Cofactor matrix C (row-major):
  const c00 = e * i - f * h;
  const c01 = -(d * i - f * g);
  const c02 = d * h - e * g;
  const c10 = -(b * i - c * h);
  const c11 = a * i - c * g;
  const c12 = -(a * h - b * g);
  const c20 = b * f - c * e;
  const c21 = -(a * f - c * d);
  const c22 = a * e - b * d;
  // Column-major output of C / det.
  return Float64Array.of(
    c00 / det,
    c10 / det,
    c20 / det,
    c01 / det,
    c11 / det,
    c21 / det,
    c02 / det,
    c12 / det,
    c22 / det,
  );
}

export function transformPoint(m: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array): void {
  out[0] = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
  out[1] = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
  out[2] = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
}

export function transformVector(m: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array): void {
  out[0] = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z;
  out[1] = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z;
  out[2] = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z;
}

/** A custom normal through the column-major 3×3 `n`, renormalized; an all-zero value stays zero. */
export function transformNormal(n: ArrayLike<number>, x: number, y: number, z: number, out: Float64Array): void {
  if (x === 0 && y === 0 && z === 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  const nx = (n[0] as number) * x + (n[3] as number) * y + (n[6] as number) * z;
  const ny = (n[1] as number) * x + (n[4] as number) * y + (n[7] as number) * z;
  const nz = (n[2] as number) * x + (n[5] as number) * y + (n[8] as number) * z;
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(length > 0) || !Number.isFinite(length)) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  out[0] = nx / length;
  out[1] = ny / length;
  out[2] = nz / length;
}

/** A point layer holding displacement vectors (morph deltas): transformed by the linear part. */
export function isVectorLayer(def: LayerDef): boolean {
  return def.domain === 'point' && def.type === 'f32' && def.comps >= 3 && def.mirror === 'negate-axis';
}

/** A corner layer holding normals: transformed by the inverse transpose. */
export function isNormalLayer(def: LayerDef): boolean {
  return def.domain === 'corner' && def.type === 'f32' && def.comps >= 3 && def.name === NORMAL_CUSTOM;
}

const OUT = new Float64Array(3);

/**
 * Applies `matrix` to every vertex of `m` (positions, vector layers) and every corner normal, and reverses every face
 * when the determinant is negative. Inside the caller's transaction.
 */
export function applyMatrixToMesh(m: EditMesh, matrix: ArrayLike<number>): void {
  const p = m.position;
  const P = m.counts.points;
  for (let v = 0; v < P; v++) {
    transformPoint(matrix, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number, OUT);
    m.setPosition(v, (OUT[0] as number) + 0, (OUT[1] as number) + 0, (OUT[2] as number) + 0);
  }
  const normals = normalMatrix(matrix);
  for (const layer of m.layers()) {
    if (isVectorLayer(layer.def)) transformLayer(layer, P, (x, y, z) => transformVector(matrix, x, y, z, OUT));
    else if (normals !== null && isNormalLayer(layer.def)) {
      transformLayer(layer, m.counts.corners, (x, y, z) => transformNormal(normals, x, y, z, OUT));
    }
  }
  if (det3(matrix) < 0) for (let f = 0; f < m.counts.faces; f++) m.reverseFace(f);
}

function transformLayer(layer: AttrLayer, count: number, fn: (x: number, y: number, z: number) => void): void {
  for (let i = 0; i < count; i++) {
    const x = layer.get(i, 0);
    const y = layer.get(i, 1);
    const z = layer.get(i, 2);
    fn(x, y, z);
    for (let k = 0; k < 3; k++) {
      const value = (OUT[k] as number) + 0; // −0 → +0: stored values stay canonical
      if (!Object.is(layer.get(i, k), Math.fround(value))) layer.set(i, k, value);
    }
  }
}

/** True when every entry is a finite number and the array has 16 of them. */
export function isMatrix(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length === 16 && value.every((x) => typeof x === 'number' && Number.isFinite(x));
}
