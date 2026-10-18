// Numeric entry and display (Channel Box, Graph Editor fields): internal units are radians and metres, the UI shows
// degrees for rotation channels (MVP-SPEC §3 convention 4) and for attributes with `unit: 'angle'` (M2A-SPEC §5.1
// rule 5: callers that know the control pass `channelUnit(control, channel)`).
import { DEG2RAD, RAD2DEG } from '@ekza-animator/anim-core';
import type { ChannelId } from '@ekza-animator/doc';
import type { ChannelUnit } from '../types';
import { isRotation } from './channelMeta';

/**
 * Parses a typed value in display units against the field's `current` display value, with the shared numeric-field
 * grammar of research 09 §6.4 (v0.3 integration: one parser for the Channel Box, the Graph Editor fields and the
 * other numeric fields): `[=]expr` sets, `+=`/`-=` add, `*=`/`/=` (and the short `*x`/`/x`) scale.
 *
 * - `expr` has `+ - * / ( )`, decimals and exponents, one optional sign per operand (`2 * -3`, not `--5`);
 * - unit suffixes after a number or a parenthesised group convert into display degrees: `1.5rad` → 85.94…,
 *   `90deg` / `90°` → 90; a scale (`*`, `/`) takes no unit;
 * - a decimal comma is accepted when the text has no point (`1,5`); U+2212 minus counts as `-`.
 *
 * Returns null for anything else, division by zero and non-finite results.
 */
export function parseNumericInput(text: string, current: number): number | null {
  let source = text.trim().replaceAll('\u2212', '-');
  if (!source.includes('.')) source = source.replace(',', '.');
  let result: number | null;
  const relative = /^([+\-*/])=(.*)$/s.exec(source);
  if (relative !== null) {
    result = applyRelative(relative[1] ?? '', current, relative[2] ?? '');
  } else if (source.startsWith('*') || source.startsWith('/')) {
    result = applyRelative(source[0] ?? '', current, source.slice(1));
  } else {
    result = evaluateExpression(source.startsWith('=') ? source.slice(1) : source)?.value ?? null;
  }
  return result !== null && Number.isFinite(result) ? result : null;
}

function applyRelative(op: string, current: number, operandText: string): number | null {
  const operand = evaluateExpression(operandText);
  if (operand === null) return null;
  switch (op) {
    case '+':
      return current + operand.value;
    case '-':
      return current - operand.value;
    case '*':
      return operand.hasUnit ? null : current * operand.value;
    default:
      return operand.hasUnit || operand.value === 0 ? null : current / operand.value;
  }
}

type Token =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'op'; readonly op: '+' | '-' | '*' | '/' }
  | { readonly kind: 'open' }
  | { readonly kind: 'close' }
  | { readonly kind: 'unit'; readonly factor: number };

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i;
const UNIT = /^(?:deg|rad|°)/i;

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let rest = text;
  while (rest.length > 0) {
    const ch = rest[0];
    if (ch === ' ' || ch === '\t') {
      rest = rest.slice(1);
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number !== null) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      rest = rest.slice(number[0].length);
      continue;
    }
    const unit = UNIT.exec(rest);
    if (unit !== null) {
      tokens.push({ kind: 'unit', factor: unit[0].toLowerCase() === 'rad' ? RAD2DEG : 1 });
      rest = rest.slice(unit[0].length);
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') tokens.push({ kind: 'op', op: ch });
    else if (ch === '(') tokens.push({ kind: 'open' });
    else if (ch === ')') tokens.push({ kind: 'close' });
    else return null;
    rest = rest.slice(1);
  }
  return tokens;
}

/** Recursive-descent evaluation over the whole text; null on a syntax error. `hasUnit`: a unit suffix was used. */
function evaluateExpression(text: string): { readonly value: number; readonly hasUnit: boolean } | null {
  const tokens = tokenize(text);
  if (tokens === null || tokens.length === 0) return null;
  let at = 0;
  let hasUnit = false;
  const peekOp = (...ops: readonly string[]): '+' | '-' | '*' | '/' | null => {
    const token = tokens[at];
    return token?.kind === 'op' && ops.includes(token.op) ? token.op : null;
  };
  const withUnit = (value: number): number => {
    const token = tokens[at];
    if (token?.kind !== 'unit') return value;
    at++;
    hasUnit = true;
    return value * token.factor;
  };
  const primary = (): number | null => {
    const token = tokens[at];
    if (token?.kind === 'number') {
      at++;
      return withUnit(token.value);
    }
    if (token?.kind === 'open') {
      at++;
      const inner = expression();
      if (inner === null || tokens[at]?.kind !== 'close') return null;
      at++;
      return withUnit(inner);
    }
    return null;
  };
  const unary = (): number | null => {
    const sign = peekOp('+', '-');
    if (sign === null) return primary();
    at++;
    const operand = primary();
    return operand === null ? null : sign === '-' ? -operand : operand;
  };
  const term = (): number | null => {
    let value = unary();
    for (let op = peekOp('*', '/'); value !== null && op !== null; op = peekOp('*', '/')) {
      at++;
      const right = unary();
      value = right === null ? null : op === '*' ? value * right : value / right;
    }
    return value;
  };
  function expression(): number | null {
    let value = term();
    for (let op = peekOp('+', '-'); value !== null && op !== null; op = peekOp('+', '-')) {
      at++;
      const right = term();
      value = right === null ? null : op === '+' ? value + right : value - right;
    }
    return value;
  }
  const value = expression();
  return value !== null && at === tokens.length ? { value, hasUnit } : null;
}

/** Degrees in the UI: a given unit wins ('angle'), else the M1 rule (rotation channels). */
function shownInDegrees(channel: ChannelId, unit: ChannelUnit | undefined): boolean {
  return unit === undefined ? isRotation(channel) : unit === 'angle';
}

/** Display value of a channel: degrees for angles (rotations, or `unit: 'angle'`), else unchanged. */
export function toDisplayValue(channel: ChannelId, value: number, unit?: ChannelUnit): number {
  return shownInDegrees(channel, unit) ? value * RAD2DEG : value;
}

/** Inverse of `toDisplayValue` (typed values are display units: `30` on an angle attribute is 30°). */
export function fromDisplayValue(channel: ChannelId, display: number, unit?: ChannelUnit): number {
  return shownInDegrees(channel, unit) ? display * DEG2RAD : display;
}

/** Display text with 3 decimals (degrees for angles); never `-0.000`. */
export function formatChannelValue(channel: ChannelId, value: number, unit?: ChannelUnit): string {
  const display = toDisplayValue(channel, value, unit);
  if (!Number.isFinite(display)) return String(display);
  const text = display.toFixed(3);
  return /^-0\.0+$/.test(text) ? text.slice(1) : text;
}
