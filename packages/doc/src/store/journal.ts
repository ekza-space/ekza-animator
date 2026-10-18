// Write journal of one transaction, preview overlay or external batch. Writes go straight to storage (so reads,
// queries and indexes see them: read-your-writes) and the journal keeps what is needed to roll them back and to
// compute the net change of every touched record.
import type { Partition } from '../records';
import { type Entry, rowKey } from './rows';

export interface JournalOp {
  readonly table: string;
  readonly id: string;
  readonly prev: Entry | undefined;
  /** True for the first write of this record in the journal. */
  readonly first: boolean;
}

/** `JournalOriginal.shown` of a record the previous preview update did not show (it was at its committed value). */
export const NOT_SHOWN: unique symbol = Symbol('not shown');

export interface JournalOriginal {
  readonly table: string;
  readonly id: string;
  /** Committed state before the first write; external writes during a preview update it (conflicts). */
  original: Entry | undefined;
  /**
   * Preview journals only (M2A-SPEC §5.21.1 M-1 mechanism 2: the journal is kept in place across updates): what
   * readers saw of the record before the running update, or NOT_SHOWN for a record first written by it.
   */
  shown: Entry | undefined | typeof NOT_SHOWN;
}

export class Journal {
  readonly ops: JournalOp[] = [];
  /** First-touch order, by `rowKey`. Add and remove through `add`/`remove` (they keep the lookup index). */
  readonly originals = new Map<string, JournalOriginal>();
  /** Partitions opened implicitly by writes, in order. */
  readonly opened: Partition[] = [];
  /**
   * The originals by table, then id (M-1: a write looks its record up without building a `rowKey` string; record
   * ids are stored strings whose hash the engine caches).
   */
  private readonly index = new Map<string, Map<string, JournalOriginal>>();

  get isEmpty(): boolean {
    return this.ops.length === 0;
  }

  get(table: string, id: string): JournalOriginal | undefined {
    return this.index.get(table)?.get(id);
  }

  add(original: JournalOriginal): void {
    this.originals.set(rowKey(original.table, original.id), original);
    let byId = this.index.get(original.table);
    if (byId === undefined) {
      byId = new Map();
      this.index.set(original.table, byId);
    }
    byId.set(original.id, original);
  }

  remove(table: string, id: string): void {
    this.originals.delete(rowKey(table, id));
    this.index.get(table)?.delete(id);
  }
}

/** A rollback point inside a journal (nested transactions). */
export interface Savepoint {
  readonly ops: number;
}
