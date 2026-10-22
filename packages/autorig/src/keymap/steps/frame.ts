// Key bindings of the frame (AUTORIG-SPEC §8.1; D3 owns the list): the global rows. The shell handles them in the
// capture phase before the host's keyboard adapter: undo/redo (refused while a composition runs, §4.5), `Mod+Enter`
// the step's primary button, `Alt+1…5` the steps (the browser default and Studio's layout presets prevented), and the
// Studio-only chords Auto-Rig turns off (`Mod+K` palette — reachable from `⋯ › Command palette…` —, `Alt+0` and
// `Ctrl+Space` focus mode). `Esc`, `F` and `Shift+F` stay the shipped rows (§8.1: Esc never leaves the step).
import type { AutoRigKeyBinding } from '../index';

const GOTO: readonly AutoRigKeyBinding[] = [1, 2, 3, 4, 5].map((n) => ({
  chord: { code: `Digit${n}`, alt: true },
  run: { action: 'goto', args: n - 1 },
  steps: 'all',
}));

export const frameKeys: readonly AutoRigKeyBinding[] = [
  { chord: { code: 'KeyZ', mod: true }, run: { op: 'edit.undo' }, steps: 'all' },
  { chord: { code: 'KeyZ', mod: true, shift: true }, run: { op: 'edit.redo' }, steps: 'all' },
  { chord: { code: 'KeyY', mod: true }, run: { op: 'edit.redo' }, steps: 'all' },
  { chord: { code: 'Enter', mod: true }, run: { action: 'primary' }, steps: 'all', notInText: true },
  ...GOTO,
  { chord: { code: 'KeyK', mod: true }, run: { action: 'none' }, steps: 'all', notInText: false },
  { chord: { code: 'Digit0', alt: true }, run: { action: 'none' }, steps: 'all' },
  { chord: { code: 'Space', ctrl: true }, run: { action: 'none' }, steps: 'all' },
];
