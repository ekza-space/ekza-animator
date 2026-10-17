// Preference and layout storage over localStorage (PrefsStorage, MVP-SPEC §4.5). Every access is wrapped in
// try/catch (private mode, quota, disabled storage): the editor runs with no storage at all (research 09 §9.2).
import type { PrefsStorage } from '@ekza-animator/editor-core';

export const STORAGE_PREFIX = 'ekza-animator:';

/** Keys are stored as `${namespace}${key}`. Falls back to memory when localStorage is unavailable. */
export function createLocalStorage(namespace = ''): PrefsStorage {
  const memory = createMemoryStorage();
  const local = probeLocalStorage();
  if (local === null) return memory;
  // Keys whose last write failed (quota, storage revoked) live in memory until a write succeeds again: reading
  // localStorage first would return the older stored value.
  const inMemory = new Set<string>();
  return {
    getItem(key: string): string | null {
      if (inMemory.has(key)) return memory.getItem(key);
      try {
        return local.getItem(`${namespace}${key}`);
      } catch {
        return memory.getItem(key);
      }
    },
    setItem(key: string, value: string): void {
      try {
        local.setItem(`${namespace}${key}`, value);
        if (inMemory.delete(key)) memory.removeItem(key);
      } catch {
        memory.setItem(key, value);
        inMemory.add(key);
      }
    },
  };
}

/** In-memory storage: e2e runs (a fresh namespace per page load, MVP-SPEC §4.8) and storage-blocked browsers. */
export function createMemoryStorage(): PrefsStorage & { removeItem(key: string): void } {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

function probeLocalStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    if (storage === undefined) return null;
    const probe = `${STORAGE_PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
