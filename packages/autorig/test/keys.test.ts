// AUTORIG-SPEC §8.1 (D3): the `autorig` key scope — the frame's global rows (undo/redo, Mod+Enter, Alt+1…5, the
// Studio-only chords turned off), chord matching on macOS (Mod = Cmd) and elsewhere (Mod = Ctrl), text fields keeping
// their own keys, and the shortcut text of the sheet.
import { describe, expect, it } from 'vitest';
import { AUTORIG_KEYMAP } from '../src';
import { bindingFor, chordText, inText, matchesChord } from '../src/shell/keys';

const key = (code: string, mods: Partial<KeyboardEvent> = {}, target: EventTarget | null = null): KeyboardEvent =>
  ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target, ...mods }) as KeyboardEvent;

describe('the frame keys (§8.1)', () => {
  it('lists undo/redo, the primary, the five steps and the turned-off Studio chords', () => {
    // the frame's global rows (the step packages' rows name their steps; D5's are pinned in steps/animations)
    const rows = AUTORIG_KEYMAP.filter((b) => b.steps === 'all').map((b) =>
      'op' in b.run ? b.run.op : `${b.run.action}${typeof b.run.args === 'number' ? b.run.args : ''}`,
    );
    expect(rows).toEqual([
      'edit.undo',
      'edit.redo',
      'edit.redo',
      'primary',
      'goto0',
      'goto1',
      'goto2',
      'goto3',
      'goto4',
      'none',
      'none',
      'none',
    ]);
  });

  it('matches Mod as Cmd on macOS and Ctrl elsewhere', () => {
    const undo = { code: 'KeyZ', mod: true };
    expect(matchesChord(undo, key('KeyZ', { metaKey: true }), true)).toBe(true);
    expect(matchesChord(undo, key('KeyZ', { ctrlKey: true }), true)).toBe(false);
    expect(matchesChord(undo, key('KeyZ', { ctrlKey: true }), false)).toBe(true);
    expect(matchesChord(undo, key('KeyZ', { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    // a literal Ctrl chord: Ctrl on macOS, the Mod key elsewhere
    const focus = { code: 'Space', ctrl: true };
    expect(matchesChord(focus, key('Space', { ctrlKey: true }), true)).toBe(true);
    expect(matchesChord(focus, key('Space', { metaKey: true }), true)).toBe(false);
    expect(matchesChord(focus, key('Space', { ctrlKey: true }), false)).toBe(true);
  });

  it('finds the binding of a step; text fields keep their keys (Mod+K is off even there)', () => {
    expect(bindingFor(key('Enter', { metaKey: true }), 'model', true)?.run).toEqual({ action: 'primary' });
    expect(bindingFor(key('Digit3', { altKey: true }), 'model', false)?.run).toEqual({ action: 'goto', args: 2 });
    expect(bindingFor(key('KeyQ'), 'model', true)).toBeNull();
    const field = { tagName: 'INPUT', type: 'text' } as unknown as EventTarget;
    expect(inText(field)).toBe(true);
    expect(inText({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
    expect(inText({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(bindingFor(key('Enter', { metaKey: true }, field), 'model', true)).toBeNull();
    expect(bindingFor(key('KeyZ', { metaKey: true }, field), 'model', true)).toBeNull();
    expect(bindingFor(key('KeyK', { metaKey: true }, field), 'rig', true)?.run).toEqual({ action: 'none' });
  });

  it('writes chords for the shortcuts sheet', () => {
    expect(chordText({ code: 'KeyZ', mod: true }, true)).toBe('⌘Z');
    expect(chordText({ code: 'KeyZ', mod: true, shift: true }, false)).toBe('Shift+Ctrl+Z');
    expect(chordText({ code: 'Digit2', alt: true }, false)).toBe('Alt+2');
    expect(chordText({ code: 'Enter', mod: true }, true)).toBe('⌘↩');
  });
});
