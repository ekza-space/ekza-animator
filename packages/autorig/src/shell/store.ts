// A minimal external store for the shell's own U state (the footer a step sets, the From Studio hand-over, the
// pending step) — `useSyncExternalStore`-friendly, no dependency.
import { useCallback, useSyncExternalStore } from 'react';

export interface SmallStore<T> {
  get(): T;
  set(next: T | ((current: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function smallStore<T>(initial: T): SmallStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      for (const listener of Array.from(listeners)) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useSmall<T, S = T>(store: SmallStore<T>, select?: (value: T) => S): S {
  const get = useCallback(
    () => (select === undefined ? (store.get() as unknown as S) : select(store.get())),
    [store, select],
  );
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(subscribe, get, get);
}
