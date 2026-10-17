// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Animator contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Adapted from Autodesk/animx/src/animx.cpp (`_autoTangent`, `autoTangent`, `flatTangent`) @
// 11c31ac74e526b599031414866db639383c9a5e0 (Apache-2.0, © Autodesk, Inc.). Changes: ported to TypeScript; returns
// the clamped slope (value per frame) instead of the (x, y) tangent pair, since AnimX's y = slope·x and the x
// component is always the span to the neighbour on that side (the curve engine derives handles from it); end keys
// (a missing neighbour) are flat as in `autoTangent` → `flatTangent`.

/** The AnimX auto-tangent family. */
export type AnimxAutoType = 'auto' | 'autoMix' | 'autoEase';

/** `kEaseCoefficient` (a float in AnimX; −0.5 is exact in both precisions). */
const EASE_COEFFICIENT = -0.5;

/** `_SIGN`: note that the sign of 0 is +1. */
function sign(x: number): number {
  return x < 0.0 ? -1 : 1;
}

/**
 * AnimX `_autoTangent`: the slope of key (x, y) between its neighbours (px, py) and (nx, ny), clamped so the Bézier
 * handle at 1/3 of either span never passes the neighbour's value (local extrema become flat).
 */
export function autoTangentSlope(
  type: AnimxAutoType,
  x: number,
  px: number,
  nx: number,
  y: number,
  py: number,
  ny: number,
): number {
  let targetSlope: number;
  // prevSlope3 and nextSlope3 are the slopes to the left and right keys multiplied by 3
  const prevSlope3 = (3.0 * (y - py)) / (x - px);
  const nextSlope3 = (3.0 * (ny - y)) / (nx - x);

  if (type === 'auto') {
    // Legacy auto tangents: the target slope is the default spline slope.
    targetSlope = (ny - py) / (nx - px);
  } else {
    const prevSlope = (y - py) / (x - px);
    const nextSlope = (ny - y) / (nx - x);
    const f = (x - px) / (nx - px);
    if (type === 'autoMix') {
      // linear interpolation
      targetSlope = (1 - f) * prevSlope + f * nextSlope;
    } else {
      // Cubic interpolation, g(c, f) = 0.5 + (f − 0.5)·(1 − c + 4·c·(f − 0.5)²) with c = −1/2 (strongest influence
      // of the closest neighbour).
      const c = EASE_COEFFICIENT;
      const fMinusHalf = f - 0.5;
      const fMinusHalfSquared = fMinusHalf * fMinusHalf;
      const g = 0.5 + fMinusHalf * (1 - c + 4 * c * fMinusHalfSquared);
      targetSlope = (1 - g) * prevSlope + g * nextSlope;
    }
  }

  // Clamp
  if (sign(prevSlope3) !== sign(nextSlope3) || sign(targetSlope) !== sign(nextSlope3)) {
    targetSlope = 0.0;
  } else if (nextSlope3 >= 0) {
    targetSlope = Math.min(Math.min(targetSlope, nextSlope3), prevSlope3);
  } else {
    targetSlope = Math.max(Math.max(targetSlope, nextSlope3), prevSlope3);
  }
  return targetSlope;
}
