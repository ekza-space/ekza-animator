// Numeric entry and display (Channel Box, Graph Editor fields): internal units are radians and metres, the UI shows
// degrees for rotation channels (MVP-SPEC §3 convention 4).
import { DEG2RAD, RAD2DEG } from '@ekza-animator/anim-core';
import type { ChannelId } from '@ekza-animator/doc';
import { isRotation } from './channelMeta';

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?`;
const UNIT = String.raw`deg|rad|°`;
const INPUT = new RegExp(String.raw`^(\+=|-=|\*=?|/=?)?\s*(${NUMBER})\s*(${UNIT})?$`, 'i');

/**
 * Parses a typed value in display units against the field's `current` display value:
 *
 * - `45` → 45; `-5` → −5; `+=10` / `-=5` → relative; `*2` / `*=2` / `/2` / `/=2` → scaled;
 * - unit suffixes convert into display degrees: `1.5rad` → 85.94…, `90deg` / `90°` → 90 (a unit is not allowed
 *   with `*` or `/`);
 * - a decimal comma is accepted when the text has no point (`1,5`); U+2212 minus counts as `-`.
 *
 * Returns null for anything else, division by zero and non-finite results.
 */
export function parseNumericInput(text: string, current: number): number | null {
  let source = text.trim().replaceAll('−', '-');
  if (!source.includes('.')) source = source.replace(',', '.');
  const match = INPUT.exec(source);
  if (match === null) return null;
  const operator = match[1] ?? '';
  const unit = (match[3] ?? '').toLowerCase();
  let value = Number(match[2]);
  if (unit !== '' && (operator.startsWith('*') || operator.startsWith('/'))) return null;
  if (unit === 'rad') value *= RAD2DEG;
  let result: number;
  switch (operator) {
    case '':
      result = value;
      break;
    case '+=':
      result = current + value;
      break;
    case '-=':
      result = current - value;
      break;
    case '*':
    case '*=':
      result = current * value;
      break;
    default:
      if (value === 0) return null;
      result = current / value;
  }
  return Number.isFinite(result) ? result : null;
}

/** Display value of a channel: degrees for rotations, else unchanged. */
export function toDisplayValue(channel: ChannelId, value: number): number {
  return isRotation(channel) ? value * RAD2DEG : value;
}

/** Inverse of `toDisplayValue`. */
export function fromDisplayValue(channel: ChannelId, display: number): number {
  return isRotation(channel) ? display * DEG2RAD : display;
}

/** Display text with 3 decimals (degrees for rotations); never `-0.000`. */
export function formatChannelValue(channel: ChannelId, value: number): string {
  const display = toDisplayValue(channel, value);
  if (!Number.isFinite(display)) return String(display);
  const text = display.toFixed(3);
  return /^-0\.0+$/.test(text) ? text.slice(1) : text;
}
