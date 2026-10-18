// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Animator contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Adapted from Autodesk/animx/src/animx.cpp (`evaluateCurve`, `evaluateCurveSegment`) @
// 11c31ac74e526b599031414866db639383c9a5e0 (Apache-2.0, © Autodesk, Inc.). Changes: ported to TypeScript over a
// compiled curve's arrays (key lookup by binary search, span kinds precomputed per segment, Hermite/Bézier
// coefficients prepared once at compile time); infinities are mapped by the caller (`mapInfinity`); Maya's
// `isStatic()` shortcut is omitted (a static curve evaluates to the same values); the `(seconds)` precision drop
// before Bézier spans is a no-op with 64-bit time and is left out; the key lookup first tries the segment of the
// curve's previous lookup and the one after it (M2A-SPEC §5.21.3, M-3: a cache, not state).

import type { CompiledAnimCurve, Segment } from '../../types';
import { BEZIER_STRIDE, evaluateBezierSegment } from './bezier';

/** AnimX `equivalent()` default tolerance (`kDblEpsilon`): a time this close to a key returns the key's value. */
const KEY_SNAP_EPSILON = 1e-10;

// Hot-path constants (M2A-SPEC §5.21.3, M-3). Module wrappers — the test runner's and the app bundler's — can turn
// every access to an imported binding into a property getter, so the span kinds are local literals (checked against
// `Segment` by the type annotations) and the Bézier evaluator is bound once.
const HERMITE: (typeof Segment)['Hermite'] = 0;
const BEZIER: (typeof Segment)['Bezier'] = 1;
const LINEAR: (typeof Segment)['Linear'] = 2;
const STEP: (typeof Segment)['Step'] = 3;
const STEP_NEXT: (typeof Segment)['StepNext'] = 4;
const STRIDE = BEZIER_STRIDE;
const bezierValue = evaluateBezierSegment;

/**
 * A compiled curve that remembers the segment of its last key lookup (`compileAnimCurve` creates every curve with
 * the field). Contract curves built elsewhere lack it and always search.
 */
export interface SegmentHinted {
  segmentHint?: number;
}

/**
 * AnimX's `keyframe(time)` lookup: the index of the first key at or after `frame` (n when none). Keys are strictly
 * increasing (`normalizeKeys`), so the segment k with t[k] < frame ≤ t[k + 1] determines it uniquely: playback and
 * scrubbing usually stay in the hinted segment or move to the next one, which skips the binary search; any other
 * frame searches. The answer never depends on the hint (any frame order gives the same values).
 */
export function keyAtOrAfter(c: CompiledAnimCurve, frame: number): number {
  const t = c.t;
  const n = c.keyCount;
  const hinted = c as CompiledAnimCurve & SegmentHinted;
  const hint = hinted.segmentHint;
  if (hint !== undefined) {
    if (hint + 1 < n && t[hint]! < frame) {
      if (frame <= t[hint + 1]!) return hint + 1;
      if (hint + 2 < n && frame <= t[hint + 2]!) {
        hinted.segmentHint = hint + 1;
        return hint + 2;
      }
    }
  }
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! < frame) lo = mid + 1;
    else hi = mid;
  }
  if (hint !== undefined && lo > 0 && lo < n) hinted.segmentHint = lo - 1;
  return lo;
}

/**
 * AnimX `evaluateCurve` for `frame` inside [first, last] (a frame outside gives the end key's value). `coef` holds
 * the prepared segment coefficients (stride `BEZIER_STRIDE`: Hermite power basis or prepared Bézier). The key lookup
 * is AnimX's `keyframe(time)`: the first key at or after `frame`; a frame within 1e-10 of that key, or before the
 * first key, returns its value. A positive `snap` first returns the value of the nearest key within `snap` (ties to
 * the later key), exactly as evaluating at `snapToKey(t, n, frame, snap)` would. Allocation-free.
 */
export function evaluateCurveInRange(c: CompiledAnimCurve, coef: Float64Array, frame: number, snap: number): number {
  const t = c.t;
  const n = c.keyCount;
  const lo = keyAtOrAfter(c, frame);
  if (lo === n) return c.v[n - 1]!;
  if (snap > 0 && lo > 0) {
    const above = t[lo]! - frame;
    const below = frame - t[lo - 1]!;
    if (below < above) {
      if (below <= snap) return c.v[lo - 1]!;
    } else if (above <= snap) {
      return c.v[lo]!;
    }
  }
  if (Math.abs(t[lo]! - frame) <= KEY_SNAP_EPSILON || lo === 0) return c.v[lo]!;
  const k = lo - 1;
  const kind = c.segment[k];
  if (kind === HERMITE) {
    // AnimX `hermite`: t·(t·(t·c0 + c1) + c2) + c3 with t frames after the start key
    const o = k * STRIDE;
    const s = frame - t[k]!;
    return s * (s * (s * coef[o]! + coef[o + 1]!) + coef[o + 2]!) + coef[o + 3]!;
  }
  if (kind === LINEAR) {
    const t0 = t[k]!;
    const t1 = t[lo]!;
    const v0 = c.v[k]!;
    return t0 === t1 ? v0 : v0 + ((frame - t0) / (t1 - t0)) * (c.v[lo]! - v0);
  }
  if (kind === STEP) return c.v[k]!;
  if (kind === STEP_NEXT) return c.v[lo]!;
  if (kind === BEZIER) return bezierValue(coef, k * STRIDE, t[k]!, t[lo]!, frame);
  // Unknown kinds (foreign curves) evaluate as Hermite, like AnimX's default branch.
  const o = k * STRIDE;
  const s = frame - t[k]!;
  return s * (s * (s * coef[o]! + coef[o + 1]!) + coef[o + 2]!) + coef[o + 3]!;
}
