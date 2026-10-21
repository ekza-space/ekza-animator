// Layout presets for focused work (docs/LAYOUT-PRESETS.md): the user preset store (persistence, blocked storage),
// the chrome toggles, focus mode's exact round trip, the built-in presets, user presets surviving a reload, the
// Windows menu's check-box items and Presets sub-menu, and the fullscreen operator.
import type { DocSnapshot } from '@ekza-studio/doc';
import {
  BUILTIN_MENU_ITEMS,
  type EditorApp,
  MODEL_MENU_ITEMS,
  registerBuiltinOperators,
  registerBuiltinWorkspaces,
} from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import type { SerializedDockview } from 'dockview-react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../src/services/storage';
import { EditorRoot } from '../src/shell/EditorRoot';
import { layoutStorageKey, readStoredLayout } from '../src/shell/layout';
import { menuContents } from '../src/shell/menus';
import { shellOperatorDefs } from '../src/shell/operators';
import {
  createLayoutPresetStore,
  presetsStorageKey,
  readStoredPresets,
  type UserPresetData,
} from '../src/shell/presets';
import type { Shell } from '../src/shell/types';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
import { DEFAULT_PARAMS, type EditorParams } from '../src/test-api/params';
import { liveEnvironment, mountLive, settle, waitFor, waveFixtures } from './shell-helpers';

const DOCK: SerializedDockview = { grid: {}, panels: {} } as unknown as SerializedDockview;
const DATA: UserPresetData = {
  dockview: DOCK,
  chrome: { toolbar: false },
  viewportLayout: 'single',
  maximizedPane: null,
};

describe('user preset store', () => {
  it('saves, renames and deletes per workspace and reads them back from storage', () => {
    const storage = createMemoryStorage();
    const store = createLayoutPresetStore(storage, { now: () => 1000 });
    let changes = 0;
    const unsubscribe = store.subscribe(() => {
      changes += 1;
    });
    const a = store.save('animate', '  Close-up ', DATA);
    expect(a.name).toBe('Close-up');
    store.save('model', 'Sculpt', { ...DATA, viewportLayout: 'quad' });
    // The same name (any case) replaces the preset and keeps its id.
    const again = store.save('animate', 'close-UP', { ...DATA, chrome: { helpLine: false } });
    expect(again.id).toBe(a.id);
    expect(store.list('animate')).toHaveLength(1);
    expect(store.persistent()).toBe(true);

    const reloaded = createLayoutPresetStore(storage);
    expect(reloaded.list('animate').map((p) => [p.name, p.chrome])).toEqual([['close-UP', { helpLine: false }]]);
    expect(reloaded.list('model').map((p) => [p.name, p.viewportLayout])).toEqual([['Sculpt', 'quad']]);

    const second = store.save('animate', 'Wide', DATA);
    expect(() => store.rename('animate', second.id, 'close-up')).toThrow(/already exists/);
    expect(store.rename('animate', second.id, 'Wide shot')?.name).toBe('Wide shot');
    expect(store.remove('animate', a.id)).toBe(true);
    expect(store.remove('animate', a.id)).toBe(false);
    expect(readStoredPresets(storage, 'animate').map((p) => p.name)).toEqual(['Wide shot']);
    expect(() => store.save('animate', '   ', DATA)).toThrow(/name/);
    expect(changes).toBe(6);
    unsubscribe();
  });

  it('keeps presets for the session when storage is blocked, throws or holds garbage', () => {
    const blocked = createLayoutPresetStore(null);
    blocked.save('animate', 'Session', DATA);
    expect(blocked.list('animate')).toHaveLength(1);
    expect(blocked.persistent()).toBe(false);

    const throwing = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = createLayoutPresetStore(throwing);
    expect(store.list('animate')).toEqual([]);
    expect(() => store.save('animate', 'Kept', DATA)).not.toThrow();
    expect(store.list('animate').map((p) => p.name)).toEqual(['Kept']);
    expect(store.persistent()).toBe(false);

    const storage = createMemoryStorage();
    for (const raw of ['{nope', '{"schemaVersion":99,"presets":[]}', '{"schemaVersion":1,"presets":{}}']) {
      storage.setItem(presetsStorageKey('animate'), raw);
      expect(readStoredPresets(storage, 'animate')).toEqual([]);
    }
    storage.setItem(
      presetsStorageKey('animate'),
      JSON.stringify({
        schemaVersion: 1,
        presets: [
          { id: 'x', name: '' },
          { ...DATA, id: 'ok', name: 'Fine' },
        ],
      }),
    );
    expect(readStoredPresets(storage, 'animate').map((p) => p.id)).toEqual(['ok']);
  });
});

describe('view.toggleFullscreen', () => {
  it('requests and leaves full screen through the Fullscreen API, and fails politely without it', async () => {
    const app = createFakeEditorApp();
    const calls: string[] = [];
    const fake = {
      fullscreenEnabled: true,
      fullscreenElement: null as Element | null,
      documentElement: {
        requestFullscreen: () => {
          calls.push('request');
          return Promise.resolve();
        },
      },
      exitFullscreen: () => {
        calls.push('exit');
        return Promise.resolve();
      },
    };
    const deps = {
      workspace: { dockview: null } as unknown as Shell['workspace'],
      ui: null as unknown as Shell['ui'],
      presets: createLayoutPresetStore(null),
      document: fake as unknown as Document,
      onImportClosed: () => {},
    };
    for (const contribution of shellOperatorDefs(app, deps)) app.contribute(contribution);
    expect((await app.runUntyped('view.toggleFullscreen')).status).toBe('finished');
    fake.fullscreenElement = {} as Element;
    expect((await app.runUntyped('view.toggleFullscreen')).status).toBe('finished');
    expect(calls).toEqual(['request', 'exit']);
    fake.fullscreenEnabled = false;
    expect((await app.runUntyped('view.toggleFullscreen')).status).toBe('cancelled');
  });
});

// ---------- the mounted editor ----------

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
let style: HTMLStyleElement;
let restoreAct: () => void = () => {};
beforeAll(async () => {
  restoreAct = liveEnvironment();
  ({ snapshot, skeleton } = await waveFixtures());
  style = document.createElement('style');
  style.textContent =
    '.ekza-editor{position:relative;width:1440px;height:900px;display:block}' +
    '[data-testid="gl-host"]{position:fixed;inset:0;pointer-events:none}' +
    '[data-testid="editor-shell"]{display:flex;flex-direction:column;height:100%}' +
    '[data-testid="editor-shell"]>main{flex:1;min-height:0}';
  document.head.append(style);
});
afterAll(() => {
  style.remove();
  restoreAct();
});

type Rendered = ReturnType<typeof mountLive>;
let mounted: Rendered | null = null;
afterEach(async () => {
  if (mounted !== null && document.body.contains(mounted.container)) await mounted.unmount();
  mounted = null;
});

const query = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);

function withBuiltins(app: EditorApp): void {
  registerBuiltinOperators(app);
  registerBuiltinWorkspaces(app);
  for (const def of [...BUILTIN_MENU_ITEMS, ...MODEL_MENU_ITEMS]) {
    if (app.menus.get(def.id) === undefined) app.contribute({ kind: 'menu', def });
  }
}

async function mount(params: Partial<EditorParams> = {}): Promise<{ app: FakeEditorApp; shell: Shell }> {
  let app: FakeEditorApp | null = null;
  let shell: Shell | null = null;
  mounted = mountLive(
    <EditorRoot
      params={{ ...DEFAULT_PARAMS, e2e: true, ...params }}
      onShell={(s) => {
        shell = s;
        return undefined;
      }}
      createApp={({ services, platform }) => {
        app = createFakeEditorApp({
          snapshot,
          skeleton,
          services: { ...services, models: createSyntheticModelLoader() },
          platform,
        });
        withBuiltins(app);
        return app;
      }}
    />,
  );
  await waitFor(() => app !== null && shell !== null && query('editor-shell') !== null);
  if (app === null || shell === null) throw new Error('the editor did not start');
  const ready: Shell = shell;
  await waitFor(() => ready.workspace.kinds().includes('viewport'));
  return { app, shell: ready };
}

const kindsOf = (shell: Shell): string[] => [...shell.workspace.kinds()].sort();
const ANIMATE_KINDS = ['attributes', 'channelBox', 'clips', 'dopeSheet', 'graph', 'outliner', 'viewport'];

async function runOk(app: FakeEditorApp, op: string, args?: unknown): Promise<unknown> {
  const result = await app.runUntyped(op, args);
  if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
  return result.value;
}

describe('chrome toggles and focus mode', () => {
  it('hides the tool strip, help line and time slider per workspace, ticked in the Windows menu', async () => {
    const { app, shell } = await mount();
    expect(query('statusline')).not.toBeNull();
    expect(query('helpline')).not.toBeNull();
    expect(query('timeline-region')).not.toBeNull();
    const checks = (): Record<string, boolean | null> =>
      Object.fromEntries(
        menuContents(app, 'windows', {})
          .sections.flatMap((section) => section.items)
          .filter((item) => item.checked !== null)
          .map((item) => [item.id, item.checked]),
      );
    expect(checks()).toMatchObject({
      'shell.windows.toolbar': true,
      'shell.windows.helpLine': true,
      'shell.windows.timeline': true,
      'shell.windows.focus': false,
      'shell.windows.fullscreen': false,
    });

    await runOk(app, 'workspace.toggleChrome', { part: 'toolbar' });
    await runOk(app, 'workspace.toggleChrome', { part: 'helpLine' });
    await runOk(app, 'workspace.toggleTimeline');
    await waitFor(
      () => query('statusline') === null && query('helpline') === null && query('timeline-region') === null,
    );
    expect(checks()).toMatchObject({
      'shell.windows.toolbar': false,
      'shell.windows.helpLine': false,
      'shell.windows.timeline': false,
    });
    // Model keeps its own chrome (its tool strip shows; its time slider stays hidden).
    await runOk(app, 'workspace.set', { workspace: 'model' });
    await waitFor(() => query('statusline') !== null);
    expect(query('timeline-region')).toBeNull();
    await runOk(app, 'workspace.set', { workspace: 'animate' });
    await waitFor(() => query('statusline') === null);
    expect(shell.workspace.chrome()).toEqual({ toolbar: false, helpLine: false, timeline: false });
    // Stored with the layout.
    await settle(400);
    const stored = readStoredLayout(shell.storage, 'animate');
    expect(stored.kind === 'ok' ? stored.chrome : stored).toEqual({ toolbar: false, helpLine: false, timeline: false });
    expect((await app.runUntyped('workspace.toggleChrome', { part: 'menubar' })).status).toBe('cancelled');
    // Reset Workspace brings the default chrome back.
    await runOk(app, 'workspace.reset');
    await waitFor(
      () => query('statusline') !== null && query('helpline') !== null && query('timeline-region') !== null,
    );
  });

  it('focus mode keeps only the viewport and restores the exact layout and chrome; it survives a reload', async () => {
    const ns = `focus-${Date.now()}`;
    const first = await mount({ ns });
    const { app, shell } = first;
    // A layout of the user's own: Attributes closed, the time slider hidden.
    const api = shell.workspace.dockview;
    const attributes = api?.getPanel('attributes');
    if (api === null || attributes === undefined) throw new Error('no dockview');
    api.removePanel(attributes);
    await runOk(app, 'workspace.toggleTimeline');
    const before = structureOf(api.toJSON());
    const kindsBefore = kindsOf(shell);

    expect(await runOk(app, 'workspace.toggleFocus')).toEqual({ focused: true });
    expect(kindsOf(shell)).toEqual(['viewport']);
    await waitFor(() => query('statusline') === null && query('helpline') === null);
    expect(shell.workspace.focused()).toBe(true);
    expect(shell.ui.getState().focus).toEqual({ animate: true });
    await settle(400);
    await mounted?.unmount();

    // Reload: still in focus mode, and the next toggle restores what was there before it.
    const second = await mount({ ns });
    await waitFor(() => second.shell.workspace.focused());
    expect(kindsOf(second.shell)).toEqual(['viewport']);
    expect(query('statusline')).toBeNull();
    expect(await runOk(second.app, 'workspace.toggleFocus')).toEqual({ focused: false });
    expect(kindsOf(second.shell)).toEqual(kindsBefore);
    const restored = second.shell.workspace.dockview?.toJSON();
    expect(restored === undefined ? null : structureOf(restored)).toEqual(before);
    await waitFor(() => query('statusline') !== null && query('helpline') !== null);
    expect(query('timeline-region')).toBeNull();
    clearNamespace(ns);
  });
});

/** A layout without its pixel sizes (dockview recomputes them for the container): the grid's branches and groups,
 *  each group's panels in tab order and its active panel. */
function structureOf(layout: SerializedDockview): unknown {
  const walk = (node: unknown): unknown => {
    const n = node as { type: string; data: unknown };
    if (n.type === 'branch') return (n.data as unknown[]).map(walk);
    const group = n.data as { views: string[]; activeView?: string };
    return { views: group.views, active: group.activeView ?? null };
  };
  return {
    root: walk(layout.grid.root),
    orientation: layout.grid.orientation,
    panels: Object.keys(layout.panels).sort(),
  };
}

function clearNamespace(ns: string): void {
  for (const key of Object.keys(localStorage)) if (key.includes(ns)) localStorage.removeItem(key);
}

describe('layout presets', () => {
  it('applies the built-in presets: dock shape, chrome and viewport panes', async () => {
    const { app, shell } = await mount();
    await runOk(app, 'workspace.preset.apply', { preset: 'blocking' });
    expect(kindsOf(shell)).toEqual(['viewport']);
    expect(app.session.getState().viewportLayout).toBe('single');
    expect(shell.workspace.chrome()).toEqual({ toolbar: true, helpLine: true, timeline: true });

    await runOk(app, 'workspace.preset.apply', { preset: 'polish' });
    expect(kindsOf(shell)).toEqual(['dopeSheet', 'graph', 'viewport']);
    const api = shell.workspace.dockview;
    expect(api?.getPanel('graph')?.api.isVisible).toBe(true);
    expect(api?.getPanel('graph')?.group.id).toBe(api?.getPanel('dopeSheet')?.group.id);
    expect(api?.groups).toHaveLength(2);

    await runOk(app, 'workspace.preset.apply', { preset: 'review' });
    expect(kindsOf(shell)).toEqual(['viewport']);
    await waitFor(() => query('statusline') === null && query('helpline') === null);
    expect(query('timeline-region')).not.toBeNull();

    // Focus mode inside a preset, then a preset: the preset wins and focus mode ends.
    await runOk(app, 'workspace.toggleFocus');
    await runOk(app, 'workspace.preset.apply', { preset: 'animate' });
    expect(shell.workspace.focused()).toBe(false);
    expect(kindsOf(shell)).toEqual(ANIMATE_KINDS);
    expect(app.session.getState().viewportLayout).toBe('split');
    await waitFor(() => query('statusline') !== null && query('helpline') !== null);

    // Model offers its default only.
    await runOk(app, 'workspace.set', { workspace: 'model' });
    await waitFor(() => kindsOf(shell).includes('toolkit'));
    const blocking = await app.runUntyped('workspace.preset.apply', { preset: 'blocking' });
    expect(blocking.status).toBe('cancelled');
    await runOk(app, 'workspace.preset.apply', { preset: 'animate' });
    expect(app.session.getState().viewportLayout).toBe('quad');
    expect((await app.runUntyped('workspace.preset.apply', { preset: 'nope' })).status).toBe('cancelled');
  });

  it('saves a user preset, lists it in Windows › Presets and applies it after a reload', async () => {
    const ns = `presets-${Date.now()}`;
    const first = await mount({ ns });
    await runOk(first.app, 'workspace.preset.apply', { preset: 'polish' });
    await runOk(first.app, 'workspace.toggleChrome', { part: 'toolbar' });
    first.app.session.setState({ viewportLayout: 'quad' });
    const saved = (await runOk(first.app, 'workspace.preset.save', { name: 'My polish' })) as {
      id: string;
      persistent: boolean;
    };
    expect(saved.persistent).toBe(true);
    const presetsMenu = menuContents(first.app, 'windows', {}).submenus.find((sub) => sub.id === 'windows.presets');
    expect(presetsMenu?.sections.flatMap((section) => section.items.map((item) => item.label))).toEqual([
      'Animate',
      'Blocking',
      'Polish',
      'Review',
      'My polish',
      'Save Current Layout as…',
      'Rename or Delete Presets…',
    ]);
    expect(first.shell.storage?.getItem(presetsStorageKey('animate'))).toContain('My polish');
    await mounted?.unmount();

    const second = await mount({ ns });
    expect(kindsOf(second.shell)).toEqual(['dopeSheet', 'graph', 'viewport']);
    await runOk(second.app, 'workspace.preset.apply', { preset: 'animate' });
    expect(kindsOf(second.shell)).toEqual(ANIMATE_KINDS);
    await runOk(second.app, 'workspace.preset.apply', { preset: saved.id });
    expect(kindsOf(second.shell)).toEqual(['dopeSheet', 'graph', 'viewport']);
    expect(second.app.session.getState().viewportLayout).toBe('quad');
    await waitFor(() => query('statusline') === null);

    await runOk(second.app, 'workspace.preset.rename', { id: saved.id, name: 'Polish wide' });
    expect(second.shell.presets.list('animate').map((p) => p.name)).toEqual(['Polish wide']);
    expect((await second.app.runUntyped('workspace.preset.save', { name: '' })).status).toBe('cancelled');
    await runOk(second.app, 'workspace.preset.delete', { id: saved.id });
    expect(second.shell.presets.list('animate')).toEqual([]);
    const after = menuContents(second.app, 'windows', {}).submenus.find((sub) => sub.id === 'windows.presets');
    expect(after?.sections.some((section) => section.group === 'user')).toBe(false);
    expect(localStorage.getItem(`${layoutStorageKey('animate')}`)).toBeNull(); // namespaced, never the bare key
    clearNamespace(ns);
  });

  it('keeps presets for the session when storage is blocked', async () => {
    const { app, shell } = await mount({ storageBlocked: true });
    const saved = (await runOk(app, 'workspace.preset.save', { name: 'Temp' })) as { persistent: boolean };
    expect(saved.persistent).toBe(false);
    expect(shell.presets.list('animate').map((p) => p.name)).toEqual(['Temp']);
    await runOk(app, 'workspace.toggleFocus');
    expect(kindsOf(shell)).toEqual(['viewport']);
    await runOk(app, 'workspace.toggleFocus');
    expect(kindsOf(shell)).toEqual(ANIMATE_KINDS);
  });
});
