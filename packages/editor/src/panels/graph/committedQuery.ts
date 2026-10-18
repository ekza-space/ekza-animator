// M-1 (M2A-SPEC §5.21.1): the Graph panel's document reads that a drag does not need frame by frame — the channel
// tree, the selected keys' numeric fields and the toolbar state — re-read after committed changes only. Preview batches
// (each coalesced drag update) are skipped: during a drag the fields keep their pre-drag values (the canvas readout
// shows the offsets), the commit re-reads them, and a cancel restores exactly what they show.
import { batchTouches, type DocumentStore, type TableName } from '@ekza-animator/doc';
import { useMemo, useSyncExternalStore } from 'react';
import { useEditorApp } from '../../hooks';

interface Snapshot {
  readonly store: DocumentStore;
  readonly version: number;
}

/** `useDocQuery` without the re-reads of preview batches. */
export function useCommittedDocQuery<T>(read: (store: DocumentStore) => T, tables: readonly TableName[]): T {
  const { store } = useEditorApp();
  const tablesKey = [...tables].sort().join(',');
  const source = useMemo(() => committedSource(store, tablesKey.split(',')), [store, tablesKey]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  return useMemo(() => read(snapshot.store), [read, snapshot]);
}

function committedSource(
  store: DocumentStore,
  tables: readonly string[],
): { readonly subscribe: (notify: () => void) => () => void; readonly getSnapshot: () => Snapshot } {
  const watched = [...new Set(tables)] as TableName[];
  let snapshot: Snapshot = { store, version: 0 };
  return {
    subscribe: (notify) =>
      store.subscribe((batch) => {
        if (batch.origin === 'preview' && store.preview !== null) return;
        if (batch.origin !== 'load' && !batchTouches(batch, watched)) return;
        snapshot = { store, version: snapshot.version + 1 };
        notify();
      }),
    getSnapshot: () => snapshot,
  };
}
