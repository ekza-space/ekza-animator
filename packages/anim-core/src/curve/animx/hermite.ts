// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Studio contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Adapted from Autodesk/animx/src/internal/interpolators.h (CurveInterpolators::hermite) @
// 11c31ac74e526b599031414866db639383c9a5e0 (Apache-2.0, © Autodesk, Inc.). Changes: ported to TypeScript; takes
// the two end slopes directly (AnimX derives them from the control points as ty/tx, which is the same slope); the
// coefficients are computed once per segment at compile time and evaluated by `evaluateHermiteSegment`.

/** Relative tolerance of AnimX's "both tangents parallel to the chord → straight line" short-circuit. */
const PARALLEL_EPSILON = 2e-7;

/** Stride of a prepared Hermite segment: [c0, c1, c2, c3] (value = ((c0·s + c1)·s + c2)·s + c3, s = t − t_k). */
export const HERMITE_STRIDE = 4;

/**
 * Power-basis coefficients of AnimX's non-weighted (Hermite) segment from (startX, startY) with out-slope `m1` to
 * (endX, endY) with in-slope `m2`, written to `out[o … o + 3]`.
 */
export function prepareHermiteSegment(
  startX: number,
  startY: number,
  m1: number,
  m2: number,
  endX: number,
  endY: number,
  out: Float64Array,
  o: number,
): void {
  const dx = endX - startX;
  const dy = endY - startY;
  // If both tangents are parallel to the chord this is a line segment; don't fit a cubic (AnimX "magic number").
  if (
    Math.abs(dx * m1 - dy) <= Math.abs(PARALLEL_EPSILON * dx * m1) &&
    Math.abs(dx * m2 - dy) <= Math.abs(PARALLEL_EPSILON * dx * m2)
  ) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = dy / dx;
    out[o + 3] = startY;
    return;
  }
  const length = 1.0 / (dx * dx);
  const double1 = dx * m1;
  const double2 = dx * m2;
  // c0 = (dx·(m2 + m1) − 2·dy) / dx³ ;  c1 = (3·dy − dx·(2·m1 + m2)) / dx² ;  c2 = m1 ;  c3 = v1
  out[o] = ((double1 + double2 - dy - dy) * length) / dx;
  out[o + 1] = (dy + dy + dy - double1 - double1 - double2) * length;
  out[o + 2] = m1;
  out[o + 3] = startY;
}

/** Value of a prepared Hermite segment `s` frames after its start key. */
export function evaluateHermiteSegment(coef: Float64Array, o: number, s: number): number {
  return s * (s * (s * coef[o]! + coef[o + 1]!) + coef[o + 2]!) + coef[o + 3]!;
}

/** Slope (value per frame) of a prepared Hermite segment `s` frames after its start key. */
export function hermiteSlope(coef: Float64Array, o: number, s: number): number {
  return (3 * coef[o]! * s + 2 * coef[o + 1]!) * s + coef[o + 2]!;
}
