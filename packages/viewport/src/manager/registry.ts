// Which ViewportManager serves an EditorApp. The shell's GL host creates the manager (it owns the WebGLRenderer);
// the viewport panel and the e2e test API find it here, so PanelProps stay `{ app, instanceId }`.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';

interface Entry<T> {
  manager: T | null;
  readonly listeners: Set<(manager: T | null) => void>;
}

const entries = new WeakMap<EditorApp, Entry<unknown>>();

function entryOf<T>(app: EditorApp): Entry<T> {
  let entry = entries.get(app) as Entry<T> | undefined;
  if (entry === undefined) {
    entry = { manager: null, listeners: new Set() };
    entries.set(app, entry as Entry<unknown>);
  }
  return entry;
}

/** Records `manager` as the app's viewport manager (null clears it when that manager is current). */
export function setManagerOf<T>(app: EditorApp, manager: T | null, previous?: T): void {
  const entry = entryOf<T>(app);
  if (manager === null && previous !== undefined && entry.manager !== previous) return;
  entry.manager = manager;
  for (const listener of entry.listeners) listener(manager);
}

export function managerOf<T>(app: EditorApp): T | null {
  return (entries.get(app)?.manager as T | null | undefined) ?? null;
}

export function subscribeManager<T>(app: EditorApp, listener: (manager: T | null) => void): Disposer {
  const entry = entryOf<T>(app);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}
