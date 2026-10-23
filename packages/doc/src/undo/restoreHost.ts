// The host side of compare-before-restore (MCP-SPEC §4.2), apart from the planner (`restorePlan.ts`) so the memory
// store implements the hook without carrying the planner in the editor's first visit (`check:size`).

/** doc's internal row shape (`store/rows.ts` Row), exported under this name. */
export type DocRow = Readonly<Record<string, unknown>>;

/** The planned writes a dependant check sees (keyed by `rowKey(table, id)`). */
export type PlannedRestoreWrites = ReadonlyMap<string, { readonly table: string; readonly after: DocRow | undefined }>;

export interface RestoreHost {
  /** The stored record (soft-deleted ones and closed partitions included): the transaction's read-your-writes view. */
  current(table: string, id: string): DocRow | undefined;
  isOpen(table: string, id: string, record: DocRow): boolean;
  /** A record that still references (table, id) when it is about to be hard-deleted, else null. */
  dependantOf(table: string, id: string, planned: PlannedRestoreWrites): string | null;
  /**
   * D0 addition (docs/wp-notes/mcp-contracts-foundation.md MAI-D0-1): the table names and the ids of every stored
   * record of a table (any visibility, any order). `planSnapshotRestore` needs them to find records created since
   * the snapshot; `planRestore` does not call them.
   */
  tables(): readonly string[];
  ids(table: string): readonly string[];
}
/** The hook a store's transaction implements to give `restoreHostOf` its exact reads (the memory store does). */
export const RESTORE_HOST = Symbol.for('ekza-animator.doc.restoreHost');
