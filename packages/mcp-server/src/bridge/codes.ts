// Pairing codes and tokens of the bridge (MCP-SPEC §5.10): the SERVER generates the codes (crypto random, rejection
// sampling) from a 31-symbol alphabet without look-alikes, six characters shown as `K7Q-M4P`; claims accept them with
// or without the dash, in any case, compared in constant time. Session tokens are 32 random bytes (base64url), held in
// memory only.
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** 31 symbols: no 0/O, 1/I/L (§5.10). */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 6;
const CLAIM = /^[A-HJKMNP-Z2-9]{3}-?[A-HJKMNP-Z2-9]{3}$/;

/** A fresh code (canonical form, no dash) that `taken` does not hold yet. */
export function generatePairingCode(taken: (code: string) => boolean = () => false): string {
  const limit = 256 - (256 % PAIRING_ALPHABET.length); // 248: unbiased
  for (;;) {
    let code = '';
    while (code.length < PAIRING_CODE_LENGTH) {
      for (const byte of randomBytes(16)) {
        if (byte >= limit) continue;
        code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
        if (code.length === PAIRING_CODE_LENGTH) break;
      }
    }
    if (!taken(code)) return code;
  }
}

/** `K7QM4P` → `K7Q-M4P` (what the editor shows). */
export function displayPairingCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/** A claimed code in canonical form (upper case, no dash), or null when it is not a well-formed code. */
export function normalizePairingCode(text: string): string | null {
  const upper = text.trim().toUpperCase();
  return CLAIM.test(upper) ? upper.replace('-', '') : null;
}

/** Constant-time equality of two canonical codes (or tokens). */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** 256-bit session token, base64url (§5.10). */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** `length` random base62 characters (rejection sampling). */
export function randomBase62(length = 12): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue;
      out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}
