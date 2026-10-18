// A minimal ReplicatingStore over Yjs (ADR 0002 decision 6, research 06 §6–§7): one Y.Doc per partition.
//
// Encoding (research 06 R2/R3):
// - one top-level Y.Map per table in each partition document;
// - record-merge tables (keys, assets): the record as one plain value under its id (whole-record LWW);
// - field-merge tables (everything else, opaque tables included): a nested Y.Map of top-level fields per record,
//   created by the record's single creator; updates set or delete only the changed fields (per-field LWW).
//
// Reads, transactions, previews, queries and the shared PatchUndoManager come from a MemoryDocumentStore that holds
// the materialized records. Every change it commits (local, undo, redo, import, load, …) is mirrored into the
// partition documents in one Y transaction per document; updates received from peers are applied to the Y.Doc and
// the records they touched are re-materialized and handed to the core as one `remote` batch. The Y.Docs are the
// replicated truth; the core is their projection.
import {
  type AnyChange,
  type ChangeBatch,
  type CommittedChange,
  compareStrings,
  deepEqual,
  type DocQueries,
  type DocSnapshot,
  type DocumentStore,
  diffFields,
  EkzaError,
  type IdOf,
  MemoryDocumentStore,
  mergeUnitOf,
  type Partition,
  type PreviewSession,
  type RecordOf,
  type ReplicatingStore,
  type TableName,
  type Tx,
  type TxMeta,
  type UndoManager,
  type UserId,
} from '@ekza-animator/doc';
import * as Y from 'yjs';

type Row = { readonly id: string; readonly [field: string]: unknown };

/** Transaction origin of updates applied by `receive`: never sent back out, never mirrored. */
const REMOTE_ORIGIN = Symbol('ekza-doc-yjs:remote');
/** Transaction origin of local mirror writes. */
const LOCAL_ORIGIN = Symbol('ekza-doc-yjs:local');

/** Deterministic Yjs client id for a replica (FNV-1a 32), so LWW tie-breaks are reproducible in tests. */
function clientIdOf(replicaId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < replicaId.length; i++) {
    hash ^= replicaId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 1;
}

function isRecordObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class YjsDocumentStore implements ReplicatingStore {
  readonly replicaId: string;
  private readonly core: MemoryDocumentStore;
  private readonly clientId: number;
  private readonly docs = new Map<Partition, Y.Doc>();
  private readonly roots = new Map<Y.Doc, Map<object, string>>();
  private readonly outgoing = new Map<Partition, Uint8Array[]>();
  /** Records touched by the update being received, as table → ids. */
  private pending: Map<string, Set<string>> | null = null;
  private applyingRemote = false;

  constructor(opts: { readonly replicaId: string; readonly user?: UserId; readonly strictPut?: boolean }) {
    if (typeof opts.replicaId !== 'string' || opts.replicaId.length === 0) {
      throw new EkzaError('unsupported', 'createYjsStore: replicaId must be a non-empty string');
    }
    this.replicaId = opts.replicaId;
    this.clientId = clientIdOf(opts.replicaId);
    this.core = new MemoryDocumentStore({
      ...(opts.user === undefined ? {} : { user: opts.user }),
      ...(opts.strictPut === undefined ? {} : { strictPut: opts.strictPut }),
    });
    this.core.observeCommits((_batch, committed) => {
      if (!this.applyingRemote) this.mirror(committed);
    });
  }

  // ---------- DocumentStore (delegated to the materialized core) ----------

  get user(): UserId {
    return this.core.user;
  }

  get version(): number {
    return this.core.version;
  }

  get schemaVersion(): number {
    return this.core.schemaVersion;
  }

  get readOnly(): boolean {
    return this.core.readOnly;
  }

  get query(): DocQueries {
    return this.core.query;
  }

  get undo(): UndoManager {
    return this.core.undo;
  }

  get preview(): PreviewSession | null {
    return this.core.preview;
  }

  get<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.core.get(table, id);
  }

  getIncludingDeleted<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined {
    return this.core.getIncludingDeleted(table, id);
  }

  list<T extends TableName>(table: T): readonly RecordOf<T>[] {
    return this.core.list(table);
  }

  isOpen(partition: Partition): boolean {
    return this.core.isOpen(partition);
  }

  open(partition: Partition): Promise<void> {
    this.docFor(partition);
    return this.core.open(partition);
  }

  close(partition: Partition): void {
    // The Y.Doc stays: updates for a closed partition keep arriving and show up when it is opened again.
    this.core.close(partition);
  }

  openPartitions(): readonly Partition[] {
    return this.core.openPartitions();
  }

  transact<R>(meta: TxMeta, fn: (tx: Tx) => R): R {
    return this.core.transact(meta, fn);
  }

  applyChanges(
    changes: readonly AnyChange[],
    meta: {
      readonly origin: 'remote' | 'import' | 'migration' | 'cleanup';
      readonly label: string;
      readonly user?: UserId;
    },
  ): ChangeBatch {
    // Changes handed in by callers are document writes of this replica: they are mirrored and replicate.
    return this.core.applyChanges(changes, meta);
  }

  beginPreview(label: string): PreviewSession {
    return this.core.beginPreview(label);
  }

  subscribe(listener: (batch: ChangeBatch) => void): () => void {
    return this.core.subscribe(listener);
  }

  snapshot(): DocSnapshot {
    return this.core.snapshot();
  }

  load(snapshot: DocSnapshot, opts?: { readonly readOnly?: boolean }): void {
    this.core.load(snapshot, opts);
  }

  // ---------- ReplicatingStore ----------

  drainOutgoing(): readonly { readonly partition: Partition; readonly update: Uint8Array }[] {
    const out: { partition: Partition; update: Uint8Array }[] = [];
    for (const partition of [...this.outgoing.keys()].sort(compareStrings)) {
      const updates = this.outgoing.get(partition) ?? [];
      if (updates.length === 0) continue;
      out.push({ partition, update: updates.length === 1 ? (updates[0] as Uint8Array) : Y.mergeUpdatesV2(updates) });
    }
    this.outgoing.clear();
    return out;
  }

  receive(partition: Partition, update: Uint8Array): void {
    const doc = this.docFor(partition);
    const touched = new Map<string, Set<string>>();
    this.pending = touched;
    try {
      Y.applyUpdateV2(doc, update, REMOTE_ORIGIN);
    } finally {
      this.pending = null;
    }
    const changes: AnyChange[] = [];
    const partitions: (Partition | undefined)[] = [];
    for (const [table, ids] of touched) {
      for (const id of ids) {
        const next = this.materialize(table, id);
        const current = this.core.entryOf(table, id);
        if (next === undefined) {
          if (current === undefined) continue;
          changes.push({ table, id, before: current.record, after: undefined } as unknown as AnyChange);
          partitions.push(undefined);
          continue;
        }
        if (current !== undefined && current.partition === next.partition && deepEqual(current.record, next.record))
          continue;
        changes.push({ table, id, before: current?.record, after: next.record } as unknown as AnyChange);
        partitions.push(next.partition);
      }
    }
    if (changes.length === 0) return;
    this.applyingRemote = true;
    try {
      this.core.applyChanges(
        changes,
        { origin: 'remote', label: 'Remote update', user: 'remote' as UserId },
        { partitions },
      );
    } finally {
      this.applyingRemote = false;
    }
  }

  // ---------- Yjs plumbing ----------

  /** The Y.Doc of a partition, if this replica has one (adapter tests inspect the encoding). */
  documentOf(partition: Partition): Y.Doc | undefined {
    return this.docs.get(partition);
  }

  /** The Yjs client id of this replica's documents (derived from `replicaId`). */
  get yjsClientId(): number {
    return this.clientId;
  }

  private docFor(partition: Partition): Y.Doc {
    let doc = this.docs.get(partition);
    if (doc !== undefined) return doc;
    doc = new Y.Doc();
    doc.clientID = this.clientId;
    doc.on('updateV2', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      const queue = this.outgoing.get(partition);
      if (queue === undefined) this.outgoing.set(partition, [update]);
      else queue.push(update);
    });
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      if (transaction.origin === REMOTE_ORIGIN) this.collect(transaction);
    });
    this.docs.set(partition, doc);
    return doc;
  }

  /** Records touched by a remote transaction: changed keys of table maps and changed nested record maps. */
  private collect(transaction: Y.Transaction): void {
    const pending = this.pending;
    if (pending === null) return;
    const doc = transaction.doc;
    const add = (table: string | undefined, id: string | null): void => {
      if (table === undefined || id === null) return;
      const ids = pending.get(table);
      if (ids === undefined) pending.set(table, new Set([id]));
      else ids.add(id);
    };
    for (const [type, keys] of transaction.changed) {
      const item = type._item;
      if (item === null) {
        const table = this.rootName(doc, type);
        for (const key of keys) add(table, key);
      } else if (item.parent instanceof Y.AbstractType && item.parent._item === null) {
        add(this.rootName(doc, item.parent), item.parentSub);
      }
    }
  }

  private rootName(doc: Y.Doc, type: object): string | undefined {
    let names = this.roots.get(doc);
    if (names === undefined || !names.has(type)) {
      names = new Map();
      for (const [name, root] of doc.share) names.set(root, name);
      this.roots.set(doc, names);
    }
    return names.get(type);
  }

  /**
   * The record as the partition documents hold it now. A record present in several documents (two replicas wrote
   * the same id into different partitions) resolves to the smallest partition name, the same on every replica.
   */
  private materialize(table: string, id: string): { readonly record: Row; readonly partition: Partition } | undefined {
    let best: { record: Row; partition: Partition } | undefined;
    for (const [partition, doc] of this.docs) {
      if (!doc.share.has(table)) continue;
      const value: unknown = doc.getMap(table).get(id);
      const record = toRecord(value, id);
      if (record === undefined) continue;
      if (best === undefined || compareStrings(partition, best.partition) < 0) best = { record, partition };
    }
    return best;
  }

  /** Writes committed changes into the partition documents, one Y transaction per document. */
  private mirror(committed: readonly CommittedChange[]): void {
    const writes = new Map<Partition, ((doc: Y.Doc) => void)[]>();
    const queue = (partition: Partition, write: (doc: Y.Doc) => void): void => {
      const list = writes.get(partition);
      if (list === undefined) writes.set(partition, [write]);
      else list.push(write);
    };
    for (const { change, beforePartition, afterPartition } of committed) {
      const table = change.table as string;
      const id = change.id as string;
      const before = change.before as Row | undefined;
      const after = change.after as Row | undefined;
      const moved = beforePartition !== afterPartition;
      // Exactly one copy: the record leaves every other partition document (its old partition after a move, and any
      // stale copy a concurrent move left behind), so this replica's view equals the materialization rule.
      for (const [partition, doc] of this.docs) {
        if (after !== undefined && partition === afterPartition) continue;
        if (doc.share.has(table) && doc.getMap(table).has(id))
          queue(partition, (target) => target.getMap(table).delete(id));
      }
      if (after === undefined || afterPartition === null) continue;
      const perField = mergeUnitOf(table) === 'field';
      queue(afterPartition, (doc) => {
        const rows = doc.getMap<unknown>(table);
        if (!perField) {
          rows.set(id, after);
          return;
        }
        const existing = rows.get(id);
        if (before === undefined || moved || !(existing instanceof Y.Map)) {
          // Insert: the creator makes the nested field map.
          const fields = new Y.Map<unknown>();
          for (const [field, value] of Object.entries(after)) if (value !== undefined) fields.set(field, value);
          rows.set(id, fields);
          return;
        }
        for (const field of change.fields ?? diffFields(before, after)) {
          const value = after[field];
          if (value === undefined) existing.delete(field);
          else existing.set(field, value);
        }
      });
    }
    for (const [partition, list] of writes) {
      const doc = this.docFor(partition);
      doc.transact(() => {
        for (const write of list) write(doc);
      }, LOCAL_ORIGIN);
    }
  }
}

/** A stored Yjs value as a record: nested field maps become plain objects; plain values are records already. */
function toRecord(value: unknown, id: string): Row | undefined {
  const plain: unknown = value instanceof Y.Map ? value.toJSON() : value;
  if (!isRecordObject(plain)) return undefined;
  return plain['id'] === id ? (plain as Row) : { ...plain, id };
}

/** A private, test-only replicating store (never a dependency of the app). `strictPut` defaults to true. */
export function createYjsStore(opts: {
  readonly replicaId: string;
  readonly user?: UserId;
  readonly strictPut?: boolean;
}): ReplicatingStore {
  return new YjsDocumentStore(opts);
}

/** Exposed for adapter tests: the store's documents are an implementation detail otherwise. */
export function isYjsStore(store: DocumentStore): store is YjsDocumentStore {
  return store instanceof YjsDocumentStore;
}
