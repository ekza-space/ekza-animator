// AUTORIG-SPEC §3.3 (D2): the remembered entry choice — `localStorage['ekza-studio:entry:v1'] = {choice, at}`; every
// access in try/catch; blocked, throwing or malformed storage means Ask; `?chooser=1` and back/forward visits never
// redirect; the redirect keeps the page's other parameters.
import { describe, expect, it } from 'vitest';
import {
  ENTRY_KEY,
  ENTRY_ROUTES,
  type EntryStorage,
  entryHref,
  parseChoice,
  readChoice,
  redirectHref,
  writeChoice,
} from '../app/entry';

function memoryStorage(initial: Record<string, string> = {}): EntryStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function blockedStorage(): EntryStorage {
  const refuse = (): never => {
    throw new Error('SecurityError: storage is blocked');
  };
  return { getItem: refuse, setItem: refuse, removeItem: refuse };
}

describe('the remembered choice (§3.3)', () => {
  it('uses the new ekza-studio key and the two routes', () => {
    expect(ENTRY_KEY).toBe('ekza-studio:entry:v1');
    // STUDIO-TOUCH-SPEC §1.2 (T2): + Ekza Studio's `/app` (honoured only with HALO_ENTRY, entry-contract.test.ts)
    expect(ENTRY_ROUTES).toEqual({ autorig: '/autorig', studio: '/editor', halo: '/app' });
  });

  it.each([
    [null, null],
    ['{"choice":"autorig","at":1}', 'autorig'],
    ['{"choice":"studio","at":1}', 'studio'],
    ['{"choice":"editor"}', null],
    ['{"choice":"toString"}', null],
    ['{"choice":"__proto__"}', null],
    ['"autorig"', null],
    ['null', null],
    ['[]', null],
    ['{', null],
  ] as const)('parses %s as %s', (raw, choice) => {
    expect(parseChoice(raw)).toBe(choice);
  });

  it('writes {choice, at} and reads it back; null forgets it', () => {
    const storage = memoryStorage();
    expect(readChoice(storage)).toBeNull();
    expect(writeChoice('autorig', storage, 1234)).toBe(true);
    expect(JSON.parse(storage.data.get(ENTRY_KEY) ?? '')).toEqual({ choice: 'autorig', at: 1234 });
    expect(readChoice(storage)).toBe('autorig');
    expect(writeChoice('studio', storage, 5)).toBe(true);
    expect(readChoice(storage)).toBe('studio');
    expect(writeChoice(null, storage)).toBe(true);
    expect(storage.data.has(ENTRY_KEY)).toBe(false);
    expect(readChoice(storage)).toBeNull();
  });

  it('blocked or missing storage means Ask and never throws', () => {
    expect(readChoice(blockedStorage())).toBeNull();
    expect(writeChoice('autorig', blockedStorage())).toBe(false);
    expect(writeChoice(null, blockedStorage())).toBe(false);
    expect(readChoice(null)).toBeNull();
    expect(writeChoice('studio', null)).toBe(false);
  });
});

describe('the landing redirect (§3.3)', () => {
  it.each([
    ['', 'autorig', false, '/autorig'],
    ['', 'studio', false, '/editor'],
    ['', null, false, null],
    ['?chooser=1', 'autorig', false, null],
    ['?e2e=1&chooser=1', 'studio', false, null],
    ['?chooser=0', 'studio', false, '/editor'],
    ['?e2e=1&ns=a', 'autorig', false, '/autorig?e2e=1&ns=a'],
    ['', 'autorig', true, null],
  ] as const)('%s with %s (back/forward %s) → %s', (search, choice, backForward, href) => {
    expect(redirectHref(search, choice, backForward)).toBe(href);
  });

  it('cards carry the query without the chooser parameter', () => {
    expect(entryHref('autorig', '?chooser=1&e2e=1')).toBe('/autorig?e2e=1');
    expect(entryHref('studio', '')).toBe('/editor');
  });
});
