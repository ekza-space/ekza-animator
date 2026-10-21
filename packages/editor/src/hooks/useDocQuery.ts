import { batchTouches, type DocumentStore, type TableName } from '@ekza-studio/doc';
import { useMemo, useSyncExternalStore } from 'react';
import { useEditorApp } from './context';

/**
 * Reads document state and re-reads it after every change batch (preview batches included) that touches one of
 * `tables`, and after `load`. `read` also runs when the component renders with a new `read` function, so keep it
 * cheap and pure; results are not deep-compared.
 */
export function useDocQuery<T>(read: (store: DocumentStore) => T, tables: readonly TableName[]): T {
  const { store } = useEditorApp();
  const tablesKey = [...tables].sort().join(',');
  const source = useMemo(() => tableSource(store, tablesKey.split(',')), [store, tablesKey]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  return useMemo(() => read(snapshot.store), [read, snapshot]);
}

interface TableSnapshot {
  readonly store: DocumentStore;
  readonly version: number;
}

/** External store whose snapshot changes identity only on batches that touch the watched tables. */
function tableSource(
  store: DocumentStore,
  tables: readonly string[],
): { readonly subscribe: (notify: () => void) => () => void; readonly getSnapshot: () => TableSnapshot } {
  const watched = [...new Set(tables)] as TableName[];
  let snapshot: TableSnapshot = { store, version: 0 };
  return {
    subscribe: (notify) =>
      store.subscribe((batch) => {
        // M-1: the batch's table set is computed once for every listener (a drag batch holds 1,000 changes).
        if (batch.origin !== 'load' && !batchTouches(batch, watched)) return;
        snapshot = { store, version: snapshot.version + 1 };
        notify();
      }),
    getSnapshot: () => snapshot,
  };
}
