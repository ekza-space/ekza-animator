// Grid steps for the Graph Editor and the time slider (research 09 §4.7): frames step through {1, 2, 5, 10, 20, 50,
// 100, …} (integer frames only) with ≥ 48 px between lines; values use "nice numbers" {1, 2, 5}·10ⁿ with ≥ 32 px.
// Major lines fall on every fifth step.

export const MIN_FRAME_STEP_PX = 48;
export const MIN_VALUE_STEP_PX = 32;
export const MAJOR_EVERY = 5;

const NICE = [1, 2, 5] as const;

/** Smallest nice step (`{1,2,5}·10ⁿ`, n ≥ `minExponent`) whose screen length `step·scale` is at least `minPx`. */
function niceStep(scale: number, minPx: number, minExponent: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return 1;
  const raw = minPx / scale;
  let exponent = Math.max(Math.floor(Math.log10(raw)), minExponent);
  for (let guard = 0; guard < 64; guard++, exponent++) {
    const decade = 10 ** exponent;
    for (const nice of NICE) {
      const step = nice * decade;
      if (step * scale >= minPx * (1 - 1e-12)) return step;
    }
  }
  return 10 ** exponent;
}

/** Frame grid step for `sx` px per frame: an integer ≥ 1. */
export function frameStep(sx: number, minPx: number = MIN_FRAME_STEP_PX): number {
  return niceStep(sx, minPx, 0);
}

/** Value grid step for `sy` px per display unit. */
export function valueStep(sy: number, minPx: number = MIN_VALUE_STEP_PX): number {
  return niceStep(sy, minPx, -12);
}

/** Decimal places that print every multiple of `step` exactly (e.g. 0.05 → 2). */
export function stepDecimals(step: number): number {
  if (step >= 1) return 0;
  return Math.min(12, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

/** True when `index · step` lies on a major line. */
export function isMajor(index: number): boolean {
  return index % MAJOR_EVERY === 0;
}
