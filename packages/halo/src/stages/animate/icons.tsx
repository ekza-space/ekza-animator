// The Animate stage's icons (STUDIO-TOUCH-SPEC §6.1, §10.3; T7): line icons on the Halo's 24 px grid (1.8 px stroke,
// `currentColor`) for the Thread and the Animations row. A fixed table, never user input; buttons always carry a word
// or an accessible name next to the icon (§3 P6).
import type { JSX } from 'react';

const ICONS = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  library: '<path d="M4 4.5v15M8.5 4.5v15"/><path d="m13 5 4.5-1 3 15-4.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  repeat:
    '<path d="M17 3.5 20.5 7 17 10.5"/><path d="M3.5 12V10a3 3 0 0 1 3-3h14"/><path d="M7 20.5 3.5 17 7 13.5"/><path d="M20.5 12v2a3 3 0 0 1-3 3h-14"/>',
  start: '<path d="M6 5v14"/><path d="m18 5-9 7 9 7z" fill="currentColor"/>',
  end: '<path d="M18 5v14"/><path d="m6 5 9 7-9 7z" fill="currentColor"/>',
  prevKey: '<path d="M15 6 9 12l6 6"/><path d="M5 12 7.5 9.5 10 12 7.5 14.5z" fill="currentColor"/>',
  nextKey: '<path d="m9 6 6 6-6 6"/><path d="M19 12 16.5 9.5 14 12 16.5 14.5z" fill="currentColor"/>',
  key: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  paste: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h4"/>',
  delete: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  ease: '<path d="M3.5 19c6 0 5-14 17-14"/>',
  between: '<path d="M4 12h16"/><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
  columns: '<path d="M12 4v16"/><path d="M8 12 12 8 16 12 12 16z" fill="currentColor"/>',
  move: '<path d="M4 12h16"/><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
  stretch: '<path d="M4 6v12M20 6v12"/><path d="M8 12h8"/><path d="m10 9-3 3 3 3M14 9l3 3-3 3"/>',
  hold: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  insert: '<path d="M12 4v16"/><path d="M5 9v6M19 9v6"/>',
  remove: '<path d="M5 12h14"/><path d="M5 9v6M19 9v6"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 17M8 16.5 20 7"/>',
  brackets: '<path d="M8 4H5v16h3M16 4h3v16h-3"/>',
  rename: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="m14.5 5.5 3 3"/>',
  duplicate:
    '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/><path d="M14 11v6M11 14h6"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
  person: '<circle cx="12" cy="5" r="2.5"/><path d="M12 8v6M7.5 10.5 12 9l4.5 1.5M9 21l3-7 3 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
} as const;

export type AnimateIcon = keyof typeof ICONS;

export function AnimateGlyph({ name, size = 20 }: { readonly name: AnimateIcon; readonly size?: number }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      // The fixed table above: shapes only, no user input.
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
