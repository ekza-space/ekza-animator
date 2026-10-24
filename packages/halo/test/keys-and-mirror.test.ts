// STUDIO-TOUCH-SPEC §5.8, §16.1, §1.2 (T6a): the `halo` key scope, the session mirror, the input settings, the stage
// arrival and the remembered entry.
import { describe, expect, it } from 'vitest';
import { haloKey } from '../src/shell/keys';
import { ENTRY_KEY, HALO_ENTRY, rememberProLayout } from '../src/shell/entry';
import { HALO_INPUT_KEY, HALO_SESSION_KEY, mirrorOf, readInput, readMirror, writeMirror } from '../src/shell/mirror';
import { arrivalStage, parseStage, stageOfWorkspace, workspaceOfStage } from '../src/shell/stage';
import { DEFAULT_INPUT, initialUi } from '../src/shell/store';

const key = (code: string, extra: Partial<KeyboardEvent> = {}) => ({
  code,
  key: extra.key ?? '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  ...extra,
});

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('the halo key scope (§5.8)', () => {
  it('Space plays, Mod+K and / search, Ctrl+1–4 switch stages', () => {
    expect(haloKey(key('Space'), true, false)).toBe('play');
    expect(haloKey(key('KeyK', { metaKey: true }), true, false)).toBe('search');
    expect(haloKey(key('KeyK', { ctrlKey: true }), false, false)).toBe('search');
    expect(haloKey(key('Slash', { key: '/' }), false, false)).toBe('search');
    expect(haloKey(key('Digit3', { ctrlKey: true }), true, false)).toBe('stage3');
  });

  it('Esc and Enter work the session bar; T and G are the chip and Again', () => {
    expect(haloKey(key('Escape'), false, false)).toBe('sessionCancel');
    expect(haloKey(key('Enter'), false, false)).toBe('sessionDone');
    expect(haloKey(key('KeyT'), false, false)).toBe('focusChip');
    expect(haloKey(key('KeyG'), false, false)).toBe('again');
  });

  it('Pro’s window chords say they arrange Pro’s panels (never Pro’s layout state)', () => {
    expect(haloKey(key('Digit2', { altKey: true }), false, false)).toBe('proOnly');
    expect(haloKey(key('Digit0', { altKey: true }), false, false)).toBe('proOnly');
    expect(haloKey(key('Space', { ctrlKey: true }), false, false)).toBe('proOnly');
  });

  it('a text field keeps its keys; a focused control keeps Space and Enter', () => {
    expect(haloKey(key('Space'), false, true)).toBeNull();
    expect(haloKey(key('KeyT'), false, true)).toBeNull();
    expect(haloKey(key('Space'), false, false, true)).toBeNull();
    expect(haloKey(key('Enter'), false, false, true)).toBeNull();
    expect(haloKey(key('Escape'), false, true)).toBe('sessionCancel');
  });

  it('a hardware Shift, Cmd or Alt is reported (the Thumb key hides in auto, §4.5)', () => {
    expect(haloKey(key('ShiftLeft'), false, false)).toBe('hardwareModifier');
    expect(haloKey(key('MetaRight'), true, false)).toBe('hardwareModifier');
    expect(haloKey(key('AltLeft'), false, false)).toBe('hardwareModifier');
    expect(haloKey(key('KeyQ'), false, false)).toBeNull();
  });
});

describe('the session mirror (§16.1)', () => {
  it('round-trips the stage, sheet, Thread layer, Thumb lock, destination and Rec', () => {
    const storage = memoryStorage();
    const ui = {
      ...initialUi('rig'),
      sheet: 'numbers',
      threadLayer: 2 as const,
      destination: 'omoba',
      rec: false,
      thumb: { ...initialUi().thumb, latch: 'locked' as const },
    };
    writeMirror(storage, mirrorOf(ui));
    expect(storage.data.has(HALO_SESSION_KEY)).toBe(true);
    expect(readMirror(storage)).toEqual({
      stage: 'rig',
      sheet: 'numbers',
      threadLayer: 2,
      thumbLocked: true,
      destination: 'omoba',
      rec: false,
    });
  });

  it('ignores a malformed or foreign mirror, and blocked storage', () => {
    const storage = memoryStorage();
    storage.setItem(HALO_SESSION_KEY, '{"stage":"review"}');
    expect(readMirror(storage)).toBeNull();
    storage.setItem(HALO_SESSION_KEY, 'not json');
    expect(readMirror(storage)).toBeNull();
    expect(readMirror(null)).toBeNull();
  });

  it('input settings default per field and never throw', () => {
    const storage = memoryStorage();
    expect(readInput(storage)).toEqual(DEFAULT_INPUT);
    storage.setItem(HALO_INPUT_KEY, JSON.stringify({ reduceGestures: true, routing: 'pencilOnly', haloOpensOn: 'x' }));
    expect(readInput(storage)).toEqual({ ...DEFAULT_INPUT, reduceGestures: true, routing: 'pencilOnly' });
  });
});

describe('stages and the arrival (§7.1, §16.1, P-T3-4)', () => {
  it('maps workspaces and stages both ways; Paint is Model with the Paint Colour tool', () => {
    expect(stageOfWorkspace('model')).toBe('make');
    expect(workspaceOfStage('paint')).toBe('model');
    expect(arrivalStage('model', 'paint')).toBe('paint');
    expect(arrivalStage('model', 'select')).toBe('make');
    expect(arrivalStage('rig', 'paint')).toBe('rig');
    expect(parseStage('animate')).toBe('animate');
    expect(parseStage('studio')).toBeNull();
  });
});

describe('the remembered entry (§1.2)', () => {
  it('writes nothing while HALO_ENTRY is off', () => {
    const storage = memoryStorage();
    storage.setItem(ENTRY_KEY, JSON.stringify({ choice: 'halo', at: 1 }));
    rememberProLayout(storage);
    const choice = (JSON.parse(storage.getItem(ENTRY_KEY) ?? '{}') as { choice?: string }).choice;
    expect(choice).toBe(HALO_ENTRY ? 'studio' : 'halo');
  });
});
