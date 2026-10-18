import { compileAnimCurve } from '../curve/compile';
import { evaluateAnimCurve } from '../curve/evaluate';
import { infinityModeOf, KEY_TIME_EPSILON, lowerBound, normalizeKeys, upperBound } from '../curve/keys';
import { EkzaError } from '../errors';
import type { AnimCurve, KeyData, ReduceOptions, ReduceResult } from '../types';

/**
 * Error-bounded key reduction (Graph Editor Simplify, clip import; MVP-SPEC §4.11.4): top-down insertion. Starts
 * from the first and last keys plus the keys at `keep` frames (within 1e-6; a keep frame without a key is ignored),
 * measures |reduced − original| at every original key time and every integer frame in [first, last], adds the
 * original key nearest to the time of the largest error (ties: the earlier sample, then the earlier key), and
 * repeats until the largest error ≤ `tolerance`. Kept keys are returned unchanged (same objects, original tangent
 * types and handles; computed tangents are re-resolved from their new neighbours by the engine). Deterministic.
 * Terminates because keeping every key reproduces the original exactly.
 */
export function reduceKeys(curve: AnimCurve, opts: ReduceOptions): ReduceResult {
  const tolerance = opts.tolerance;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new EkzaError('unsupported', `reduceKeys: tolerance must be a finite number ≥ 0 (got ${tolerance})`);
  }
  const keys = normalizeKeys(curve.keys);
  const n = keys.length;
  if (n <= 2) return { keys: keys.slice(), removed: 0, maxError: 0 };
  const weighted = curve.weighted === true;
  const pre = infinityModeOf(curve.pre);
  const post = infinityModeOf(curve.post);
  const original = compileAnimCurve({ keys, weighted, pre, post });
  const keyTimes = original.t;
  const first = keyTimes[0]!;
  const last = keyTimes[n - 1]!;

  const times = sampleTimes(keyTimes, first, last);
  const samples = times.length;
  const target = new Float64Array(samples);
  for (let s = 0; s < samples; s++) target[s] = evaluateAnimCurve(original, times[s]!);

  const kept = new Uint8Array(n);
  kept[0] = 1;
  kept[n - 1] = 1;
  for (const frame of opts.keep ?? []) {
    if (!Number.isFinite(frame)) continue;
    const i = nearestKey(keyTimes, n, frame);
    if (Math.abs(keyTimes[i]! - frame) <= KEY_TIME_EPSILON) kept[i] = 1;
  }
  const keptIndices: number[] = [];
  for (let i = 0; i < n; i++) if (kept[i] === 1) keptIndices.push(i);

  // Clamped tangents depend on the curve's value range, so a new extreme key changes them everywhere.
  const rangeSensitive = keys.some((key) => key.inType === 'clamped' || key.outType === 'clamped');
  let rangeKey = valueRangeKey(keys, keptIndices);

  const error = new Float64Array(samples);
  let windowLo = 0;
  let windowHi = samples;
  let maxError = 0;
  for (;;) {
    const reduced = compileAnimCurve({ keys: keptIndices.map((i) => keys[i]!), weighted, pre, post });
    for (let s = windowLo; s < windowHi; s++) error[s] = Math.abs(evaluateAnimCurve(reduced, times[s]!) - target[s]!);
    let worst = 0;
    maxError = 0;
    for (let s = 0; s < samples; s++) {
      if (error[s]! > maxError) {
        maxError = error[s]!;
        worst = s;
      }
    }
    if (maxError <= tolerance) break;

    const add = nearestUnkept(keyTimes, kept, n, times[worst]!);
    if (add < 0) break; // unreachable: with every key kept the error is 0
    kept[add] = 1;
    const at = lowerBound(keptIndices, keptIndices.length, add);
    keptIndices.splice(at, 0, add);

    const nextRangeKey = rangeSensitive ? valueRangeKey(keys, keptIndices) : rangeKey;
    if (nextRangeKey !== rangeKey) {
      rangeKey = nextRangeKey;
      windowLo = 0;
      windowHi = samples;
    } else {
      // The new key changes the tangents of itself and its two kept neighbours: spans from two kept keys before to
      // two kept keys after it.
      const lo = keyTimes[keptIndices[Math.max(at - 2, 0)]!]!;
      const hi = keyTimes[keptIndices[Math.min(at + 2, keptIndices.length - 1)]!]!;
      windowLo = lowerBound(times, samples, lo);
      windowHi = upperBound(times, samples, hi);
    }
  }

  return { keys: keptIndices.map((i) => keys[i]!), removed: n - keptIndices.length, maxError };
}

/** Sorted, unique union of the key times and the integer frames in [first, last]. */
function sampleTimes(keyTimes: Float64Array, first: number, last: number): Float64Array {
  const out: number[] = [];
  let i = 0;
  const n = keyTimes.length;
  for (let f = Math.ceil(first); f <= last || i < n; ) {
    const k = i < n ? keyTimes[i]! : Number.POSITIVE_INFINITY;
    const integer = f <= last ? f : Number.POSITIVE_INFINITY;
    const next = Math.min(k, integer);
    if (out.length === 0 || out[out.length - 1] !== next) out.push(next);
    if (k === next) i++;
    if (integer === next) f++;
  }
  return Float64Array.from(out);
}

function nearestKey(keyTimes: Float64Array, n: number, frame: number): number {
  const i = lowerBound(keyTimes, n, frame);
  if (i === 0) return 0;
  if (i === n) return n - 1;
  return frame - keyTimes[i - 1]! <= keyTimes[i]! - frame ? i - 1 : i;
}

/** The not-yet-kept key nearest to `frame` (ties: the earlier key), −1 when every key is kept. */
function nearestUnkept(keyTimes: Float64Array, kept: Uint8Array, n: number, frame: number): number {
  const i = lowerBound(keyTimes, n, frame);
  let left = i - 1;
  while (left >= 0 && kept[left] === 1) left--;
  let right = i;
  while (right < n && kept[right] === 1) right++;
  if (left < 0) return right < n ? right : -1;
  if (right >= n) return left;
  return frame - keyTimes[left]! <= keyTimes[right]! - frame ? left : right;
}

function valueRangeKey(keys: readonly KeyData[], indices: readonly number[]): string {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const i of indices) {
    const v = keys[i]!.v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return `${min}:${max}`;
}
