// Chord labels for menus, tooltips and the shortcut sheet: macOS symbols in Apple's modifier order (⌃⌥⇧⌘), else
// 'Ctrl+Alt+Shift+Key'. Key names are US-layout names of the physical key; the editor may replace them with the
// user's layout (navigator.keyboard.getLayoutMap) where available.
import type { Chord } from '../types';

const NAMED: Readonly<Record<string, { readonly mac: string; readonly other: string }>> = {
  Space: { mac: 'Space', other: 'Space' },
  Escape: { mac: 'Esc', other: 'Esc' },
  Enter: { mac: '↩', other: 'Enter' },
  Tab: { mac: '⇥', other: 'Tab' },
  Backspace: { mac: '⌫', other: 'Backspace' },
  Delete: { mac: '⌦', other: 'Del' },
  Home: { mac: 'Home', other: 'Home' },
  End: { mac: 'End', other: 'End' },
  PageUp: { mac: 'PgUp', other: 'PgUp' },
  PageDown: { mac: 'PgDn', other: 'PgDn' },
  ArrowLeft: { mac: '←', other: '←' },
  ArrowRight: { mac: '→', other: '→' },
  ArrowUp: { mac: '↑', other: '↑' },
  ArrowDown: { mac: '↓', other: '↓' },
  Comma: { mac: ',', other: ',' },
  Period: { mac: '.', other: '.' },
  Slash: { mac: '/', other: '/' },
  Backslash: { mac: '\\', other: '\\' },
  Minus: { mac: '-', other: '-' },
  Equal: { mac: '=', other: '=' },
  Semicolon: { mac: ';', other: ';' },
  Quote: { mac: "'", other: "'" },
  BracketLeft: { mac: '[', other: '[' },
  BracketRight: { mac: ']', other: ']' },
  Backquote: { mac: '`', other: '`' },
};

export function keyLabel(code: string, platform: 'mac' | 'other'): string {
  const named = NAMED[code];
  if (named !== undefined) return platform === 'mac' ? named.mac : named.other;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

export function chordLabel(chord: Chord, platform: 'mac' | 'other'): string {
  const key = keyLabel(chord.code, platform);
  if (platform === 'mac') {
    const ctrl = chord.ctrl === true ? '⌃' : '';
    const alt = chord.alt === true ? '⌥' : '';
    const shift = chord.shift === true ? '⇧' : '';
    const command = chord.mod === true ? '⌘' : '';
    return `${ctrl}${alt}${shift}${command}${key}`;
  }
  const parts: string[] = [];
  if (chord.mod === true || chord.ctrl === true) parts.push('Ctrl');
  if (chord.alt === true) parts.push('Alt');
  if (chord.shift === true) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
