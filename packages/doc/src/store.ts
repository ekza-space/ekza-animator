// Contract file: MVP-SPEC §4.2 with the M6A-SPEC §4.2 additions, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { CharacterId, ClipId, ControlId, CurveId, GroupId, LayerId, MeshId, PaletteId, RigId, SkeletonId,
  UserId } from './ids';
import type { ChannelId, ClipRecord, ControlRecord, CurveRecord, GroupRecord, IdOf, ImagePlaneRecord, JointRecord,
  KeyRecord, LayerRecord, MeshRecord, OrthoCamera, Partition, RecordOf, RigRecord, SoftDeletableTable, SwatchRecord,
  TableName } from './records';

export type Origin = 'local' | 'undo' | 'redo' | 'preview' | 'remote' | 'load' | 'import' | 'migration' | 'cleanup';

export interface TxMeta {
  readonly label: string;                      // undo menu label, e.g. 'Set Key'
  readonly coalesceKey?: string;               // same key within coalesceMs merges into one undo entry
  readonly coalesceMs?: number;                // default 0 (no coalescing)
  readonly undoable?: boolean;                 // default true; false: committed, never on the undo stack
  readonly selectionBefore?: unknown;          // opaque snapshots from editor-core, restored by undo/redo
  readonly selectionAfter?: unknown;
}

/** Whole-record before/after. `before === undefined` = insert; `after === undefined` = hard delete. */
export interface Change<T extends TableName = TableName> {
  readonly table: T;
  readonly id: IdOf<T>;
  readonly before: RecordOf<T> | undefined;
  readonly after: RecordOf<T> | undefined;
  /** Top-level fields that changed: set for updates of field-merge tables (patch, or put over an existing
   *  record). Absent for inserts, hard deletes and record-merge tables. */
  readonly fields?: readonly string[];
}
/** Discriminated union: narrowing on `table` narrows `before`/`after`. */
export type AnyChange = { [T in TableName]: Change<T> }[TableName];

export interface ChangeBatch {
  readonly txId: string;
  readonly origin: Origin;
  readonly label: string;
  readonly user: UserId;
  readonly version: number;                    // store version after this batch
  readonly changes: readonly AnyChange[];
}

/** Read access with read-your-writes inside a transaction or preview. Unopened partitions read as absent. */
export interface ReadView {
  get<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined;   // excludes soft-deleted
  getIncludingDeleted<T extends TableName>(table: T, id: IdOf<T>): RecordOf<T> | undefined;
  list<T extends TableName>(table: T): readonly RecordOf<T>[];                // excludes soft-deleted, ordered by id
  isOpen(partition: Partition): boolean;
  readonly query: DocQueries;
}

export interface Tx extends ReadView {
  /** Insert, or replace a whole record. Over an existing record of a field-merge table the change records the
   *  diffed fields; stores created with `strictPut` (tests, dev) throw EkzaError('use-patch') instead. */
  put<T extends TableName>(table: T, record: RecordOf<T>): void;
  /** Shallow-merge fields into an existing record (per-field LWW under a CRDT adapter). */
  patch<T extends TableName>(table: T, id: IdOf<T>, fields: Partial<Omit<RecordOf<T>, 'id'>>): void;
  /** Hard delete. Allowed for 'keys' always; for other tables only when the record has no dependants. */
  remove<T extends TableName>(table: T, id: IdOf<T>): void;
  softDelete<T extends SoftDeletableTable>(table: T, id: IdOf<T>): void;
  restore<T extends SoftDeletableTable>(table: T, id: IdOf<T>): void;
  /** Late metadata for the OUTERMOST transaction; the last call wins. */
  annotate(meta: Partial<Pick<TxMeta, 'label' | 'selectionAfter'>>): void;
}

/** Derived, cached indexes. All results are stable-ordered and exclude soft-deleted records. */
export interface DocQueries {
  /** Sorted by t; duplicate times resolved: the greatest KeyId wins, losers are reported by `hiddenKeys`. */
  keysOfCurve(curve: CurveId): readonly KeyRecord[];
  hiddenKeys(curve: CurveId): readonly KeyRecord[];
  curvesOfClip(clip: ClipId): readonly CurveRecord[];
  curvesOfControl(clip: ClipId, control: ControlId): readonly CurveRecord[];
  /** Canonical curve (smallest CurveId) for a channel; duplicates are unioned by keysOfCurve of the canonical one. */
  curveFor(clip: ClipId, layer: LayerId, control: ControlId, channel: ChannelId): CurveRecord | undefined;
  layersOfClip(clip: ClipId): readonly LayerRecord[];      // by order; [0] = base layer
  baseLayer(clip: ClipId): LayerRecord | undefined;
  clipsOfCharacter(character: CharacterId): readonly ClipRecord[];   // by order (char partition; no clip doc needed)
  rigOfCharacter(character: CharacterId): RigRecord | undefined;
  controlsOfRig(rig: RigId): readonly ControlRecord[];     // parents before children, then by order
  controlByKey(rig: RigId, templateKey: string): ControlRecord | undefined;
  /** Partitions referenced by open records (character → char:, clip → clip:) that are not open. [] in the MVP. */
  missingPartitions(): readonly Partition[];
  // ---------- M6a (M6A-SPEC §4.2) ----------
  meshesOfOwner(owner: CharacterId | 'scene'): readonly MeshRecord[];          // by order
  childrenOf(parent: GroupId | MeshId | null, owner: CharacterId | 'scene'): readonly (MeshRecord | GroupRecord)[];
  swatchesOfPalette(palette: PaletteId): readonly SwatchRecord[];              // by order; live only
  swatchBySlot(palette: PaletteId, slot: number): SwatchRecord | undefined;    // smallest SwatchId on a duplicate
  imagePlanesOf(camera: OrthoCamera): readonly ImagePlaneRecord[];             // by order
  jointsOfSkeleton(skeleton: SkeletonId): readonly JointRecord[];              // parents first, then order
}

export interface PreviewSession {
  readonly label: string;
  readonly active: boolean;
  /** Remote changes to records the overlay touches, received during the preview. Always empty in the MVP. */
  readonly conflicts: readonly AnyChange[];
  /** Discard the previous overlay, then apply fn on top of committed state. Emits an origin 'preview' batch. */
  update(fn: (tx: Tx) => void): void;
  /** Write the overlay as ONE transaction (one undo step unless meta.undoable === false). Null when empty. */
  commit(meta?: Partial<TxMeta>): ChangeBatch | null;
  /** Drop the overlay; emits a 'preview' batch restoring committed values. */
  cancel(): void;
}

export type UndoSkipReason = 'changed-by-other' | 'missing-partition';
export interface UndoEntry {
  readonly txId: string;
  readonly label: string;
  readonly changes: readonly AnyChange[];
  readonly selectionBefore?: unknown;
  readonly selectionAfter?: unknown;
}
export interface UndoResult {
  readonly label: string;
  readonly applied: number;
  /** Per change; `fields` lists the skipped fields of field-merge updates (null = whole change skipped). */
  readonly skipped: readonly { readonly change: AnyChange; readonly fields: readonly string[] | null; readonly reason: UndoSkipReason }[];
  readonly selection?: unknown;               // selectionBefore (undo) / selectionAfter (redo)
}
/** M6a: why entries left the undo manager for good (M6A-SPEC §4.2). */
export type UndoEvictReason = 'limit' | 'clear' | 'budget' | 'redo-cleared' | 'load';
export interface UndoManager {
  canUndo(): boolean;
  canRedo(): boolean;
  peekUndo(): UndoEntry | null;
  peekRedo(): UndoEntry | null;
  /** Compare-before-restore per merge unit (§4.11.0). */
  undo(): UndoResult | null;
  redo(): UndoResult | null;
  stopCapturing(): void;                       // next transaction starts a new entry even inside a coalesce window
  clear(): void;
  readonly limit: number;                      // default 500
  subscribe(listener: () => void): () => void;
  /** M6a: every entry, oldest undo entry first, and the redo entries from the next redo to the last. Read-only
   *  views valid until the next store write; O(1) to obtain. */
  entries(): { readonly undo: readonly UndoEntry[]; readonly redo: readonly UndoEntry[] };
  /** M6a: entries leaving the manager for good (the 500 limit, clear(), evictOldest, a new transaction clearing
   *  redo, load()). Called synchronously after the change, in eviction order. */
  onEvict(listener: (entries: readonly UndoEntry[], reason: UndoEvictReason) => void): () => void;
  /** M6a: drops the n oldest undo entries (the BlobStore byte budget, §5.20); fires onEvict(…, 'budget'). */
  evictOldest(n: number): void;
  /** M6a: drops every redo entry (a selection-only step in Model clears redo like a transaction does, §5.6); fires
   *  onEvict(…, 'redo-cleared') when there was any. */
  clearRedo(): void;
}

/** Known tables are typed; unknown tables (missing extensions, newer apps) are preserved verbatim. */
export type SnapshotTables =
  { readonly [T in TableName]: Readonly<Record<string, RecordOf<T>>> } &
  { readonly [table: string]: Readonly<Record<string, unknown>> };

export interface DocSnapshot {
  readonly format: 'ekza-animator-doc';
  readonly schemaVersion: number;              // core format version (SCHEMA_VERSION when written)
  readonly minWriterVersion: number;
  readonly tableVersions: Readonly<Record<string, number>>;   // per-table schema versions (TableDef.version)
  readonly tables: SnapshotTables;
}

export interface DocumentStore extends ReadView {
  readonly user: UserId;
  readonly version: number;                    // increments on every emitted batch (incl. preview)
  readonly schemaVersion: number;
  readonly readOnly: boolean;                  // true after loading a project with minWriterVersion > SCHEMA_VERSION
  /** Load a partition (memory store: resolves at once). Idempotent. Reads of unopened partitions are absent. */
  open(partition: Partition): Promise<void>;
  close(partition: Partition): void;
  openPartitions(): readonly Partition[];
  /** Synchronous; fn exceptions roll back everything. A transact inside a transact joins the outer one (one
   *  batch; the outer meta wins; `annotate` may adjust it). Throws EkzaError('preview-active') while a preview
   *  is active and EkzaError('read-only') on a read-only store. Never awaited. */
  transact<R>(meta: TxMeta, fn: (tx: Tx) => R): R;
  /** External writes (import pipelines, future remote peers, agents). Never enter the undo stack. */
  applyChanges(changes: readonly AnyChange[], meta: { readonly origin: 'remote' | 'import' | 'migration' | 'cleanup'; readonly label: string; readonly user?: UserId }): ChangeBatch;
  beginPreview(label: string): PreviewSession;      // throws EkzaError('preview-active') if one is active
  readonly preview: PreviewSession | null;
  subscribe(listener: (batch: ChangeBatch) => void): () => void;
  readonly undo: UndoManager;
  /** Deterministic snapshot of committed state in open partitions; soft-deleted records are omitted. */
  snapshot(): DocSnapshot;
  /** Replace all content (origin 'load'); clears undo. Snapshot must already be migrated. */
  load(snapshot: DocSnapshot, opts?: { readonly readOnly?: boolean }): void;
}

/** Implemented by replicating stores (doc-yjs). The memory store does not implement it. */
export interface ReplicatingStore extends DocumentStore {
  readonly replicaId: string;
  /** Opaque updates produced since the last call, per partition. */
  drainOutgoing(): readonly { readonly partition: Partition; readonly update: Uint8Array }[];
  receive(partition: Partition, update: Uint8Array): void;
}

/** In-memory bus between replicas with controllable delay, drop, reorder and partitions (research 06 §7.4). */
export interface ReplicaNetwork {
  readonly peers: readonly ReplicatingStore[];
  /** Move queued updates according to the link settings; returns the number delivered. */
  deliver(): number;
  /** Deliver until no update is queued and every link is healed. */
  settle(): void;
  partition(a: number, b: number): void;
  heal(): void;
  setLink(opts: { readonly delayTicks?: number; readonly dropRate?: number; readonly reorder?: boolean }): void;
}
export interface ReplicaHarness {
  create(n: number, opts?: { readonly seed?: number }): ReplicaNetwork;
}
export interface ConformanceCaps {
  readonly replicating: boolean;
  /** Required when replicating is true. */
  readonly harness?: ReplicaHarness;
}
