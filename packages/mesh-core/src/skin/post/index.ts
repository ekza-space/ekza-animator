// C4 (auto-skin; M6B-SPEC §5.9 step 3): post-processing of every method — (a) prune, (b) keep the 4 largest (ties:
// smaller palette rank) and normalize in float64, (c) symmetrize on the fixed partner map, then (b) again,
// (d) rigidify, (e) write f32 with the rounding residual in the largest weight.
//
// Sums run in descending-weight order (ties by rank), so a point and its mirror partner — whose weight vectors are
// the same values on mirrored joints — get bit-identical results (P-S4).
//
// After symmetrize every order is mirror-aware (`MirrorOrder`): ties break on the mirror-invariant rank
// min(rank[j], rank[M(j)]) and then on a side order that is swapped for the partner point, so v and p(v) sort, cut,
// rigidify and round mirrored joints. On a seam point (partner = self) a tied mirror pair is kept or dropped as a unit
// and shares the f32 residual, so w(v) = M(w(v)) exactly.

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

/** The mirror-aware order of one point after symmetrize (P-S4). */
export interface MirrorOrder {
  /** A joint's mirror (itself when none). */
  readonly mirror: ArrayLike<number>;
  /** The point's side: a tied mirror pair puts its larger rank first. A point and its partner have opposite sides. */
  readonly flip: boolean;
  /** partner = self: tied mirror pairs are kept, dropped and rounded as a unit. */
  readonly seam: boolean;
}

/** Sorts entries by descending weight, ties by ascending rank — or, with `order`, by the mirror-invariant rank and then
 *  the point's side. */
export function sortEntries(v: WeightVector, rank: ArrayLike<number>, order?: MirrorOrder): void {
  const idx = v.joints.map((_, k) => k);
  idx.sort((a, b) => {
    const wa = v.weights[a] as number;
    const wb = v.weights[b] as number;
    if (wa !== wb) return wb - wa;
    const ja = v.joints[a] as number;
    const jb = v.joints[b] as number;
    const ra = rank[ja] as number;
    const rb = rank[jb] as number;
    if (order !== undefined) {
      const ka = Math.min(ra, rank[order.mirror[ja] as number] as number);
      const kb = Math.min(rb, rank[order.mirror[jb] as number] as number);
      if (ka !== kb) return ka - kb;
      return order.flip ? rb - ra : ra - rb;
    }
    return ra - rb;
  });
  v.joints = idx.map((k) => v.joints[k] as number);
  v.weights = idx.map((k) => v.weights[k] as number);
}

/** In a sorted vector: true when entry k and k+1 are a tied mirror pair (j, M(j)), j ≠ M(j). */
function tiedPair(v: WeightVector, k: number, mirror: ArrayLike<number>): boolean {
  if (k + 1 >= v.joints.length) return false;
  const j = v.joints[k] as number;
  const m = mirror[j] as number;
  return m !== j && v.joints[k + 1] === m && v.weights[k + 1] === v.weights[k];
}

/** (b) keep the 4 largest (ties: smaller rank, or `order`'s mirror-aware rule) and normalize in float64; false when
 *  nothing is left. On a seam point a tied mirror pair that does not fit whole is dropped whole, and so is everything
 *  after it (the kept entries stay the largest). */
export function keepLargest(v: WeightVector, rank: ArrayLike<number>, order?: MirrorOrder): boolean {
  sortEntries(v, rank, order);
  if (v.joints.length > MAX_INFLUENCES) {
    let keep = MAX_INFLUENCES;
    if (order?.seam === true) {
      keep = 0;
      while (keep < v.joints.length) {
        const size = tiedPair(v, keep, order.mirror) ? 2 : 1;
        if (keep + size > MAX_INFLUENCES) break;
        keep += size;
      }
    }
    v.joints.length = keep;
    v.weights.length = keep;
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

/** (d) rigidify: a dominant weight ≥ x becomes 1, the rest 0 (the vector must be sorted). A seam point whose top is a
 *  tied mirror pair has no single dominant joint and stays as it is. */
export function rigidify(v: WeightVector, above: number | null, order?: MirrorOrder): void {
  if (above === null || v.weights.length === 0) return;
  if (order?.seam === true && tiedPair(v, 0, order.mirror)) return;
  if ((v.weights[0] as number) >= above) {
    v.joints = [v.joints[0] as number];
    v.weights = [1];
  }
}

/**
 * (e) f32: rounds every weight, then puts the residual 1 − Σ (float64, summed in descending order) into the largest
 * and rounds it again. The vector must be sorted and normalized. On a seam point whose largest is a tied mirror pair
 * the pair shares the residual in halves, so both stay equal.
 */
export function toFloat32(v: WeightVector, order?: MirrorOrder): number[] {
  const out = v.weights.map((w) => Math.fround(w));
  if (out.length === 0) return out;
  let sum = 0;
  for (const w of out) sum += w;
  const residual = 1 - sum;
  if (order?.seam === true && tiedPair(v, 0, order.mirror)) {
    const half = Math.fround((out[0] as number) + 0.5 * residual);
    out[0] = half;
    out[1] = half;
    return out;
  }
  out[0] = Math.fround((out[0] as number) + residual);
  return out;
}
