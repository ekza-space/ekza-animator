// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Animator contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Adapted from Autodesk/animx/src/animx.cpp (`evaluateInfinity`) @ 11c31ac74e526b599031414866db639383c9a5e0
// (Apache-2.0, © Autodesk, Inc.). Changes: ported to TypeScript; returns the time mapping (in-range time, signed
// cycle count, mirror flag) instead of evaluating, so slopes and painters reuse it; times are frames and are not
// rounded to Maya ticks (`toTickDoubleTime` mimics Maya's seconds→ticks precision loss, which frames do not have);
// the mapped time is clamped into the key range so a rounding error can never recurse into the infinity again.

/** Cyclic infinity modes (constant and linear are handled by the caller). */
export type CyclicInfinity = 'cycle' | 'cycleOffset' | 'oscillate';

/**
 * Scratch result of `mapCyclicInfinity`: [mapped frame, signed cycle count for cycle-with-offset (0 otherwise),
 * mirrored (1 when time runs backwards there, oscillate only)].
 */
export const INFINITY_MAP = new Float64Array(3);

/**
 * Maps `time` before the first key (`pre`) or after the last key into [first, last] for a cyclic infinity mode,
 * exactly as AnimX `evaluateInfinity` does. `last > first` is required.
 */
export function mapCyclicInfinity(time: number, first: number, last: number, mode: CyclicInfinity, pre: boolean): void {
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

  INFINITY_MAP[0] = Math.min(Math.max(factoredTime, first), last);
  INFINITY_MAP[1] = mode === 'cycleOffset' ? (pre ? -numCycles : numCycles) : 0;
  INFINITY_MAP[2] = mirrored ? 1 : 0;
}
