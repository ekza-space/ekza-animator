// Adapted from rocicorp/fractional-indexing/src/index.js @ v4.0.0 (CC0-1.0, © Rocicorp). Changes: TypeScript,
// base62 digits only, EkzaError for invalid input, explicit validation helpers.
//
// Fractional index keys order siblings by code-unit string comparison (research 06 R7). A key is an integer part
// followed by an optional fraction:
// - the integer part starts with a head character that encodes its length: 'a'…'z' are non-negative integers with
//   1…26 digits ('a0' is zero), 'A'…'Z' are negative integers with 26…1 digits;
// - the fraction is any run of base62 digits that does not end in '0'.
// `fractionalIndex(null, null)` is 'a0'; appending after the last key increments the integer part, so a list built by
// appending stays short ('a0', 'a1', … 'az', 'b00', …).
import { EkzaError } from '@ekza-animator/anim-core';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = '0';
const LAST_DIGIT = 'z';
/** The smallest integer part: it has no predecessor, so keys before it extend its fraction instead. */
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

/**
 * A key that sorts strictly between `before` and `after` (`null` = open end). Throws `EkzaError('invalid-record')`
 * for malformed keys or when `before >= after`.
 */
export function fractionalIndex(before: string | null, after: string | null): string {
  if (before !== null) validateKey(before);
  if (after !== null) validateKey(after);
  if (before !== null && after !== null && before >= after) {
    throw new EkzaError('invalid-record', `fractionalIndex: '${before}' is not before '${after}'`);
  }
  if (before === null) {
    if (after === null) return `a${ZERO}`;
    const integer = integerPart(after);
    const fraction = after.slice(integer.length);
    if (integer === SMALLEST_INTEGER) return integer + midpoint('', fraction);
    if (integer < after) return integer;
    const decremented = decrementInteger(integer);
    if (decremented === null) throw new EkzaError('invalid-record', `fractionalIndex: no key before '${after}'`);
    return decremented;
  }
  const integerBefore = integerPart(before);
  const fractionBefore = before.slice(integerBefore.length);
  if (after === null) {
    const incremented = incrementInteger(integerBefore);
    return incremented === null ? integerBefore + midpoint(fractionBefore, null) : incremented;
  }
  const integerAfter = integerPart(after);
  const fractionAfter = after.slice(integerAfter.length);
  if (integerBefore === integerAfter) return integerBefore + midpoint(fractionBefore, fractionAfter);
  const incremented = incrementInteger(integerBefore);
  if (incremented === null) throw new EkzaError('invalid-record', `fractionalIndex: no key after '${before}'`);
  if (incremented < after) return incremented;
  return integerBefore + midpoint(fractionBefore, null);
}

/** True for keys `fractionalIndex` accepts (and produces). */
export function isFractionalIndex(key: string): boolean {
  try {
    validateKey(key);
    return true;
  } catch {
    return false;
  }
}

/** A fraction strictly between `a` and `b` (`null` = 1); neither may end in '0'. */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new EkzaError('invalid-record', `fractionalIndex: '${a}' >= '${b}'`);
  if (b !== null) {
    // Strip the common prefix, padding `a` with zeros: `b` cannot end inside it.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a.length > 0 ? DIGITS.indexOf(a.charAt(0)) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b.charAt(0)) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  // The first digits are consecutive.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new EkzaError('invalid-record', `fractionalIndex: invalid key head '${head}'`);
}

function integerPart(key: string): string {
  const length = integerLength(key.charAt(0));
  if (length > key.length) throw new EkzaError('invalid-record', `fractionalIndex: invalid key '${key}'`);
  return key.slice(0, length);
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new EkzaError('invalid-record', 'fractionalIndex: keys must be non-empty strings');
  }
  if (key === SMALLEST_INTEGER) throw new EkzaError('invalid-record', `fractionalIndex: invalid key '${key}'`);
  const integer = integerPart(key);
  for (let i = 1; i < key.length; i++) {
    if (DIGITS.indexOf(key.charAt(i)) < 0) {
      throw new EkzaError('invalid-record', `fractionalIndex: invalid character in key '${key}'`);
    }
  }
  if (key.length > integer.length && key.endsWith(ZERO)) {
    throw new EkzaError('invalid-record', `fractionalIndex: key '${key}' has a trailing zero`);
  }
}

function incrementInteger(integer: string): string | null {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const next = DIGITS.indexOf(digits[i] ?? ZERO) + 1;
    if (next === DIGITS.length) {
      digits[i] = ZERO;
    } else {
      digits[i] = DIGITS.charAt(next);
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return `a${ZERO}`;
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(ZERO);
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(integer: string): string | null {
  const head = integer.charAt(0);
  const digits = integer.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const previous = DIGITS.indexOf(digits[i] ?? ZERO) - 1;
    if (previous === -1) {
      digits[i] = LAST_DIGIT;
    } else {
      digits[i] = DIGITS.charAt(previous);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return `Z${LAST_DIGIT}`;
  if (head === 'A') return null;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < 'Z') digits.push(LAST_DIGIT);
  else digits.pop();
  return previousHead + digits.join('');
}
