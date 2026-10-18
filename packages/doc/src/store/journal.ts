// Write journal of one transaction, preview overlay or external batch. Writes go straight to storage (so reads,
// queries and indexes see them: read-your-writes) and the journal keeps what is needed to roll them back and to
// compute the net change of every touched record.
import type { Partition } from '../records';
import type { Entry } from './rows';

export interface JournalOp {
  readonly table: string;
  readonly id: string;
  readonly prev: Entry | undefined;
  /** True for the first write of this record in the journal. */
  readonly first: boolean;
}

export interface JournalOriginal {
  readonly table: string;
  readonly id: string;
  /** Committed state before the first write; external writes during a preview update it (conflicts). */
  original: Entry | undefined;
}

export class Journal {
  readonly ops: JournalOp[] = [];
  /** First-touch order. */
  readonly originals = new Map<string, JournalOriginal>();
  /** Partitions opened implicitly by writes, in order. */
  readonly opened: Partition[] = [];

  get isEmpty(): boolean {
    return this.ops.length === 0;
  }
}

/** A rollback point inside a journal (nested transactions). */
export interface Savepoint {
  readonly ops: number;
}
