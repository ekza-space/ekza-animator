// The effective-preferences layer (STUDIO-TOUCH-SPEC §16.4, §20.3 item 16; T0): readers see base ⊕ device ⊕ shell,
// persistence writes only the base, a removed override is gone (AS-ST-10), writes under an override land in the base,
// the legacy id migration keeps working, and a store without overrides is untouched.
import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import {
  basePrefs,
  defaultPrefs,
  LEGACY_IDS,
  overridePrefs,
  type Prefs,
  type PrefsStorage,
  prefsOverrideLayers,
  registerBuiltins,
} from '../../src';
import { PREFS_STORAGE_KEY } from '../../src/prefs/persist';
import { createFakeEditorApp, createFakeServices } from '../../src/testing';

function memoryStorage(initial?: Record<string, string>): PrefsStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const stored = (storage: { readonly data: Map<string, string> }): Prefs =>
  JSON.parse(storage.data.get(PREFS_STORAGE_KEY) ?? 'null') as Prefs;

const appWith = (storage: PrefsStorage | null) =>
  createFakeEditorApp({ platform: 'other', services: { ...createFakeServices(), storage } });

/** The iOS memory profile's device patch (host/memoryProfile.ts). */
const DEVICE = { modeling: { undoBudgetMB: 96, journalBudgetMB: 24 } } as const;

describe('overridePrefs', () => {
  it('shows base ⊕ device ⊕ shell to readers; a deep patch keeps the other nested fields', () => {
    const store = createStore<Prefs>()(() => defaultPrefs('other'));
    const base = store.getState();
    overridePrefs(store, 'device', DEVICE);
    const prefs = store.getState();
    expect(prefs.modeling.undoBudgetMB).toBe(96);
    expect(prefs.modeling.journalBudgetMB).toBe(24);
    expect(prefs.modeling.gridStep).toBe(base.modeling.gridStep);
    expect(prefs.modeling.increments).toBe(base.modeling.increments); // untouched branches are shared
    expect(prefs.rigging).toBe(base.rigging);
    expect(basePrefs(prefs)).toBe(base);
    expect(prefsOverrideLayers(store)).toEqual(['device']);
  });

  it('a shell override wins over the device layer, whatever the order they were laid in', () => {
    const store = createStore<Prefs>()(() => defaultPrefs('other'));
    const offShell = overridePrefs(store, 'shell', { modeling: { undoBudgetMB: 10 }, autoKey: true });
    const offDevice = overridePrefs(store, 'device', DEVICE);
    expect(store.getState().modeling.undoBudgetMB).toBe(10);
    expect(store.getState().modeling.journalBudgetMB).toBe(24);
    expect(store.getState().autoKey).toBe(true);
    expect(prefsOverrideLayers(store)).toEqual(['device', 'shell']);
    offShell();
    expect(store.getState().modeling.undoBudgetMB).toBe(96);
    expect(store.getState().autoKey).toBe(false);
    offDevice();
    expect(store.getState().modeling.undoBudgetMB).toBe(256);
    expect(prefsOverrideLayers(store)).toEqual([]);
  });

  it('notifies subscribers when an override comes and goes, and leaves the store untouched afterwards', () => {
    const store = createStore<Prefs>()(() => defaultPrefs('other'));
    const setState = store.setState;
    const seen = vi.fn<(next: boolean, previous: boolean) => void>();
    store.subscribe((next, previous) => seen(next.autoKey, previous.autoKey));
    const off = overridePrefs(store, 'shell', { autoKey: true });
    expect(seen).toHaveBeenLastCalledWith(true, false);
    expect(store.setState).not.toBe(setState);
    off();
    expect(seen).toHaveBeenLastCalledWith(false, true);
    off(); // a second call does nothing
    expect(seen).toHaveBeenCalledTimes(2);
    expect(store.setState).toBe(setState); // the layer left the store
    store.setState({ autoKey: true });
    expect(store.getState().autoKey).toBe(true);
  });

  it('an override that changes nothing visible does not notify', () => {
    const store = createStore<Prefs>()(() => defaultPrefs('other'));
    const seen = vi.fn<() => void>();
    store.subscribe(seen);
    const off = overridePrefs(store, 'shell', { autoKey: false });
    expect(seen).not.toHaveBeenCalled();
    off();
    expect(seen).not.toHaveBeenCalled();
  });

  it('a write that carries the shown value back keeps the base; a new value under an override lands in the base', () => {
    const store = createStore<Prefs>()(() => defaultPrefs('other'));
    const off = overridePrefs(store, 'device', DEVICE);
    // the usual spread write of another field
    store.setState({ modeling: { ...store.getState().modeling, gridStep: 0.5 } });
    expect(store.getState().modeling.gridStep).toBe(0.5);
    expect(store.getState().modeling.undoBudgetMB).toBe(96);
    expect(basePrefs(store.getState()).modeling).toMatchObject({
      gridStep: 0.5,
      undoBudgetMB: 256,
      journalBudgetMB: 64,
    });
    // a functional update reads the effective value and is rebased the same way
    store.setState((prefs) => ({ modeling: { ...prefs.modeling, multiCutSnapStep: 0.5 } }));
    expect(basePrefs(store.getState()).modeling.undoBudgetMB).toBe(256);
    // a deliberate new value of an overridden field goes to the base and shows once the override is gone
    store.setState({ modeling: { ...store.getState().modeling, undoBudgetMB: 512 } });
    expect(store.getState().modeling.undoBudgetMB).toBe(96);
    expect(basePrefs(store.getState()).modeling.undoBudgetMB).toBe(512);
    off();
    expect(store.getState().modeling).toMatchObject({ undoBudgetMB: 512, journalBudgetMB: 64, gridStep: 0.5 });
  });

  it('a replace write is rebased too', () => {
    const store = createStore<Prefs>()(() => defaultPrefs('other'));
    overridePrefs(store, 'shell', { autoKey: true });
    store.setState({ ...store.getState(), uiScale: 1.25 }, true);
    expect(store.getState()).toMatchObject({ autoKey: true, uiScale: 1.25 });
    expect(basePrefs(store.getState())).toMatchObject({ autoKey: false, uiScale: 1.25 });
  });
});

describe('the override layer on the kernel (persistence writes only the base)', () => {
  it('readers and the mesh budgets see the override; storage never does (AS-ST-10)', () => {
    const storage = memoryStorage();
    const app = appWith(storage);
    app.prefs.setState({ uiScale: 1.25 });
    const before = storage.data.get(PREFS_STORAGE_KEY);
    const off = overridePrefs(app.prefs, 'device', DEVICE);
    expect(app.prefs.getState().modeling.undoBudgetMB).toBe(96);
    expect(stored(storage).modeling.undoBudgetMB).toBe(256);
    app.prefs.setState({ autoKey: true });
    expect(stored(storage)).toMatchObject({ autoKey: true, uiScale: 1.25 });
    expect(stored(storage).modeling).toMatchObject({ undoBudgetMB: 256, journalBudgetMB: 64 });
    app.prefs.setState({ autoKey: false });
    off();
    expect(storage.data.get(PREFS_STORAGE_KEY)).toBe(before);
    app.dispose();
  });

  it('a shell override of autoKey (Halo’s Rec) never writes Pro’s stored Auto Key', () => {
    const storage = memoryStorage();
    const app = appWith(storage);
    const off = overridePrefs(app.prefs, 'shell', { autoKey: true });
    expect(app.prefs.getState().autoKey).toBe(true);
    app.prefs.setState({ lastWorkspace: 'rig' });
    expect(stored(storage)).toMatchObject({ autoKey: false, lastWorkspace: 'rig' });
    off();
    expect(app.prefs.getState().autoKey).toBe(false);
    app.dispose();
  });

  it('under Rec, prefs.set and Auto Key still write Pro’s stored value, and only it (T6-INT, P-T6B-6)', async () => {
    const storage = memoryStorage();
    const app = appWith(storage);
    app.contribute({
      kind: 'operator',
      def: {
        id: 'prefs.set',
        label: 'Set Preferences',
        category: 'ui',
        scope: 'global',
        apply: (_ctx, args) => app.prefs.setState({ ...(args as { patch: Partial<Prefs> }).patch }),
      },
    });
    registerBuiltins(app);
    const off = overridePrefs(app.prefs, 'shell', { autoKey: true });
    // the stored value can be set to the value the override shows (the plain partial names it)
    expect((await app.run('prefs.set', { patch: { autoKey: true } })).status).toBe('finished');
    expect(stored(storage).autoKey).toBe(true);
    expect(app.prefs.getState().autoKey).toBe(true);
    // the toggle flips the stored value, not the shown one
    expect((await app.run('key.toggleAutoKey')).status).toBe('finished');
    expect(stored(storage).autoKey).toBe(false);
    expect(app.prefs.getState().autoKey).toBe(true);
    expect((await app.run('key.toggleAutoKey')).status).toBe('finished');
    expect(stored(storage).autoKey).toBe(true);
    await app.run('key.toggleAutoKey');
    off();
    expect(app.prefs.getState().autoKey).toBe(false);
    // without an override the toggle is what it always was
    await app.run('key.toggleAutoKey');
    expect(app.prefs.getState().autoKey).toBe(true);
    expect(stored(storage).autoKey).toBe(true);
    app.dispose();
  });

  it('legacy ids load migrated under an override, and the next save writes the current ids without it', () => {
    // An old navigation id, spelled only in the legacy table (DECISIONS-OPEN TM-1).
    const oldNav = Object.keys(LEGACY_IDS.navProfile)[0];
    const legacy = { ...defaultPrefs('other'), navProfile: oldNav, modeling: { undoBudgetMB: 300 } };
    const storage = memoryStorage({ [PREFS_STORAGE_KEY]: JSON.stringify(legacy) });
    const app = appWith(storage);
    expect(app.prefs.getState().navProfile).toBe('dcc');
    overridePrefs(app.prefs, 'device', DEVICE);
    expect(app.prefs.getState().modeling.undoBudgetMB).toBe(96);
    app.prefs.setState({ tweenOvershoot: true });
    expect(stored(storage).navProfile).toBe('dcc');
    expect(stored(storage).modeling.undoBudgetMB).toBe(300);
    expect(stored(storage).tweenOvershoot).toBe(true);
    app.dispose();
  });
});
