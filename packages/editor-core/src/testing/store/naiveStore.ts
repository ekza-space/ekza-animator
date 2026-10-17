// Naive in-memory DocumentStore of the shared test kit (MVP-SPEC §7 WP-0b): the transaction, preview and undo
// semantics of §4.2 and §4.11.0 over plain maps, with linear scans instead of indexes. WP-2's memory store is the
// production implementation; this one exists so packages can test against the contract before it lands.
import { EkzaError } from '@ekza-animator/anim-core';
import {
  type AnyChange,
  BUILTIN_TABLES,
  type ChangeBatch,
  type DocQueries,
  type DocSnapshot,
  type DocumentStore,
  type IdOf,
  type Origin,
  type Partition,
  type PreviewSession,
  type RecordOf,
  SCHEMA_VERSION,
  type SnapshotTables,
  type SoftDeletableTable,
  type TableName,
  type Tx,
  type TxMeta,
  type UserId,
} from '@ekza-animator/doc';
import { CommittedTables, Overlay, type RowSource, RowView } from './layers';
import { createQueries } from './queries';
import { compareStrings, deepEqual, isSoftDeletable, mergeUnitOf, type Row } from './rows';
import { asAnyChanges, makeChange, NaiveUndoManager, type RowChange } from './undo';

export interface NaiveStoreOptions {
  readonly user?: UserId;
  /** Default 500. */
  readonly undoLimit?: number;
  /** Clock for soft-delete stamps and undo coalescing; default `Date.now`. */
  readonly now?: () => number;
  /** Default true (tests): `put` over an existing record of a field-merge table throws `use-patch`. */
  readonly strictPut?: boolean;
}

export function createNaiveStore(opts: NaiveStoreOptions = {}): DocumentStore {
  return new NaiveStore(opts);
}

interface MutableMeta {
  label: string;
  selectionAfter: unknown;
}

interface TxContext {
  readonly overlay: Overlay;
  readonly tx: Tx;
  readonly meta: MutableMeta;
}

class NaiveStore implements DocumentStore {
  readonly user: UserId;
  readonly schemaVersion = SCHEMA_VERSION;
  readonly undo: NaiveUndoManager;
  readonly committed = new CommittedTables();
  readonly now: () => number;
  readonly strictPut: boolean;
  current: TxContext | null = null;
  previewSession: NaivePreview | null = null;

  private readonly openSet = new Set<Partition>();
  private readonly listeners = new Set<(batch: ChangeBatch) => void>();
  private versionCounter = 0;
  private txCounter = 0;
  private readOnlyFlag = false;
  private minWriter = SCHEMA_VERSION;
  private loadedTableVersions: Readonly<Record<string, number>> = {};

  constructor(opts: NaiveStoreOptions) {
    this.user = opts.user ?? ('local' as UserId);
    this.now = opts.now ?? Date.now;
    this.strictPut = opts.strictPut ?? true;
    this.undo = new NaiveUndoManager(
      {
        now: this.now,
        current: (table, id) => this.committed.raw(table, id),
        partitionOpen: (table, row) => this.isOpen(this.viewOf(this.committed).partitionOf(table, row)),
        assertWritable: () => this.assertWritable(),
        commit: (origin, label, writes) => {
          this.commitChanges(writes, origin, label, this.user);
        },
      },
      opts.undoLimit ?? 500,
    );
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

  // ---------- reads (committed state plus the active preview overlay) ----------

  viewOf(source: RowSource): RowView {
    return new RowView(source, (partition) => this.openSet.has(partition));
  }

  private visible(): RowView {
    return this.viewOf(this.previewSession?.overlay ?? this.committed);
  }

  get<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.visible().get(table, id) as RecordOf<T> | undefined;
  }

  getIncludingDeleted<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.visible().raw(table, id) as RecordOf<T> | undefined;
  }

  list<T extends TableName>(table: T): readonly RecordOf<T>[] {
    return this.visible().list(table) as unknown as readonly RecordOf<T>[];
  }

  isOpen(partition: Partition): boolean {
    return this.openSet.has(partition);
  }

  get query(): DocQueries {
    return createQueries(this.visible());
  }

  // ---------- partitions ----------

  open(partition: Partition): Promise<void> {
    this.openSet.add(partition);
    return Promise.resolve();
  }

  close(partition: Partition): void {
    this.openSet.delete(partition);
  }

  openPartitions(): readonly Partition[] {
    return [...this.openSet].sort(compareStrings);
  }

  /** Writes open the partition they land in, so read-your-writes holds for new characters and clips. */
  openFor(source: RowSource, table: string, row: Row): void {
    this.openSet.add(this.viewOf(source).partitionOf(table, row));
  }

  // ---------- writes ----------

  assertWritable(): void {
    if (this.previewSession !== null) throw new EkzaError('preview-active', 'A preview session is active');
    if (this.readOnlyFlag) throw new EkzaError('read-only', 'The document is read-only');
  }

  transact<R>(meta: TxMeta, fn: (tx: Tx) => R): R {
    if (this.current !== null) return fn(this.current.tx);
    this.assertWritable();
    const context = this.beginTx(new Overlay(this.committed), meta.label, meta.selectionAfter);
    let result: R;
    try {
      result = fn(context.tx);
    } finally {
      this.current = null;
    }
    const changes = diffOverlay(context.overlay);
    if (changes.length === 0) return result;
    const batch = this.commitChanges(changes, 'local', context.meta.label, this.user);
    this.undo.record(batch.txId, changes, withMeta(meta, context.meta));
    return result;
  }

  beginTx(overlay: Overlay, label: string, selectionAfter: unknown): TxContext {
    const meta: MutableMeta = { label, selectionAfter };
    const context: TxContext = { overlay, meta, tx: new NaiveTx(this, overlay, meta) };
    this.current = context;
    return context;
  }

  applyChanges(
    changes: readonly AnyChange[],
    meta: {
      readonly origin: 'remote' | 'import' | 'migration' | 'cleanup';
      readonly label: string;
      readonly user?: UserId;
    },
  ): ChangeBatch {
    const writes = (changes as unknown as readonly RowChange[]).map((change) =>
      makeChange(change.table, change.id, this.committed.raw(change.table, change.id), change.after),
    );
    return this.commitChanges(writes, meta.origin, meta.label, meta.user ?? this.user);
  }

  beginPreview(label: string): PreviewSession {
    if (this.previewSession !== null || this.current !== null) {
      throw new EkzaError('preview-active', 'A preview session or transaction is active');
    }
    if (this.readOnlyFlag) throw new EkzaError('read-only', 'The document is read-only');
    this.previewSession = new NaivePreview(this, label);
    return this.previewSession;
  }

  /** Applies whole-row writes to the committed tables and emits one batch. */
  commitChanges(writes: readonly RowChange[], origin: Origin, label: string, user: UserId): ChangeBatch {
    for (const write of writes) {
      this.committed.set(write.table, write.id, write.after);
      if (write.after !== undefined) this.openFor(this.committed, write.table, write.after);
    }
    return this.emit(writes, origin, label, user);
  }

  emit(changes: readonly RowChange[], origin: Origin, label: string, user: UserId = this.user): ChangeBatch {
    this.versionCounter++;
    const batch: ChangeBatch = {
      txId: this.nextTxId(),
      origin,
      label,
      user,
      version: this.versionCounter,
      changes: asAnyChanges(changes),
    };
    for (const listener of this.listeners) listener(batch);
    return batch;
  }

  private nextTxId(): string {
    this.txCounter++;
    return `tx_${this.txCounter.toString().padStart(16, '0')}`;
  }

  subscribe(listener: (batch: ChangeBatch) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------- snapshots ----------

  snapshot(): DocSnapshot {
    const view = this.viewOf(this.committed);
    const names = new Set<string>([...BUILTIN_TABLES, ...this.committed.tableNames()]);
    const tables: Record<string, Record<string, Row>> = {};
    for (const name of [...names].sort(compareStrings)) {
      const rows: Record<string, Row> = {};
      for (const row of view.list(name)) rows[row.id] = row;
      tables[name] = rows;
    }
    const tableVersions: Record<string, number> = { ...this.loadedTableVersions };
    for (const name of BUILTIN_TABLES) tableVersions[name] = 1;
    return {
      format: 'ekza-animator-doc',
      schemaVersion: SCHEMA_VERSION,
      minWriterVersion: this.minWriter,
      tableVersions,
      tables: tables as unknown as SnapshotTables,
    };
  }

  load(snapshot: DocSnapshot, opts?: { readonly readOnly?: boolean }): void {
    this.previewSession?.end();
    const before = new Map<string, Row>();
    for (const table of this.committed.tableNames()) {
      for (const id of this.committed.ids(table)) {
        const row = this.committed.raw(table, id);
        if (row !== undefined) before.set(`${table}\u0000${id}`, row);
      }
    }
    this.committed.clear();
    this.openSet.clear();
    const entries = Object.entries(snapshot.tables as Readonly<Record<string, Readonly<Record<string, unknown>>>>);
    for (const [table, rows] of entries) {
      for (const [id, row] of Object.entries(rows)) this.committed.set(table, id, row as Row);
    }
    for (const [table, rows] of entries) {
      for (const row of Object.values(rows)) this.openFor(this.committed, table, row as Row);
    }
    this.readOnlyFlag = opts?.readOnly ?? false;
    this.minWriter = snapshot.minWriterVersion;
    this.loadedTableVersions = { ...snapshot.tableVersions };
    this.undo.clear();
    const changes: RowChange[] = [];
    for (const [table, rows] of entries) {
      for (const [id, row] of Object.entries(rows)) {
        const key = `${table}\u0000${id}`;
        const previous = before.get(key);
        before.delete(key);
        if (!deepEqual(previous, row)) changes.push(makeChange(table, id, previous, row as Row));
      }
    }
    for (const [key, row] of before) {
      const [table = ''] = key.split('\u0000');
      changes.push(makeChange(table, row.id, row, undefined));
    }
    this.emit(changes, 'load', 'Load');
  }
}

/** Overlay writes as changes against the overlay's base (whole-record before/after, `fields` for updates). */
function diffOverlay(overlay: Overlay): RowChange[] {
  const changes: RowChange[] = [];
  for (const [table, id] of overlay.touched()) {
    const before = overlay.base.raw(table, id);
    const after = overlay.raw(table, id);
    if (!deepEqual(before, after)) changes.push(makeChange(table, id, before, after));
  }
  return changes;
}

function withMeta(meta: TxMeta, annotated: MutableMeta): TxMeta {
  const { selectionAfter: _ignored, ...rest } = meta;
  return {
    ...rest,
    label: annotated.label,
    ...(annotated.selectionAfter === undefined ? {} : { selectionAfter: annotated.selectionAfter }),
  };
}

class NaiveTx implements Tx {
  private readonly view: RowView;

  constructor(
    private readonly store: NaiveStore,
    private readonly overlay: Overlay,
    private readonly meta: MutableMeta,
  ) {
    this.view = store.viewOf(overlay);
  }

  get<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.view.get(table, id) as RecordOf<T> | undefined;
  }

  getIncludingDeleted<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.view.raw(table, id) as RecordOf<T> | undefined;
  }

  list<T extends TableName>(table: T): readonly RecordOf<T>[] {
    return this.view.list(table) as unknown as readonly RecordOf<T>[];
  }

  isOpen(partition: Partition): boolean {
    return this.store.isOpen(partition);
  }

  get query(): DocQueries {
    return createQueries(this.view);
  }

  put<T extends TableName>(table: T, record: RecordOf<T>): void {
    const row = record as unknown as Row;
    if (typeof row.id !== 'string' || row.id.length === 0) {
      throw new EkzaError('invalid-record', `put(${table}): the record has no id`);
    }
    const existing = this.overlay.raw(table, row.id);
    if (existing !== undefined && mergeUnitOf(table) === 'field' && this.store.strictPut) {
      throw new EkzaError('use-patch', `put(${table}, ${row.id}) over an existing record: use patch`);
    }
    this.write(table, row.id, row);
  }

  patch<T extends TableName>(table: T, id: IdOf<T>, fields: Partial<Omit<RecordOf<T>, 'id'>>): void {
    const existing = this.require(table, id, 'patch');
    this.write(table, id, { ...existing, ...(fields as Readonly<Record<string, unknown>>), id });
  }

  remove<T extends TableName>(table: T, id: IdOf<T>): void {
    this.require(table, id, 'remove');
    if (table !== 'keys') {
      const dependant = this.findDependant(id);
      if (dependant !== null) {
        throw new EkzaError('invalid-record', `remove(${table}, ${id}): ${dependant} still references it`);
      }
    }
    this.overlay.write(table, id, null);
  }

  softDelete<T extends SoftDeletableTable>(table: T, id: IdOf<T>): void {
    const existing = this.require(table, id, 'softDelete');
    this.write(table, id, { ...existing, deleted: { by: this.store.user, at: this.store.now() } });
  }

  restore<T extends SoftDeletableTable>(table: T, id: IdOf<T>): void {
    const existing = this.require(table, id, 'restore');
    this.write(table, id, { ...existing, deleted: null });
  }

  annotate(meta: Partial<Pick<TxMeta, 'label' | 'selectionAfter'>>): void {
    if (meta.label !== undefined) this.meta.label = meta.label;
    if ('selectionAfter' in meta) this.meta.selectionAfter = meta.selectionAfter;
  }

  private require(table: string, id: string, op: string): Row {
    const existing = this.view.raw(table, id);
    if (existing === undefined) throw new EkzaError('invalid-record', `${op}(${table}, ${id}): no such record`);
    if ((op === 'softDelete' || op === 'restore') && !isSoftDeletable(table)) {
      throw new EkzaError('invalid-record', `${op}(${table}, ${id}): the table has no soft delete`);
    }
    return existing;
  }

  private write(table: string, id: string, row: Row): void {
    this.overlay.write(table, id, row);
    this.store.openFor(this.overlay, table, row);
  }

  /** First non-deleted record (other than the target) with a top-level field equal to `id`. */
  private findDependant(id: string): string | null {
    for (const table of this.overlay.tableNames()) {
      for (const row of this.view.list(table)) {
        if (row.id === id) continue;
        for (const [field, value] of Object.entries(row)) {
          if (field !== 'id' && value === id) return `${table}/${row.id}.${field}`;
        }
      }
    }
    return null;
  }
}

class NaivePreview implements PreviewSession {
  overlay: Overlay;
  readonly conflicts: readonly AnyChange[] = [];
  private isActive = true;

  constructor(
    private readonly store: NaiveStore,
    readonly label: string,
  ) {
    this.overlay = new Overlay(store.committed);
  }

  get active(): boolean {
    return this.isActive;
  }

  update(fn: (tx: Tx) => void): void {
    this.assertActive();
    const previous = this.overlay;
    const next = new Overlay(this.store.committed);
    const context = this.store.beginTx(next, this.label, undefined);
    try {
      fn(context.tx);
    } finally {
      this.store.current = null;
    }
    this.overlay = next;
    const touched = new Map<string, readonly [string, string]>();
    for (const entry of [...previous.touched(), ...next.touched()]) touched.set(`${entry[0]}\u0000${entry[1]}`, entry);
    const changes: RowChange[] = [];
    for (const [table, id] of touched.values()) {
      const before = previous.raw(table, id);
      const after = next.raw(table, id);
      if (!deepEqual(before, after)) changes.push(makeChange(table, id, before, after));
    }
    if (changes.length > 0) this.store.emit(changes, 'preview', this.label);
  }

  commit(meta?: Partial<TxMeta>): ChangeBatch | null {
    this.assertActive();
    this.end();
    const changes = diffOverlay(this.overlay);
    if (changes.length === 0) return null;
    const label = meta?.label ?? this.label;
    const batch = this.store.commitChanges(changes, 'local', label, this.store.user);
    this.store.undo.record(batch.txId, changes, { ...meta, label });
    return batch;
  }

  cancel(): void {
    if (!this.isActive) return;
    this.end();
    const changes: RowChange[] = [];
    for (const [table, id] of this.overlay.touched()) {
      const before = this.overlay.raw(table, id);
      const after = this.store.committed.raw(table, id);
      if (!deepEqual(before, after)) changes.push(makeChange(table, id, before, after));
    }
    if (changes.length > 0) this.store.emit(changes, 'preview', this.label);
  }

  end(): void {
    this.isActive = false;
    if (this.store.previewSession === this) this.store.previewSession = null;
  }

  private assertActive(): void {
    if (!this.isActive) throw new EkzaError('unsupported', `Preview '${this.label}' has ended`);
  }
}
