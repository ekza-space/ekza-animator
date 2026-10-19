// Compare-before-restore as a pure plan over the CURRENT document (MCP-SPEC §4.2): the planning half of
// `PatchUndoManager.step()` (patchUndo.ts, which stays untouched), so a forward transaction can undo older history
// entries without the undo stack (`edit.revertSteps`), and the "Restore the project as it was before the agent"
// action can return the document to a snapshot (`edit.restoreDocument`). A conformance test asserts that
// `planRestore(host, entry.changes, 'undo')` plans exactly the writes and skips that `undo()` performs.
//
// - Undo walks the changes newest first, redo oldest first; per merge unit: keys/assets and inserts/hard deletes as
//   whole records; updates of field-merge tables per field, restoring only the fields whose current value still
//   equals what the change wrote. Skips are `changed-by-other`, or `missing-partition` for a closed partition.
// - A planned hard delete of a record that something outside the plan still references is skipped as
//   `changed-by-other`, repeated until no planned delete has a dependant (exactly like the undo manager).
// - `applyRestorePlan` writes a plan through a transaction (read-your-writes, one undo step for the caller).
import { EkzaError } from '@ekza-animator/anim-core';
import type { AnyChange, DocSnapshot, Tx, UndoSkipReason } from '../store';
import { compareStrings, deepEqual } from '../store/diff';
import { referencesOf } from '../store/references';
import { hasTombstone, makeChange, type Row, type RowChange, rowKey } from '../store/rows';
import { BUILTIN_TABLES, type TableName } from '../records';
import { mergeUnitOf } from '../tables/registry';

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
export interface RestoreWrite {
  readonly table: string;
  readonly id: string;
  readonly after: DocRow | undefined;
}
export interface RestoreSkip {
  readonly change: AnyChange;
  readonly fields: readonly string[] | null;
  readonly reason: UndoSkipReason;
}
export interface RestorePlan {
  readonly writes: readonly RestoreWrite[];
  readonly skipped: readonly RestoreSkip[];
}

interface Outcome {
  readonly change: RowChange;
  write: RestoreWrite | null;
}

/** Compare-before-restore of one change (PatchUndoManager.restore). */
function restoreOne(
  host: RestoreHost,
  change: RowChange,
  direction: 'undo' | 'redo',
): { write: RestoreWrite | null; skip: { fields: readonly string[] | null; reason: UndoSkipReason } | null } {
  const expected = direction === 'undo' ? change.after : change.before;
  const target = direction === 'undo' ? change.before : change.after;
  const current = host.current(change.table, change.id) as Row | undefined;
  const probe = current ?? target ?? expected;
  if (probe !== undefined && !host.isOpen(change.table, change.id, probe)) {
    return { write: null, skip: { fields: null, reason: 'missing-partition' } };
  }
  const perField = expected !== undefined && target !== undefined && mergeUnitOf(change.table) === 'field';
  if (!perField) {
    if (!deepEqual(current, expected)) return { write: null, skip: { fields: null, reason: 'changed-by-other' } };
    return { write: { table: change.table, id: change.id, after: target }, skip: null };
  }
  if (current === undefined) return { write: null, skip: { fields: null, reason: 'changed-by-other' } };
  const fields = change.fields ?? allFields(expected, target);
  const next: Record<string, unknown> = { ...current };
  const skippedFields: string[] = [];
  let reverted = 0;
  for (const field of fields) {
    if (!deepEqual(current[field], expected[field])) {
      skippedFields.push(field);
      continue;
    }
    const value = target[field];
    if (value === undefined) delete next[field];
    else next[field] = value;
    reverted++;
  }
  return {
    write: reverted === 0 ? null : { table: change.table, id: change.id, after: next },
    skip: skippedFields.length === 0 ? null : { fields: skippedFields, reason: 'changed-by-other' },
  };
}

function allFields(a: Row, b: Row): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((field) => field !== 'id');
}

/**
 * Skips planned hard deletes of records something else still references; skipping one keeps its own references
 * alive, so this repeats until no planned delete has a dependant (PatchUndoManager.step).
 */
function skipReferencedDeletes(
  host: RestoreHost,
  outcomes: readonly Outcome[],
  planned: Map<string, { readonly table: string; readonly after: DocRow | undefined }>,
  skipped: RestoreSkip[],
): void {
  for (let changed = true; changed; ) {
    changed = false;
    for (const outcome of outcomes) {
      const write = outcome.write;
      if (write === null || write.after !== undefined) continue;
      if (host.dependantOf(write.table, write.id, planned) === null) continue;
      planned.delete(rowKey(write.table, write.id));
      outcome.write = null;
      skipped.push({ change: outcome.change as unknown as AnyChange, fields: null, reason: 'changed-by-other' });
      changed = true;
    }
  }
}

function finish(outcomes: readonly Outcome[], skipped: readonly RestoreSkip[]): RestorePlan {
  const writes: RestoreWrite[] = [];
  for (const outcome of outcomes) if (outcome.write !== null) writes.push(outcome.write);
  return { writes, skipped };
}

/** Undo walks newest change first, redo oldest first; per merge unit, exactly like PatchUndoManager. */
export function planRestore(host: RestoreHost, changes: readonly AnyChange[], direction: 'undo' | 'redo'): RestorePlan {
  const rows = changes as unknown as readonly RowChange[];
  const skipped: RestoreSkip[] = [];
  const planned = new Map<string, { readonly table: string; readonly after: DocRow | undefined }>();
  const outcomes: Outcome[] = [];
  for (let n = 0; n < rows.length; n++) {
    const change = rows[direction === 'undo' ? rows.length - 1 - n : n] as RowChange;
    const outcome = restoreOne(host, change, direction);
    if (outcome.skip !== null) skipped.push({ change: change as unknown as AnyChange, ...outcome.skip });
    if (outcome.write === null) continue;
    planned.set(rowKey(change.table, change.id), { table: change.table, after: outcome.write.after });
    outcomes.push({ change, write: outcome.write });
  }
  skipReferencedDeletes(host, outcomes, planned, skipped);
  return finish(outcomes, skipped);
}

/**
 * Plans the writes that make the current document equal to `snapshot` (a `store.snapshot()` taken earlier) in the
 * partitions that were open when it was taken: records that differ are written back, records created since are
 * removed, records deleted since are restored (the "Restore before the agent" action, MCP-SPEC §5.13). A snapshot
 * omits soft-deleted records, so a record that is soft-deleted now and absent from the snapshot needs no write;
 * a record in a partition that is closed now is skipped (`missing-partition`) when it differs.
 */
export function planSnapshotRestore(host: RestoreHost, snapshot: DocSnapshot): RestorePlan {
  const snapshotTables = snapshot.tables as unknown as Readonly<Record<string, Readonly<Record<string, Row>>>>;
  const tables = [...new Set([...host.tables(), ...Object.keys(snapshotTables)])].sort(compareStrings);
  const skipped: RestoreSkip[] = [];
  const planned = new Map<string, { readonly table: string; readonly after: DocRow | undefined }>();
  const outcomes: Outcome[] = [];
  for (const table of tables) {
    const rows = snapshotTables[table] ?? {};
    const ids = [...new Set([...host.ids(table), ...Object.keys(rows)])].sort(compareStrings);
    for (const id of ids) {
      const target = Object.hasOwn(rows, id) ? rows[id] : undefined;
      const current = host.current(table, id) as Row | undefined;
      if (target === undefined) {
        // Not in the snapshot: created since (or soft-deleted already, or in a partition it did not cover).
        if (current === undefined || hasTombstone(current) || !host.isOpen(table, id, current)) continue;
        const change = makeChange(table, id, current, undefined);
        planned.set(rowKey(table, id), { table, after: undefined });
        outcomes.push({ change, write: { table, id, after: undefined } });
        continue;
      }
      if (deepEqual(current, target)) continue;
      const change = makeChange(table, id, current, target);
      if (!host.isOpen(table, id, current ?? target)) {
        skipped.push({ change: change as unknown as AnyChange, fields: null, reason: 'missing-partition' });
        continue;
      }
      planned.set(rowKey(table, id), { table, after: target });
      outcomes.push({ change, write: { table, id, after: target } });
    }
  }
  skipReferencedDeletes(host, outcomes, planned, skipped);
  return finish(outcomes, skipped);
}

/** True when a `tx.remove` failed only because a record not yet removed still references the target. */
function isDependantError(error: unknown): boolean {
  return error instanceof EkzaError && error.code === 'invalid-record' && /still references it/.test(error.message);
}

/**
 * Applies a plan inside a transaction: after === undefined → tx.remove; field-merge tables → tx.patch of the
 * differing fields; other tables → tx.put. Hard deletes run after the other writes, dependants first (a record whose
 * dependant is removed later in the same plan waits for it). Returns the number of writes applied.
 */
export function applyRestorePlan(tx: Tx, plan: RestorePlan): number {
  let applied = 0;
  const removals: RestoreWrite[] = [];
  for (const write of plan.writes) {
    if (write.after === undefined) {
      removals.push(write);
      continue;
    }
    const table = write.table as TableName;
    const existing = tx.getIncludingDeleted(table, write.id as never) as Row | undefined;
    if (existing !== undefined && mergeUnitOf(write.table) === 'field') {
      const fields: Record<string, unknown> = {};
      let differs = false;
      for (const field of new Set([...Object.keys(existing), ...Object.keys(write.after)])) {
        if (field === 'id') continue;
        if (deepEqual(existing[field], write.after[field])) continue;
        fields[field] = write.after[field];
        differs = true;
      }
      if (differs) tx.patch(table, write.id as never, fields);
    } else {
      tx.put(table, write.after as never);
    }
    applied++;
  }
  let pending = removals;
  while (pending.length > 0) {
    const blocked: RestoreWrite[] = [];
    let progressed = false;
    for (const write of pending) {
      const table = write.table as TableName;
      if (tx.getIncludingDeleted(table, write.id as never) === undefined) {
        progressed = true;
        continue;
      }
      try {
        tx.remove(table, write.id as never);
        applied++;
        progressed = true;
      } catch (error) {
        if (!isDependantError(error)) throw error;
        blocked.push(write);
      }
    }
    if (!progressed) {
      const first = blocked[0] as RestoreWrite;
      tx.remove(first.table as TableName, first.id as never); // throws the store's dependant error
    }
    pending = blocked;
  }
  return applied;
}

/** The hook a store's transaction implements to give `restoreHostOf` its exact reads (the memory store does). */
export const RESTORE_HOST = Symbol.for('ekza-animator.doc.restoreHost');

interface WithRestoreHost {
  readonly [RESTORE_HOST]: () => RestoreHost;
}

function hasRestoreHost(tx: Tx): tx is Tx & WithRestoreHost {
  return typeof (tx as Partial<WithRestoreHost>)[RESTORE_HOST] === 'function';
}

/**
 * The compare-before-restore reads of a transaction (its own writes visible). Memory-store transactions (also the
 * ones doc-yjs runs on its core) answer exactly like the undo manager's host. Other stores get a host over the
 * public read API: visible partitions only, and dependants found by scanning the open records.
 */
export function restoreHostOf(tx: Tx): RestoreHost {
  if (hasRestoreHost(tx)) return tx[RESTORE_HOST]();
  return publicRestoreHost(tx);
}

function publicRestoreHost(tx: Tx): RestoreHost {
  const current = (table: string, id: string): DocRow | undefined =>
    tx.getIncludingDeleted(table as TableName, id as never) as DocRow | undefined;
  const ids = (table: string): readonly string[] => {
    const out = new Set<string>();
    for (const record of tx.list(table as TableName)) out.add((record as { readonly id: string }).id);
    return [...out];
  };
  return {
    current,
    // Without the store's partition map, a record readable through the transaction is in an open partition; a new
    // record (absent now) can always be written (writes open their partition).
    isOpen: () => true,
    dependantOf(table, id, planned) {
      for (const other of BUILTIN_TABLES) {
        for (const record of tx.list(other)) {
          const row = record as unknown as Row;
          const key = rowKey(other, row.id);
          const after = planned.has(key) ? planned.get(key)?.after : row;
          if (after === undefined || (other === table && row.id === id)) continue;
          for (const [refTable, refId] of referencesOf(other, after as Row)) {
            if (refTable === table && refId === id) return `${other}/${String(row.id)}`;
          }
        }
      }
      return null;
    },
    tables: () => [...BUILTIN_TABLES],
    ids,
  };
}
