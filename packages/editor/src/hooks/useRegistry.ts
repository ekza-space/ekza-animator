import type { Registry } from '@ekza-animator/editor-core';
import { useMemo, useSyncExternalStore } from 'react';

/** The items of a contribution registry; re-renders when something registers or unregisters. */
export function useRegistryList<T extends { readonly id: string }>(registry: Registry<T>): readonly T[] {
  const source = useMemo(() => listSource(registry), [registry]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

/** External store over a registry whose snapshot changes identity only when the registry notifies. */
function listSource<T extends { readonly id: string }>(
  registry: Registry<T>,
): { readonly subscribe: (notify: () => void) => () => void; readonly getSnapshot: () => readonly T[] } {
  let snapshot: readonly T[] = registry.list();
  return {
    subscribe: (notify) =>
      registry.subscribe(() => {
        snapshot = registry.list();
        notify();
      }),
    getSnapshot: () => snapshot,
  };
}
