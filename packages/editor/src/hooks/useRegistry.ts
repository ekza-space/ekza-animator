import type { Registry } from '@ekza-studio/editor-core';
import { useMemo, useSyncExternalStore } from 'react';

/** The items of a contribution registry; re-renders when something registers or unregisters. */
export function useRegistryList<T extends { readonly id: string }>(registry: Registry<T>): readonly T[] {
  const source = useMemo(() => listSource(registry), [registry]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

const sameItems = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/** External store over a registry whose snapshot changes identity only when the registry's items change. */
function listSource<T extends { readonly id: string }>(
  registry: Registry<T>,
): { readonly subscribe: (notify: () => void) => () => void; readonly getSnapshot: () => readonly T[] } {
  let snapshot: readonly T[] = registry.list();
  return {
    subscribe: (notify) => {
      const off = registry.subscribe(() => {
        snapshot = registry.list();
        notify();
      });
      // M6A-INT-15: a registration between the render that read the snapshot and this subscription (the Model menu
      // items of a chunk that loaded meanwhile) is not lost: React reads the snapshot again after subscribing.
      const latest = registry.list();
      if (!sameItems(latest, snapshot)) {
        snapshot = latest;
        notify();
      }
      return off;
    },
    getSnapshot: () => snapshot,
  };
}
