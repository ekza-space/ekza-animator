// Store-agnostic patch undo (MVP-SPEC §4.11.0 store rules 4–5, ADR 0002 §2 and §7, research 06 §9).
// - Only committed `local` batches with `undoable !== false` are recorded (the store calls `record`).
// - Coalescing: a transaction with the same `coalesceKey` as the top entry, inside `coalesceMs` of the previous one,
//   merges into it (same txId, new entry object) — unless capturing was stopped or any other batch was committed in
//   between (`breakCoalescing`), so a merged entry never spans foreign writes.
// - Undo/redo compare before restore, per merge unit: keys/assets and inserts/hard deletes as whole records; updates
//   of field-merge tables per field, reverting only the fields whose current value still equals what this entry
//   wrote. Skips are reported (`changed-by-other`, or `missing-partition` when the record's partition is closed).
// - Undo/redo never hard-deletes a record that a record outside the step still references (another writer keyed into
//   a curve this entry created, an import added clips to its character): that delete is skipped as
//   `changed-by-other`, so undo cannot orphan someone else's records (research 06 R4, H2).
// - M6a eviction (M6A-SPEC §4.2): `entries()` exposes both stacks; entries leaving for good (the limit, `clear`, a new
//   transaction clearing redo, `evictOldest`, `clearRedo`, a document load) are reported to `onEvict` listeners
//   synchronously after the change, in eviction order. Coalescing replaces the top entry by a merged one with the same
//   txId (and drops it when the edits cancel out): that is not an eviction (§4.2). Transactions that write
//   `meshes.data` never set a coalesceKey (§5.20), so no chunk reference leaves the history unreported.
import { EkzaError } from '@ekza-studio/anim-core';
import type { AnyChange, TxMeta, UndoEntry, UndoEvictReason, UndoManager, UndoResult, UndoSkipReason } from '../store';
import { deepEqual } from '../store/diff';
import type { PlannedWrites } from '../store/references';
import { makeChange, type Row, type RowChange, rowKey } from '../store/rows';
import { mergeUnitOf } from '../tables/registry';

/** One whole-record write produced by undo/redo (`after === undefined`: hard delete). */
export interface UndoWrite {
  readonly table: string;
  readonly id: string;
  readonly after: Row | undefined;
}

/** What the undo manager needs from a store. */
export interface UndoHost {
  /** Clock for coalescing windows (ms). */
  now(): number;
  /** The stored record, soft-deleted ones and closed partitions included; undefined when absent. */
  current(table: string, id: string): Row | undefined;
  /** Whether the partition holding `id` (or, when absent, the one `record` would land in) is open. */
  isOpen(table: string, id: string, record: Row): boolean;
  /** Throws when the store cannot be written now (preview active, read-only, inside a transaction). */
  assertWritable(): void;
  /**
   * A record ('table/id') other than `table/id` itself that references it once `planned` is applied, or null. Hidden
   * and soft-deleted referrers count.
   */
  dependantOf(table: string, id: string, planned: PlannedWrites): string | null;
  /** Applies the writes as one committed batch of the given origin (never recorded on the undo stack). */
  commit(origin: 'undo' | 'redo', label: string, writes: readonly UndoWrite[]): void;
}

interface StackItem {
  entry: UndoEntry;
  readonly coalesceKey: string | undefined;
  lastAt: number;
}

type Skip = { readonly change: AnyChange; readonly fields: readonly string[] | null; readonly reason: UndoSkipReason };
type EvictListener = (entries: readonly UndoEntry[], reason: UndoEvictReason) => void;
const NO_ENTRIES: readonly UndoEntry[] = Object.freeze([]);

export const DEFAULT_UNDO_LIMIT = 500;

export class PatchUndoManager implements UndoManager {
  readonly limit: number;
  private readonly undoStack: StackItem[] = [];
  private readonly redoStack: StackItem[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly evictListeners = new Set<EvictListener>();
  /** `entries()` views, rebuilt on the first read after a stack change. */
  private entriesCache: { readonly undo: readonly UndoEntry[]; readonly redo: readonly UndoEntry[] } | null = null;
  /** False after stopCapturing/breakCoalescing: the next record starts a new entry. */
  private capturing = false;

  constructor(
    private readonly host: UndoHost,
    opts?: { readonly limit?: number },
  ) {
    const limit = opts?.limit ?? DEFAULT_UNDO_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new EkzaError('unsupported', `PatchUndoManager: limit must be a positive integer, got ${limit}`);
    }
    this.limit = limit;
  }

  /** Records a committed local batch. No-op for `undoable: false` or empty change lists. */
  record(txId: string, changes: readonly AnyChange[], meta: TxMeta): void {
    if (meta.undoable === false || changes.length === 0) {
      this.capturing = false;
      return;
    }
    let limited: readonly UndoEntry[] = NO_ENTRIES;
    const now = this.host.now();
    const top = this.undoStack.at(-1);
    const coalesceMs = meta.coalesceMs ?? 0;
    const coalesce =
      this.capturing &&
      top !== undefined &&
      meta.coalesceKey !== undefined &&
      top.coalesceKey === meta.coalesceKey &&
      coalesceMs > 0 &&
      now - top.lastAt <= coalesceMs;
    if (coalesce) {
      const merged = mergeChanges(top.entry.changes as readonly RowChange[], changes as readonly RowChange[]);
      this.entriesCache = null;
      if (merged.length === 0) {
        // Edits that cancel out (a nudge and its reverse) leave nothing to undo.
        this.undoStack.pop();
        this.capturing = false;
      } else {
        top.entry = withSelectionAfter({ ...top.entry, changes: merged as unknown as readonly AnyChange[] }, meta);
        top.lastAt = now;
      }
    } else {
      const entry = withSelectionAfter(
        {
          txId,
          label: meta.label,
          changes,
          ...(meta.selectionBefore === undefined ? {} : { selectionBefore: meta.selectionBefore }),
        },
        meta,
      );
      this.undoStack.push({ entry, coalesceKey: meta.coalesceKey, lastAt: now });
      if (this.undoStack.length > this.limit) {
        limited = this.undoStack.splice(0, this.undoStack.length - this.limit).map((item) => item.entry);
      }
      this.capturing = true;
    }
    const redone = this.takeRedo();
    this.entriesCache = null;
    this.evicted(limited, 'limit');
    this.evicted(redone, 'redo-cleared');
    this.notify();
  }

  /** Called by the store for every other committed batch: the next local transaction starts a new entry. */
  breakCoalescing(): void {
    this.capturing = false;
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
    this.reset('clear');
  }

  /** Empties both stacks; `load` is the store's document load (reported as `onEvict(…, 'load')`). */
  reset(reason: 'clear' | 'load'): void {
    const undone = this.undoStack.map((item) => item.entry);
    const redone = this.takeRedo();
    this.undoStack.length = 0;
    this.capturing = false;
    if (undone.length === 0 && redone.length === 0) return;
    this.entriesCache = null;
    this.evicted([...undone, ...redone], reason);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  entries(): { readonly undo: readonly UndoEntry[]; readonly redo: readonly UndoEntry[] } {
    this.entriesCache ??= Object.freeze({
      undo: Object.freeze(this.undoStack.map((item) => item.entry)),
      redo: Object.freeze(this.redoStack.map((item) => item.entry).reverse()),
    });
    return this.entriesCache;
  }

  onEvict(listener: EvictListener): () => void {
    this.evictListeners.add(listener);
    return () => {
      this.evictListeners.delete(listener);
    };
  }

  evictOldest(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new EkzaError('unsupported', `evictOldest: n must be an integer ≥ 0, got ${n}`);
    }
    if (n === 0 || this.undoStack.length === 0) return;
    const evicted = this.undoStack.splice(0, Math.min(n, this.undoStack.length)).map((item) => item.entry);
    this.entriesCache = null;
    this.evicted(evicted, 'budget');
    this.notify();
  }

  clearRedo(): void {
    // A selection-only step sits between two transactions: they must not coalesce across it.
    this.capturing = false;
    const redone = this.takeRedo();
    if (redone.length === 0) return;
    this.entriesCache = null;
    this.evicted(redone, 'redo-cleared');
    this.notify();
  }

  /** Empties the redo stack; its entries from the next redo to the last. */
  private takeRedo(): readonly UndoEntry[] {
    if (this.redoStack.length === 0) return NO_ENTRIES;
    const redone = this.redoStack.map((item) => item.entry).reverse();
    this.redoStack.length = 0;
    return redone;
  }

  private evicted(entries: readonly UndoEntry[], reason: UndoEvictReason): void {
    if (entries.length === 0) return;
    const frozen = Object.freeze([...entries]);
    for (const listener of Array.from(this.evictListeners)) listener(frozen, reason);
  }

  private step(direction: 'undo' | 'redo'): UndoResult | null {
    const from = direction === 'undo' ? this.undoStack : this.redoStack;
    const to = direction === 'undo' ? this.redoStack : this.undoStack;
    const item = from.at(-1);
    if (item === undefined) return null;
    this.host.assertWritable();
    const changes = item.entry.changes as readonly RowChange[];
    const skipped: Skip[] = [];
    const planned = new Map<string, { readonly table: string; readonly after: Row | undefined }>();
    const outcomes: { readonly change: RowChange; write: UndoWrite | null }[] = [];
    // Undo walks the changes newest first, redo oldest first.
    for (let n = 0; n < changes.length; n++) {
      const change = changes[direction === 'undo' ? changes.length - 1 - n : n] as RowChange;
      const outcome = this.restore(change, direction);
      if (outcome.skip !== null) skipped.push({ change: change as unknown as AnyChange, ...outcome.skip });
      if (outcome.write === null) continue;
      planned.set(rowKey(change.table, change.id), { table: change.table, after: outcome.write.after });
      outcomes.push({ change, write: outcome.write });
    }
    // Hard deletes of records something else still references are skipped; skipping one keeps its own references
    // alive, so repeat until no planned delete has a dependant.
    for (let changed = true; changed; ) {
      changed = false;
      for (const outcome of outcomes) {
        const write = outcome.write;
        if (write === null || write.after !== undefined) continue;
        if (this.host.dependantOf(write.table, write.id, planned) === null) continue;
        planned.delete(rowKey(write.table, write.id));
        outcome.write = null;
        skipped.push({ change: outcome.change as unknown as AnyChange, fields: null, reason: 'changed-by-other' });
        changed = true;
      }
    }
    const writes: UndoWrite[] = [];
    for (const outcome of outcomes) if (outcome.write !== null) writes.push(outcome.write);
    // Stacks first, then the batch: listeners of the undo/redo batch see the updated stacks.
    from.pop();
    to.push(item);
    this.entriesCache = null;
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

  /** Compare-before-restore of one change: a whole-record write or the matching fields of a field-merge update. */
  private restore(
    change: RowChange,
    direction: 'undo' | 'redo',
  ): { write: UndoWrite | null; skip: { fields: readonly string[] | null; reason: UndoSkipReason } | null } {
    const expected = direction === 'undo' ? change.after : change.before;
    const target = direction === 'undo' ? change.before : change.after;
    const current = this.host.current(change.table, change.id);
    const probe = current ?? target ?? expected;
    if (probe !== undefined && !this.host.isOpen(change.table, change.id, probe)) {
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
      write: reverted === 0 ? null : { table: change.table, id: change.id, after: next as Row },
      skip: skippedFields.length === 0 ? null : { fields: skippedFields, reason: 'changed-by-other' },
    };
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}

function allFields(a: Row, b: Row): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((field) => field !== 'id');
}

function withSelectionAfter(entry: UndoEntry, meta: TxMeta): UndoEntry {
  return meta.selectionAfter === undefined ? entry : { ...entry, selectionAfter: meta.selectionAfter };
}

/**
 * Folds two consecutive change lists of one undo entry: earliest `before`, latest `after` per record, in first-touch
 * order; net no-op changes are dropped and `fields` is recomputed from the merged before/after. Exact because
 * coalescing only happens when no other batch was committed in between (see `breakCoalescing`).
 */
export function mergeChanges(first: readonly RowChange[], second: readonly RowChange[]): RowChange[] {
  const merged = new Map<string, { table: string; id: string; before: Row | undefined; after: Row | undefined }>();
  for (const change of [...first, ...second]) {
    const key = `${change.table}\u0000${change.id}`;
    const existing = merged.get(key);
    if (existing === undefined)
      merged.set(key, { table: change.table, id: change.id, before: change.before, after: change.after });
    else existing.after = change.after;
  }
  const out: RowChange[] = [];
  for (const change of merged.values()) {
    if (!deepEqual(change.before, change.after))
      out.push(makeChange(change.table, change.id, change.before, change.after));
  }
  return out;
}
