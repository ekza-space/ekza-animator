// C4 (auto-skin; M6B-SPEC §5.9 step 2 `closest`): per point the nearest visible segment j*; with `hierarchy` the
// candidates are j*, its parent and its children, else the 4 nearest joints; w_j ∝ max(d_j, 1e-4 H)^(−dropoff) with
// d_j the distance to j's nearest segment.
import type { WeightVector } from '../post';

export interface ClosestInput {
  /** The point's nearest visible segment owner (else its nearest segment's owner). */
  readonly best: number;
  /** Distance from the point to joint j's nearest segment (candidates only). */
  readonly distance: (j: number) => number;
  /** Candidate joints, ascending. */
  readonly candidates: readonly number[];
  readonly parent: Int32Array;
  readonly children: readonly (readonly number[])[];
  readonly isCandidate: Uint8Array;
  readonly hierarchy: boolean;
  readonly dropoff: number;
  /** 1e-4 H. */
  readonly floor: number;
}

export function closestWeights(input: ClosestInput): WeightVector {
  let joints: number[];
  if (input.hierarchy) {
    joints = [input.best];
    const p = input.parent[input.best] as number;
    if (p >= 0 && input.isCandidate[p] === 1) joints.push(p);
    for (const c of input.children[input.best] ?? []) if (input.isCandidate[c] === 1) joints.push(c);
  } else {
    // The 4 nearest candidate joints (ties: smaller joint index).
    const ranked = input.candidates.map((j) => ({ j, d: input.distance(j) }));
    ranked.sort((a, b) => a.d - b.d || a.j - b.j);
    joints = ranked.slice(0, 4).map((r) => r.j);
  }
  joints.sort((a, b) => a - b);
  const weights = joints.map((j) => Math.max(input.distance(j), input.floor) ** -input.dropoff);
  let sum = 0;
  for (const w of weights) sum += w;
  return { joints, weights: weights.map((w) => w / sum) };
}
