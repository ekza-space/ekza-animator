// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Animator contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Adapted from Autodesk/animx/src/animx.cpp (`evaluateCurve`, `evaluateCurveSegment`) @
// 11c31ac74e526b599031414866db639383c9a5e0 (Apache-2.0, © Autodesk, Inc.). Changes: ported to TypeScript over a
// compiled curve's arrays (key lookup by binary search, span kinds precomputed per segment, Hermite/Bézier
// coefficients prepared once at compile time); infinities are mapped by the caller (`mapInfinity`); Maya's
// `isStatic()` shortcut is omitted (a static curve evaluates to the same values); the `(seconds)` precision drop
// before Bézier spans is a no-op with 64-bit time and is left out.

import type { CompiledAnimCurve, SegmentKind } from '../../types';
import { Segment } from '../../types';
import { BEZIER_STRIDE, evaluateBezierSegment } from './bezier';

/** AnimX `equivalent()` default tolerance (`kDblEpsilon`): a time this close to a key returns the key's value. */
const KEY_SNAP_EPSILON = 1e-10;

/**
 * AnimX `evaluateCurve` for `frame` inside [first, last] (a frame outside gives the end key's value). `coef` holds
 * the prepared segment coefficients (stride `BEZIER_STRIDE`: Hermite power basis or prepared Bézier). The key lookup
 * is AnimX's `keyframe(time)`: the first key at or after `frame`; a frame within 1e-10 of that key, or before the
 * first key, returns its value. Allocation-free.
 */
export function evaluateCurveInRange(c: CompiledAnimCurve, coef: Float64Array, frame: number): number {
  const t = c.t;
  const n = c.keyCount;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < frame) lo = mid + 1;
    else hi = mid;
  }
  if (lo === n) return c.v[n - 1]!;
  if (Math.abs(t[lo]! - frame) <= KEY_SNAP_EPSILON || lo === 0) return c.v[lo]!;
  const k = lo - 1;
  switch (c.segment[k] as SegmentKind) {
    case Segment.Linear: {
      const t0 = t[k]!;
      const t1 = t[lo]!;
      const v0 = c.v[k]!;
      return t0 === t1 ? v0 : v0 + ((frame - t0) / (t1 - t0)) * (c.v[lo]! - v0);
    }
    case Segment.Step:
      return c.v[k]!;
    case Segment.StepNext:
      return c.v[lo]!;
    case Segment.Bezier:
      return evaluateBezierSegment(coef, k * BEZIER_STRIDE, t[k]!, t[lo]!, frame);
    case Segment.Hermite:
    default: {
      // AnimX `hermite`: t·(t·(t·c0 + c1) + c2) + c3 with t frames after the start key
      const o = k * BEZIER_STRIDE;
      const s = frame - t[k]!;
      return s * (s * (s * coef[o]! + coef[o + 1]!) + coef[o + 2]!) + coef[o + 3]!;
    }
  }
}
