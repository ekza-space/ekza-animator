// The one sanitiser for every outgoing string (MCP-SPEC §5.3), live and headless, re-applied by the server to tab
// results: Unicode NFC; whitespace controls become spaces; every other `Cc` and `Cf` code point is removed (C0/C1
// controls, the bidi controls U+202A–202E and U+2066–2069, the zero-width characters U+200B–200F and U+2060, U+FEFF
// and the tag block U+E0000–E007F used for invisible "ASCII smuggling"); whitespace runs collapse to one space; the
// length is capped (names 120 characters, prose 300, `…` appended when cut).

/** Caps of §5.3 by kind. */
export const NAME_MAX_CHARS = 120;
export const PROSE_MAX_CHARS = 300;
/** Document strings quoted inside prose fields (§5.3): at most this many characters between the quotes. */
export const QUOTE_MAX_CHARS = 40;

const ELLIPSIS = '…';
/** Whitespace control characters (tab, line feed, vertical tab, form feed, carriage return, next line). */
const CONTROL_WHITESPACE = /[\t\n\v\f\r\u0085]/gu;
/** Every remaining control (Cc) and format (Cf) code point, and the whole tag block (U+E0000 itself is unassigned). */
const CONTROLS_AND_FORMATS = /[\p{Cc}\p{Cf}\u{E0000}-\u{E007F}]/gu;
/** Whitespace runs (Unicode White_Space, after the controls are gone). */
const WHITESPACE_RUN = /\s+/gu;

/** Cuts `text` to `max` code points, appending `…` (counted) when it was longer. Never splits a surrogate pair. */
function capLength(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  if (max <= 1) return ELLIPSIS.slice(0, Math.max(0, max));
  return `${points
    .slice(0, max - 1)
    .join('')
    .trimEnd()}${ELLIPSIS}`;
}

/** The one sanitiser for every outgoing string (§5.3), also re-applied by the server to tab results. */
export function sanitizeText(
  text: string,
  opts: { readonly maxChars: number; readonly kind: 'name' | 'prose' },
): string {
  const cleaned = String(text)
    .normalize('NFC')
    .replace(CONTROL_WHITESPACE, ' ')
    .replace(CONTROLS_AND_FORMATS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
  const kindMax = opts.kind === 'name' ? NAME_MAX_CHARS : PROSE_MAX_CHARS;
  return capLength(cleaned, Math.max(0, Math.min(opts.maxChars, kindMax)));
}

/** A document string quoted for a prose field: sanitised, at most 40 characters, in double quotes (§5.3). */
export function quoteName(text: string): string {
  return `"${sanitizeText(text, { maxChars: QUOTE_MAX_CHARS, kind: 'name' })}"`;
}

/** True when `text` contains no `Cc`/`Cf` code point (the adversarial-fixture assertion of §9.2). */
export function isClean(text: string): boolean {
  return !/[\p{Cc}\p{Cf}\u{E0000}-\u{E007F}]/u.test(text);
}

/**
 * Sanitises every string inside a JSON-like value (object keys included), depth first; numbers, booleans and null
 * pass through, typed arrays become their length (JSON-safe values, §5.14). Strings are capped at `maxChars`.
 */
export function sanitizeDeep(
  value: unknown,
  opts: { readonly maxChars: number; readonly kind: 'name' | 'prose' },
): unknown {
  if (typeof value === 'string') return sanitizeText(value, opts);
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (Array.isArray(value)) return value.map((item: unknown) => sanitizeDeep(item, opts));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[sanitizeText(key, { maxChars: NAME_MAX_CHARS, kind: 'name' })] = sanitizeDeep(inner, opts);
  }
  return out;
}
