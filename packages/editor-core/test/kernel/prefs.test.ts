import { describe, expect, it } from 'vitest';
import { defaultPrefs, type Prefs, type PrefsStorage } from '../../src';
import { PREFS_STORAGE_KEY, sanitizePrefs } from '../../src/prefs/persist';
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

const appWith = (storage: PrefsStorage | null, platform: 'mac' | 'other' = 'other') =>
  createFakeEditorApp({ platform, services: { ...createFakeServices(), storage } });

describe('defaultPrefs', () => {
  it('documents every default (§4.5), trackpad navigation on macOS', () => {
    expect(defaultPrefs('other')).toEqual({
      version: 1,
      firstRunDone: false,
      navProfile: 'maya',
      spaceBehaviour: 'maya',
      keymapOverrides: [],
      defaultTangents: { in: 'auto', out: 'auto' },
      autoKey: false,
      autoKeyMode: 'keyed-only',
      graphHandles: 'selected',
      moveSpace: 'world',
      rotateSpace: 'object',
      reduceOnImport: 'auto',
      uiScale: 1,
      // M2A-SPEC §4.5 (literal update, §3 rule 8)
      autoRigIk: { legs: true, arms: true },
      ikFkVisibility: 'hide',
      ikFkSwitchKey: 'auto',
      tweenOvershoot: false,
      arrowKeys: 'pickWalk',
      virtualSlider: { degPerPx: 0.5, metresPerPx: 0.01, unitsPerPx: 0.01, viewportMmb: true },
      exportReduce: {
        enabled: true,
        positionM: 0.0002,
        rotationCapRad: 0.004363323129985824,
        minLeverM: 0.01,
        scaleRel: 1e-4,
      },
      autosave: { enabled: true, delayMs: 2000, maxIntervalMs: 30000 },
      // M6a (M6A-SPEC §4.6; §3 rule 9 literal update)
      lastWorkspace: 'animate',
      modeling: {
        primitiveDefaults: 'low-poly',
        numericCapture: 'auto',
        undoSelection: { model: true, animate: false },
        undoBudgetMB: 256,
        journalBudgetMB: 64,
        symmetryTolerance: 0.001,
        gridStep: 0.1,
        increments: { move: 0.1, rotate: Math.PI / 12, scale: 0.1 },
        vertexSnapRadiusPx: 12,
        multiCutSnapStep: 0.25,
        optionDefaults: {},
        toolkitCollapsed: [],
        paletteRecents: [],
        convertOnModeSwitch: false,
      },
    });
    expect(defaultPrefs('mac').navProfile).toBe('trackpad');
  });
});

describe('M2a preferences (version stays 1)', () => {
  it('an M1 preferences value loads with every M2a field at its default', () => {
    const defaults = defaultPrefs('other');
    const m1 = {
      version: 1,
      firstRunDone: true,
      navProfile: 'trackpad',
      spaceBehaviour: 'play',
      keymapOverrides: [],
      defaultTangents: { in: 'linear', out: 'linear' },
      autoKey: true,
      autoKeyMode: 'all',
      graphHandles: 'all',
      moveSpace: 'object',
      rotateSpace: 'gimbal',
      reduceOnImport: 'never',
      uiScale: 1.25,
    };
    expect(sanitizePrefs(m1, defaults)).toEqual({
      ...m1,
      autoRigIk: defaults.autoRigIk,
      ikFkVisibility: 'hide',
      ikFkSwitchKey: 'auto',
      tweenOvershoot: false,
      arrowKeys: 'pickWalk',
      virtualSlider: defaults.virtualSlider,
      exportReduce: defaults.exportReduce,
      autosave: defaults.autosave,
      lastWorkspace: 'animate',
      modeling: defaults.modeling,
    });
  });

  it('keeps valid M2a values and falls back field by field inside the nested ones', () => {
    const defaults = defaultPrefs('other');
    const stored = {
      ...defaults,
      autoRigIk: { legs: false, arms: 'no' },
      ikFkVisibility: 'ghost',
      ikFkSwitchKey: 'sometimes',
      tweenOvershoot: true,
      arrowKeys: 'frames',
      virtualSlider: { degPerPx: 1, metresPerPx: -1, unitsPerPx: 0.02, viewportMmb: false },
      exportReduce: { enabled: false, positionM: 0.001, rotationCapRad: 'x' },
      autosave: 'off',
    };
    expect(sanitizePrefs(stored, defaults)).toMatchObject({
      autoRigIk: { legs: false, arms: true },
      ikFkVisibility: 'ghost',
      ikFkSwitchKey: 'auto',
      tweenOvershoot: true,
      arrowKeys: 'frames',
      virtualSlider: { degPerPx: 1, metresPerPx: 0.01, unitsPerPx: 0.02, viewportMmb: false },
      exportReduce: { ...defaults.exportReduce, enabled: false, positionM: 0.001 },
      autosave: defaults.autosave,
    });
  });
});

describe('M6a preferences (version stays 1)', () => {
  it('keeps valid modeling values and falls back field by field', () => {
    const defaults = defaultPrefs('other');
    const stored = {
      ...defaults,
      lastWorkspace: 'model',
      modeling: {
        primitiveDefaults: 'maya',
        numericCapture: 'sometimes',
        undoSelection: { model: false, animate: 'yes' },
        undoBudgetMB: 128,
        journalBudgetMB: -1,
        increments: { move: 0.5, rotate: 'x', scale: 0.25 },
        optionDefaults: { 'mesh.bevel': { offset: 0.1 } },
        toolkitCollapsed: ['soft', 3],
        paletteRecents: ['sw_A'],
        convertOnModeSwitch: true,
      },
    };
    expect(sanitizePrefs(stored, defaults)).toMatchObject({
      lastWorkspace: 'model',
      modeling: {
        ...defaults.modeling,
        primitiveDefaults: 'maya',
        undoBudgetMB: 128,
        increments: { move: 0.5, rotate: Math.PI / 12, scale: 0.25 },
        optionDefaults: { 'mesh.bevel': { offset: 0.1 } },
        paletteRecents: ['sw_A'],
        convertOnModeSwitch: true,
      },
    });
    expect(sanitizePrefs({ ...defaults, lastWorkspace: 'Not An Id!', modeling: 'off' }, defaults)).toMatchObject({
      lastWorkspace: 'animate',
      modeling: defaults.modeling,
    });
  });
});

describe('preference persistence', () => {
  it('loads stored preferences and writes every change back', () => {
    const storage = memoryStorage({
      [PREFS_STORAGE_KEY]: JSON.stringify({ ...defaultPrefs('other'), autoKey: true, rotateSpace: 'gimbal' }),
    });
    const app = appWith(storage);
    expect(app.prefs.getState()).toMatchObject({ autoKey: true, rotateSpace: 'gimbal', firstRunDone: false });
    app.prefs.setState({ navProfile: 'trackpad' });
    const saved = JSON.parse(storage.data.get(PREFS_STORAGE_KEY) ?? '{}') as Prefs;
    expect(saved).toMatchObject({ version: 1, navProfile: 'trackpad', autoKey: true });
    expect(appWith(storage).prefs.getState().navProfile).toBe('trackpad');
  });

  it('falls back field by field on invalid values and wholesale on another version or garbage', () => {
    const defaults = defaultPrefs('other');
    const stored = {
      ...defaults,
      navProfile: 'blender',
      uiScale: 9,
      autoKey: 'yes',
      defaultTangents: { in: 'linear', out: 'bogus' },
      keymapOverrides: [
        { chord: { code: 'KeyS' }, op: 'acme.save', scope: 'viewport' },
        { chord: { code: '' }, op: 'acme.bad', scope: 'viewport' },
        { chord: { code: 'KeyS' }, op: 'nodot', scope: 'viewport' },
        { chord: { code: 'KeyS', shift: 'yes' }, op: 'acme.bad', scope: 'viewport' },
        { chord: { code: 'KeyS' }, op: 'acme.bad', scope: 'viewport', trigger: 'double' },
        'junk',
      ],
      firstRunDone: true,
    };
    expect(sanitizePrefs(stored, defaults)).toEqual({
      ...defaults,
      firstRunDone: true,
      keymapOverrides: [{ chord: { code: 'KeyS' }, op: 'acme.save', scope: 'viewport' }],
    });
    expect(sanitizePrefs({ ...stored, version: 2 }, defaults)).toBe(defaults);
    expect(sanitizePrefs(null, defaults)).toBe(defaults);
    expect(appWith(memoryStorage({ [PREFS_STORAGE_KEY]: '{not json' })).prefs.getState()).toMatchObject({
      firstRunDone: true, // the test kit's default; nothing else was read
      autoKey: false,
    });
  });

  it('works without storage and survives throwing storage', () => {
    const app = appWith(null);
    app.prefs.setState({ autoKey: true });
    expect(app.prefs.getState().autoKey).toBe(true);
    const hostile: PrefsStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const blocked = appWith(hostile, 'mac');
    expect(blocked.prefs.getState().navProfile).toBe('trackpad');
    expect(() => blocked.prefs.setState({ autoKey: true })).not.toThrow();
    expect(blocked.prefs.getState().autoKey).toBe(true);
  });

  it('applies stored keymap overrides at startup', () => {
    const storage = memoryStorage({
      [PREFS_STORAGE_KEY]: JSON.stringify({
        ...defaultPrefs('other'),
        keymapOverrides: [{ chord: { code: 'KeyS' }, op: 'acme.save', scope: 'viewport' }],
        spaceBehaviour: 'play',
      }),
    });
    const app = appWith(storage);
    const input = { code: 'KeyS', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false };
    expect(app.keymap.resolve(input, ['viewport', 'global'], 'press')?.op).toBe('acme.save');
    expect(app.keymap.resolve({ ...input, code: 'Space' }, ['viewport', 'global'], 'tap')?.op).toBe('time.togglePlay');
  });
});
