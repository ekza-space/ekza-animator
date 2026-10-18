// M-1 (M2A-SPEC §5.21.1): the tables a change batch touches, computed once per batch. A drag of 1,000 keys emits a
// 1,000-change preview batch every frame, and a dozen listeners only ask "does it touch my tables?"; each used to
// scan every change for that (a dozen scans per frame, interpreted in a fresh editor's first frames).
import type { AnyChange, ChangeBatch } from '../store';
import type { TableName } from '../records';

const tablesOfBatch = new WeakMap<ChangeBatch, ReadonlySet<TableName>>();

/** The tables `batch` changes (one scan per batch object, cached while the batch lives). */
export function batchTables(batch: ChangeBatch): ReadonlySet<TableName> {
  let tables = tablesOfBatch.get(batch);
  if (tables === undefined) {
    const set = new Set<TableName>();
    let last: TableName | null = null;
    const changes = batch.changes;
    for (let i = 0; i < changes.length; i++) {
      // Batches come in runs of one table (1,000 keys): add each run once.
      const table = (changes[i] as AnyChange).table;
      if (table === last) continue;
      last = table;
      set.add(table);
    }
    tables = set;
    tablesOfBatch.set(batch, tables);
  }
  return tables;
}

/** True when `batch` changes one of `tables` (`batchTables` against a small watch list). */
export function batchTouches(batch: ChangeBatch, tables: Iterable<TableName>): boolean {
  const touched = batchTables(batch);
  for (const table of tables) if (touched.has(table)) return true;
  return false;
}
