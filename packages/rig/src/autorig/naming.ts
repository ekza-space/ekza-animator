import type { Side } from '@ekza-animator/doc';

// Naming helpers for generated controls: sanitized node names, sibling order keys and left/right inference from
// node names (research 07 §16.3).

/** Node name reduced to `[A-Za-z0-9_-]` (anything else becomes `_`); empty names become `node`. */
export function sanitizeNodeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned.length === 0 ? 'node' : cleaned;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Order key of the i-th sibling in the fractional-indexing integer-key format (rocicorp `fractional-indexing`):
 * `a0`…`az` (one base-62 digit), then `b00`…`bzz`, `c000`, … Keys increase strictly in string order, so siblings
 * sort exactly as generated.
 */
export function orderKey(index: number): string {
  let digits = 1;
  let capacity = 62;
  let rest = Math.max(0, Math.floor(index));
  while (rest >= capacity) {
    rest -= capacity;
    digits++;
    capacity = 62 ** digits;
  }
  let body = '';
  for (let d = 0; d < digits; d++) {
    body = BASE62.charAt(rest % 62) + body;
    rest = Math.floor(rest / 62);
  }
  return String.fromCharCode(96 + digits) + body;
}

interface SideMatch {
  readonly side: 'L' | 'R';
  /** The name with the side token swapped (case preserved). */
  readonly mirrored: string;
}

const SIDE_PATTERNS: readonly {
  readonly re: RegExp;
  readonly swap: (m: RegExpMatchArray, name: string) => SideMatch;
}[] = [
  // Suffixes `.L`, `_L`, `-L`, ` L` (case-insensitive: `_l`, `.r`, …).
  {
    re: /([._ -])([LlRr])$/,
    swap: (m, name) => {
      const token = m[2] as string;
      const side = token.toUpperCase() === 'L' ? 'L' : 'R';
      const other = swapCase(token, side === 'L' ? 'R' : 'L');
      return { side, mirrored: `${name.slice(0, name.length - 1)}${other}` };
    },
  },
  // Prefixes `L_`, `L.`, `L-`, `l_`, …
  {
    re: /^([LlRr])([._-])/,
    swap: (m, name) => {
      const token = m[1] as string;
      const side = token.toUpperCase() === 'L' ? 'L' : 'R';
      return { side, mirrored: `${swapCase(token, side === 'L' ? 'R' : 'L')}${name.slice(1)}` };
    },
  },
  // The words Left / Right anywhere (`mixamorig:LeftArm`, `hand_left`).
  {
    re: /(left|right)/i,
    swap: (m, name) => {
      const token = m[1] as string;
      const index = m.index ?? 0;
      const side = token.toLowerCase() === 'left' ? 'L' : 'R';
      const other = side === 'L' ? 'right' : 'left';
      const replaced = matchCase(token, other);
      return { side, mirrored: name.slice(0, index) + replaced + name.slice(index + token.length) };
    },
  },
];

/** Side and mirrored name of a node name, or null when the name carries no side. */
export function sideFromName(name: string): SideMatch | null {
  for (const pattern of SIDE_PATTERNS) {
    const match = name.match(pattern.re);
    if (match !== null) return pattern.swap(match, name);
  }
  return null;
}

export function sideOf(name: string): Side {
  return sideFromName(name)?.side ?? 'C';
}

function swapCase(token: string, side: 'L' | 'R'): string {
  return token === token.toUpperCase() ? side : side.toLowerCase();
}

function matchCase(template: string, word: string): string {
  if (template === template.toUpperCase()) return word.toUpperCase();
  if (template.charAt(0) === template.charAt(0).toUpperCase()) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}
