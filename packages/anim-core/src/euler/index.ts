import { compileAnimCurve } from '../curve/compile';
import { evaluateAnimCurve } from '../curve/evaluate';
import { KEY_TIME_EPSILON, lowerBound, normalizeKeys, tangentTypeOf } from '../curve/keys';
import { eulerFilter, rotateOrderAxes } from '../math/euler';
import type { AnimCurve, KeyData, RotateOrder, Vec3 } from '../types';

const TAU = 2 * Math.PI;
/** A middle-axis change that is not a multiple of 2π (beyond this) is the alternate-triple branch. */
const BRANCH_EPSILON = 1e-6;

/**
 * Curve-level Euler filter (Graph Editor `graph.eulerFilter`, clip import; MVP-SPEC §4.11.5): samples rx, ry, rz at
 * the union of their key times (times within 1e-6 are one sample), runs the sequential `eulerFilter` (2π unwrap and
 * the nearer of the two equivalent triples), and writes each curve's values back only at its own keys. Tangent types
 * are unchanged; where a sample switched to the alternate triple (a + π, π − b, c + π) the middle axis' fixed
 * handles are negated so its motion keeps the same direction (computed tangents follow by themselves). A channel
 * without keys samples as 0; pass a single-key curve holding its static value for exact results. Unchanged keys are
 * returned as the same objects.
 */
export function eulerFilterCurves(
  curves: readonly [AnimCurve, AnimCurve, AnimCurve],
  order: RotateOrder,
): [KeyData[], KeyData[], KeyData[]] {
  const middle = rotateOrderAxes(order)[1];
  const keySets = curves.map((curve) => normalizeKeys(curve.keys)) as [
    readonly KeyData[],
    readonly KeyData[],
    readonly KeyData[],
  ];
  const compiled = curves.map((curve, axis) =>
    compileAnimCurve({ keys: keySets[axis]!, weighted: curve.weighted, pre: curve.pre, post: curve.post }),
  );

  const union = unionTimes(keySets);
  const original: Vec3[] = union.map((t) => [
    evaluateAnimCurve(compiled[0]!, t),
    evaluateAnimCurve(compiled[1]!, t),
    evaluateAnimCurve(compiled[2]!, t),
  ]);
  const filtered: Vec3[] = original.map((e) => [e[0], e[1], e[2]]);
  eulerFilter(filtered, order);

  // Samples where the filter chose the alternate triple (detected on the middle axis: π − b is not b + 2πk).
  const alternate = original.map((e, s) => isAlternateBranch(e[middle], (filtered[s] as Vec3)[middle]));
  const unionArray = Float64Array.from(union);
  const result = keySets.map((keys, axis) =>
    keys.map((key) => {
      const s = sampleOf(unionArray, key.t);
      const value = (filtered[s] as Vec3)[axis] as number;
      const flipped = axis === middle && alternate[s] === true;
      if (value === key.v && !flipped) return key;
      let next: KeyData = { ...key, v: value };
      if (flipped && tangentTypeOf(key.inType) === 'fixed') {
        next = { ...next, inHandle: { dt: key.inHandle.dt, dv: -key.inHandle.dv } };
      }
      if (flipped && tangentTypeOf(key.outType) === 'fixed') {
        next = { ...next, outHandle: { dt: key.outHandle.dt, dv: -key.outHandle.dv } };
      }
      return next;
    }),
  );
  return [result[0]!, result[1]!, result[2]!];
}

/** Sorted union of the key times; a time within 1e-6 of the previous union time joins it. */
function unionTimes(keySets: readonly (readonly KeyData[])[]): number[] {
  const all: number[] = [];
  for (const keys of keySets) for (const key of keys) all.push(key.t);
  all.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) {
    const last = out[out.length - 1];
    if (last === undefined || t - last > KEY_TIME_EPSILON) out.push(t);
  }
  return out;
}

/** Index of the union sample a key time belongs to (the nearest one). */
function sampleOf(union: Float64Array, t: number): number {
  const n = union.length;
  const i = lowerBound(union, n, t);
  if (i === 0) return 0;
  if (i === n) return n - 1;
  return t - union[i - 1]! <= union[i]! - t ? i - 1 : i;
}

/** True when `filtered` is `original` mirrored to the other branch (π − b), not just unwrapped by 2π. */
function isAlternateBranch(original: number, filtered: number): boolean {
  const d = filtered - original;
  return Math.abs(d - TAU * Math.round(d / TAU)) > BRANCH_EPSILON;
}
