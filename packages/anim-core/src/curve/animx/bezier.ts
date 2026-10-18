// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Animator contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Adapted from Autodesk/animx/src/internal/Tbezier.h @ 11c31ac74e526b599031414866db639383c9a5e0 (Apache-2.0,
// © Autodesk, Inc.). Changes: ported to TypeScript; `Tbezier::evaluate` is split into a time-independent segment
// preparation (monotonic-X correction and power basis, run once when a curve is compiled) and the per-time root
// solve; out-parameters go through scratch arrays; added the parameter/derivative helpers used by the curve engine;
// the root finder is bound once at module load (M-3).

import { polyZeroes } from './polyZeroes';

/** `kDblEpsilon` of AnimX `math.h`. */
const K_DBL_EPSILON = 1.0e-10;
const ONE_THIRD = 1.0 / 3.0;
const TWO_THIRDS = 2.0 / 3.0;
const FOUR_THIRDS = 4.0 / 3.0;

/** Stride of a prepared Bézier segment: [x3, x2, x1, y3, y2, y1, y0, linear]. */
export const BEZIER_STRIDE = 8;

/**
 * Corrected control points of the last `prepareBezierSegment` call: [x1, y1, x2, y2] (absolute frame/value).
 * Read it right after the call; the next call overwrites it.
 */
export const BEZIER_CORRECTED = new Float64Array(4);

/** Bound once (M2A-SPEC §5.21.3, M-3): module wrappers can turn each imported-binding access into a getter call. */
const findZeroes = polyZeroes;

const MONO = new Float64Array(2);
const BOUNDS = new Float64Array(2);
const POLY = new Float64Array(4);
const ROOTS = new Float64Array(8);

function equivalent(a: number, b: number, epsilon: number): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** `Tbezier::bezierToPower`: cubic Bézier ordinates → power basis [a·u³, b·u², c·u, d]. */
function bezierToPower(a1: number, b1: number, c1: number, d1: number, out: Float64Array, o: number): void {
  const a = b1 - a1;
  const b = c1 - b1;
  const c = d1 - c1;
  const d = b - a;
  out[o] = c - b - d;
  out[o + 1] = d + d + d;
  out[o + 2] = a + a + a;
  out[o + 3] = a1;
}

/** `Tbezier::constrainInsideBounds` on the symmetric control vector; result in BOUNDS. */
function constrainInsideBounds(x1In: number, x2In: number): void {
  let x1 = x1In;
  let x2 = x2In;
  if (x1 + K_DBL_EPSILON < FOUR_THIRDS) {
    const b = x1 - 2.0;
    const c = x1 - 1.0;
    const discr = Math.sqrt(b * b - 4 * c * c);
    let root = (-b + discr) * 0.5;
    if (x2 + K_DBL_EPSILON > root) {
      x2 = root - K_DBL_EPSILON;
    } else {
      root = (-b - discr) * 0.5;
      if (x2 < root + K_DBL_EPSILON) x2 = root + K_DBL_EPSILON;
    }
  } else {
    x1 = FOUR_THIRDS - K_DBL_EPSILON;
    x2 = ONE_THIRD - K_DBL_EPSILON;
  }
  BOUNDS[0] = x1;
  BOUNDS[1] = x2;
}

/** `Tbezier::checkMonotonic` on normalized handle times; result in MONO. */
function checkMonotonic(x1In: number, x2In: number, keepFirst: boolean): void {
  let x1 = x1In;
  // We want a control vector of [0 x1 (1−x2) 1] since this provides more symmetry.
  let x2 = 1.0 - x2In;
  if (x1 < 0.0) x1 = 0.0;
  if (x2 < 0.0) x2 = 0.0;
  // If x1 or x2 are greater than 1.0, they must be inside the ellipse x1² + x2² − 2(x1 + x2) + x1·x2 + 1 ≤ 0.
  if (x1 > 1.0 || x2 > 1.0) {
    const d = x1 * (x1 - 2.0 + x2) + x2 * (x2 - 2.0) + 1.0;
    if (d + K_DBL_EPSILON > 0.0) {
      if (keepFirst) {
        constrainInsideBounds(x1, x2);
        x1 = BOUNDS[0]!;
        x2 = BOUNDS[1]!;
      } else {
        constrainInsideBounds(x2, x1);
        x2 = BOUNDS[0]!;
        x1 = BOUNDS[1]!;
      }
    }
  }
  MONO[0] = x1;
  MONO[1] = 1.0 - x2;
}

/**
 * Time-independent half of AnimX `Tbezier::evaluate` for the segment (startX, startY) → (endX, endY) with control
 * points (x1, y1), (x2, y2): applies the monotonic-X correction (keeping the first handle), and writes the power
 * basis of the normalized X(u) and of V(u) plus the "equally spaced" flag at `out[o … o + 7]`. The corrected
 * control points are left in `BEZIER_CORRECTED`.
 */
export function prepareBezierSegment(
  startX: number,
  startY: number,
  x1In: number,
  y1In: number,
  x2In: number,
  y2In: number,
  endX: number,
  endY: number,
  out: Float64Array,
  o: number,
): void {
  let x1 = x1In;
  let y1 = y1In;
  let x2 = x2In;
  let y2 = y2In;
  const rangeX = endX - startX;
  if (rangeX === 0.0) {
    // AnimX evaluates a zero-length segment as 0.
    out.fill(0, o, o + BEZIER_STRIDE);
    out[o + 7] = 1;
    BEZIER_CORRECTED[0] = x1;
    BEZIER_CORRECTED[1] = y1;
    BEZIER_CORRECTED[2] = x2;
    BEZIER_CORRECTED[3] = y2;
    return;
  }
  const dx1 = x1 - startX;
  const dx2 = x2 - startX;
  // normalize X control values
  let nX1 = dx1 / rangeX;
  let nX2 = dx2 / rangeX;
  // if all 4 CVs are equally spaced, the polynomial is linear in time
  const fLinear = equivalent(nX1, ONE_THIRD, 1e-6) && equivalent(nX2, TWO_THIRDS, 1e-6);
  const oldX1 = nX1;
  const oldX2 = nX2;
  // check that the inside control values yield a monotonic function, correcting them with preference to the first
  if (nX1 < 0.0) nX1 = 0.0;
  if (nX2 > 1.0) nX2 = 1.0;
  if (nX1 > 1.0 || nX2 < 0.0) {
    checkMonotonic(nX1, nX2, true);
    nX1 = MONO[0]!;
    nX2 = MONO[1]!;
  }
  // compute the new control points
  if (nX1 !== oldX1) {
    x1 = startX + nX1 * rangeX;
    if (!equivalent(oldX1, 0.0, K_DBL_EPSILON)) y1 = startY + ((y1 - startY) * nX1) / oldX1;
  }
  if (nX2 !== oldX2) {
    x2 = startX + nX2 * rangeX;
    if (!equivalent(oldX2, 1.0, K_DBL_EPSILON)) y2 = endY - ((endY - y2) * (1.0 - nX2)) / (1.0 - oldX2);
  }
  BEZIER_CORRECTED[0] = x1;
  BEZIER_CORRECTED[1] = y1;
  BEZIER_CORRECTED[2] = x2;
  BEZIER_CORRECTED[3] = y2;
  // convert the Bézier basis to the power basis: X keeps [x3, x2, x1] (its constant term is 0), V keeps all four
  bezierToPower(0.0, nX1, nX2, 1.0, POLY, 0);
  out[o] = POLY[0]!;
  out[o + 1] = POLY[1]!;
  out[o + 2] = POLY[2]!;
  bezierToPower(startY, y1, y2, endY, out, o + 3);
  out[o + 7] = fLinear ? 1 : 0;
}

/** Curve parameter u ∈ [0, 1] at `time` for a prepared segment (AnimX root solve; 0 when no unique root). */
export function bezierParameter(coef: Float64Array, o: number, startX: number, endX: number, time: number): number {
  let s: number;
  if (equivalent(time, startX, K_DBL_EPSILON)) s = 0.0;
  else if (equivalent(time, endX, K_DBL_EPSILON)) s = 1.0;
  else s = (time - startX) / (endX - startX);
  if (coef[o + 7] === 1) return s;
  // temporarily make X(t) = X(t) − s and find its single root in [0, 1]
  POLY[3] = coef[o]!;
  POLY[2] = coef[o + 1]!;
  POLY[1] = coef[o + 2]!;
  POLY[0] = 0.0 - s;
  const numRoots = findZeroes(POLY, 3, 0.0, true, 1.0, true, ROOTS);
  return numRoots === 1 ? ROOTS[0]! : 0.0;
}

/** V(u) of a prepared segment. */
export function bezierValueAt(coef: Float64Array, o: number, u: number): number {
  return u * (u * (u * coef[o + 3]! + coef[o + 4]!) + coef[o + 5]!) + coef[o + 6]!;
}

/** AnimX `Tbezier::evaluate` for a prepared segment. */
export function evaluateBezierSegment(
  coef: Float64Array,
  o: number,
  startX: number,
  endX: number,
  time: number,
): number {
  return bezierValueAt(coef, o, bezierParameter(coef, o, startX, endX, time));
}

/** dV/dt of a prepared segment at parameter u (value per frame); near-vertical tangents are limited, not infinite. */
export function bezierSlopeAt(coef: Float64Array, o: number, startX: number, endX: number, u: number): number {
  const range = endX - startX;
  if (range === 0) return 0;
  const dv = (3 * coef[o + 3]! * u + 2 * coef[o + 4]!) * u + coef[o + 5]!;
  if (coef[o + 7] === 1) return dv / range;
  const dx = Math.max((3 * coef[o]! * u + 2 * coef[o + 1]!) * u + coef[o + 2]!, 1e-12);
  return dv / (dx * range);
}

/** X(u) of a prepared segment, normalized to [0, 1]. */
export function bezierTimeAt(coef: Float64Array, o: number, u: number): number {
  return u * (u * (u * coef[o]! + coef[o + 1]!) + coef[o + 2]!);
}
