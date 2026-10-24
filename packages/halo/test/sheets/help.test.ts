// The Help sheet's model (STUDIO-TOUCH-SPEC §17 "Help", §5.2, §5.8, §7.2; T6b) over a headless app: the gesture card
// lists every gesture of §5.2 with a visible twin, the glyph legend has the five readiness glyphs, the shortcut sheet
// groups the keymap with Everywhere first and plain labels, About names the product, version, beta and licence, and
// the manifest's Help entries (`ui.open` shortcuts / about) land on sections the sheet has.
import { createHeadlessEditorApp, EDITOR_VERSION, type EditorApp, GLOBAL_SCOPE } from '@ekza-studio/editor-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DIALOG_SURFACES } from '../../src/manifest/dialogs';
import { DISCLOSURE } from '../../src/manifest/disclosure';
import { PLAIN_LABELS } from '../../src/manifest/labels';
import { SHEET_SECTIONS } from '../../src/manifest/sheets';
import { entriesOf, isSurfaceEntry } from '../../src/manifest/types';
import {
  aboutInfo,
  argumentPlain,
  gestureRows,
  glyphRows,
  haloKeys,
  helpSections,
  licenceRows,
  routingRows,
  shortcutGroups,
  THIRD_PARTY_NOTICES_URL,
  thumbRows,
} from '../../src/sheets/help/model';

// Headless apps with every chunk load slowly on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

let app: EditorApp;

beforeAll(() => {
  app = createHeadlessEditorApp();
});

/** The gestures of the §5.2 table (the *Glue* row is after GA, T15). */
const SPEC_GESTURES = [
  'tap',
  'tapAgain',
  'overlap',
  'tapEmpty',
  'drag',
  'dragEmpty',
  'twoFinger',
  'twoFingerTap',
  'doubleTap',
  'quickPinch',
  'longPress',
  'flick',
  'hover',
  'pressure',
  'thumbKey',
  'thread',
];

describe('the gesture card (§5.2, §5.5, §5.1)', () => {
  it('lists every gesture of §5.2 once, each with what it does and its visible twin', () => {
    const rows = gestureRows();
    expect(rows.map((row) => row.id)).toEqual(SPEC_GESTURES);
    expect(rows.filter((row) => row.twin.trim() === '').map((row) => row.id)).toEqual([]);
    const silent = rows.filter(
      (row) => ![row.finger, row.pencil, row.mouse].some((text) => text !== null && text !== ''),
    );
    expect(silent.map((row) => row.id)).toEqual([]);
  });

  it('explains the Thumb key and the finger / Pencil routing modes', () => {
    expect(thumbRows().map((row) => row.id)).toEqual(['tap', 'doubleTap', 'hold', 'slideUp', 'keyboard']);
    expect(routingRows().map((row) => row.mode)).toEqual(['Shared', 'Pencil edits', 'Pencil only']);
  });
});

describe('the glyph legend (§7.2)', () => {
  it('has all five readiness glyphs with their meaning', () => {
    const rows = glyphRows();
    expect(rows.map((row) => row.text)).toEqual(['○', '◐', '●', '⚠n', '·']);
    expect(rows.filter((row) => row.meaning.trim() === '').map((row) => row.glyph)).toEqual([]);
  });
});

describe('the shortcut sheet (§5.8, §17)', () => {
  it('groups the keymap by scope with Everywhere first, every row with keys and a label', () => {
    const groups = shortcutGroups(app);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups[0]?.scope).toBe(GLOBAL_SCOPE);
    expect(groups[0]?.label).toBe('Everywhere');
    const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
    expect(total).toBe(app.keymap.bindings().length);
    const blank = groups
      .flatMap((group) => group.rows)
      .filter((row) => row.keys.trim() === '' || row.label.trim() === '');
    expect(blank.map((row) => row.key)).toEqual([]);
  });

  it('uses the plain label with Studio Pro’s in grey (Again: G in the Make view)', () => {
    const binding = app.keymap.bindings().find((b) => b.op === 'edit.repeatLast');
    const rows = shortcutGroups(app).find((group) => group.scope === binding?.scope)?.rows ?? [];
    const again = rows.find((row) => binding !== undefined && row.keys === app.keymap.label(binding.chord));
    expect([again?.label, again?.pro, again?.available]).toEqual([
      PLAIN_LABELS['edit.repeatLast'],
      app.operators.get('edit.repeatLast')?.label,
      true,
    ]);
    const undo = app.keymap.bindings().find((b) => b.scope === GLOBAL_SCOPE && b.op === 'edit.undo');
    const everywhere = shortcutGroups(app)[0]?.rows ?? [];
    expect(everywhere.some((row) => undo !== undefined && row.keys === app.keymap.label(undo.chord))).toBe(true);
  });

  it('names arguments in plain words where the manifest has a per-argument row', () => {
    expect(argumentPlain('view.toggleMaximize', { panel: null })).toBe('Maximize pane');
    expect(argumentPlain('workspace.showPanel', { panel: 'outliner' })).toBe('Scene');
    expect(argumentPlain('edit.undo', undefined)).toBeNull();
    const groups = shortcutGroups(app);
    const unnamed = app.keymap
      .bindings()
      .map((binding) => ({ binding, plain: argumentPlain(binding.op, binding.args) }))
      .filter(({ binding, plain }) => {
        if (plain === null) return false;
        const rows = groups.find((group) => group.scope === binding.scope)?.rows ?? [];
        return !rows.some((row) => row.label === plain && row.keys.startsWith(app.keymap.label(binding.chord)));
      })
      .map(({ binding }) => `${binding.op} ${JSON.stringify(binding.args)}`);
    expect(unnamed).toEqual([]);
  });

  it('filters by keys or words, and lists Ekza Studio’s own keys (§5.8)', () => {
    const filtered = shortcutGroups(app, 'undo');
    expect(filtered.length).toBeGreaterThan(0);
    const strays = filtered.flatMap((group) =>
      group.rows.filter((row) => !`${row.keys} ${row.label} ${row.pro} ${group.label}`.toLowerCase().includes('undo')),
    );
    expect(strays).toEqual([]);
    expect(shortcutGroups(app, 'no shortcut is called this')).toEqual([]);
    const own = haloKeys(app);
    expect(own.map((row) => row.label)).toContain('Search');
    expect(own.find((row) => row.label.startsWith('Play'))?.keys).toBe(app.keymap.label({ code: 'Space' }));
    expect(haloKeys(app, 'search')).toHaveLength(1);
  });
});

describe('About and licences (§1.1, §17)', () => {
  it('names Ekza Studio, its version, the beta note, MIT and the notices the app serves', () => {
    const about = aboutInfo();
    expect(about.name).toBe('Ekza Studio');
    expect(about.version).toBe(EDITOR_VERSION);
    expect(about.beta).toContain('beta');
    expect(about.positioning).toContain('two layouts');
    expect(about.licence).toBe('MIT');
    expect(about.noticesHref).toBe(THIRD_PARTY_NOTICES_URL);
    expect(THIRD_PARTY_NOTICES_URL).toBe('/THIRD_PARTY_NOTICES.txt');
    const licences = licenceRows().map((row) => row.text);
    expect(licences.some((text) => text.includes('MIT'))).toBe(true);
    expect(licences.some((text) => text.includes('CC0') && text.includes('notices'))).toBe(true);
  });
});

describe('the Disclosure Manifest’s Help entries (§20.5)', () => {
  it('every surface in Help names a section the sheet renders', () => {
    expect(helpSections().map((section) => section.id)).toEqual(SHEET_SECTIONS.help);
    const sections = new Set<string>(helpSections().map((section) => section.id));
    expect(DIALOG_SURFACES.shortcuts).toEqual({ sheet: 'help', section: 'shortcuts' });
    expect(DIALOG_SURFACES.about).toEqual({ sheet: 'help', section: 'about' });
    const placed = Object.values(DISCLOSURE)
      .flatMap((entry) => entriesOf(entry).filter(isSurfaceEntry))
      .flatMap((disclosure) => disclosure.surfaces)
      .flatMap((surface) => ('sheet' in surface && surface.sheet === 'help' ? [surface.section ?? ''] : []));
    expect([...placed].sort()).toEqual(['about', 'shortcuts']);
    expect(placed.filter((section) => !sections.has(section))).toEqual([]);
  });
});
