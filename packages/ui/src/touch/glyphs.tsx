// The few glyphs the kit draws itself (24-unit strokes, `currentColor`, hidden from screen readers). Verb icons are
// the caller's (`icon` props): the touch shell keeps its own icon set (STUDIO-TOUCH-SPEC §6.1), and the kit
// imports no icon module, so nothing it draws is shared with the Pro shell's eager code.
import type { JSX } from 'react';

const PATHS = {
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  down: 'm6 9 6 6 6-6',
  close: 'M18 6 6 18M6 6l12 12',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6 9 17l-5-5',
  backspace: 'M10 5h10a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H10l-7-7zM17 9l-6 6M11 9l6 6',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  shift: 'M12 4 4 13h4.5v7h7v-7H20z',
  next: 'm9 18 6-6-6-6',
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 20 }: { readonly name: GlyphName; readonly size?: number }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
