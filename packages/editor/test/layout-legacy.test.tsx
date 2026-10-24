// A renamed panel kind (DECISIONS-OPEN TM-4) in what earlier builds saved: dock layouts, focus snapshots and layout
// presets restore with the current kind and are written back without the old one; `workspace.showPanel` with the old
// kind shows the renamed panel. The old spellings come from editor-core's legacy table.
import { LEGACY_IDS } from '@ekza-studio/editor-core';
import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/services/storage';
import { layoutStorageKey, layoutVersion, migrateLegacyLayout, readStoredLayout } from '../src/shell/layout';
import { presetsStorageKey, readStoredPresets } from '../src/shell/presets';
import { WorkspaceHost } from '../src/shell/WorkspaceHost';
import { render, update } from './render';
import { createTestShell, ShellFrame, waitFor } from './shell-helpers';

const [[OLD, NOW]] = Object.entries(LEGACY_IDS.panelKind) as [[string, string]];

/** A dock layout as an earlier build saved it: the old kind twice (a second instance) beside Attributes. */
function oldLayout(): SerializedDockview {
  const panel = (id: string, kind: string, title: string) => ({ id, contentComponent: kind, title, params: { kind } });
  return {
    grid: {
      root: {
        type: 'branch',
        data: [
          { type: 'leaf', data: { id: '1', views: ['viewport'], activeView: 'viewport' }, size: 600 },
          {
            type: 'leaf',
            data: { id: '2', views: [OLD, `${OLD}#5`, 'attributes'], activeView: `${OLD}#5` },
            size: 280,
          },
        ],
        size: 600,
      },
      width: 880,
      height: 600,
      orientation: 'HORIZONTAL',
    },
    panels: {
      viewport: panel('viewport', 'viewport', 'Viewport'),
      [OLD]: panel(OLD, OLD, 'Old title'),
      [`${OLD}#5`]: panel(`${OLD}#5`, OLD, 'Old title'),
      attributes: panel('attributes', 'attributes', 'Attributes'),
    },
    activeGroup: '2',
  } as unknown as SerializedDockview;
}

/** True when `value`, serialized, names the old kind as an id (alone or with an instance suffix). */
const namesOld = (value: unknown): boolean => {
  const text = JSON.stringify(value);
  return text.includes(`"${OLD}"`) || text.includes(`"${OLD}#`);
};

const dock = (shell: ReturnType<typeof createTestShell>['shell']): DockviewApi => {
  const api = shell.workspace.dockview;
  if (api === null) throw new Error('workspace not mounted');
  return api;
};

describe('migrateLegacyLayout', () => {
  it('renames the panel keys, ids, components, kinds, group views and active view; keeps the rest', () => {
    const old = oldLayout();
    const migrated = migrateLegacyLayout(old);
    expect(Object.keys(migrated.panels)).toEqual(['viewport', NOW, `${NOW}#5`, 'attributes']);
    expect(migrated.panels[NOW]).toEqual({ id: NOW, contentComponent: NOW, title: 'Old title', params: { kind: NOW } });
    expect(migrated.panels[`${NOW}#5`]?.params).toEqual({ kind: NOW });
    expect(migrated.grid.root.data).toEqual([
      { type: 'leaf', data: { id: '1', views: ['viewport'], activeView: 'viewport' }, size: 600 },
      { type: 'leaf', data: { id: '2', views: [NOW, `${NOW}#5`, 'attributes'], activeView: `${NOW}#5` }, size: 280 },
    ]);
    expect(migrated.activeGroup).toBe('2');
    expect(migrated.grid.width).toBe(880);
    expect(namesOld(migrated)).toBe(false);
    // The stored value is not changed in place, and a current layout is returned as it is.
    expect(old).toEqual(oldLayout());
    expect(migrateLegacyLayout(migrated)).toBe(migrated);
  });

  it('restores a stored layout and its focus snapshot with the current kind', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      layoutStorageKey('animate'),
      JSON.stringify({
        schemaVersion: layoutVersion('animate'),
        workspace: 'animate',
        dockview: oldLayout(),
        focus: { dockview: oldLayout(), chrome: { toolbar: false } },
      }),
    );
    const stored = readStoredLayout(storage, 'animate');
    if (stored.kind !== 'ok') throw new Error(`expected a stored layout, got ${stored.kind}`);
    expect(Object.keys(stored.layout.panels)).toContain(NOW);
    expect(stored.focus?.dockview.panels[NOW]?.params).toEqual({ kind: NOW });
    expect(stored.focus?.chrome).toEqual({ toolbar: false });
    expect(namesOld(stored)).toBe(false);
  });

  it('reads layout presets saved with the old kind', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      presetsStorageKey('animate'),
      JSON.stringify({
        schemaVersion: 1,
        presets: [
          { id: 'p1', name: 'Wide', dockview: oldLayout(), chrome: {}, viewportLayout: 'single', maximizedPane: null },
        ],
      }),
    );
    const [preset] = readStoredPresets(storage, 'animate');
    expect(preset?.dockview.panels[NOW]?.id).toBe(NOW);
    expect(namesOld(preset)).toBe(false);
  });
});

describe('the shell with a layout saved before the rename', () => {
  it('shows the renamed panel where the old one was and stores the layout without the old kind', async () => {
    const storage = createMemoryStorage();
    const first = createTestShell({ storage });
    const view = await render(
      <ShellFrame shell={first.shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => first.shell.workspace.kinds().length === 7);
    const firstApi = dock(first.shell);
    await update(() => {
      const clips = firstApi.getPanel('clips');
      if (clips !== undefined) firstApi.removePanel(clips);
    });
    await waitFor(() => (storage.getItem(layoutStorageKey()) ?? '').includes(`"${NOW}"`), 3000);
    const right = firstApi.getPanel(NOW)?.group.id;
    await view.unmount();

    // What an earlier build wrote: the same layout under the old kind.
    const saved = storage.getItem(layoutStorageKey()) ?? '';
    storage.setItem(layoutStorageKey(), saved.replaceAll(`"${NOW}"`, `"${OLD}"`));
    expect(namesOld(JSON.parse(storage.getItem(layoutStorageKey()) ?? 'null'))).toBe(true);

    const second = createTestShell({ storage });
    const again = await render(
      <ShellFrame shell={second.shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => second.shell.workspace.kinds().length > 0);
    const api = dock(second.shell);
    expect([...second.shell.workspace.kinds()].sort()).toEqual(
      ['attributes', NOW, 'dopeSheet', 'graph', 'outliner', 'viewport'].sort(),
    );
    expect(api.getPanel(NOW)?.api.isVisible).toBe(true);
    expect(api.getPanel(NOW)?.group.id).toBe(right);
    expect(api.getPanel(OLD)).toBeUndefined();

    // The next layout change stores the current kind only.
    await update(() => {
      const attributes = api.getPanel('attributes');
      if (attributes !== undefined) api.removePanel(attributes);
    });
    await waitFor(() => !(storage.getItem(layoutStorageKey()) ?? '').includes('"attributes"'), 3000);
    expect(namesOld(JSON.parse(storage.getItem(layoutStorageKey()) ?? 'null'))).toBe(false);

    // A key binding, menu item or agent call written with the old kind opens the renamed panel.
    await update(() => {
      const panel = api.getPanel(NOW);
      if (panel !== undefined) api.removePanel(panel);
    });
    expect(second.shell.workspace.kinds()).not.toContain(NOW);
    await update(async () => {
      expect((await second.shell.runFromUi('workspace.showPanel', { panel: OLD })).status).toBe('finished');
    });
    expect(api.getPanel(NOW)?.api.isVisible).toBe(true);
    await again.unmount();
  });
});
