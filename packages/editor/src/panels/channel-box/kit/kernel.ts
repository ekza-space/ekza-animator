// Adapters over the editor-core, doc and io helpers the WP-9 data panels call (MVP-SPEC §7 WP-7a, WP-2, WP-4).
//
// The panels must use the kernel's helpers rather than private copies (WP-7a DoD). While this branch is built in
// parallel with WP-2/WP-4/WP-7a, those exports are still stubs that throw EkzaError('not-implemented'); each adapter
// then switches, once and for good, to a fallback that follows the same spec text, so the panels already work in
// the /dev/panels harness and in tests. When the real helpers are on `dev` the fallbacks are dead code: delete them
// (docs/wp-notes/wp-9.md, deviation D-1).
import { EkzaError, RAD2DEG } from '@ekza-animator/anim-core';
import {
  type ChannelId,
  defaultChannelValue as docDefaultChannelValue,
  isRotationChannel as docIsRotationChannel,
} from '@ekza-animator/doc';
import {
  beginChannelEditGesture,
  type ChannelEditGesture,
  type EditorApp,
  formatChannelValue as coreFormatChannelValue,
  fromDisplayValue as coreFromDisplayValue,
  type KeyPolicy,
  parseNumericInput as coreParseNumericInput,
  toDisplayValue as coreToDisplayValue,
} from '@ekza-animator/editor-core';
import { type GlbContainer, readVrmLicense as ioReadVrmLicense, type VrmLicenseInfo } from '@ekza-animator/io';

export function isNotImplemented(error: unknown): boolean {
  return error instanceof EkzaError && error.code === 'not-implemented';
}

/**
 * Calls `real` until it either works (then always `real`) or throws `not-implemented` (then always `fallback`).
 * Other errors propagate and leave the choice open.
 */
export function withFallback<A extends readonly unknown[], R>(
  real: (...args: A) => R,
  fallback: (...args: A) => R,
): (...args: A) => R {
  let chosen: ((...args: A) => R) | null = null;
  return (...args: A): R => {
    if (chosen !== null) return chosen(...args);
    try {
      const result = real(...args);
      chosen = real;
      return result;
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
      chosen = fallback;
      return fallback(...args);
    }
  };
}

// ---------- channel units (doc / editor-core) ----------

/** `rx`, `ry`, `rz`: shown in degrees. */
export const isRotationChannel: (channel: ChannelId) => boolean = withFallback(
  docIsRotationChannel,
  (channel) => channel === 'rx' || channel === 'ry' || channel === 'rz',
);

/** 1 for `sx`/`sy`/`sz`, else 0 (the value a reset writes). */
export const defaultChannelValue: (channel: ChannelId) => number = withFallback(docDefaultChannelValue, (channel) =>
  channel === 'sx' || channel === 'sy' || channel === 'sz' ? 1 : 0,
);

/** Internal units (radians, metres) → display units (degrees for rotations). */
export const toDisplayValue: (channel: ChannelId, value: number) => number = withFallback(
  coreToDisplayValue,
  (channel, value) => (isRotationChannel(channel) ? value * RAD2DEG : value),
);

/** Display units → internal units. */
export const fromDisplayValue: (channel: ChannelId, display: number) => number = withFallback(
  coreFromDisplayValue,
  (channel, display) => (isRotationChannel(channel) ? display / RAD2DEG : display),
);

/** Degrees for rotations, three decimals; never `-0.000`. */
export const formatChannelValue: (channel: ChannelId, value: number) => string = withFallback(
  coreFormatChannelValue,
  (channel, value) => formatFixed(toDisplayValue(channel, value), 3),
);

/** `toFixed` without a negative zero. */
export function formatFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

// ---------- numeric input (editor-core `parseNumericInput`) ----------

/**
 * The numeric-field grammar of research 09 §6.4: `[=]expr`, relative `+=`, `-=`, `*=`, `/=` (and the short `*x`,
 * `/x`), where `expr` has `+ - * / ( )`, decimals, exponents and a `deg`/`°`/`rad` suffix (radians are converted
 * to degrees, the display unit of angles). `current` is the field's value in display units. Returns null for
 * anything else, including a non-finite result.
 */
export const parseNumericInput: (text: string, current: number) => number | null = withFallback(
  coreParseNumericInput,
  fallbackParseNumericInput,
);

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

/** Recursive-descent evaluation of `expr` over the whole token list; null on a syntax error. */
function evaluateTokens(tokens: readonly Token[]): number | null {
  let at = 0;
  const peekOp = (...ops: readonly string[]): '+' | '-' | '*' | '/' | null => {
    const token = tokens[at];
    return token?.kind === 'op' && ops.includes(token.op) ? token.op : null;
  };
  const withUnit = (value: number): number => {
    const token = tokens[at];
    if (token?.kind !== 'unit') return value;
    at++;
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
    const operand = unary();
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
  return value !== null && at === tokens.length ? value : null;
}

function evaluateExpression(text: string): number | null {
  const tokens = tokenize(text);
  return tokens === null || tokens.length === 0 ? null : evaluateTokens(tokens);
}

/** The fallback of `parseNumericInput` (exported for its own tests). */
export function fallbackParseNumericInput(text: string, current: number): number | null {
  const source = text.trim();
  let result: number | null;
  const relative = /^([+\-*/])=(.*)$/s.exec(source);
  if (relative !== null) {
    const operand = evaluateExpression(relative[2] ?? '');
    result = operand === null ? null : applyOperator(relative[1] ?? '', current, operand);
  } else if (source.startsWith('*') || source.startsWith('/')) {
    const operand = evaluateExpression(source.slice(1));
    result = operand === null ? null : applyOperator(source[0] ?? '', current, operand);
  } else {
    result = evaluateExpression(source.startsWith('=') ? source.slice(1) : source);
  }
  return result !== null && Number.isFinite(result) ? result : null;
}

function applyOperator(op: string, left: number, right: number): number | null {
  switch (op) {
    case '+':
      return left + right;
    case '-':
      return left - right;
    case '*':
      return left * right;
    case '/':
      return left / right;
    default:
      return null;
  }
}

// ---------- interactive edits (editor-core edit kernel) ----------

/**
 * `beginChannelEditGesture`, or null while the edit kernel is not implemented (callers then fall back to one
 * `channel.setValues` run per gesture).
 */
export function startChannelEditGesture(
  app: EditorApp,
  label: string,
  opts: { readonly key: KeyPolicy },
): ChannelEditGesture | null {
  try {
    return beginChannelEditGesture(app, label, opts);
  } catch (error) {
    if (isNotImplemented(error)) return null;
    throw error;
  }
}

// ---------- VRM meta (io) ----------

/**
 * The model's VRM licence; null when the file has none (or its meta cannot be read: a panel never fails on file
 * content); undefined while io cannot read it yet.
 */
export function readVrmLicense(container: GlbContainer): VrmLicenseInfo | null | undefined {
  try {
    return ioReadVrmLicense(container);
  } catch (error) {
    return isNotImplemented(error) ? undefined : null;
  }
}
