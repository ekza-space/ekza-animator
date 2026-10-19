// MemoryDocumentStore: the MVP production store (ADR 0002 decision 1, MVP-SPEC §4.2 and §4.11.0 store rules).
//
// Design:
// - Records live in `Storage` with the partition they were assigned when last written. Reads see records of open
//   partitions; `get`/`list`/queries also skip soft-deleted ones.
// - Transactions, preview updates and external batches write straight to storage through a `Journal`, so reads,
//   queries and indexes inside them see the writes. A failed transaction is undone from the journal; a commit turns
//   the journal into the net change of every touched record (`fields` for field-merge updates).
// - A preview is a journal kept open between updates: `update` reverts it and applies the callback afresh; `commit`
//   keeps the overlay and emits it as one `local` batch; `cancel` reverts it. Readers see the overlay; `snapshot()`
//   sees committed values.
// - Writes into an unopened partition open it (a new character or clip has nothing to load); the records that
//   become visible are announced in a `load` batch before the writing batch. `remote` batches never open partitions.
// - Batches are emitted in commit order through a queue, so a listener that writes does not reorder them; listener
//   exceptions are rethrown asynchronously and never undo a commit.
// - Adapters (doc-yjs) observe committed changes with their partitions through `observeCommits` and feed remote
//   changes with `applyChanges(…, { partitions })`.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { CharacterId, UserId } from '../ids';
import {
  BUILTIN_TABLES,
  type IdOf,
  type Partition,
  type PartitionLookup,
  type RecordOf,
  type SoftDeletableTable,
  type TableName,
} from '../records';
import { QueryEngine } from '../queries/engine';
import { requiredWriterVersion, SCHEMA_VERSION, SNAPSHOT_FORMAT } from '../snapshot/version';
import type {
  AnyChange,
  ChangeBatch,
  DocSnapshot,
  DocumentStore,
  Origin,
  PreviewSession,
  SnapshotTables,
  Tx,
  TxMeta,
} from '../store';
import {
  getTableDef,
  scopeFieldOf,
  isSoftDeletable,
  mergeUnitOf,
  ownedPartition,
  partitionOfAny,
  validateAny,
} from '../tables/registry';
import { DEFAULT_UNDO_LIMIT, PatchUndoManager, type UndoWrite } from '../undo/patchUndo';
import { compareStrings, deepEqual } from './diff';
import { Journal, type JournalOriginal, NOT_SHOWN, type Savepoint } from './journal';
import { ReferenceIndex } from './references';
import {
  dropUndefined,
  type Entry,
  hasTombstone,
  makeChange,
  normalizeRow,
  type Row,
  type RowChange,
  rowKey,
} from './rows';
import { Storage } from './storage';

export interface MemoryStoreOptions {
  /** Author of local batches and soft-delete tombstones; default 'local'. */
  readonly user?: UserId;
  /** Undo stack size; default 500. */
  readonly undoLimit?: number;
  /** Clock (ms) for tombstones and undo coalescing; default `Date.now`. */
  readonly now?: () => number;
  /** `put` over an existing record of a field-merge table throws `use-patch`; default true (tests, dev builds). */
  readonly strictPut?: boolean;
}

/** A committed change with the partition the record left (`before`) and entered (`after`); null = absent. */
export interface CommittedChange {
  readonly change: AnyChange;
  readonly beforePartition: Partition | null;
  readonly afterPartition: Partition | null;
}

/**
 * Called for every batch that changed committed state (all origins except `preview`), after the commit and before
 * subscribers see the batch. `committed` lists the storage-level changes, including ones a preview overlay hides
 * from readers (preview conflicts), so it can differ from `batch.changes`.
 */
export type CommitObserver = (batch: ChangeBatch, committed: readonly CommittedChange[]) => void;

/** Adapter options of `applyChanges`: the partition of each change, overriding the computed one. */
export interface ApplyChangesOptions {
  readonly partitions?: readonly (Partition | undefined)[];
}

type ExternalOrigin = 'remote' | 'import' | 'migration' | 'cleanup';
const EXTERNAL_ORIGINS: ReadonlySet<string> = new Set<ExternalOrigin>(['remote', 'import', 'migration', 'cleanup']);

/** The running transaction or preview update: its journal, its `Tx` and the late metadata `annotate` sets. */
class TxContext {
  readonly journal: Journal;
  readonly tx: StoreTx;
  label: string;
  selectionAfter: unknown = undefined;
  /** Set by annotate({selectionAfter}); distinguishes an explicit `undefined`. */
  hasSelectionAfter = false;

  constructor(
    store: MemoryDocumentStore,
    readonly kind: 'transact' | 'preview',
    label: string,
    journal?: Journal,
  ) {
    this.label = label;
    this.journal = journal ?? new Journal();
    this.tx = new StoreTx(store, this);
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `next` has the fields of `previous` with the same values, except finite numbers in `t` and `v`. */
function onlyNewTimeOrValue(previous: Row, next: Row): boolean {
  let fields = 0;
  for (const field in next) {
    fields++;
    const value = next[field];
    if (field === 't' || field === 'v') {
      if (!Number.isFinite(value)) return false;
    } else if (value !== previous[field]) {
      return false;
    }
  }
  for (const _ in previous) fields--;
  return fields === 0;
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Rethrows outside the current call stack: a failing listener must not undo or interrupt a commit. */
function reportAsync(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

export class MemoryDocumentStore implements DocumentStore {
  readonly user: UserId;
  readonly schemaVersion = SCHEMA_VERSION;
  readonly undo: PatchUndoManager;
  readonly query: QueryEngine;
  readonly strictPut: boolean;
  readonly now: () => number;

  private readonly storage: Storage;
  private readonly openSet = new Set<Partition>();
  private readonly listeners = new Set<(batch: ChangeBatch) => void>();
  private readonly observers = new Set<CommitObserver>();
  private readonly listCache = new Map<string, readonly Row[]>();
  private readonly references = new ReferenceIndex();
  private readonly lookup: PartitionLookup;
  private current: TxContext | null = null;
  private previewSession: StorePreview | null = null;
  private versionCounter = 0;
  private txCounter = 0;
  private readOnlyFlag = false;
  /** `minWriterVersion` of the last `load()` (1 for a store that never loaded); see `snapshot()`. */
  private loadedMinWriterVersion = 1;
  private loadedTableVersions: Readonly<Record<string, number>> = {};
  private readonly emitQueue: ChangeBatch[] = [];
  private emitting = false;

  constructor(opts: MemoryStoreOptions = {}) {
    this.user = opts.user ?? ('local' as UserId);
    this.now = opts.now ?? Date.now;
    this.strictPut = opts.strictPut ?? true;
    this.storage = new Storage((table, id, prev, next) => this.onStorageWrite(table, id, prev, next));
    this.query = new QueryEngine(this.storage, (partition) => this.openSet.has(partition));
    this.lookup = {
      rigCharacter: (rig) => {
        const character = this.storage.get('rigs', rig)?.record['character'];
        return typeof character === 'string' ? (character as CharacterId) : undefined;
      },
      skeletonCharacter: (skeleton) => {
        const character = this.storage.get('skeletons', skeleton)?.record['character'];
        return typeof character === 'string' ? (character as CharacterId) : undefined;
      },
    };
    this.undo = new PatchUndoManager(
      {
        now: () => this.now(),
        current: (table, id) => this.storage.get(table, id)?.record,
        isOpen: (table, id, record) =>
          this.openSet.has(this.storage.get(table, id)?.partition ?? this.partitionFor(table, record)),
        assertWritable: () => this.assertWritable('undo'),
        dependantOf: (table, id, planned) =>
          this.references.dependantOf(table, id, (t, i) => this.storage.get(t, i)?.record, planned),
        commit: (origin, label, writes) => this.commitUndo(origin, label, writes),
      },
      { limit: opts.undoLimit ?? DEFAULT_UNDO_LIMIT },
    );
    for (const table of BUILTIN_TABLES) this.storage.ensureTable(table);
  }

  get version(): number {
    return this.versionCounter;
  }

  get readOnly(): boolean {
    return this.readOnlyFlag;
  }

  get preview(): PreviewSession | null {
    return this.previewSession;
  }

  // ---------- reads ----------

  get<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    const record = this.visibleRaw(table, id);
    if (record === undefined || (isSoftDeletable(table) && hasTombstone(record))) return undefined;
    return record as unknown as RecordOf<T>;
  }

  getIncludingDeleted<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.visibleRaw(table, id) as unknown as RecordOf<T> | undefined;
  }

  list<T extends TableName>(table: T): readonly RecordOf<T>[] {
    let cached = this.listCache.get(table);
    if (cached === undefined) {
      const softDelete = isSoftDeletable(table);
      const rows: Row[] = [];
      for (const [, entry] of this.storage.entries(table)) {
        if (this.openSet.has(entry.partition) && !(softDelete && hasTombstone(entry.record))) rows.push(entry.record);
      }
      rows.sort((a, b) => compareStrings(a.id, b.id));
      cached = Object.freeze(rows);
      this.listCache.set(table, cached);
    }
    return cached as unknown as readonly RecordOf<T>[];
  }

  isOpen(partition: Partition): boolean {
    return this.openSet.has(partition);
  }

  /** The record of an open partition, soft-deleted included. */
  private visibleRaw(table: string, id: string): Row | undefined {
    const entry = this.storage.get(table, id);
    return entry !== undefined && this.openSet.has(entry.partition) ? entry.record : undefined;
  }

  // ---------- adapter-facing reads ----------

  /** The stored record and its partition, regardless of visibility (adapters, tests). */
  entryOf(table: string, id: string): { readonly record: Row; readonly partition: Partition } | undefined {
    return this.storage.get(table, id);
  }

  /** The partition a record would be assigned now (rig-scoped records resolve through this store's rigs). */
  partitionFor(table: string, record: Row): Partition {
    return partitionOfAny(table, record, this.lookup);
  }

  /**
   * The partition of a record being written over `existing`. A record keeps its partition for life unless a
   * partition-determining field changes: rig-scoped records depend on their rig's character (and M6a joints on their
   * skeleton's), which the record itself does not carry, so they keep their partition while that field is unchanged
   * (deleting a rig must not move its controls).
   */
  private partitionForWrite(table: string, record: Row, existing: Entry | undefined): Partition {
    const scope = scopeFieldOf(table);
    if (existing !== undefined && scope !== null && existing.record[scope] === record[scope]) return existing.partition;
    // M-1: a clip-partitioned record that keeps its clip keeps its `clip:<clip>` partition (no new partition string
    // per write; checked without building one).
    if (existing !== undefined && (table === 'keys' || table === 'curves' || table === 'layers')) {
      const clip = record['clip'];
      const partition = existing.partition;
      if (
        typeof clip === 'string' &&
        existing.record['clip'] === clip &&
        partition.length === clip.length + 5 &&
        partition.startsWith('clip:') &&
        partition.endsWith(clip)
      ) {
        return partition;
      }
    }
    return this.partitionFor(table, record);
  }

  /** Observes committed changes with their partitions (see `CommitObserver`). */
  observeCommits(observer: CommitObserver): Disposer {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  // ---------- partitions ----------

  open(partition: Partition): Promise<void> {
    this.assertNotInTransaction('open');
    if (!this.openSet.has(partition)) {
      this.openSet.add(partition);
      this.afterVisibilityChange();
      const changes: RowChange[] = [];
      for (const [table, id] of this.storage.membersOf(partition)) {
        const entry = this.storage.get(table, id);
        if (entry !== undefined) changes.push(makeChange(table, id, undefined, entry.record));
      }
      if (changes.length > 0) this.emit(this.makeBatch('load', `Open ${partition}`, this.user, changes));
    }
    return Promise.resolve();
  }

  close(partition: Partition): void {
    this.assertNotInTransaction('close');
    if (!this.openSet.has(partition)) return;
    this.openSet.delete(partition);
    this.afterVisibilityChange();
    const changes: RowChange[] = [];
    for (const [table, id] of this.storage.membersOf(partition)) {
      const entry = this.storage.get(table, id);
      if (entry !== undefined) changes.push(makeChange(table, id, entry.record, undefined));
    }
    if (changes.length > 0) this.emit(this.makeBatch('load', `Close ${partition}`, this.user, changes));
  }

  openPartitions(): readonly Partition[] {
    return [...this.openSet].sort(compareStrings);
  }

  private afterVisibilityChange(): void {
    this.listCache.clear();
    this.query.invalidateAll();
  }

  // ---------- transactions ----------

  transact<R>(meta: TxMeta, fn: (tx: Tx) => R): R {
    if (this.previewSession !== null) throw new EkzaError('preview-active', 'A preview session is active');
    const outer = this.current;
    if (outer !== null) {
      // Join the outer transaction (one batch, outer meta wins); a failure rolls back only the inner writes.
      const savepoint: Savepoint = { ops: outer.journal.ops.length };
      try {
        const result = fn(outer.tx);
        if (isThenable(result)) throw asyncCallback();
        return result;
      } catch (error) {
        this.rollbackTo(outer.journal, savepoint);
        throw error;
      }
    }
    if (this.readOnlyFlag) throw new EkzaError('read-only', 'The document is read-only');
    const context = this.beginContext('transact', meta.label);
    let result: R;
    try {
      result = fn(context.tx);
      if (isThenable(result)) throw asyncCallback();
      this.resolvePartitions(context.journal);
    } catch (error) {
      this.revert(context.journal);
      this.endContext(context);
      this.flushReveals(context.journal, null);
      throw error;
    }
    this.endContext(context);
    const committed = this.collect(context.journal);
    this.flushReveals(context.journal, committed);
    if (committed.length > 0) {
      const txMeta: TxMeta = {
        ...meta,
        label: context.label,
        ...(context.hasSelectionAfter ? { selectionAfter: context.selectionAfter } : {}),
      };
      this.commitLocal(committed, txMeta);
    }
    return result;
  }

  beginPreview(label: string): PreviewSession {
    if (this.previewSession !== null || this.current !== null) {
      throw new EkzaError('preview-active', 'A preview session or transaction is active');
    }
    if (this.readOnlyFlag) throw new EkzaError('read-only', 'The document is read-only');
    const session = new StorePreview(this, label);
    this.previewSession = session;
    return session;
  }

  applyChanges(
    changes: readonly AnyChange[],
    meta: { readonly origin: ExternalOrigin; readonly label: string; readonly user?: UserId },
    opts?: ApplyChangesOptions,
  ): ChangeBatch {
    if (!EXTERNAL_ORIGINS.has(meta.origin)) {
      throw new EkzaError('unsupported', `applyChanges: origin must be remote, import, migration or cleanup`);
    }
    this.assertNotInTransaction('applyChanges');
    const remote = meta.origin === 'remote';
    if (!remote && this.readOnlyFlag) throw new EkzaError('read-only', 'The document is read-only');
    const preview = this.previewSession;
    const journal = new Journal();
    const conflicts: CommittedChange[] = [];
    try {
      changes.forEach((change, index) => {
        const table = change.table as string;
        const id = change.id as string;
        const after = change.after === undefined ? undefined : normalizeRow(change.after);
        if (after !== undefined && after.id !== id) {
          throw new EkzaError('invalid-record', `applyChanges: ${table}/${id} has record id '${after.id}'`);
        }
        if (!remote && after !== undefined) this.checkValid(table, after, this.storage.get(table, id)?.record);
        const forced = opts?.partitions?.[index];
        const overlaid = preview?.journal.get(table, id);
        if (overlaid !== undefined) {
          // The record is under the preview overlay: the committed value changes underneath it (a conflict).
          const next =
            after === undefined
              ? undefined
              : { record: after, partition: forced ?? this.partitionForWrite(table, after, overlaid.original) };
          const before = overlaid.original;
          overlaid.original = next;
          if (!deepEqual(before?.record, after)) {
            conflicts.push({
              change: makeChange(table, id, before?.record, after) as unknown as AnyChange,
              beforePartition: before?.partition ?? null,
              afterPartition: next?.partition ?? null,
            });
          }
          return;
        }
        const entry =
          after === undefined
            ? undefined
            : { record: after, partition: forced ?? this.partitionForWrite(table, after, this.storage.get(table, id)) };
        this.journalWrite(journal, table, id, entry, !remote);
      });
      if (opts?.partitions === undefined) this.resolvePartitions(journal, !remote);
    } catch (error) {
      this.revert(journal);
      this.flushReveals(journal, null);
      throw error;
    }
    const committed = this.collect(journal);
    this.flushReveals(journal, committed);
    if (preview !== null && conflicts.length > 0) preview.addConflicts(conflicts.map((c) => c.change));
    const visible = committed.map((c) => c.change as unknown as RowChange);
    const batch =
      visible.length > 0
        ? this.makeBatch(meta.origin, meta.label, meta.user ?? this.user, visible)
        : this.unemittedBatch(meta.origin, meta.label, meta.user ?? this.user);
    if (committed.length + conflicts.length > 0) {
      this.undo.breakCoalescing();
      this.notifyObservers(batch, [...committed, ...conflicts]);
    }
    if (visible.length > 0) this.emit(batch);
    return batch;
  }

  // ---------- previews (called by StorePreview) ----------

  /**
   * @internal One preview update: the callback runs on committed state and its writes become the new overlay.
   *
   * M-1 (M2A-SPEC §5.21.1 mechanism 2): the session's journal is kept in place across updates. Each update notes
   * what readers saw of every overlaid record (`shown`), reverts the overlay (records whose stored entry is already
   * the committed one are not written again), and lets the callback journal into the same originals; the preview
   * batch then compares shown and new values with a reference check first. A failing callback restores the
   * previous overlay.
   */
  previewUpdate(session: StorePreview, fn: (tx: Tx) => void): void {
    this.assertNotInTransaction('preview.update');
    const journal = session.journal;
    const ordered = journal.ordered;
    // Note what readers see, and revert to committed state (a record already at its committed entry is not written).
    for (let i = 0; i < ordered.length; i++) {
      const original = ordered[i] as JournalOriginal;
      const shown = original.current;
      original.shown = shown;
      this.storage.write(original.table, original.id, shown, original.original);
      original.current = original.original;
    }
    journal.ops.length = 0;
    const context = this.beginContext('preview', session.label, journal);
    try {
      const result: unknown = fn(context.tx);
      if (isThenable(result)) throw asyncCallback();
      this.resolvePartitions(journal);
    } catch (error) {
      // Keep the previous overlay on screen: undo the partial update and re-apply what readers saw.
      this.revert(journal);
      this.endContext(context);
      for (const original of journal.originals.values()) {
        if (original.shown === NOT_SHOWN) {
          journal.remove(original.table, original.id);
        } else {
          this.storage.set(original.table, original.id, original.shown);
          original.current = original.shown;
        }
      }
      journal.ops.length = 0;
      this.flushReveals(journal, null);
      throw error;
    }
    this.endContext(context);
    if (context.hasSelectionAfter) session.selectionAfter = { value: context.selectionAfter };
    if (context.label !== session.label) session.annotatedLabel = context.label;
    // Preview batch: what readers saw before this update → what they see now.
    const changes: RowChange[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const original = ordered[i] as JournalOriginal;
      const shown = original.shown;
      const before = shown === NOT_SHOWN ? original.original?.record : shown?.record;
      const after = original.current?.record;
      if (before !== after && !deepEqual(before, after)) {
        changes.push(makeChange(original.table, original.id, before, after));
      }
    }
    this.flushReveals(journal, null, (key) => journal.originals.has(key));
    if (changes.length > 0) this.emit(this.makeBatch('preview', session.label, this.user, changes));
  }

  /** @internal */
  previewCommit(session: StorePreview, meta: Partial<TxMeta> | undefined): ChangeBatch | null {
    this.assertNotInTransaction('preview.commit');
    this.endPreview(session);
    const committed = this.collect(session.journal);
    if (committed.length === 0) {
      this.undo.breakCoalescing();
      return null;
    }
    const selectionAfter =
      meta !== undefined && 'selectionAfter' in meta ? { value: meta.selectionAfter } : session.selectionAfter;
    const txMeta: TxMeta = {
      ...meta,
      label: meta?.label ?? session.annotatedLabel ?? session.label,
      ...(selectionAfter === undefined ? {} : { selectionAfter: selectionAfter.value }),
    };
    return this.commitLocal(committed, txMeta);
  }

  /** @internal */
  previewCancel(session: StorePreview): void {
    this.assertNotInTransaction('preview.cancel');
    this.endPreview(session);
    const changes: RowChange[] = [];
    for (const original of session.journal.originals.values()) {
      const before = this.storage.get(original.table, original.id)?.record;
      const after = original.original?.record;
      if (!deepEqual(before, after)) changes.push(makeChange(original.table, original.id, before, after));
    }
    this.revert(session.journal);
    if (changes.length > 0) this.emit(this.makeBatch('preview', session.label, this.user, changes));
  }

  private endPreview(session: StorePreview): void {
    session.active = false;
    if (this.previewSession === session) this.previewSession = null;
  }

  // ---------- writes (called by StoreTx) ----------

  /** @internal */
  txPut(context: TxContext, table: string, record: unknown): void {
    if (!isObject(record) || typeof record['id'] !== 'string' || record['id'].length === 0) {
      throw new EkzaError('invalid-record', `put(${table}): the record needs a non-empty string id`);
    }
    const row = normalizeRow(record);
    const existing = this.storage.get(table, row.id);
    if (existing !== undefined && this.strictPut && mergeUnitOf(table) === 'field') {
      throw new EkzaError('use-patch', `put(${table}, ${row.id}) over an existing record: use patch`);
    }
    this.checkValid(table, row, existing?.record);
    const partition = this.partitionForWrite(table, row, existing);
    this.journalWrite(context.journal, table, row.id, { record: row, partition }, true, existing);
  }

  /** @internal */
  txPatch(context: TxContext, table: string, id: string, fields: unknown): void {
    if (!isObject(fields)) throw new EkzaError('invalid-record', `patch(${table}, ${id}): fields must be an object`);
    const stored = this.requireEntry(table, id, 'patch');
    const existing = stored.record;
    if (fields['id'] !== undefined && fields['id'] !== id) {
      throw new EkzaError('invalid-record', `patch(${table}, ${id}): the id cannot change`);
    }
    // One merged copy; the stored record has no `undefined` field, so only the patch's own fields need the check.
    const merged: Record<string, unknown> = { ...existing, ...fields };
    merged['id'] = id;
    let next: Row = merged as Row;
    for (const key in fields) {
      if (fields[key] === undefined) {
        next = dropUndefined(merged);
        break;
      }
    }
    this.checkValid(table, next, existing);
    // M-1: the entry read once above serves the partition, the journal and the storage write.
    const partition = this.partitionForWrite(table, next, stored);
    this.journalWrite(context.journal, table, id, { record: next, partition }, true, stored);
  }

  /** @internal */
  txRemove(context: TxContext, table: string, id: string): void {
    this.require(table, id, 'remove');
    const dependant = this.references.dependantOf(table, id, (t, i) => this.storage.get(t, i)?.record);
    if (dependant !== null) {
      throw new EkzaError('invalid-record', `remove(${table}, ${id}): ${dependant} still references it`, {
        dependant,
      });
    }
    this.journalWrite(context.journal, table, id, undefined, true);
  }

  /** @internal */
  txSoftDelete(context: TxContext, table: string, id: string, deleted: boolean): void {
    const op = deleted ? 'softDelete' : 'restore';
    if (!isSoftDeletable(table)) throw new EkzaError('unsupported', `${op}(${table}): the table has no soft delete`);
    const stored = this.requireEntry(table, id, op);
    const existing = stored.record;
    if (hasTombstone(existing) === deleted) return;
    const next: Row = { ...existing, deleted: deleted ? { by: this.user, at: this.now() } : null };
    const partition = this.partitionForWrite(table, next, stored);
    this.journalWrite(context.journal, table, id, { record: next, partition }, true, stored);
  }

  private require(table: string, id: string, op: string): Row {
    return this.requireEntry(table, id, op).record;
  }

  /** The stored entry of a visible record (soft-deleted included), or `invalid-record`. */
  private requireEntry(table: string, id: string, op: string): Entry {
    const entry = this.storage.get(table, id);
    if (entry === undefined || !this.openSet.has(entry.partition)) {
      throw new EkzaError('invalid-record', `${op}(${table}, ${id}): no such record`);
    }
    return entry;
  }

  /** Throws for problems the write introduces; problems the stored record already had are tolerated. */
  private checkValid(table: string, next: Row, previous: Row | undefined): void {
    // M-1: a key rewritten with only a new finite time or value (every key of a drag, every frame) introduces no
    // problem: key fields are checked one by one, so its other fields have exactly the problems they had.
    if (table === 'keys' && previous !== undefined && onlyNewTimeOrValue(previous, next)) return;
    const problems = validateAny(table, next);
    if (problems.length === 0) return;
    const known = previous === undefined ? new Set<string>() : new Set(validateAny(table, previous));
    const introduced = problems.filter((problem) => !known.has(problem));
    if (introduced.length === 0) return;
    throw new EkzaError('invalid-record', `Invalid ${table}/${next.id}: ${introduced.join('; ')}`, {
      table,
      id: next.id,
      problems: introduced,
    });
  }

  // ---------- journal mechanics ----------

  /** `prev` is the stored entry when the caller has just read it (M-1: one lookup per write); omitted, it is read. */
  private journalWrite(
    journal: Journal,
    table: string,
    id: string,
    next: Entry | undefined,
    implicitOpen: boolean,
    prev: Entry | undefined = this.storage.get(table, id),
  ): void {
    const journaled = journal.get(table, id);
    const first = journaled === undefined;
    if (first) journal.add({ table, id, original: prev, shown: NOT_SHOWN, current: next });
    else journaled.current = next;
    journal.ops.push({ table, id, prev, first });
    this.storage.write(table, id, prev, next);
    if (!implicitOpen || next === undefined) return;
    this.openImplicitly(journal, next.partition);
    // A new character or clip owns a partition that has nothing to load yet: open it too, so nothing it implies is
    // reported missing (`missingPartitions` stays [] in the MVP).
    const owned = prev === undefined ? ownedPartition(table, id) : null;
    if (owned !== null) this.openImplicitly(journal, owned);
  }

  private openImplicitly(journal: Journal, partition: Partition): void {
    if (this.openSet.has(partition)) return;
    this.openSet.add(partition);
    journal.opened.push(partition);
    this.afterVisibilityChange();
  }

  /** Rolls a journal back to a savepoint (nested transactions). Implicitly opened partitions stay open. */
  private rollbackTo(journal: Journal, savepoint: Savepoint): void {
    for (let i = journal.ops.length - 1; i >= savepoint.ops; i--) {
      const op = journal.ops[i];
      if (op === undefined) continue;
      this.storage.set(op.table, op.id, op.prev);
      if (op.first) journal.remove(op.table, op.id);
      else {
        const journaled = journal.get(op.table, op.id);
        if (journaled !== undefined) journaled.current = op.prev;
      }
    }
    journal.ops.length = savepoint.ops;
  }

  /** Restores every touched record to its committed state (preview conflicts included). */
  private revert(journal: Journal): void {
    const ordered = journal.ordered;
    for (let i = 0; i < ordered.length; i++) {
      const original = ordered[i] as JournalOriginal;
      this.storage.set(original.table, original.id, original.original);
      original.current = original.original;
    }
  }

  /**
   * Re-resolves the partitions of rig-scoped (and skeleton-scoped) records this journal inserted or moved to another
   * rig or skeleton (a control written before its rig in one transaction got `scene` provisionally). Records that kept
   * their rig or skeleton keep their partition.
   */
  private resolvePartitions(journal: Journal, implicitOpen = true): void {
    const ordered = journal.ordered;
    for (let i = 0; i < ordered.length; i++) {
      const original = ordered[i] as JournalOriginal;
      const scope = scopeFieldOf(original.table);
      if (scope === null) continue;
      const entry = this.storage.get(original.table, original.id);
      if (entry === undefined) continue;
      if (original.original !== undefined && original.original.record[scope] === entry.record[scope]) continue;
      const partition = this.partitionFor(original.table, entry.record);
      if (partition !== entry.partition) {
        this.journalWrite(journal, original.table, original.id, { record: entry.record, partition }, implicitOpen);
      }
    }
  }

  /** Net change of every touched record, in first-touch order. */
  private collect(journal: Journal): CommittedChange[] {
    const out: CommittedChange[] = [];
    const ordered = journal.ordered;
    for (let i = 0; i < ordered.length; i++) {
      const original = ordered[i] as JournalOriginal;
      const current = this.storage.get(original.table, original.id);
      const before = original.original?.record;
      const after = current?.record;
      if (before === after || deepEqual(before, after)) continue;
      out.push({
        change: makeChange(original.table, original.id, before, after) as unknown as AnyChange,
        beforePartition: original.original?.partition ?? null,
        afterPartition: current?.partition ?? null,
      });
    }
    return out;
  }

  /**
   * Announces records that became visible because a write opened their partition, as a `load` batch emitted before
   * the writing batch. Records the writing batch reports (`committed`, or `skip`) are left out.
   */
  private flushReveals(
    journal: Journal,
    committed: readonly CommittedChange[] | null,
    skip?: (key: string) => boolean,
  ): void {
    if (journal.opened.length === 0) return;
    const reported = new Set<string>();
    for (const item of committed ?? []) reported.add(rowKey(item.change.table, item.change.id));
    const changes: RowChange[] = [];
    for (const partition of journal.opened) {
      for (const [table, id] of this.storage.membersOf(partition)) {
        const key = rowKey(table, id);
        if (reported.has(key) || skip?.(key) === true) continue;
        const entry = this.storage.get(table, id);
        if (entry !== undefined) changes.push(makeChange(table, id, undefined, entry.record));
      }
    }
    journal.opened.length = 0;
    if (changes.length > 0) this.emit(this.makeBatch('load', 'Open partitions', this.user, changes));
  }

  private beginContext(kind: TxContext['kind'], label: string, journal?: Journal): TxContext {
    const context = new TxContext(this, kind, label, journal);
    this.current = context;
    return context;
  }

  private endContext(context: TxContext): void {
    context.tx.close();
    if (this.current === context) this.current = null;
  }

  // ---------- commits ----------

  private commitLocal(committed: readonly CommittedChange[], meta: TxMeta): ChangeBatch {
    const changes = committed.map((item) => item.change as unknown as RowChange);
    const batch = this.makeBatch('local', meta.label, this.user, changes);
    this.undo.record(batch.txId, batch.changes, meta);
    this.notifyObservers(batch, committed);
    this.emit(batch);
    return batch;
  }

  private commitUndo(origin: 'undo' | 'redo', label: string, writes: readonly UndoWrite[]): void {
    const journal = new Journal();
    for (const write of writes) {
      const stored = this.storage.get(write.table, write.id);
      const entry =
        write.after === undefined
          ? undefined
          : { record: write.after, partition: this.partitionForWrite(write.table, write.after, stored) };
      this.journalWrite(journal, write.table, write.id, entry, false);
    }
    this.resolvePartitions(journal, false);
    const committed = this.collect(journal);
    if (committed.length === 0) return;
    const batch = this.makeBatch(
      origin,
      label,
      this.user,
      committed.map((item) => item.change as unknown as RowChange),
    );
    this.notifyObservers(batch, committed);
    this.emit(batch);
  }

  private makeBatch(origin: Origin, label: string, user: UserId, changes: readonly RowChange[]): ChangeBatch {
    this.versionCounter++;
    return {
      txId: this.nextTxId(),
      origin,
      label,
      user,
      version: this.versionCounter,
      changes: changes as unknown as readonly AnyChange[],
    };
  }

  /** A batch that changed nothing visible: returned to the caller, never emitted, version unchanged. */
  private unemittedBatch(origin: Origin, label: string, user: UserId): ChangeBatch {
    return { txId: this.nextTxId(), origin, label, user, version: this.versionCounter, changes: [] };
  }

  private nextTxId(): string {
    this.txCounter++;
    return `tx_${this.txCounter.toString().padStart(16, '0')}`;
  }

  private notifyObservers(batch: ChangeBatch, committed: readonly CommittedChange[]): void {
    for (const observer of Array.from(this.observers)) observer(batch, committed);
  }

  private emit(batch: ChangeBatch): void {
    this.emitQueue.push(batch);
    if (this.emitting) return;
    this.emitting = true;
    try {
      for (let next = this.emitQueue.shift(); next !== undefined; next = this.emitQueue.shift()) {
        for (const listener of Array.from(this.listeners)) {
          try {
            listener(next);
          } catch (error) {
            reportAsync(error);
          }
        }
      }
    } finally {
      this.emitting = false;
    }
  }

  subscribe(listener: (batch: ChangeBatch) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------- guards ----------

  private assertNotInTransaction(op: string): void {
    if (this.current !== null) {
      throw new EkzaError('unsupported', `${op} cannot run inside a transaction or preview update callback`);
    }
  }

  private assertWritable(op: string): void {
    this.assertNotInTransaction(op);
    if (this.previewSession !== null) throw new EkzaError('preview-active', 'A preview session is active');
    if (this.readOnlyFlag) throw new EkzaError('read-only', 'The document is read-only');
  }

  // ---------- storage hook ----------

  private onStorageWrite(table: string, id: string, prev: Entry | undefined, next: Entry | undefined): void {
    if (this.listCache.size !== 0) this.listCache.delete(table);
    if (prev?.record !== next?.record) this.references.onWrite(table, id, prev?.record, next?.record);
    this.query.onWrite(table, id, prev, next);
  }

  // ---------- snapshots ----------

  snapshot(): DocSnapshot {
    const overrides = new Map<string, Entry | undefined>();
    // Committed state: what a preview or a running transaction overlays is reported at its committed value.
    for (const journal of [this.previewSession?.journal, this.current?.journal]) {
      if (journal === undefined) continue;
      for (const [key, original] of journal.originals) if (!overrides.has(key)) overrides.set(key, original.original);
    }
    const names = new Set<string>([...BUILTIN_TABLES, ...this.storage.tableNames()]);
    const tables: Record<string, Record<string, Row>> = {};
    const tableVersions: Record<string, number> = {};
    for (const table of [...names].sort(compareStrings)) {
      const softDelete = isSoftDeletable(table);
      const ids = new Set<string>();
      for (const [id] of this.storage.entries(table)) ids.add(id);
      for (const original of overrides.keys()) {
        if (original.startsWith(`${table}\u0000`)) ids.add(original.slice(table.length + 1));
      }
      const rows: Record<string, Row> = {};
      for (const id of [...ids].sort(compareStrings)) {
        const key = rowKey(table, id);
        const entry = overrides.has(key) ? overrides.get(key) : this.storage.get(table, id);
        if (entry === undefined || !this.openSet.has(entry.partition)) continue;
        if (softDelete && hasTombstone(entry.record)) continue;
        rows[id] = entry.record;
      }
      tables[table] = rows;
      tableVersions[table] = getTableDef(table)?.version ?? this.loadedTableVersions[table] ?? 1;
    }
    // M2A-SPEC §4.2 snapshot rule: the content decides (2 with an enabled ik2 solver), and a loaded future document
    // keeps its own, newer value (it stays read-only in this build).
    const loaded = this.loadedMinWriterVersion;
    const minWriterVersion = Math.max(
      requiredWriterVersion(tables as unknown as SnapshotTables),
      loaded > SCHEMA_VERSION ? loaded : 1,
    );
    return {
      format: SNAPSHOT_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      minWriterVersion,
      tableVersions,
      tables: tables as unknown as SnapshotTables,
    };
  }

  load(snapshot: DocSnapshot, opts?: { readonly readOnly?: boolean }): void {
    this.assertNotInTransaction('load');
    if (snapshot.format !== SNAPSHOT_FORMAT || !isObject(snapshot.tables)) {
      throw new EkzaError('invalid-record', 'load: not an ekza-animator-doc snapshot (run migrateSnapshot first)');
    }
    const preview = this.previewSession;
    if (preview !== null) {
      this.endPreview(preview);
      this.revert(preview.journal);
    }
    const before = new Map<string, { table: string; id: string; entry: Entry; visible: boolean }>();
    for (const table of this.storage.tableNames()) {
      for (const [id, entry] of this.storage.entries(table)) {
        before.set(rowKey(table, id), { table, id, entry, visible: this.openSet.has(entry.partition) });
      }
    }

    this.storage.clear();
    this.references.clear();
    this.query.reset();
    this.listCache.clear();
    this.openSet.clear();
    const rows = snapshot.tables as unknown as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    const characterOf = (table: string): Map<string, string> => {
      const out = new Map<string, string>();
      for (const [key, record] of Object.entries(rows[table] ?? {})) {
        if (!isObject(record) || typeof record['character'] !== 'string') continue;
        out.set(typeof record['id'] === 'string' ? record['id'] : key, record['character']);
      }
      return out;
    };
    const rigCharacters = characterOf('rigs');
    const skeletonCharacters = characterOf('skeletons');
    const lookup: PartitionLookup = {
      rigCharacter: (rig) => rigCharacters.get(rig) as CharacterId | undefined,
      skeletonCharacter: (skeleton) => skeletonCharacters.get(skeleton) as CharacterId | undefined,
    };
    for (const table of [...BUILTIN_TABLES, ...Object.keys(rows)]) this.storage.ensureTable(table);
    for (const [table, records] of Object.entries(rows)) {
      if (!isObject(records)) continue;
      for (const [key, value] of Object.entries(records)) {
        if (!isObject(value)) continue;
        const record = normalizeRow(
          typeof value['id'] === 'string' && value['id'].length > 0 ? value : { ...value, id: key },
        );
        this.storage.set(table, record.id, { record, partition: partitionOfAny(table, record, lookup) });
      }
    }
    this.openSet.add('scene');
    for (const partition of this.storage.partitions()) this.openSet.add(partition);
    for (const table of ['characters', 'clips']) {
      for (const [id] of this.storage.entries(table)) this.openSet.add(ownedPartition(table, id) as Partition);
    }

    this.loadedMinWriterVersion = snapshot.minWriterVersion;
    this.loadedTableVersions = { ...snapshot.tableVersions };
    const newerTable = Object.entries(snapshot.tableVersions).some(([table, version]) => {
      const def = getTableDef(table);
      return def !== undefined && version > def.version;
    });
    this.readOnlyFlag = opts?.readOnly === true || snapshot.minWriterVersion > SCHEMA_VERSION || newerTable;
    this.undo.reset('load');

    const committed: CommittedChange[] = [];
    const visible: RowChange[] = [];
    const record = (table: string, id: string, prior: Entry | undefined, priorVisible: boolean): void => {
      const next = this.storage.get(table, id);
      if (!deepEqual(prior?.record, next?.record) || prior?.partition !== next?.partition) {
        committed.push({
          change: makeChange(table, id, prior?.record, next?.record) as unknown as AnyChange,
          beforePartition: prior?.partition ?? null,
          afterPartition: next?.partition ?? null,
        });
      }
      const seenBefore = priorVisible ? prior?.record : undefined;
      const seenAfter = next !== undefined && this.openSet.has(next.partition) ? next.record : undefined;
      if (!deepEqual(seenBefore, seenAfter)) visible.push(makeChange(table, id, seenBefore, seenAfter));
    };
    for (const table of this.storage.tableNames()) {
      for (const [id] of this.storage.entries(table)) {
        const key = rowKey(table, id);
        const prior = before.get(key);
        before.delete(key);
        record(table, id, prior?.entry, prior?.visible ?? false);
      }
    }
    for (const prior of before.values()) record(prior.table, prior.id, prior.entry, prior.visible);

    const batch = this.makeBatch('load', 'Load', this.user, visible);
    this.notifyObservers(batch, committed);
    this.emit(batch);
  }
}

function asyncCallback(): EkzaError {
  return new EkzaError('unsupported', 'Transaction callbacks must be synchronous: transact is never awaited');
}

/** The `Tx` handed to transaction and preview callbacks; it refuses writes once its callback has returned. */
export class StoreTx implements Tx {
  private active = true;

  constructor(
    private readonly store: MemoryDocumentStore,
    private readonly context: TxContext,
  ) {}

  /** @internal */
  close(): void {
    this.active = false;
  }

  get<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.store.get(table, id);
  }

  getIncludingDeleted<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.store.getIncludingDeleted(table, id);
  }

  list<T extends TableName>(table: T): readonly RecordOf<T>[] {
    return this.store.list(table);
  }

  isOpen(partition: Partition): boolean {
    return this.store.isOpen(partition);
  }

  get query(): QueryEngine {
    return this.store.query;
  }

  put<T extends TableName>(table: T, record: RecordOf<T>): void {
    this.assertActive('put');
    this.store.txPut(this.context, table, record);
  }

  patch<T extends TableName>(table: T, id: IdOf<T>, fields: Partial<Omit<RecordOf<T>, 'id'>>): void {
    this.assertActive('patch');
    this.store.txPatch(this.context, table, id, fields);
  }

  remove<T extends TableName>(table: T, id: IdOf<T>): void {
    this.assertActive('remove');
    this.store.txRemove(this.context, table, id);
  }

  softDelete<T extends SoftDeletableTable>(table: T, id: IdOf<T>): void {
    this.assertActive('softDelete');
    this.store.txSoftDelete(this.context, table, id, true);
  }

  restore<T extends SoftDeletableTable>(table: T, id: IdOf<T>): void {
    this.assertActive('restore');
    this.store.txSoftDelete(this.context, table, id, false);
  }

  annotate(meta: Partial<Pick<TxMeta, 'label' | 'selectionAfter'>>): void {
    this.assertActive('annotate');
    if (meta.label !== undefined) this.context.label = meta.label;
    if ('selectionAfter' in meta) {
      this.context.selectionAfter = meta.selectionAfter;
      this.context.hasSelectionAfter = true;
    }
  }

  private assertActive(op: string): void {
    if (!this.active) throw new EkzaError('unsupported', `tx.${op}: the transaction has ended`);
  }
}

/** A preview overlay (MVP-SPEC §4.2 `PreviewSession`). */
export class StorePreview implements PreviewSession {
  active = true;
  /** @internal */
  journal = new Journal();
  /** @internal Set by `tx.annotate` inside an update. */
  selectionAfter: { readonly value: unknown } | undefined;
  /** @internal */
  annotatedLabel: string | undefined;
  private readonly conflictList: AnyChange[] = [];

  constructor(
    private readonly store: MemoryDocumentStore,
    readonly label: string,
  ) {}

  get conflicts(): readonly AnyChange[] {
    return this.conflictList;
  }

  /** @internal */
  addConflicts(changes: readonly AnyChange[]): void {
    this.conflictList.push(...changes);
  }

  update(fn: (tx: Tx) => void): void {
    this.assertActive('update');
    this.store.previewUpdate(this, fn);
  }

  commit(meta?: Partial<TxMeta>): ChangeBatch | null {
    this.assertActive('commit');
    return this.store.previewCommit(this, meta);
  }

  cancel(): void {
    if (!this.active) return;
    this.store.previewCancel(this);
  }

  private assertActive(op: string): void {
    if (!this.active) throw new EkzaError('unsupported', `preview.${op}: the preview '${this.label}' has ended`);
  }
}

/** The in-memory document store (MVP production store). `strictPut` defaults to true. */
export function createMemoryStore(opts?: {
  readonly user?: UserId;
  readonly undoLimit?: number;
  readonly now?: () => number;
  readonly strictPut?: boolean;
}): DocumentStore {
  return new MemoryDocumentStore(opts);
}
