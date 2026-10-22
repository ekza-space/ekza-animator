// The CSR part of the shared sparse kit (M6B-SPEC §4.2; C4, C5 reuses it): assembly from coordinate triples with a
// fixed summation order, sub-matrices over an index subset and the product with a vector. Deterministic (§3 rule 8):
// rows ascending, columns ascending inside a row, duplicates summed in input order.
import type { CsrMatrix } from '../types';

/**
 * A CSR matrix from coordinate triples (`rows[k]`, `cols[k]`, `vals[k]`). Duplicates are summed in input order; every
 * row gets its diagonal entry (0 when absent) so solvers can read it in place. Columns ascend inside every row.
 */
export function csrFromTriples(
  n: number,
  rows: ArrayLike<number>,
  cols: ArrayLike<number>,
  vals: ArrayLike<number>,
): CsrMatrix {
  const count = rows.length;
  // Counting sort by row (stable: keeps input order inside a row), with one slot per row for the diagonal.
  const perRow = new Int32Array(n + 1);
  for (let k = 0; k < count; k++) {
    const at = (rows[k] as number) + 1;
    perRow[at] = (perRow[at] as number) + 1;
  }
  for (let i = 0; i < n; i++) perRow[i + 1] = (perRow[i + 1] as number) + (perRow[i] as number);
  const order = new Int32Array(count);
  const fill = perRow.slice(0, n);
  for (let k = 0; k < count; k++) {
    const r = rows[k] as number;
    order[fill[r] as number] = k;
    fill[r] = (fill[r] as number) + 1;
  }
  const rowPtr = new Int32Array(n + 1);
  const colOut: number[] = [];
  const valOut: number[] = [];
  const scratchCol: number[] = [];
  const scratchVal: number[] = [];
  for (let i = 0; i < n; i++) {
    rowPtr[i] = colOut.length;
    scratchCol.length = 0;
    scratchVal.length = 0;
    // Insertion into a sorted, merged row (rows are short: a vertex's valence + 1).
    insert(scratchCol, scratchVal, i, 0);
    for (let s = perRow[i] as number; s < (perRow[i + 1] as number); s++) {
      const k = order[s] as number;
      insert(scratchCol, scratchVal, cols[k] as number, vals[k] as number);
    }
    for (let s = 0; s < scratchCol.length; s++) {
      colOut.push(scratchCol[s] as number);
      valOut.push(scratchVal[s] as number);
    }
  }
  rowPtr[n] = colOut.length;
  return { n, rowPtr, col: Int32Array.from(colOut), val: Float64Array.from(valOut) };
}

function insert(cols: number[], vals: number[], c: number, v: number): void {
  let lo = 0;
  let hi = cols.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cols[mid] as number) < c) lo = mid + 1;
    else hi = mid;
  }
  if (lo < cols.length && cols[lo] === c) {
    vals[lo] = (vals[lo] as number) + v;
    return;
  }
  cols.splice(lo, 0, c);
  vals.splice(lo, 0, v);
}

/** The diagonal of a CSR matrix. */
export function csrDiagonal(a: CsrMatrix): Float64Array {
  const d = new Float64Array(a.n);
  for (let i = 0; i < a.n; i++) {
    for (let k = a.rowPtr[i] as number; k < (a.rowPtr[i + 1] as number); k++) {
      if (a.col[k] === i) {
        d[i] = a.val[k] as number;
        break;
      }
    }
  }
  return d;
}

/** y = A·x. */
export function csrMultiply(a: CsrMatrix, x: Float64Array, y: Float64Array): void {
  const { rowPtr, col, val } = a;
  for (let i = 0; i < a.n; i++) {
    let s = 0;
    for (let k = rowPtr[i] as number; k < (rowPtr[i + 1] as number); k++)
      s += (val[k] as number) * (x[col[k] as number] as number);
    y[i] = s;
  }
}

/**
 * The principal sub-matrix of `a` over `index` (ascending global indices); entries whose column lies outside the
 * subset are dropped. `local` maps a global index to its position in `index` (−1 outside); it is filled for the
 * subset and reset to −1 before returning, so one scratch array serves every call.
 */
export function csrSubmatrix(a: CsrMatrix, index: ArrayLike<number>, local: Int32Array): CsrMatrix {
  const m = index.length;
  for (let i = 0; i < m; i++) local[index[i] as number] = i;
  const rowPtr = new Int32Array(m + 1);
  let nnz = 0;
  for (let i = 0; i < m; i++) {
    const g = index[i] as number;
    for (let k = a.rowPtr[g] as number; k < (a.rowPtr[g + 1] as number); k++)
      if ((local[a.col[k] as number] as number) >= 0) nnz++;
  }
  const col = new Int32Array(nnz);
  const val = new Float64Array(nnz);
  let w = 0;
  for (let i = 0; i < m; i++) {
    rowPtr[i] = w;
    const g = index[i] as number;
    for (let k = a.rowPtr[g] as number; k < (a.rowPtr[g + 1] as number); k++) {
      const c = local[a.col[k] as number] as number;
      if (c < 0) continue;
      col[w] = c;
      val[w] = a.val[k] as number;
      w++;
    }
  }
  rowPtr[m] = w;
  for (let i = 0; i < m; i++) local[index[i] as number] = -1;
  return { n: m, rowPtr, col, val };
}
