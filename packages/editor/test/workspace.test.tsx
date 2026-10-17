// WorkspaceHost (dockview adapter): the Animate layout, layout persistence round trip (versioned, try/catch), Reset
// Workspace, show-panel and group maximize.
import { PANEL } from '@ekza-animator/editor-core';
import type { DockviewApi, SerializedDockview } from 'dockview-react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';
import { createPanelRegistry } from '../src/panels/registry';
import type { PanelDef } from '../src/panels/types';
import { createMemoryStorage } from '../src/services/storage';
import {
  layoutStorageKey,
  PLACEHOLDER_COMPONENT,
  readStoredLayout,
  reconcileLayout,
  writeStoredLayout,
} from '../src/shell/layout';
import { WorkspaceHost } from '../src/shell/WorkspaceHost';
import { render, update } from './render';
import { createTestShell, ShellFrame, waitFor } from './shell-helpers';

function GraphStub(): JSX.Element {
  return <p data-testid="graph-stub">graph</p>;
}
const GRAPH_DEF: PanelDef = {
  id: 'graph',
  kind: PANEL.graph,
  title: 'Graph Editor',
  component: GraphStub,
  keyScope: 'graph',
};

const dock = (shell: ReturnType<typeof createTestShell>['shell']): DockviewApi => {
  const api = shell.workspace.dockview;
  if (api === null) throw new Error('workspace not mounted');
  return api;
};
const kinds = (shell: ReturnType<typeof createTestShell>['shell']): string[] => [...shell.workspace.kinds()].sort();

describe('Animate layout', () => {
  it('docks Outliner | Clips left, the viewport centre, Channel Box | Attributes right and the Graph Editor below', async () => {
    // No registered panels: every Animate slot shows the placeholder.
    const { shell } = createTestShell({ panels: createPanelRegistry() });
    const view = await render(
      <ShellFrame shell={shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => shell.workspace.kinds().length > 0);
    expect(kinds(shell)).toEqual(['attributes', 'channelBox', 'clips', 'graph', 'outliner', 'viewport'].sort());
    const api = dock(shell);
    expect(api.groups).toHaveLength(4);
    const groupOf = (kind: string) => api.getPanel(kind)?.group.id;
    expect(groupOf('outliner')).toBe(groupOf('clips'));
    expect(groupOf('channelBox')).toBe(groupOf('attributes'));
    expect(api.getPanel('outliner')?.api.isVisible).toBe(true);
    expect(api.getPanel('clips')?.api.isVisible).toBe(false);
    expect(api.getPanel('channelBox')?.api.isVisible).toBe(true);
    expect(api.getPanel('viewport')?.api.isActive).toBe(true);
    // Unregistered kinds render the placeholder; the timeline is fixed chrome, not a dock panel.
    expect(view.container.querySelector('[data-testid="placeholder-viewport"]')).not.toBeNull();
    expect(api.getPanel('timeline')).toBeUndefined();
    await view.unmount();
  });

  it('renders registered panels inside a panel frame with their key scope', async () => {
    const panels = createPanelRegistry();
    panels.register(GRAPH_DEF);
    const { shell } = createTestShell({ panels });
    const view = await render(
      <ShellFrame shell={shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => view.container.querySelector('[data-testid="graph-stub"]') !== null);
    const frame = view.container.querySelector('[data-testid="graph-stub"]')?.closest('[data-ekza-panel]');
    expect(frame?.getAttribute('data-ekza-panel')).toBe('graph');
    expect(frame?.getAttribute('data-ekza-scope')).toBe('graph');
    expect(frame?.getAttribute('data-ekza-panel-instance')).toBe('graph');
    await view.unmount();
  });
});

describe('layout persistence', () => {
  it('round-trips a changed layout through storage and restores it in a new editor', async () => {
    const storage = createMemoryStorage();
    const first = createTestShell({ storage });
    const view = await render(
      <ShellFrame shell={first.shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => first.shell.workspace.kinds().length === 6);
    const api = dock(first.shell);
    await update(() => {
      const attributes = api.getPanel('attributes');
      if (attributes !== undefined) api.removePanel(attributes);
    });
    await waitFor(() => (storage.getItem(layoutStorageKey()) ?? '').includes('"schemaVersion":1'), 3000);
    const stored = readStoredLayout(storage);
    expect(stored.kind === 'ok' ? Object.keys(stored.layout.panels).sort() : stored).toEqual(
      ['channelBox', 'clips', 'graph', 'outliner', 'viewport'].sort(),
    );
    await view.unmount();

    const second = createTestShell({ storage });
    const again = await render(
      <ShellFrame shell={second.shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => second.shell.workspace.kinds().length > 0);
    expect(kinds(second.shell)).toEqual(['channelBox', 'clips', 'graph', 'outliner', 'viewport'].sort());

    // Reset Workspace restores the default and stores it.
    await update(async () => {
      await second.shell.runFromUi('workspace.reset');
    });
    expect(kinds(second.shell)).toContain('attributes');
    const reset = readStoredLayout(storage);
    expect(reset.kind === 'ok' && Object.keys(reset.layout.panels).includes('attributes')).toBe(true);
    await again.unmount();
  });

  it('falls back to the default layout with a notice for unreadable or newer layouts', async () => {
    for (const [raw, notice] of [
      ['{not json', 'Layout reset (saved layout unreadable)'],
      [
        JSON.stringify({ schemaVersion: 99, workspace: 'animate', dockview: {} }),
        'Layout reset (saved by a newer version)',
      ],
    ] as const) {
      const storage = createMemoryStorage();
      storage.setItem(layoutStorageKey(), raw);
      const { shell, toasts } = createTestShell({ storage });
      const view = await render(
        <ShellFrame shell={shell}>
          <WorkspaceHost />
        </ShellFrame>,
      );
      await waitFor(() => shell.workspace.kinds().length === 6);
      expect(toasts.store.getState().toasts.map((t) => t.text)).toContain(notice);
      await view.unmount();
    }
  });

  it('works without storage and survives a throwing storage', () => {
    expect(readStoredLayout(null)).toEqual({ kind: 'none' });
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readStoredLayout(throwing)).toEqual({ kind: 'none' });
    expect(() => writeStoredLayout(throwing, { grid: {}, panels: {} } as unknown as SerializedDockview)).not.toThrow();
  });

  it('reconciles stored panels with the registered ones (placeholder ↔ panel), rejects foreign layouts', () => {
    const layout = {
      grid: { root: { type: 'branch', data: [] }, width: 100, height: 100, orientation: 'HORIZONTAL' },
      panels: {
        graph: {
          id: 'graph',
          contentComponent: PLACEHOLDER_COMPONENT,
          title: 'Graph Editor',
          params: { kind: 'graph' },
        },
        outliner: { id: 'outliner', contentComponent: 'outliner', title: 'Outliner', params: { kind: 'outliner' } },
      },
    } as unknown as SerializedDockview;
    const resolve = (kind: string) =>
      kind === 'graph'
        ? { kind, component: 'graph', title: 'Graph Editor' }
        : kind === 'outliner'
          ? { kind, component: PLACEHOLDER_COMPONENT, title: 'Outliner' }
          : null;
    const reconciled = reconcileLayout(layout, resolve);
    expect(reconciled?.panels['graph']?.contentComponent).toBe('graph');
    expect(reconciled?.panels['outliner']?.contentComponent).toBe(PLACEHOLDER_COMPONENT);
    const foreign = { ...layout, panels: { x: { id: 'x', contentComponent: 'x' } } } as unknown as SerializedDockview;
    expect(reconcileLayout(foreign, resolve)).toBeNull();
    const timeline = {
      ...layout,
      panels: { t: { id: 't', contentComponent: 'timeline', params: { kind: 'timeline' } } },
    } as unknown as SerializedDockview;
    expect(reconcileLayout(timeline, () => ({ kind: 'timeline', component: 'timeline', title: 'T' }))).toBeNull();
  });
});

describe('workspace commands', () => {
  it('view.toggleMaximize maximizes and restores the dockview group of a panel', async () => {
    const { shell } = createTestShell();
    const view = await render(
      <ShellFrame shell={shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => shell.workspace.kinds().length === 6);
    await update(async () => {
      await shell.runFromUi('view.toggleMaximize', { panel: 'graph' });
    });
    expect(shell.workspace.hasMaximized()).toBe(true);
    expect(shell.ui.getState().dockMaximized).toBe(true);
    await update(async () => {
      await shell.runFromUi('view.toggleMaximize', { panel: 'graph' });
    });
    expect(shell.workspace.hasMaximized()).toBe(false);
    await view.unmount();
  });

  it('view.toggleMaximize on a viewport pane toggles session.maximizedPane', async () => {
    const { shell, app } = createTestShell();
    await shell.runFromUi('view.toggleMaximize', undefined, { panel: 'viewport', paneId: 'pane-right' });
    expect(app.session.getState().maximizedPane).toBe('pane-right');
    await shell.runFromUi('view.toggleMaximize', undefined, { panel: 'viewport', paneId: 'pane-right' });
    expect(app.session.getState().maximizedPane).toBeNull();
    app.session.setState({ hoveredPanel: { kind: 'viewport', paneId: 'pane-left' } });
    await shell.runFromUi('view.toggleMaximize');
    expect(app.session.getState().maximizedPane).toBe('pane-left');
  });

  it('workspace.showPanel re-opens a closed panel in its default dock', async () => {
    const { shell } = createTestShell();
    const view = await render(
      <ShellFrame shell={shell}>
        <WorkspaceHost />
      </ShellFrame>,
    );
    await waitFor(() => shell.workspace.kinds().length === 6);
    const api = dock(shell);
    await update(() => {
      const clips = api.getPanel('clips');
      if (clips !== undefined) api.removePanel(clips);
    });
    expect(shell.workspace.kinds()).not.toContain('clips');
    await update(async () => {
      await shell.runFromUi('workspace.showPanel', { panel: 'clips' });
    });
    expect(api.getPanel('clips')?.group.id).toBe(api.getPanel('outliner')?.group.id);
    expect(api.getPanel('clips')?.api.isVisible).toBe(true);
    const failed = await shell.runFromUi('workspace.showPanel', { panel: 'acme.unknown' });
    expect(failed.status).toBe('failed');
    await view.unmount();
  });
});
