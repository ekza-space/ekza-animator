// The Halo's icons (STUDIO-TOUCH-SPEC §6.1): line icons kept inside the Halo package, so operators' `icon` field and
// `/editor` stay untouched. Drawn from the published prototype's set (24 px grid, 1.8 px stroke, `currentColor`); the
// markup is a fixed table, never user input. Petals and buttons always carry a word next to the icon (§3 P6).
import type { JSX } from 'react';

const ICONS = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  layout: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M9.5 9v11"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  pull: '<path d="M12 17V4"/><path d="m6.5 9.5 5.5-5.5 5.5 5.5"/><path d="M4 20h16"/>',
  inset: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  bevel: '<path d="M8 3.5h8l4.5 4.5v8L16 20.5H8L3.5 16V8z"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.2-1-1.5-1-2.6 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-3.9-4-7.2-9-7.2z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  delete: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  key: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 3"/><path d="M8.5 7 3.5 12l5 5z"/><path d="m15.5 7 5 5-5 5z"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  paste: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h4"/>',
  shape: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  faces:
    '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m12 12 8-4.5v9L12 21z" fill="currentColor" opacity=".35"/>',
  select: '<path d="M4 4l6.5 16 2.3-6.7L19.5 11z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  duplicate:
    '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/><path d="M14 11v6M11 14h6"/>',
  paint:
    '<path d="M9.5 14.5 18 6a2.1 2.1 0 0 1 3 3l-8.5 8.5"/><path d="M7 15.5c-2 0-3.5 1.5-3.5 3.5 0 .8-.4 1.3-1 1.5 1 .7 2.2 1 3.5 1 2.2 0 4-1.8 4-4 0-1.1-.9-2-3-2z"/>',
  rig: '<circle cx="12" cy="5" r="2.5"/><path d="M12 8v7M8 10.5h8M9 21l3-6 3 6"/>',
  cut: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 17M8 16.5 20 7"/>',
  merge: '<path d="M6 4v5a6 6 0 0 0 6 6M18 4v5a6 6 0 0 1-6 6v5"/>',
  slide: '<path d="M4 12h16"/><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
  weld: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 16 16 8"/>',
  connect:
    '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M7.5 7.5 16.5 16.5" stroke-dasharray="2 2.5"/>',
  clip: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7.5 4v16M16.5 4v16M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/>',
  orient: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  bind: '<path d="M17 4.5a2.5 2.5 0 0 1 2.4 3.2 2.5 2.5 0 0 1-1.7 4.4l-5.6 5.6a2.5 2.5 0 0 1-4.4 1.7 2.5 2.5 0 0 1-3.2-2.4 2.5 2.5 0 0 1 2.4-2.5l5.6-5.6A2.5 2.5 0 0 1 17 4.5z"/>',
  again: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.5h-4.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  backspace: '<path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="m12 9 6 6M18 9l-6 6"/>',
  options: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  upload:
    '<path d="M12 15V3.5"/><path d="m7 8 5-4.5L17 8"/><path d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/><path d="m14.5 5.5 3 3"/>',
  warn: '<path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>',
} as const;

export type VerbIcon = keyof typeof ICONS;

export function Icon({ name, size = 20 }: { readonly name: VerbIcon; readonly size?: number }): JSX.Element {
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
