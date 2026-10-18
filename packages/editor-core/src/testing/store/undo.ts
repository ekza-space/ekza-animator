// Patch undo of the naive store: local batches only, coalescing, compare-before-restore per merge unit
// (MVP-SPEC §4.11.0 store rules 4–5). Simple stacks; WP-2's PatchUndoManager is the production version.
import type { AnyChange, TxMeta, UndoEntry, UndoManager, UndoResult, UndoSkipReason } from '@ekza-animator/doc';
import { deepEqual, diffFields, mergeUnitOf, type Row } from './rows';

/** Loosely typed `Change`; the store casts it to `AnyChange` at the API boundary. */
export interface RowChange {
  readonly table: string;
  readonly id: string;
  readonly before: Row | undefined;
  readonly after: Row | undefined;
  readonly fields?: readonly string[];
}

export const asAnyChanges = (changes: readonly RowChange[]): readonly AnyChange[] =>
  changes as unknown as readonly AnyChange[];
const asRowChanges = (changes: readonly AnyChange[]): readonly RowChange[] =>
  changes as unknown as readonly RowChange[];

/** A change record: `fields` only for updates of field-merge tables (§4.2 `Change`). */
export function makeChange(table: string, id: string, before: Row | undefined, after: Row | undefined): RowChange {
  if (before !== undefined && after !== undefined && mergeUnitOf(table) === 'field') {
    return { table, id, before, after, fields: diffFields(before, after) };
  }
  return { table, id, before, after };
}

/** Folds two consecutive change lists into one (earliest `before`, latest `after`); drops no-op changes. */
export function mergeChanges(first: readonly RowChange[], second: readonly RowChange[]): RowChange[] {
  const merged = new Map<string, { table: string; id: string; before: Row | undefined; after: Row | undefined }>();
  for (const change of [...first, ...second]) {
    const key = `${change.table}\u0000${change.id}`;
    const existing = merged.get(key);
    if (existing === undefined)
      merged.set(key, { table: change.table, id: change.id, before: change.before, after: change.after });
    else existing.after = change.after;
  }
  return [...merged.values()]
    .filter((change) => !deepEqual(change.before, change.after))
    .map((change) => makeChange(change.table, change.id, change.before, change.after));
}

export interface UndoHost {
  readonly now: () => number;
  /** Committed row (soft-deleted included). */
  current(table: string, id: string): Row | undefined;
  /** False when the change's partition is not open. */
  partitionOpen(table: string, row: Row): boolean;
  /** Throws when the store cannot be written (preview active, read-only). */
  assertWritable(): void;
  /** Applies whole-row writes as one committed batch. */
  commit(origin: 'undo' | 'redo', label: string, writes: readonly RowChange[]): void;
}

interface StackEntry {
  entry: UndoEntry;
  readonly coalesceKey: string | undefined;
  lastAt: number;
}

export class NaiveUndoManager implements UndoManager {
  private readonly undoStack: StackEntry[] = [];
  private readonly redoStack: StackEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private capturing = true;

  constructor(
    private readonly host: UndoHost,
    readonly limit: number,
  ) {}

  /** Called by the store for every committed local batch. */
  record(txId: string, changes: readonly RowChange[], meta: TxMeta): void {
    if (meta.undoable === false || changes.length === 0) return;
    const now = this.host.now();
    const top = this.undoStack.at(-1);
    const coalesceMs = meta.coalesceMs ?? 0; // 0: no coalescing
    const coalesce =
      this.capturing &&
      top !== undefined &&
      meta.coalesceKey !== undefined &&
      top.coalesceKey === meta.coalesceKey &&
      coalesceMs > 0 &&
      now - top.lastAt <= coalesceMs;
    this.capturing = true;
    if (coalesce) {
      const merged = mergeChanges(asRowChanges(top.entry.changes), changes);
      if (merged.length === 0) {
        // Edits that cancel out (a nudge and its reverse) leave nothing to undo.
        this.undoStack.pop();
      } else {
        top.entry = { ...top.entry, changes: asAnyChanges(merged), ...selectionAfter(meta) };
        top.lastAt = now;
      }
    } else {
      const entry: UndoEntry = {
        txId,
        label: meta.label,
        changes: asAnyChanges(changes),
        ...(meta.selectionBefore === undefined ? {} : { selectionBefore: meta.selectionBefore }),
        ...selectionAfter(meta),
      };
      this.undoStack.push({ entry, coalesceKey: meta.coalesceKey, lastAt: now });
      if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.redoStack.length = 0;
    this.notify();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  peekUndo(): UndoEntry | null {
    return this.undoStack.at(-1)?.entry ?? null;
  }

  peekRedo(): UndoEntry | null {
    return this.redoStack.at(-1)?.entry ?? null;
  }

  undo(): UndoResult | null {
    return this.step('undo');
  }

  redo(): UndoResult | null {
    return this.step('redo');
  }

  stopCapturing(): void {
    this.capturing = false;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private step(direction: 'undo' | 'redo'): UndoResult | null {
    const from = direction === 'undo' ? this.undoStack : this.redoStack;
    const to = direction === 'undo' ? this.redoStack : this.undoStack;
    const item = from.at(-1);
    if (item === undefined) return null;
    this.host.assertWritable();
    from.pop();
    const changes = asRowChanges(item.entry.changes);
    const ordered = direction === 'undo' ? [...changes].reverse() : changes;
    const writes: RowChange[] = [];
    const skipped: { change: AnyChange; fields: readonly string[] | null; reason: UndoSkipReason }[] = [];
    for (const change of ordered) {
      const outcome = this.restore(change, direction);
      if (outcome.write !== null) writes.push(outcome.write);
      if (outcome.skipped !== null) {
        skipped.push({
          change: change as unknown as AnyChange,
          fields: outcome.skipped.fields,
          reason: outcome.skipped.reason,
        });
      }
    }
    // Stacks first, then the batch: listeners of the undo/redo batch see the updated stacks.
    to.push(item);
    this.capturing = false;
    if (writes.length > 0) this.host.commit(direction, item.entry.label, writes);
    this.notify();
    const selection = direction === 'undo' ? item.entry.selectionBefore : item.entry.selectionAfter;
    return {
      label: item.entry.label,
      applied: writes.length,
      skipped,
      ...(selection === undefined ? {} : { selection }),
    };
  }

  /** Compare-before-restore of one change: a whole-row write, or the matching fields of a field-merge update. */
  private restore(
    change: RowChange,
    direction: 'undo' | 'redo',
  ): {
    write: RowChange | null;
    skipped: { fields: readonly string[] | null; reason: UndoSkipReason } | null;
  } {
    const expected = direction === 'undo' ? change.after : change.before;
    const target = direction === 'undo' ? change.before : change.after;
    const anyRow = change.before ?? change.after;
    if (anyRow !== undefined && !this.host.partitionOpen(change.table, anyRow)) {
      return { write: null, skipped: { fields: null, reason: 'missing-partition' } };
    }
    const current = this.host.current(change.table, change.id);
    const fieldMerge = mergeUnitOf(change.table) === 'field' && expected !== undefined && target !== undefined;
    if (!fieldMerge) {
      if (!deepEqual(current, expected)) return { write: null, skipped: { fields: null, reason: 'changed-by-other' } };
      return { write: makeChange(change.table, change.id, current, target), skipped: null };
    }
    if (current === undefined) return { write: null, skipped: { fields: null, reason: 'changed-by-other' } };
    const fields = change.fields ?? diffFields(expected, target);
    const next: Record<string, unknown> = { ...current };
    const skippedFields: string[] = [];
    let reverted = 0;
    for (const field of fields) {
      if (!deepEqual(current[field], expected[field])) {
        skippedFields.push(field);
        continue;
      }
      if (Object.hasOwn(target, field)) next[field] = target[field];
      else delete next[field];
      reverted++;
    }
    return {
      write: reverted === 0 ? null : makeChange(change.table, change.id, current, next as Row),
      skipped: skippedFields.length === 0 ? null : { fields: skippedFields, reason: 'changed-by-other' },
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function selectionAfter(meta: TxMeta): { selectionAfter?: unknown } {
  return meta.selectionAfter === undefined ? {} : { selectionAfter: meta.selectionAfter };
}
