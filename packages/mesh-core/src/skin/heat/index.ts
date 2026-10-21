// C4 (auto-skin; M6B-SPEC §5.9 step 2 `heat`, Baran & Popović 2007): per island, (Lpsd + H)·w_j = H·p_j for every
// candidate joint with p_j > 0 somewhere on the island, by Jacobi PCG started from p_j (relative tolerance 1e-6, cap
// 200). Lpsd is the clamped cotangent Laplacian (§4.2 sign convention), H the diagonal of §5.9.
import { csrSubmatrix } from '../laplacian/csr';
import { HEAT_PCG, solvePcg } from '../pcg';
import type { CsrMatrix } from '../types';

export interface HeatSources {
  /** H_vv per point of the island (local order; 0 = no source). */
  readonly h: Float64Array;
  /** p_j(v) per point: the source joints (any order) and their values. */
  readonly joints: readonly (readonly number[])[];
  readonly values: readonly (readonly number[])[];
}

export interface HeatResult {
  /** Solved joints, ascending. */
  readonly joints: readonly number[];
  /** n × joints.length, interleaved (point-major), clamped to [0, 1]. */
  readonly w: Float64Array;
  readonly iterations: number;
}

/**
 * Solves one island. `points` are the island's global point indices (ascending); `laplacian` is the mesh's; `local` is a scratch array of the mesh's size filled with −1. Null when H ≡ 0 (the island sees no joint).
 */
export function solveHeatIsland(
  points: ArrayLike<number>,
  laplacian: CsrMatrix,
  sources: HeatSources,
  local: Int32Array,
): HeatResult | null {
  const n = points.length;
  const add = new Float64Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    add[i] = sources.h[i] as number;
    if ((add[i] as number) > 0) any = true;
  }
  if (!any) return null;
  const set = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (!((add[i] as number) > 0)) continue;
    const js = sources.joints[i] as readonly number[];
    const vs = sources.values[i] as readonly number[];
    for (let k = 0; k < js.length; k++) if ((vs[k] as number) > 0) set.add(js[k] as number);
  }
  const joints = [...set].sort((a, b) => a - b);
  const k = joints.length;
  const column = new Map(joints.map((j, c) => [j, c]));
  const a = csrSubmatrix(laplacian, points, local);
  const b = new Float64Array(n * k);
  const x = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    const js = sources.joints[i] as readonly number[];
    const vs = sources.values[i] as readonly number[];
    for (let e = 0; e < js.length; e++) {
      const c = column.get(js[e] as number);
      if (c === undefined) continue;
      const p = vs[e] as number;
      x[i * k + c] = p;
      b[i * k + c] = (add[i] as number) * p;
    }
  }
  const iterations = solvePcg(a, add, b, x, k, HEAT_PCG);
  let total = 0;
  for (const it of iterations) total += it;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] as number;
    x[i] = v > 0 ? (v < 1 ? v : 1) : 0;
  }
  return { joints, w: x, iterations: total };
}
