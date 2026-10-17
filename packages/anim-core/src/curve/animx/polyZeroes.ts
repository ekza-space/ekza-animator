// SPDX-License-Identifier: Apache-2.0
// Copyright Autodesk, Inc. (AnimX); TypeScript port: Ekza Animator contributors. See ../../../NOTICE.
// Licensed under the Apache License, Version 2.0 (../../../LICENSE-APACHE-2.0).
// Adapted from Autodesk/animx/src/internal/nurbs.h @ 11c31ac74e526b599031414866db639383c9a5e0 (Apache-2.0,
// © Autodesk, Inc.). Changes: ported to TypeScript; `goto` loops rewritten as structured loops; per-level scratch
// buffers instead of stack arrays (no allocation per call); polynomials of degree ≤ 6 only; Brent iterations capped
// at 1,000 as a safety net (never reached in practice).

/** `nurbs::initTolerance()`: the machine epsilon of float64. */
const EPSILON = Number.EPSILON;
const MAX_DEGREE = 6;
const LEVELS = MAX_DEGREE + 1;
const MAX_BRENT_ITERATIONS = 1000;

// One scratch set per recursion level (each level solves the derivative of the previous one).
const P: Float64Array[] = [];
const D: Float64Array[] = [];
const DR: Float64Array[] = [];
for (let level = 0; level < LEVELS; level++) {
  P.push(new Float64Array(MAX_DEGREE + 2));
  D.push(new Float64Array(MAX_DEGREE + 2));
  DR.push(new Float64Array(MAX_DEGREE + 2));
}

/** Horner evaluation of `p[0] + p[1]·s + … + p[deg]·s^deg`. */
export function horner(p: Float64Array, deg: number, s: number): number {
  let d = deg;
  let h = p[d]!;
  while (--d >= 0) h = s * h + p[d]!;
  return h;
}

/** Brent's zero finder (`zeroin2`) on the polynomial `p` of degree `deg`. */
function zeroin2(a0: number, b0: number, fa0: number, fb0: number, tol: number, p: Float64Array, deg: number): number {
  let a = a0;
  let b = b0;
  let fa = fa0;
  let fb = fb0;
  let c = 0;
  let fc = 0;
  let d = 0;
  let e = 0;
  let restart = true;
  for (let iteration = 0; iteration < MAX_BRENT_ITERATIONS; iteration++) {
    if (restart) {
      // label1
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    // label2
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    // convergence test
    const del = 2.0 * EPSILON * Math.abs(b) + 0.5 * tol;
    const m = 0.5 * (c - b);
    if (!(Math.abs(m) > del && fb !== 0.0)) return b;
    if (Math.abs(e) < del || Math.abs(fa) <= Math.abs(fb)) {
      // bisection
      d = m;
      e = d;
    } else {
      let s = fb / fa;
      let p1: number;
      let q: number;
      if (a === c) {
        // linear interpolation
        p1 = 2.0 * m * s;
        q = 1.0 - s;
      } else {
        // inverse quadratic interpolation
        q = fa / fc;
        const r = fb / fc;
        p1 = s * (2.0 * m * q * (q - r) - (b - a) * (r - 1.0));
        q = (q - 1.0) * (r - 1.0) * (s - 1.0);
      }
      // adjust the sign
      if (p1 > 0.0) q = -q;
      else p1 = -p1;
      // check if interpolation is acceptable
      s = e;
      e = d;
      if (2.0 * p1 < 3.0 * m * q - Math.abs(del * q) && p1 < Math.abs(0.5 * s * q)) {
        d = p1 / q;
      } else {
        d = m;
        e = d;
      }
    }
    // complete step
    a = b;
    fa = fb;
    if (Math.abs(d) > del) b += d;
    else if (m > 0.0) b += del;
    else b -= del;
    fb = horner(p, deg, b);
    restart = fb * (fc / Math.abs(fc)) > 0.0;
  }
  return b;
}

function zeroin(a: number, b: number, tol: number, p: Float64Array, deg: number): number {
  const fa = horner(p, deg, a);
  if (Math.abs(fa) < EPSILON) return a;
  const fb = horner(p, deg, b);
  if (Math.abs(fb) < EPSILON) return b;
  return zeroin2(a, b, fa, fb, tol, p, deg);
}

/**
 * Real roots of `poly` (coefficients in ascending powers) in the interval between `a` and `b` (each end open or
 * closed), written to `roots` in increasing order. Returns the root count, or −1 for the zero polynomial.
 */
export function polyZeroes(
  poly: ArrayLike<number>,
  degree: number,
  a: number,
  aClosed: boolean,
  b: number,
  bClosed: boolean,
  roots: Float64Array,
): number {
  if (degree > MAX_DEGREE) throw new RangeError(`polyZeroes supports degree ≤ ${MAX_DEGREE}`);
  return polyZeroesAt(0, poly, degree, a, aClosed, b, bClosed, roots);
}

function polyZeroesAt(
  level: number,
  poly: ArrayLike<number>,
  degree: number,
  a: number,
  aClosed: boolean,
  b: number,
  bClosed: boolean,
  roots: Float64Array,
): number {
  let deg = degree;
  let e = 0.0;
  let pe = 0.0;
  let s = 0.0;
  let ps = 0.0;

  let f = 0.0;
  for (let i = 0; i < deg + 1; ++i) f += Math.abs(poly[i]!);
  const tol = (Math.abs(a) + Math.abs(b)) * (deg + 1) * EPSILON;

  // Zero polynomial to tolerance?
  if (f <= tol) return -1;

  const p = P[level]!;
  const d = D[level]!;
  const dr = DR[level]!;

  // normalize the polynomial (by absolute values)
  for (let i = 0; i < deg + 1; ++i) p[i] = (1.0 / f) * poly[i]!;

  // determine true degree
  while (Math.abs(p[deg]!) < tol) deg--;

  // Identically zero poly already caught so constant fn != 0
  let nr = 0;
  if (deg === 0) return nr;

  // check for linear case
  if (deg === 1) {
    const r = -p[0]! / p[1]!;
    roots[0] = r;
    const leftOk = aClosed ? a < r + tol : a < r - tol;
    const rightOk = bClosed ? b > r - tol : b > r + tol;
    nr = leftOk && rightOk ? 1 : 0;
    if (nr !== 0) {
      if (aClosed && r < a) roots[0] = a;
      else if (bClosed && r > b) roots[0] = b;
    }
    return nr;
  }

  // handle non-linear case: compute the derivative and find its roots
  for (let i = 1; i <= deg; i++) d[i - 1] = i * p[i]!;
  const ndr = polyZeroesAt(level + 1, d, deg - 1, a, false, b, false, dr);
  if (ndr === -1) return 0;

  // find roots between roots of the derivative
  let skip = false;
  for (let i = 0; i <= ndr; i++) {
    if (nr > deg) return nr;
    if (i === 0) {
      s = a;
      ps = horner(p, deg, s);
      if (Math.abs(ps) <= tol && aClosed) roots[nr++] = a;
    } else {
      s = e;
      ps = pe;
    }
    if (i === ndr) {
      e = b;
      skip = false;
    } else {
      e = dr[i]!;
    }
    pe = horner(p, deg, e);
    if (skip) {
      skip = false;
    } else if (Math.abs(pe) < tol) {
      if (i !== ndr || bClosed) {
        roots[nr++] = e;
        skip = true;
      }
    } else if ((ps < 0 && pe > 0) || (ps > 0 && pe < 0)) {
      roots[nr++] = zeroin(s, e, 0.0, p, deg);
      if (nr > 1 && roots[nr - 2]! >= roots[nr - 1]! - tol) {
        roots[nr - 2] = (roots[nr - 2]! + roots[nr - 1]!) * 0.5;
        nr--;
      }
    }
  }
  return nr;
}
