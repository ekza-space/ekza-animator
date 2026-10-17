// Row sources of the naive store: the committed tables, copy-on-write overlays (transactions and previews) and a
// read view that applies partition visibility and soft deletion.
import type { Partition } from '@ekza-animator/doc';
import { compareStrings, isDeleted, partitionOfRow, type Row } from './rows';

export interface RowSource {
  /** The stored row, soft-deleted ones included; undefined when absent. */
  raw(table: string, id: string): Row | undefined;
  /** Every id that may exist in the table (`raw` has the final word). */
  ids(table: string): Iterable<string>;
  tableNames(): Iterable<string>;
}

export class CommittedTables implements RowSource {
  private readonly tables = new Map<string, Map<string, Row>>();

  raw(table: string, id: string): Row | undefined {
    return this.tables.get(table)?.get(id);
  }

  ids(table: string): Iterable<string> {
    return this.tables.get(table)?.keys() ?? [];
  }

  tableNames(): Iterable<string> {
    return this.tables.keys();
  }

  set(table: string, id: string, row: Row | undefined): void {
    let rows = this.tables.get(table);
    if (row === undefined) {
      rows?.delete(id);
      return;
    }
    if (rows === undefined) {
      rows = new Map();
      this.tables.set(table, rows);
    }
    rows.set(id, row);
  }

  clear(): void {
    this.tables.clear();
  }
}

/** Uncommitted writes over a base source. `null` marks a hard delete. */
export class Overlay implements RowSource {
  private readonly writes = new Map<string, Map<string, Row | null>>();
  private readonly order: (readonly [table: string, id: string])[] = [];

  constructor(readonly base: RowSource) {}

  raw(table: string, id: string): Row | undefined {
    const written = this.writes.get(table)?.get(id);
    if (written !== undefined) return written ?? undefined;
    return this.base.raw(table, id);
  }

  ids(table: string): Iterable<string> {
    const ids = new Set(this.base.ids(table));
    for (const id of this.writes.get(table)?.keys() ?? []) ids.add(id);
    return ids;
  }

  tableNames(): Iterable<string> {
    return new Set([...this.base.tableNames(), ...this.writes.keys()]);
  }

  write(table: string, id: string, row: Row | null): void {
    let rows = this.writes.get(table);
    if (rows === undefined) {
      rows = new Map();
      this.writes.set(table, rows);
    }
    if (!rows.has(id)) this.order.push([table, id]);
    rows.set(id, row);
  }

  /** Touched records in first-write order. */
  touched(): readonly (readonly [table: string, id: string])[] {
    return this.order;
  }
}

/** Read access with the doc rules: unopened partitions read as absent, `get`/`list` skip soft-deleted records. */
export class RowView {
  constructor(
    readonly source: RowSource,
    private readonly isOpen: (partition: Partition) => boolean,
  ) {}

  partitionOf(table: string, row: Row): Partition {
    return partitionOfRow(table, row, (rig) => {
      const rigRow = this.source.raw('rigs', rig);
      return rigRow === undefined ? undefined : String(rigRow['character']);
    });
  }

  /** Including soft-deleted records. */
  raw(table: string, id: string): Row | undefined {
    const row = this.source.raw(table, id);
    return row !== undefined && this.isOpen(this.partitionOf(table, row)) ? row : undefined;
  }

  get(table: string, id: string): Row | undefined {
    const row = this.raw(table, id);
    return row === undefined || isDeleted(row) ? undefined : row;
  }

  /** Visible, non-deleted rows ordered by id. */
  list(table: string): Row[] {
    const rows: Row[] = [];
    for (const id of this.source.ids(table)) {
      const row = this.get(table, id);
      if (row !== undefined) rows.push(row);
    }
    return rows.sort((a, b) => compareStrings(a.id, b.id));
  }
}
