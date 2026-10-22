// C4 (auto-skin; M6B-SPEC §4.2, §5.9): Jacobi-preconditioned conjugate gradients on a CSR matrix plus a diagonal,
// for several right-hand sides that share the matrix (heat solves every candidate joint of an island against the
// same `Lpsd + H`). Columns are independent: each has its own scalars and stops on its own, so a column's result
// does not depend on which other columns share the block. Fixed tolerance and cap (§3 rule 8).
import type { CsrMatrix } from '../types';

export interface PcgOptions {
  /** Relative residual: stop when ‖r‖₂ ≤ tolerance · ‖b‖₂. */
  readonly tolerance: number;
  readonly maxIterations: number;
}

/** §5.9: relative tolerance 1e-6, cap 200 iterations. */
export const HEAT_PCG: PcgOptions = { tolerance: 1e-6, maxIterations: 200 };

/**
 * Solves (A + diag(add))·X = B for `k` columns stored interleaved (`B[i·k + j]`), starting from X (in place).
 * Returns the iterations of every column. A column with ‖b‖ = 0 gets X = 0 without an iteration.
 */
export function solvePcg(
  a: CsrMatrix,
  add: Float64Array | null,
  b: Float64Array,
  x: Float64Array,
  k: number,
  opts: PcgOptions = HEAT_PCG,
): Int32Array {
  const n = a.n;
  const { rowPtr, col, val } = a;
  const inv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let d = add === null ? 0 : (add[i] as number);
    for (let e = rowPtr[i] as number; e < (rowPtr[i + 1] as number); e++) {
      if (col[e] === i) {
        d += val[e] as number;
        break;
      }
    }
    inv[i] = d > 0 ? 1 / d : 1;
  }
  const r = new Float64Array(n * k);
  const z = new Float64Array(n * k);
  const p = new Float64Array(n * k);
  const q = new Float64Array(n * k);
  const rz = new Float64Array(k);
  const bound = new Float64Array(k);
  const active = new Uint8Array(k);
  const iterations = new Int32Array(k);
  const multiply = (src: Float64Array, dst: Float64Array): void => {
    for (let i = 0; i < n; i++) {
      const base = i * k;
      const di = add === null ? 0 : (add[i] as number);
      for (let j = 0; j < k; j++) dst[base + j] = di * (src[base + j] as number);
      for (let e = rowPtr[i] as number; e < (rowPtr[i + 1] as number); e++) {
        const v = val[e] as number;
        const cb = (col[e] as number) * k;
        for (let j = 0; j < k; j++)
          if (active[j] === 1) dst[base + j] = (dst[base + j] as number) + v * (src[cb + j] as number);
      }
    }
  };
  // r = b − A·x
  for (let j = 0; j < k; j++) active[j] = 1;
  multiply(x, q);
  let running = 0;
  for (let j = 0; j < k; j++) {
    let bb = 0;
    let rr = 0;
    for (let i = 0; i < n; i++) {
      const bi = b[i * k + j] as number;
      const ri = bi - (q[i * k + j] as number);
      r[i * k + j] = ri;
      bb += bi * bi;
      rr += ri * ri;
    }
    bound[j] = opts.tolerance * opts.tolerance * bb;
    if (bb === 0) {
      for (let i = 0; i < n; i++) x[i * k + j] = 0;
      active[j] = 0;
      continue;
    }
    if (rr <= (bound[j] as number)) {
      active[j] = 0;
      continue;
    }
    let s = 0;
    for (let i = 0; i < n; i++) {
      const zi = (r[i * k + j] as number) * (inv[i] as number);
      z[i * k + j] = zi;
      p[i * k + j] = zi;
      s += (r[i * k + j] as number) * zi;
    }
    rz[j] = s;
    running++;
  }
  for (let it = 0; it < opts.maxIterations && running > 0; it++) {
    multiply(p, q);
    for (let j = 0; j < k; j++) {
      if (active[j] === 0) continue;
      let pq = 0;
      for (let i = 0; i < n; i++) pq += (p[i * k + j] as number) * (q[i * k + j] as number);
      iterations[j] = (iterations[j] as number) + 1;
      if (!(pq > 0)) {
        active[j] = 0;
        running--;
        continue;
      }
      const alpha = (rz[j] as number) / pq;
      let rr = 0;
      for (let i = 0; i < n; i++) {
        const idx = i * k + j;
        x[idx] = (x[idx] as number) + alpha * (p[idx] as number);
        const ri = (r[idx] as number) - alpha * (q[idx] as number);
        r[idx] = ri;
        rr += ri * ri;
      }
      if (rr <= (bound[j] as number)) {
        active[j] = 0;
        running--;
        continue;
      }
      let s = 0;
      for (let i = 0; i < n; i++) {
        const idx = i * k + j;
        const zi = (r[idx] as number) * (inv[i] as number);
        z[idx] = zi;
        s += (r[idx] as number) * zi;
      }
      const beta = s / (rz[j] as number);
      rz[j] = s;
      for (let i = 0; i < n; i++) {
        const idx = i * k + j;
        p[idx] = (z[idx] as number) + beta * (p[idx] as number);
      }
    }
  }
  return iterations;
}
