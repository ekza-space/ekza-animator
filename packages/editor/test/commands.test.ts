// Shell operators (view.toggleMaximize, ui.open/close, prefs.set, view.selectionMask), the menu bar model (registry
// order, dedupe, sub-menus, poll-driven enabled state, keymap labels) and runFromUi's result handling.
import { GLOBAL_SCOPE, type MenuItemDef } from '@ekza-animator/editor-core';
import { describe, expect, it } from 'vitest';
import type {} from '../src/shell/operator-map';
import { menuContents, shortcutFor, stableKey, topMenus } from '../src/shell/menus';
import { shellMenuItems } from '../src/shell/menuItems';
import { createTestShell, waveFixtures } from './shell-helpers';

describe('shell operators', () => {
  it('ui.open / ui.close drive session.dialog; export needs a character', async () => {
    const { shell, app } = createTestShell();
    expect((await shell.runFromUi('ui.open', { dialog: 'export' })).status).toBe('cancelled');
    expect(shell.ui.getState().help?.text).toBe('Load a character to export');
    expect((await shell.runFromUi('ui.open', { dialog: 'shortcuts' })).status).toBe('finished');
    expect(app.session.getState().dialog).toBe('shortcuts');
    expect((await shell.runFromUi('ui.open', { dialog: 'nope' })).status).toBe('cancelled');
    await shell.runFromUi('ui.close');
    expect(app.session.getState().dialog).toBeNull();

    const { snapshot } = await waveFixtures();
    const loaded = createTestShell({ snapshot });
    expect((await loaded.shell.runFromUi('ui.open', { dialog: 'export' })).status).toBe('finished');
  });

  it('closing the import dialog drops the pending file', async () => {
    const { shell } = createTestShell();
    shell.ui.setState({
      pendingImport: {
        name: 'a.glb',
        bytes: new Uint8Array(),
        importer: { id: 'gltf-model', label: 'glTF', extensions: ['glb'], op: 'file.importModel' },
        summary: null,
        summaryError: null,
      },
    });
    await shell.runFromUi('ui.open', { dialog: 'import' });
    await shell.runFromUi('ui.close');
    expect(shell.ui.getState().pendingImport).toBeNull();
  });

  it('prefs.set writes known preference fields and rejects unknown ones', async () => {
    const { shell, app } = createTestShell();
    await shell.runFromUi('prefs.set', {
      patch: { navProfile: 'trackpad', spaceBehaviour: 'play', firstRunDone: true },
    });
    expect(app.prefs.getState()).toMatchObject({ navProfile: 'trackpad', spaceBehaviour: 'play', firstRunDone: true });
    const rejected = await shell.runFromUi('prefs.set', { patch: { colour: 'pink' } });
    expect(rejected).toEqual({ status: 'cancelled', reason: 'Unknown preference colour' });
  });

  it('view.selectionMask merges into the session tool state', async () => {
    const { shell, app } = createTestShell();
    await shell.runFromUi('view.selectionMask', { mask: { joints: true } });
    expect(app.session.getState().tools.selectionMask).toEqual({ controls: true, joints: true, meshes: false });
  });

  it('runFromUi toasts failures and shows cancellations in the help line', async () => {
    const { shell, app, toasts } = createTestShell();
    app.contribute({
      kind: 'operator',
      def: {
        id: 'acme.broken',
        label: 'Broken Command',
        category: 'acme',
        scope: 'global',
        apply: () => {
          throw new Error('kaput');
        },
      },
    });
    await shell.runFromUi('acme.broken');
    expect(toasts.store.getState().toasts.at(-1)).toMatchObject({
      kind: 'error',
      text: 'Broken Command failed: kaput',
    });
    await shell.runFromUi('acme.missing');
    expect(shell.ui.getState().help?.tone).toBe('warning');
    expect(shell.ui.getState().help?.text).toContain('acme.missing');
  });

  it('typed run() accepts the shell operators added to OperatorMap', async () => {
    const { app } = createTestShell();
    const result = await app.run('prefs.set', { patch: { autoKey: true } });
    expect(result.status).toBe('finished');
    expect(app.prefs.getState().autoKey).toBe(true);
  });
});

describe('menu bar model', () => {
  const item = (
    id: string,
    menu: string,
    op: string,
    order: number,
    extra: Partial<MenuItemDef> = {},
  ): MenuItemDef => ({
    id,
    menu,
    op: op as MenuItemDef['op'],
    group: 'g',
    order,
    ...extra,
  });

  it('orders known menus, appends unknown ones before Windows and Help, hides context menus', () => {
    const menus = topMenus([
      item('a', 'help', 'x.a', 1),
      item('b', 'acme', 'x.b', 1),
      item('c', 'file', 'x.c', 1),
      item('d', 'time', 'x.d', 1),
      item('e', 'playback', 'x.e', 1),
      item('f', 'timeline.context', 'x.f', 1),
      item('g', 'graph.curves', 'x.g', 1),
    ]);
    expect(menus.map((m) => m.label)).toEqual(['File', 'Graph', 'Playback', 'Acme', 'Help']);
  });

  it('groups by section, dedupes equal commands, builds sub-menus and polls items', async () => {
    const { app } = createTestShell();
    app.contribute({
      kind: 'operator',
      def: { id: 'acme.ok', label: 'Ok', category: 'acme', scope: 'global', apply: () => {} },
    });
    app.contribute({
      kind: 'operator',
      def: {
        id: 'acme.no',
        label: 'No',
        category: 'acme',
        scope: 'global',
        poll: () => ({ ok: false, reason: 'Select a control first' }),
        apply: () => {},
      },
    });
    for (const def of [
      item('one', 'acme', 'acme.ok', 1, { group: 'a' }),
      item('dup', 'acme', 'acme.ok', 2, { group: 'a' }),
      item('two', 'acme', 'acme.no', 3, { group: 'b' }),
      item('three', 'acme', 'acme.ghost', 4, { group: 'b', label: 'Ghost' }),
      item('sub', 'acme.more', 'acme.ok', 1, { args: { x: 1 }, label: 'Nested' }),
    ]) {
      app.contribute({ kind: 'menu', def });
    }
    const contents = menuContents(app, 'acme', {});
    expect(contents.sections.map((s) => s.items.map((i) => [i.label, i.disabledReason]))).toEqual([
      [['Ok', null]],
      [
        ['No', 'Select a control first'],
        ['Ghost', 'Not available in this build'],
      ],
    ]);
    expect(contents.submenus).toEqual([
      expect.objectContaining({
        id: 'acme.more',
        label: 'More',
        sections: [expect.objectContaining({ items: [expect.objectContaining({ label: 'Nested' })] })],
      }),
    ]);
  });

  it('labels shortcuts from the keymap, preferring global bindings and matching arguments', () => {
    const { app } = createTestShell({ platform: 'other' });
    app.contribute({
      kind: 'keymap',
      bindings: [
        { chord: { code: 'KeyO', mod: true }, op: 'ui.open', args: { dialog: 'open' }, scope: GLOBAL_SCOPE },
        { chord: { code: 'KeyE', mod: true }, op: 'ui.open', args: { dialog: 'export' }, scope: GLOBAL_SCOPE },
        { chord: { code: 'KeyS' }, op: 'key.set', args: { channels: 'all' }, scope: 'viewport' },
        { chord: { code: 'Space' }, op: 'view.toggleMaximize', scope: GLOBAL_SCOPE, trigger: 'tap' },
      ],
    });
    expect(shortcutFor(app.keymap, 'ui.open', { dialog: 'export' })).toBe('Ctrl+E');
    expect(shortcutFor(app.keymap, 'ui.open', { dialog: 'about' })).toBeNull();
    expect(shortcutFor(app.keymap, 'key.set', { channels: 'all' })).toBe('S');
    expect(shortcutFor(app.keymap, 'view.toggleMaximize', undefined)).toBe('Space');
    const mac = createTestShell({ platform: 'mac' }).app;
    mac.contribute({
      kind: 'keymap',
      bindings: [{ chord: { code: 'KeyZ', mod: true, shift: true }, op: 'edit.redo', scope: GLOBAL_SCOPE }],
    });
    expect(shortcutFor(mac.keymap, 'edit.redo', undefined)).toBe('⇧⌘Z');
  });

  it('stableKey ignores key order and undefined fields', () => {
    expect(stableKey({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(stableKey({ a: [1, { d: 2 }], b: 1 }));
    expect(stableKey(undefined)).toBe('');
  });

  it('contributes the shell menu items (dialogs, panels, layouts, reset) through the registry', () => {
    const { app } = createTestShell();
    const ids = app.menus.list().map((def) => def.id);
    for (const def of shellMenuItems([])) expect(ids).toContain(def.id);
    const windows = menuContents(app, 'windows', {});
    expect(windows.sections.flatMap((s) => s.items.map((i) => i.label))).toEqual(
      expect.arrayContaining(['Outliner', 'Graph Editor', 'Reset Workspace']),
    );
    expect(windows.submenus[0]?.label).toBe('Layout');
  });
});
