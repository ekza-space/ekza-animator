// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Animator contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Adapted from Autodesk/animx/src/animx.cpp (`evaluateInfinity`) @ 11c31ac74e526b599031414866db639383c9a5e0
// (Apache-2.0, © Autodesk, Inc.). Changes: ported to TypeScript; returns the time mapping (in-range time, value
// offset, mirror flag) instead of evaluating, so slopes and painters reuse it; linear infinity uses the resolved end
// slope (AnimX: `tan(tangentAngle)`, the same slope); a single key with a cyclic infinity maps to itself (AnimX
// returns 0 there because the range is 0); the mapped time is not rounded to Maya ticks (`toTickDoubleTime`, which
// models Maya's seconds; the engine's frames have no such quantum) — instead a mapped time within the mapping's
// rounding error of a key is snapped onto that key, which is what the tick rounding achieves for tick-aligned keys
// (see `mapCyclicInfinity`); the mapped time is clamped into the key range so it can never recurse into the infinity.

import type { CompiledAnimCurve, InfinityMode } from '../../types';

/** Cyclic infinity modes (constant and linear are handled by `mapInfinity`). */
export type CyclicInfinity = 'cycle' | 'cycleOffset' | 'oscillate';

/**
 * Scratch result of `mapInfinity` / `mapCyclicInfinity`: [mapped in-range frame, value offset (`mapCyclicInfinity`:
 * the signed cycle count for cycle-with-offset, 0 otherwise), mirrored (1 where oscillation plays backwards), key-snap
 * tolerance (0 when the mapped frame is exact or already snapped)].
 */
export const INFINITY_MAP = new Float64Array(4);

/**
 * Bound on the rounding error of the cyclic mapping, relative to max(1, |time|, |first|, |last|). The subtraction,
 * division, product and sum of `mapCyclicInfinity` lose at most ~15 ulps of those magnitudes (≈ 1.7e-15); the bound
 * keeps a margin of several hundred and stays far below any key spacing an editor can produce (≥ 1e-6 frames).
 */
const MAP_SNAP_RELATIVE = 1e-12;

function isCyclicMode(mode: InfinityMode): mode is CyclicInfinity {
  return mode === 'cycle' || mode === 'cycleOffset' || mode === 'oscillate';
}

/**
 * Maps `time` before the first key (`pre`) or after the last key into [t[0], t[n − 1]] for a cyclic infinity mode,
 * with AnimX `evaluateInfinity`'s arithmetic. `n ≥ 2` and `t[n − 1] > t[0]` are required. Writes the mapped frame
 * (clamped, not yet snapped) and the key-snap tolerance into INFINITY_MAP; `snapToKey` applies it.
 *
 * AnimX then rounds the mapped time to Maya ticks. Besides modelling Maya's seconds, that rounding removes the
 * mapping's rounding error where the exact mapped time is a key: without it, a time that should land on a key can
 * come out a hair after it (10.000000000000002 for 10), and a step-next span, which jumps right after its start key,
 * would return the next key's value. The port snaps exactly that case: a mapped time within the rounding-error bound
 * of a key becomes the key's time. Elsewhere the mapping is left unrounded, which agrees with AnimX on tick-aligned
 * times (the goldens) and is exact to rounding error everywhere else.
 */
export function mapCyclicInfinity(
  time: number,
  t: ArrayLike<number>,
  n: number,
  mode: CyclicInfinity,
  pre: boolean,
): void {
  const first = t[0]!;
  const last = t[n - 1]!;
  const range = last - first;
  const diff = time > last ? time - last : time - first;
  const ratio = diff / range;
  // modf: integral part towards zero, fractional part with the sign of the argument
  const integral = Math.trunc(ratio);
  const remainder = Math.abs(ratio - integral);
  let factoredTime = range * remainder;
  const numCycles = Math.abs(integral) + 1;
  const odd = numCycles % 2 !== 0;
  let mirrored = false;

  if (pre) {
    if (mode === 'oscillate') {
      if (odd) {
        factoredTime = first + factoredTime;
        mirrored = true;
      } else {
        factoredTime = last - factoredTime;
      }
    } else {
      factoredTime = last - factoredTime;
    }
  } else if (mode === 'oscillate') {
    if (odd) {
      factoredTime = last - factoredTime;
      mirrored = true;
    } else {
      factoredTime = first + factoredTime;
    }
  } else {
    factoredTime = first + factoredTime;
  }

  INFINITY_MAP[3] = MAP_SNAP_RELATIVE * Math.max(1, Math.abs(time), Math.abs(first), Math.abs(last));
  INFINITY_MAP[0] = Math.min(Math.max(factoredTime, first), last);
  INFINITY_MAP[1] = mode === 'cycleOffset' ? (pre ? -numCycles : numCycles) : 0;
  INFINITY_MAP[2] = mirrored ? 1 : 0;
}

/**
 * The key time nearest to `time` if it is within `tolerance`, else `time`; ties go to the later key. `time` must lie
 * in [t[0], t[n − 1]]. `evaluateCurveInRange` with the same tolerance gives the same value without the extra search.
 */
export function snapToKey(t: ArrayLike<number>, n: number, time: number, tolerance: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < time) lo = mid + 1;
    else hi = mid;
  }
  const above = t[lo]! - time;
  const below = lo > 0 ? time - t[lo - 1]! : Number.POSITIVE_INFINITY;
  if (below < above) return below <= tolerance ? t[lo - 1]! : time;
  return above <= tolerance ? t[lo]! : time;
}

/**
 * Writes the infinity mapping of `frame` into INFINITY_MAP ([in-range frame, value offset, mirrored, snap tolerance])
 * so that value(frame) = value(mapped frame) + offset; returns false when `frame` is inside the key range (or the
 * curve is empty). Constant maps to the end key; linear to the end key plus the end slope times the distance (AnimX:
 * `value ± inc · tan(angle)`); cyclic modes per `mapCyclicInfinity`, cycle-with-offset adding the end-value delta per
 * cycle. A cyclic mode on a single key behaves as constant (AnimX returns 0; the key value is the sane limit).
 *
 * With `snap` (the default) a cyclic mapped frame is snapped onto a key (`snapToKey`) and the tolerance is 0;
 * without it the caller applies the tolerance (`evaluateCurveInRange` does so inside its own key search).
 */
export function mapInfinity(c: CompiledAnimCurve, frame: number, snap = true): boolean {
  const n = c.keyCount;
  if (n === 0) return false;
  const first = c.t[0]!;
  const last = c.t[n - 1]!;
  const pre = frame < first;
  if (!pre && !(frame > last)) return false;
  const mode = pre ? c.pre : c.post;
  const boundary = pre ? first : last;
  if (mode === 'linear') {
    INFINITY_MAP[0] = boundary;
    INFINITY_MAP[1] = pre ? -(first - frame) * c.inSlope[0]! : (frame - last) * c.outSlope[n - 1]!;
    INFINITY_MAP[2] = 0;
    INFINITY_MAP[3] = 0;
  } else if (isCyclicMode(mode) && last > first) {
    mapCyclicInfinity(frame, c.t, n, mode, pre);
    INFINITY_MAP[1] = INFINITY_MAP[1]! * (c.v[n - 1]! - c.v[0]!);
    if (snap) {
      INFINITY_MAP[0] = snapToKey(c.t, n, INFINITY_MAP[0]!, INFINITY_MAP[3]!);
      INFINITY_MAP[3] = 0;
    }
  } else {
    INFINITY_MAP[0] = boundary;
    INFINITY_MAP[1] = 0;
    INFINITY_MAP[2] = 0;
    INFINITY_MAP[3] = 0;
  }
  return true;
}
