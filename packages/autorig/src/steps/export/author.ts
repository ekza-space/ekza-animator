// The author Auto-Rig prefills (AUTORIG-SPEC §5.6.3; D6): the first author of the last successful VRM download,
// remembered per browser in `localStorage['ekza-studio:autorig:author:v1']`. A per-viewer convenience only (the
// closed `Prefs` contract has no author field): every access is wrapped, and blocked storage remembers nothing.
export const AUTHOR_KEY = 'ekza-studio:autorig:author:v1';

export type AuthorStorage = Pick<Storage, 'getItem' | 'setItem'> | null;

export function authorStorage(): AuthorStorage {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered author, or null. */
export function rememberedAuthor(storage: AuthorStorage = authorStorage()): string | null {
  if (storage === null) return null;
  try {
    const value = storage.getItem(AUTHOR_KEY)?.trim() ?? '';
    return value === '' || value.length > 200 ? null : value;
  } catch {
    return null;
  }
}

/** Remembers an author (empty values are ignored). */
export function rememberAuthor(author: string | undefined, storage: AuthorStorage = authorStorage()): void {
  const value = author?.trim() ?? '';
  if (storage === null || value === '') return;
  try {
    storage.setItem(AUTHOR_KEY, value.slice(0, 200));
  } catch {
    // storage full or blocked: nothing remembered
  }
}
