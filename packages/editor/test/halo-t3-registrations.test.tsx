// STUDIO-TOUCH-SPEC §20.3 item 12, §16.1, J10 (T3): the host's registrations and Pro's switch. With no Studio shell
// mounted — a host alone, as on `/app` and `/autorig`, or after Pro unmounted on the same page — the view operators,
// Model's marking menus and Rig & Skin's menus, marking menu and settings are registered (lazily, once per app) and stay
// until the host goes. The Rig & Skin view-only rule below 1024 px (`watchRigViewOnly`, AR-V1) is still Pro's alone.
// The Recovery prompt's timing is the host's and the mounted shell offers the slots. `shell.halo` switches to the
// Simple layout on the same page, carrying the workspace.
import {
  type AutosaveSlotInfo,
  type AutosaveStore,
  type EditorApp,
  registerBuiltins,
  rigViewOnly,
} from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import { act, createElement, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { setAgentPill } from '../src/agent/ui/slot';
import { createHostShell } from '../src/host/createHost';
import { provideRecoveryHook } from '../src/host/registrations';
import { useAgentPill } from '../src/host/registrations/agent';
import type { HostShell, MountedShell } from '../src/host/types';
import { MODEL_MARKING_MENUS, RIG_MARKING_MENUS } from '../src/overlays/menus';
import { createToastNotifier } from '../src/services/notify';
import { createShell } from '../src/shell/createShell';
import { PRO_NAME, PRO_TITLE } from '../src/shell/menuItems';
import { RIG_MENU_ITEMS } from '../src/shell/menus/rig';
import { RIG_VIEW_ONLY_QUERY } from '../src/shell/rig/viewOnly';
import type { Shell } from '../src/shell/types';
import { DEFAULT_PARAMS, type EditorParams } from '../src/test-api/params';
import { render } from './render';
import { settle, waitFor } from './shell-helpers';

// Lazy chunks are transformed on first use in browser mode, on a loaded machine: generous waits.
const LOAD_MS = 20_000;

const VIEW_OPS = ['view.selectionMask', 'view.toggleFullscreen'] as const;
const RIG_OPS = ['rig.snap.projectedCenter', 'rig.jointSize.set'] as const;

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

function setup(opts: { readonly params?: Partial<EditorParams>; readonly autosave?: AutosaveStore } = {}) {
  const toasts = createToastNotifier();
  const app = createFakeEditorApp({
    services: { notify: toasts, ...(opts.autosave === undefined ? {} : { autosave: opts.autosave }) },
  });
  disposers.push(registerBuiltins(app));
  const pushed: string[] = [];
  const host = createHostShell({
    app,
    params: { ...DEFAULT_PARAMS, ...opts.params },
    storage: null,
    toasts,
    navigation: { push: (href) => void pushed.push(href), location: { search: '', assign: () => {} } },
  });
  disposers.push(() => host.dispose());
  return { app, host, pushed };
}

/** A Studio (Pro) shell over the host, mounted as the page does; the disposer unmounts and disposes it. */
function mountPro(host: HostShell): { readonly shell: Shell; dispose(): void } {
  const shell = createShell({ host });
  const unmount = host.mount(shell);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unmount();
    shell.dispose();
  };
  disposers.push(dispose);
  return { shell, dispose };
}

/** What a Halo shell mounts (the T2 stub's shape): no Pro registrations of its own. */
const HALO: MountedShell = { kind: 'halo', haloState: () => ({ stage: 'make' }) };

const enter = (app: EditorApp, workspace: 'model' | 'rig' | 'animate'): void => app.session.setState({ workspace });
const operatorsPresent = (app: EditorApp, ids: readonly string[]): boolean =>
  ids.every((id) => app.operators.get(id) !== undefined);
const markingMenusPresent = (app: EditorApp, ids: readonly string[]): boolean =>
  ids.every((id) => app.markingMenus.get(id) !== undefined);
const menusPresent = (app: EditorApp, ids: readonly string[]): boolean =>
  ids.every((id) => app.menus.get(id) !== undefined);
const modelMenus = MODEL_MARKING_MENUS.map((def) => def.id);
const rigMarking = RIG_MARKING_MENUS.map((def) => def.id);
const rigItems = RIG_MENU_ITEMS.map((def) => def.id);

describe('host registrations with Pro unmounted (T3 exit test)', () => {
  it('a host alone registers the view operators at once and each workspace part on its first entry', async () => {
    const { app, host } = setup();
    host.mount(HALO);
    await waitFor(() => operatorsPresent(app, VIEW_OPS), LOAD_MS);
    // the workspace parts wait for their workspace (intent, M2A-SPEC §5.21.2)
    await settle(50);
    expect(modelMenus.filter((id) => app.markingMenus.get(id) !== undefined)).toEqual([]);
    expect(operatorsPresent(app, RIG_OPS) || menusPresent(app, rigItems)).toBe(false);

    enter(app, 'model');
    await waitFor(() => markingMenusPresent(app, modelMenus), LOAD_MS);
    expect(modelMenus).toEqual(
      expect.arrayContaining(['model.modes', 'model.convert', 'model.options', 'model.tools.object', 'model.merge']),
    );

    enter(app, 'rig');
    await waitFor(() => operatorsPresent(app, RIG_OPS), LOAD_MS);
    expect(menusPresent(app, rigItems)).toBe(true);
    expect(markingMenusPresent(app, rigMarking)).toBe(true);
    // the selection-dependent Skeleton items follow too
    expect(app.menus.get('rig.skeleton.symmetry')).toBeDefined();
    expect(app.menus.get('rig.skeleton.map-humanoid-bone.none')).toBeDefined();
    // they work without Pro: the joint size is a preference
    await expect(app.runUntyped('rig.jointSize.set', { size: 2 })).resolves.toMatchObject({ status: 'finished' });
    expect(app.prefs.getState().rigging.jointSize).toBe(2);
    await expect(app.runUntyped('view.selectionMask', { mask: { joints: true } })).resolves.toMatchObject({
      status: 'finished',
    });
    expect(app.session.getState().tools.selectionMask.joints).toBe(true);
    // no Pro shell: no view-only rule, no Pro shell operators
    expect(rigViewOnly(app)).toBe(false);
    expect(app.operators.get('workspace.reset')).toBeUndefined();

    host.dispose();
    expect(operatorsPresent(app, VIEW_OPS) || operatorsPresent(app, RIG_OPS)).toBe(false);
    expect(modelMenus.filter((id) => app.markingMenus.get(id) !== undefined)).toEqual([]);
    expect(rigItems.filter((id) => app.menus.get(id) !== undefined)).toEqual([]);
  });

  it('they outlive Pro: a switch to Halo on the same page keeps them; Pro registers none of them itself', async () => {
    const { app, host } = setup();
    const pro = mountPro(host);
    enter(app, 'model');
    await waitFor(() => markingMenusPresent(app, modelMenus), LOAD_MS);
    enter(app, 'rig');
    await waitFor(() => operatorsPresent(app, [...VIEW_OPS, ...RIG_OPS]) && menusPresent(app, rigItems), LOAD_MS);
    expect(app.operators.get('workspace.reset')).toBeDefined(); // Pro's own
    pro.dispose();
    host.mount(HALO);
    expect(app.operators.get('workspace.reset')).toBeUndefined();
    expect(operatorsPresent(app, [...VIEW_OPS, ...RIG_OPS])).toBe(true);
    expect(markingMenusPresent(app, [...modelMenus, ...rigMarking])).toBe(true);
    expect(menusPresent(app, rigItems)).toBe(true);
    // idempotent: registering a part again adds nothing, and its disposer removes nothing of the first
    const { register } = await import('../src/host/registrations/model');
    register(app)();
    expect(markingMenusPresent(app, modelMenus)).toBe(true);
  });
});

describe('watchRigViewOnly stays Pro-only (AR-V1, §16.1)', () => {
  const original = globalThis.matchMedia;
  afterEach(() => {
    globalThis.matchMedia = original;
  });

  it('below 1024 px Halo (the host alone) edits Rig & Skin; Pro is view-only; after Pro leaves, editable again', async () => {
    // a narrow window: only the view-only query matches
    globalThis.matchMedia = ((query: string) => ({
      matches: query === RIG_VIEW_ONLY_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof globalThis.matchMedia;
    const { app, host } = setup();
    host.mount(HALO);
    enter(app, 'rig');
    await waitFor(() => operatorsPresent(app, RIG_OPS) && menusPresent(app, rigItems), LOAD_MS);
    await settle(100);
    expect(rigViewOnly(app)).toBe(false);

    const pro = mountPro(host);
    await waitFor(() => rigViewOnly(app), LOAD_MS);
    pro.dispose();
    expect(rigViewOnly(app)).toBe(false);
    host.mount(HALO);
    expect(operatorsPresent(app, RIG_OPS) && menusPresent(app, rigItems)).toBe(true);
  });
});

const NOW = Date.now();
const SLOTS: AutosaveSlotInfo[] = [
  {
    id: 'as_0000000000000001',
    projectName: 'Walk cycle',
    savedAt: NOW - 5 * 60_000,
    characters: 1,
    clips: 3,
    bytes: 12_345,
    appVersion: '0.2.0',
    schemaVersion: 2,
  },
];

/** An autosave store with orphaned slots (its own slot's writes and reads are not needed here). */
function storeWith(orphans: readonly AutosaveSlotInfo[]): AutosaveStore {
  return {
    open: () => Promise.resolve('as_ownownownownown1'),
    write: () => Promise.resolve({ bytes: 0 }),
    listOrphans: () => Promise.resolve(orphans),
    read: () => Promise.resolve(null),
    remove: () => Promise.resolve(),
  };
}

describe('the Recovery prompt is the host’s; the mounted shell offers the slots (J10)', () => {
  it('nothing is offered without a hook; a shell’s hook offers once per page load', async () => {
    const { app, host } = setup({ autosave: storeWith(SLOTS) });
    host.mount(HALO);
    await waitFor(() => app.session.getState().recovery.length === 1, LOAD_MS);
    await settle(50);
    expect(app.session.getState().dialog).toBeNull();
    // Halo's hook (Home › Continue): no first-run dialog to wait for, no modal
    let offers = 0;
    const withdraw = provideRecoveryHook(app, { firstRun: false, offer: () => void (offers += 1) });
    expect(offers).toBe(1);
    withdraw();
    provideRecoveryHook(app, { firstRun: false, offer: () => void (offers += 1) });
    app.session.setState({ recovery: [...SLOTS] });
    await settle(30);
    expect([offers, app.session.getState().dialog]).toEqual([1, null]);
  });

  it('a page that received a handoff record never offers', async () => {
    const { app } = setup({ autosave: storeWith(SLOTS), params: { handoff: 'h-1' } });
    let offers = 0;
    provideRecoveryHook(app, { firstRun: false, offer: () => void (offers += 1) });
    await waitFor(() => app.session.getState().recovery.length === 1, LOAD_MS);
    await settle(50);
    expect(offers).toBe(0);
  });

  it('Pro opens its Recovery dialog after its first-run dialog on its own page', async () => {
    const { app, host } = setup({ autosave: storeWith(SLOTS) });
    app.prefs.setState({ firstRunDone: false });
    mountPro(host);
    await waitFor(() => app.session.getState().recovery.length === 1, LOAD_MS);
    await settle(50);
    expect(app.session.getState().dialog).toBeNull();
    app.prefs.setState({ firstRunDone: true });
    await waitFor(() => app.session.getState().dialog === 'recovery');
  });

  it.each(['halo', 'autorig'] as const)(
    'Pro on a page opened from=%s offers at once (no first-run dialog; P6)',
    async (from) => {
      const { app, host } = setup({ autosave: storeWith(SLOTS), params: { from } });
      app.prefs.setState({ firstRunDone: false });
      mountPro(host);
      await waitFor(() => app.session.getState().dialog === 'recovery', LOAD_MS);
      expect(app.prefs.getState().firstRunDone).toBe(false);
    },
  );
});

describe('Pro’s switch to the Simple layout (§16.1)', () => {
  it('Help › and File › hide the switch until Halo ships, unless the page asks for it (?simple=1)', () => {
    const { app, host } = setup();
    mountPro(host);
    expect(app.operators.get('shell.halo')).toBeDefined();
    expect(app.menus.get('shell.help.halo')).toBeUndefined();
    expect(app.menus.get('shell.file.halo')).toBeUndefined();
  });

  it('shell.halo navigates on the same page with the workspace; Help › and File › list it', async () => {
    const search = window.location.search;
    window.history.replaceState(null, '', '?simple=1');
    const { app, host, pushed } = setup();
    try {
      mountPro(host);
    } finally {
      window.history.replaceState(null, '', search === '' ? window.location.pathname : search);
    }
    expect(app.operators.get('shell.halo')).toMatchObject({
      label: 'Switch to the Simple Layout',
      flags: { internal: true },
    });
    expect(app.menus.get('shell.help.halo')).toMatchObject({ menu: 'help', op: 'shell.halo' });
    expect(app.menus.get('shell.file.halo')).toMatchObject({ menu: 'file', op: 'shell.halo' });
    enter(app, 'rig');
    // a remembered Pro stays while HALO_ENTRY is off (a stored 'halo' would read as Ask before T12)
    localStorage.setItem('ekza-studio:entry:v1', JSON.stringify({ choice: 'studio', at: 1 }));
    try {
      await expect(app.runUntyped('shell.halo')).resolves.toMatchObject({ status: 'finished' });
      expect(pushed).toEqual(['/app?ws=rig&from=studio']);
      expect(host.navigation.takeWorkspace()).toBe('rig');
      expect(JSON.parse(localStorage.getItem('ekza-studio:entry:v1') ?? 'null')).toMatchObject({ choice: 'studio' });
    } finally {
      localStorage.removeItem('ekza-studio:entry:v1');
    }
  });

  it('Pro keeps its shipped name until T12 turns the title on (ST-30)', () => {
    expect([PRO_TITLE, PRO_NAME]).toEqual([false, 'Ekza Studio']);
  });
});

describe('the agent pill hook (§14)', () => {
  it('returns the live pill the agent module puts in the slot, for any shell', async () => {
    const noop = (): void => {};
    const ready = (): boolean => true;
    function Probe(): JSX.Element {
      return useAgentPill(noop, ready) ?? createElement('span', null, 'muted');
    }
    const view = await render(createElement(Probe));
    expect(view.container.textContent).toBe('muted');
    await act(async () => setAgentPill(createElement('span', null, 'AI connected')));
    expect(view.container.textContent).toBe('AI connected');
    await act(async () => setAgentPill(null));
    expect(view.container.textContent).toBe('muted');
    await view.unmount();
  });
});
