// C4 (auto-skin; M6B-SPEC §5.9 step 3): post-processing of every method — (a) prune, (b) keep the 4 largest (ties:
// smaller palette rank) and normalize in float64, (c) symmetrize on the fixed partner map, then (b) again,
// (d) rigidify, (e) write f32 with the rounding residual in the largest weight.
//
// Sums run in descending-weight order (ties by rank), so a point and its mirror partner — whose weight vectors are
// the same values on mirrored joints — get bit-identical results (P-S4).

/** A sparse weight vector of ≤ 8 entries (joint index in the bind's joint space, weight), any order. */
export interface WeightVector {
  joints: number[];
  weights: number[];
}

export const MAX_INFLUENCES = 4;

/** (a) prune: w < a → 0; a ≤ w < 2a → w·(w − a)/a (a smooth ramp, research 14 R7). Zeroes are dropped. */
export function prune(v: WeightVector, below: number): void {
  const joints: number[] = [];
  const weights: number[] = [];
  for (let k = 0; k < v.joints.length; k++) {
    let w = v.weights[k] as number;
    if (!(w > 0)) continue;
    if (below > 0) {
      if (w < below) continue;
      if (w < 2 * below) w = (w * (w - below)) / below;
    }
    if (!(w > 0)) continue;
    joints.push(v.joints[k] as number);
    weights.push(w);
  }
  v.joints = joints;
  v.weights = weights;
}

/** Sorts entries by descending weight, ties by ascending rank. */
export function sortEntries(v: WeightVector, rank: ArrayLike<number>): void {
  const idx = v.joints.map((_, k) => k);
  idx.sort((a, b) => {
    const wa = v.weights[a] as number;
    const wb = v.weights[b] as number;
    if (wa !== wb) return wb - wa;
    return (rank[v.joints[a] as number] as number) - (rank[v.joints[b] as number] as number);
  });
  v.joints = idx.map((k) => v.joints[k] as number);
  v.weights = idx.map((k) => v.weights[k] as number);
}

/** (b) keep the 4 largest (ties: smaller rank) and normalize in float64; false when nothing is left. */
export function keepLargest(v: WeightVector, rank: ArrayLike<number>): boolean {
  sortEntries(v, rank);
  if (v.joints.length > MAX_INFLUENCES) {
    v.joints.length = MAX_INFLUENCES;
    v.weights.length = MAX_INFLUENCES;
  }
  let sum = 0;
  for (const w of v.weights) sum += w;
  if (!(sum > 0) || !Number.isFinite(sum)) {
    v.joints = [];
    v.weights = [];
    return false;
  }
  for (let k = 0; k < v.weights.length; k++) v.weights[k] = (v.weights[k] as number) / sum;
  return true;
}

/** (c) ½(w(v) + M(w(p))) — `mirror` maps a joint to its mirror (itself when none). */
export function symmetrized(own: WeightVector, partner: WeightVector, mirror: ArrayLike<number>): WeightVector {
  const joints: number[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const slot = (j: number): number => {
    const at = joints.indexOf(j);
    if (at >= 0) return at;
    joints.push(j);
    a.push(0);
    b.push(0);
    return joints.length - 1;
  };
  for (let k = 0; k < own.joints.length; k++) a[slot(own.joints[k] as number)] = own.weights[k] as number;
  for (let k = 0; k < partner.joints.length; k++) {
    const j = mirror[partner.joints[k] as number] as number;
    b[slot(j)] = partner.weights[k] as number;
  }
  // Commutative per joint: the partner computes 0.5·(b + a) on the mirrored joint, which is the same double.
  return { joints, weights: joints.map((_, k) => 0.5 * ((a[k] as number) + (b[k] as number))) };
}

/** (d) rigidify: a dominant weight ≥ x becomes 1, the rest 0 (the vector must be sorted). */
export function rigidify(v: WeightVector, above: number | null): void {
  if (above === null || v.weights.length === 0) return;
  if ((v.weights[0] as number) >= above) {
    v.joints = [v.joints[0] as number];
    v.weights = [1];
  }
}

/**
 * (e) f32: rounds every weight, then puts the residual 1 − Σ (float64, summed in descending order) into the largest
 * and rounds it again. The vector must be sorted and normalized.
 */
export function toFloat32(v: WeightVector): number[] {
  const out = v.weights.map((w) => Math.fround(w));
  if (out.length === 0) return out;
  let sum = 0;
  for (const w of out) sum += w;
  out[0] = Math.fround((out[0] as number) + (1 - sum));
  return out;
}
