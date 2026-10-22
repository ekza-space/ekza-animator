// C4 (auto-skin; M6B-SPEC §4.2): the shared sparse kit — the positive semi-definite cotangent Laplacian, the lumped
// (mixed Voronoi) mass and the CSR helpers; C5 reuses it. Deterministic (§3 rule 8): triangles in index order,
// float64, duplicates summed in a fixed order.
import type { CsrMatrix, SkinGeometry } from '../types';
import { csrFromTriples } from './csr';

export { csrDiagonal, csrFromTriples, csrMultiply, csrSubmatrix } from './csr';

/** Triangles whose doubled area is below this (relative to their longest edge squared) are skipped as degenerate. */
const DEGENERATE = 1e-14;

interface Corner {
  /** cot of the angle at each corner a, b, c (0 for a degenerate triangle). */
  readonly cot: [number, number, number];
  readonly area: number;
  /** squared lengths of the edges opposite a, b, c. */
  readonly len2: [number, number, number];
}

function triangleCorners(p: Float64Array, a: number, b: number, c: number): Corner | null {
  const ax = p[3 * a] as number;
  const ay = p[3 * a + 1] as number;
  const az = p[3 * a + 2] as number;
  const bx = p[3 * b] as number;
  const by = p[3 * b + 1] as number;
  const bz = p[3 * b + 2] as number;
  const cx = p[3 * c] as number;
  const cy = p[3 * c + 1] as number;
  const cz = p[3 * c + 2] as number;
  // edges
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const bcx = cx - bx;
  const bcy = cy - by;
  const bcz = cz - bz;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const twice = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const lab = abx * abx + aby * aby + abz * abz;
  const lac = acx * acx + acy * acy + acz * acz;
  const lbc = bcx * bcx + bcy * bcy + bcz * bcz;
  const longest = Math.max(lab, lac, lbc);
  if (!(twice > DEGENERATE * longest) || !Number.isFinite(twice)) return null;
  // cot(angle) = dot / |cross|; |cross| is the same (twice the area) at every corner.
  const dotA = abx * acx + aby * acy + abz * acz;
  const dotB = -abx * bcx - aby * bcy - abz * bcz;
  const dotC = acx * bcx + acy * bcy + acz * bcz;
  return { cot: [dotA / twice, dotB / twice, dotC / twice], area: twice / 2, len2: [lbc, lac, lab] };
}

/**
 * The positive semi-definite cotangent Laplacian Lpsd = −Δ (see `CsrMatrix`): off-diagonals −½(cot α + cot β), the
 * diagonal the negated sum of its row's off-diagonals (row sums 0), symmetric. With `clamp`, every negative cotangent
 * counts as 0 (so the operator is an M-matrix and heat weights stay in [0, 1]). Degenerate triangles add nothing.
 */
export function cotLaplacian(geom: SkinGeometry, opts: { readonly clamp: boolean }): CsrMatrix {
  const n = Math.floor(geom.positions.length / 3);
  const tris = geom.tris;
  const T = Math.floor(tris.length / 3);
  const rows: number[] = [];
  const cols: number[] = [];
  const vals: number[] = [];
  for (let t = 0; t < T; t++) {
    const v = [tris[3 * t] as number, tris[3 * t + 1] as number, tris[3 * t + 2] as number] as const;
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    const corner = triangleCorners(geom.positions, v[0], v[1], v[2]);
    if (corner === null) continue;
    for (let k = 0; k < 3; k++) {
      let cot = corner.cot[k] as number;
      if (opts.clamp && cot < 0) cot = 0;
      if (cot === 0) continue;
      // The angle at corner k is opposite the edge between the other two corners.
      const i = v[(k + 1) % 3] as number;
      const j = v[(k + 2) % 3] as number;
      const w = -0.5 * cot;
      rows.push(i, j);
      cols.push(j, i);
      vals.push(w, w);
    }
  }
  const m = csrFromTriples(n, rows, cols, vals);
  // Diagonal = −Σ off-diagonals of the row, summed in column order.
  for (let i = 0; i < n; i++) {
    let s = 0;
    let diag = -1;
    for (let k = m.rowPtr[i] as number; k < (m.rowPtr[i + 1] as number); k++) {
      if (m.col[k] === i) diag = k;
      else s += m.val[k] as number;
    }
    if (diag >= 0) m.val[diag] = -s;
  }
  return m;
}

/**
 * Lumped mass per point: the mixed Voronoi area (Meyer et al. 2003) — the Voronoi share of every non-obtuse
 * triangle, half the area to the obtuse corner and a quarter to the others for obtuse triangles.
 */
export function lumpedMass(geom: SkinGeometry): Float64Array {
  const n = Math.floor(geom.positions.length / 3);
  const mass = new Float64Array(n);
  const tris = geom.tris;
  const T = Math.floor(tris.length / 3);
  for (let t = 0; t < T; t++) {
    const v = [tris[3 * t] as number, tris[3 * t + 1] as number, tris[3 * t + 2] as number] as const;
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    const corner = triangleCorners(geom.positions, v[0], v[1], v[2]);
    if (corner === null) continue;
    const obtuse = corner.cot.findIndex((cot) => cot < 0);
    for (let k = 0; k < 3; k++) {
      let share: number;
      if (obtuse === -1) {
        // Voronoi: ⅛ Σ over the two edges at k of |e|² · cot(opposite angle).
        const k1 = (k + 1) % 3;
        const k2 = (k + 2) % 3;
        share =
          ((corner.len2[k1] as number) * (corner.cot[k1] as number) +
            (corner.len2[k2] as number) * (corner.cot[k2] as number)) /
          8;
      } else share = obtuse === k ? corner.area / 2 : corner.area / 4;
      const at = v[k] as number;
      mass[at] = (mass[at] as number) + share;
    }
  }
  return mass;
}
