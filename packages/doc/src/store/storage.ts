// Record storage of the memory store: one map per table plus partition membership. Every write is reported to a
// listener (the query indexes). Visibility, soft deletion and transactions are layered on top by the store.
import type { Partition } from '../records';
import { type Entry, rowKey } from './rows';

export type WriteListener = (table: string, id: string, prev: Entry | undefined, next: Entry | undefined) => void;

export class Storage {
  private readonly tables = new Map<string, Map<string, Entry>>();
  private readonly members = new Map<Partition, Map<string, readonly [table: string, id: string]>>();

  constructor(private readonly onWrite: WriteListener) {}

  get(table: string, id: string): Entry | undefined {
    return this.tables.get(table)?.get(id);
  }

  /** Writes (`undefined` deletes) and keeps partition membership in step. */
  set(table: string, id: string, next: Entry | undefined): void {
    this.write(table, id, this.tables.get(table)?.get(id), next);
  }

  /**
   * `set` for a caller that knows the stored entry (M-1: a patch looks its record up once; a preview journal tracks
   * what it wrote). `prev` must be that entry.
   */
  write(table: string, id: string, prev: Entry | undefined, next: Entry | undefined): void {
    if (prev === next) return;
    let rows = this.tables.get(table);
    if (next === undefined) {
      rows?.delete(id);
    } else {
      if (rows === undefined) {
        rows = new Map();
        this.tables.set(table, rows);
      }
      rows.set(id, next);
    }
    if (prev !== undefined && prev.partition !== next?.partition)
      this.members.get(prev.partition)?.delete(rowKey(table, id));
    if (next !== undefined && next.partition !== prev?.partition) {
      let members = this.members.get(next.partition);
      if (members === undefined) {
        members = new Map();
        this.members.set(next.partition, members);
      }
      members.set(rowKey(table, id), [table, id]);
    }
    this.onWrite(table, id, prev, next);
  }

  /** Declares a table (kept even when empty, so snapshots preserve empty opaque tables). */
  ensureTable(table: string): void {
    if (!this.tables.has(table)) this.tables.set(table, new Map());
  }

  tableNames(): IterableIterator<string> {
    return this.tables.keys();
  }

  entries(table: string): IterableIterator<[string, Entry]> {
    return (this.tables.get(table) ?? new Map<string, Entry>()).entries();
  }

  size(table: string): number {
    return this.tables.get(table)?.size ?? 0;
  }

  /** Records currently assigned to a partition, as [table, id]. */
  membersOf(partition: Partition): Iterable<readonly [table: string, id: string]> {
    return this.members.get(partition)?.values() ?? [];
  }

  /** Partitions that hold at least one record. */
  partitions(): Partition[] {
    return [...this.members].filter(([, members]) => members.size > 0).map(([partition]) => partition);
  }

  clear(): void {
    this.tables.clear();
    this.members.clear();
  }
}
