// B0b (M6A-SPEC §8.1, §8.3): menu-bar menu sets per workspace, items per component mode, and shortcut labels that
// name the chord that really runs an item where the menu opens.
import {
  ANIMATE_WORKSPACE,
  BUILTIN_MENU_ITEMS,
  type ComponentMode,
  MODEL_MENU_ITEMS,
  registerBuiltinOperators,
} from '@ekza-animator/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import { menuContents, shortcutFor, topMenus } from '../../src/shell/menus';
import { createTestShell, type TestShell } from '../shell-helpers';
import { TEST_MODEL_WORKSPACE } from './support';

const shells: TestShell[] = [];
afterEach(() => {
  for (const test of shells.splice(0)) test.shell.dispose();
});

function setup(platform: 'mac' | 'other' = 'other'): TestShell {
  const test = createTestShell({ platform });
  registerBuiltinOperators(test.app);
  // The Model items register with the Model operators chunk in the editor (M6A-INT-13); the test contributes both.
  for (const def of [...BUILTIN_MENU_ITEMS, ...MODEL_MENU_ITEMS]) test.app.contribute({ kind: 'menu', def });
  test.app.contribute({ kind: 'workspace', def: TEST_MODEL_WORKSPACE });
  shells.push(test);
  return test;
}

function enter(test: TestShell, workspace: 'model' | 'animate', mode: ComponentMode = 'object'): void {
  const state = test.app.session.getState();
  test.app.session.setState({ workspace, model: { ...state.model, componentMode: mode } });
}

const SHIPPED_ANIMATE_MENUS = ['File', 'Edit', 'Select', 'Key', 'Pose', 'Clip', 'Graph', 'Playback', 'Rig', 'View'];
const labels = (menus: readonly { readonly label: string }[]): string[] => menus.map((menu) => menu.label);
const itemLabels = (contents: ReturnType<typeof menuContents>): string[] =>
  contents.sections.flatMap((section) => section.items.map((item) => item.label));

describe('menu sets per workspace', () => {
  it('Animate shows the shipped menus, with or without its menu set', () => {
    const test = setup();
    const items = test.app.menus.list();
    expect(labels(topMenus(items)).filter((label) => label !== 'Windows' && label !== 'Help')).toEqual(
      SHIPPED_ANIMATE_MENUS,
    );
    expect(topMenus(items, ANIMATE_WORKSPACE)).toEqual(topMenus(items));
    expect(labels(topMenus(items))).toEqual([...SHIPPED_ANIMATE_MENUS, 'Windows', 'Help']);
  });

  it('Model shows its §8.1 menu set in order and none of the Animate menus', () => {
    const test = setup();
    expect(labels(topMenus(test.app.menus.list(), TEST_MODEL_WORKSPACE))).toEqual([
      'File',
      'Edit',
      'Create',
      'Select',
      'Modify',
      'Display',
      'Mesh',
      'Edit Mesh',
      'Mesh Tools',
      'Mesh Display',
      'UV',
      'Windows',
      'Help',
    ]);
  });

  it('keeps an extension menu in every workspace, before Windows and Help', () => {
    const test = setup();
    test.app.contribute({
      kind: 'menu',
      def: { id: 'acme.hello', menu: 'acme', op: 'edit.undo', group: 'acme', order: 1, label: 'Hello' },
    });
    expect(labels(topMenus(test.app.menus.list(), TEST_MODEL_WORKSPACE)).slice(-3)).toEqual([
      'Acme',
      'Windows',
      'Help',
    ]);
    expect(labels(topMenus(test.app.menus.list())).slice(-3)).toEqual(['Acme', 'Windows', 'Help']);
  });

  it('lists Model items only in Model, Animate-only items only in Animate', () => {
    const test = setup();
    enter(test, 'animate');
    const animateEdit = itemLabels(menuContents(test.app, 'edit', {}));
    expect(animateEdit).toEqual(expect.arrayContaining(['Copy', 'Paste', 'Delete']));
    expect(animateEdit).not.toContain('Repeat Last');
    expect(itemLabels(menuContents(test.app, 'select', {}))).toContain('Select Mirror');
    expect(menuContents(test.app, 'mesh', {}).sections).toEqual([]);
    enter(test, 'model');
    const modelEdit = itemLabels(menuContents(test.app, 'edit', {}));
    expect(modelEdit).toEqual(
      expect.arrayContaining(['Adjust Last Operation', 'Repeat Last', 'Last Tool', 'Duplicate', 'Delete']),
    );
    expect(modelEdit).not.toContain('Copy');
    expect(modelEdit).not.toContain('Paste');
    expect(itemLabels(menuContents(test.app, 'select', {}))).not.toContain('Select Mirror');
  });

  it('switches Edit › Delete and Select › All between objects and components by mode', () => {
    const test = setup();
    const op = (menu: string, label: string) =>
      menuContents(test.app, menu, {})
        .sections.flatMap((section) => section.items)
        .filter((item) => item.label === label)
        .map((item) => item.op);
    enter(test, 'model', 'object');
    expect([op('edit', 'Delete'), op('select', 'All')]).toEqual([['scene.delete'], ['select.objects']]);
    for (const mode of ['vertex', 'edge', 'face'] as const) {
      enter(test, 'model', mode);
      expect([op('edit', 'Delete'), op('select', 'All')]).toEqual([['mesh.delete'], ['select.mesh.all']]);
    }
  });

  it('builds the Model sub-menus with their titles', () => {
    const test = setup();
    enter(test, 'model', 'face');
    const sub = (menu: string) => menuContents(test.app, menu, {}).submenus.map((entry) => entry.label);
    expect(sub('create')).toEqual(['Polygon Primitives', 'Templates', 'Reference Image']);
    expect(sub('select')).toEqual(['Convert Selection']);
    expect(sub('modify')).toEqual(['Pivot', 'Snap']);
    expect(sub('display')).toEqual(['Shading']);
    // Literal update (SHADING-SPEC §5): + Assign New Material.
    expect(sub('edit-mesh')).toEqual(['Merge', 'Spin Edge', 'Assign Colour', 'Assign New Material']);
    expect(sub('mesh-display')).toEqual(['Show']);
  });

  it('shows every Model item disabled with its poll reason until its owner lands it', () => {
    const test = setup();
    enter(test, 'model', 'face');
    const extrude = menuContents(test.app, 'edit-mesh', {}).sections[0]?.items[0];
    // B11 landed `mesh.extrude` (literal update, M6A-SPEC §6.1): the item shows its own poll reason, here before the
    // lazy kernel has loaded; operators whose owners have not landed still say "not available yet".
    expect(extrude).toMatchObject({ label: 'Extrude', op: 'mesh.extrude', disabledReason: 'Mesh tools are loading' });
    const centerPivot = menuContents(test.app, 'modify', {}).sections[0]?.items[0];
    // B12a landed `mesh.pivot.center` (literal update): with nothing selected it says what it needs.
    expect(centerPivot).toMatchObject({ op: 'mesh.pivot.center', disabledReason: 'Select a mesh or group first' });
  });
});

describe('shortcut labels where the menu opens', () => {
  it('File › Export shows Mod+Shift+E in Model (Mod+E extrudes there) and Mod+E in Animate', () => {
    const test = setup();
    // File › Export… is the shell's item (`shell.file.export`).
    const exportShortcut = (panel: string) =>
      menuContents(test.app, 'file', { panel })
        .sections.flatMap((section) => section.items)
        .find((item) => item.id === 'shell.file.export')?.shortcut;
    enter(test, 'animate');
    expect(exportShortcut('viewport')).toBe('Ctrl+E');
    enter(test, 'model', 'face');
    expect(exportShortcut('viewport')).toBe('Ctrl+Shift+E');
    expect(exportShortcut('outliner')).toBe('Ctrl+Shift+E');
  });

  it('labels Model items with their §8.3 chords on both platforms', () => {
    for (const [platform, extrude, bevel] of [
      ['other', 'Ctrl+E', 'Ctrl+B'],
      ['mac', '⌘E', '⌘B'],
    ] as const) {
      const test = setup(platform);
      enter(test, 'model', 'face');
      const items = menuContents(test.app, 'edit-mesh', { panel: 'viewport', paneId: 'pane-persp' }).sections.flatMap(
        (section) => section.items,
      );
      expect(items.find((item) => item.op === 'mesh.extrude')?.shortcut).toBe(extrude);
      expect(items.find((item) => item.op === 'mesh.bevel')?.shortcut).toBe(bevel);
    }
  });

  it('keeps the shipped behaviour without a scope chain (status line tips)', () => {
    const test = setup();
    expect(shortcutFor(test.app.keymap, 'ui.open', { dialog: 'export' })).toBe('Ctrl+E');
    expect(shortcutFor(test.app.keymap, 'edit.undo', undefined)).toBe('Ctrl+Z');
  });
});
