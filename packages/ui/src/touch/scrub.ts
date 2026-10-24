// Distance scrub (STUDIO-TOUCH-SPEC §5.6): drag a value chip sideways to change it; the farther the finger moves
// away vertically, the finer the step (×0.1 at 80 px, ×0.01 at 160 px), as in media scrubbers. The Thumb key's
// Fine (×0.1) and Coarse (×10) multiply on top. It replaces Shift/Ctrl precision, Pointer Lock and the virtual
// slider, so it never needs Pointer Lock (S16). Pure: the chip feeds it pointer offsets.
import { TOUCH } from './constants';

/** The step factor for a vertical distance from the chip (CSS px, either direction). */
export function scrubFactor(offAxis: number): 1 | 0.1 | 0.01 {
  const d = Math.abs(offAxis);
  if (d >= TOUCH.scrubFinerAt) return 0.01;
  if (d >= TOUCH.scrubFineAt) return 0.1;
  return 1;
}

/** Decimal places a step needs (0.25 → 2, 1e-3 → 3, 10 → 0), capped at 6. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  for (let d = 0; d <= 6; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return 6;
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function clampValue(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

export interface ScrubOptions {
  readonly value: number;
  /** One step of the value per `pxPerStep` of horizontal travel at full speed. */
  readonly step: number;
  readonly min?: number;
  readonly max?: number;
  /** Horizontal travel per step (CSS px); default 4. */
  readonly pxPerStep?: number;
}

export interface ScrubSession {
  /** The value after the pointer moved to (dx, dy) from the press; `modifier` is the Thumb key's ×0.1 / ×10. */
  move(dx: number, dy: number, modifier?: number): number;
  /** The current step factor (the guide label: "×0.1"). */
  readonly factor: number;
  readonly value: number;
}

/**
 * A scrub over one drag. Travel is integrated move by move, so changing the distance mid-drag changes only the
 * speed from then on (the value never jumps), and the result is rounded to the effective step's decimals.
 */
export function createScrub(options: ScrubOptions): ScrubSession {
  const pxPerStep = options.pxPerStep ?? 4;
  let raw = options.value;
  let value = options.value;
  let lastDx = 0;
  let factor = 1;
  return {
    move(dx, dy, modifier = 1) {
      factor = scrubFactor(dy) * modifier;
      const effective = options.step * factor;
      raw = clampValue(raw + ((dx - lastDx) / pxPerStep) * effective, options.min, options.max);
      lastDx = dx;
      value = clampValue(roundTo(raw, decimalsOf(effective)), options.min, options.max);
      return value;
    },
    get factor() {
      return factor;
    },
    get value() {
      return value;
    },
  };
}

/** A keyboard step on a value chip (`role="slider"`): arrows ±1 step, Page ±10, Home / End to the range. */
export function keyStep(
  key: string,
  value: number,
  step: number,
  min?: number,
  max?: number,
  coarse = false,
): number | null {
  const big = step * 10;
  const one = coarse ? big : step;
  let next: number;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      next = value + one;
      break;
    case 'ArrowLeft':
    case 'ArrowDown':
      next = value - one;
      break;
    case 'PageUp':
      next = value + big;
      break;
    case 'PageDown':
      next = value - big;
      break;
    case 'Home':
      if (min === undefined) return null;
      next = min;
      break;
    case 'End':
      if (max === undefined) return null;
      next = max;
      break;
    default:
      return null;
  }
  return clampValue(roundTo(next, decimalsOf(step)), min, max);
}

/** A value as the chip shows it: Pro's number with the step's decimals and a true minus sign. */
export function formatValue(value: number, step: number, unit?: string): string {
  const text = roundTo(value, decimalsOf(step)).toFixed(decimalsOf(step)).replace('-', '−');
  return unit === undefined || unit === '' ? text : unit === '°' ? `${text}°` : `${text} ${unit}`;
}
