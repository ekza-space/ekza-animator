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
    });
    expect(defaultPrefs('mac').navProfile).toBe('trackpad');
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
