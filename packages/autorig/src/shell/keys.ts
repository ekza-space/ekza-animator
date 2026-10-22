// The wizard's keyboard (AUTORIG-SPEC §8.1; D3): the `autorig` key scope. A window listener in the capture phase
// matches `AUTORIG_KEYMAP` (the frame's global rows and each step's) against the current step and runs the operator
// or the shell action; a handled key is prevented, so the host's keyboard adapter (which skips prevented events)
// never runs Studio's binding for it. Everything else falls through to the shipped keymap (Esc, F, Shift+F …).
import type { Chord } from '@ekza-studio/editor-core';
import { AUTORIG_KEYMAP, type AutoRigKeyBinding } from '../keymap';
import type { AutoRigStep } from '../types';

/** Whether `e` is the chord (`mod` = Cmd on macOS, Ctrl elsewhere; a literal Ctrl chord is Ctrl everywhere). */
export function matchesChord(chord: Chord, e: KeyboardEvent, mac: boolean): boolean {
  if (e.code !== chord.code) return false;
  const mod = mac ? e.metaKey : e.ctrlKey;
  const wantMod = chord.mod === true || (!mac && chord.ctrl === true);
  const wantCtrl = mac && chord.ctrl === true;
  return (
    mod === wantMod &&
    e.shiftKey === (chord.shift === true) &&
    e.altKey === (chord.alt === true) &&
    (!mac || e.ctrlKey === wantCtrl)
  );
}

const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** A text field has the focus (its keys stay its own). */
export function inText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
  return target instanceof HTMLInputElement && TEXT_TYPES.has(target.type);
}

/** The binding of a key press in a step, or null. */
export function bindingFor(e: KeyboardEvent, step: AutoRigStep, mac: boolean): AutoRigKeyBinding | null {
  for (const binding of AUTORIG_KEYMAP) {
    if (binding.steps !== 'all' && !binding.steps.includes(step)) continue;
    if (!matchesChord(binding.chord, e, mac)) continue;
    if (binding.notInText !== false && inText(e.target)) continue;
    return binding;
  }
  return null;
}

/** Human text of a chord for the shortcuts sheet (`⌘Z` on macOS, `Ctrl+Z` elsewhere). */
export function chordText(chord: Chord, mac: boolean): string {
  const key = chord.code.replace(/^Key|^Digit/, '');
  const parts = [
    chord.ctrl === true ? (mac ? '⌃' : 'Ctrl+') : '',
    chord.alt === true ? (mac ? '⌥' : 'Alt+') : '',
    chord.shift === true ? (mac ? '⇧' : 'Shift+') : '',
    chord.mod === true ? (mac ? '⌘' : 'Ctrl+') : '',
  ];
  return `${parts.join('')}${key === 'Enter' ? (mac ? '↩' : 'Enter') : key}`;
}
