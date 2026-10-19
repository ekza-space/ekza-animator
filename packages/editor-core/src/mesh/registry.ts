// The mesh runtime registry (M6A-SPEC §4.6 `MeshRuntimeRegistry`, §5.5, §5.13 runner, §5.20 GC and budget).
//
// - **Lifecycle** (§5.5 rule 8): one runtime per live mesh record with `data`, created when the record appears and
//   disposed when it is deleted, in every workspace; batches update only the records they touch.
// - **Commits** (§5.5 rules 2–3, 9): `commitOp` commits the matching preview session or runs the op on every target
//   (atomic: one refusal refuses the run and reverts every target), hashes the dirty chunks, stores them and patches
//   each ref (`rev + 1`, `base`, `joints`) with `generator: null` (a component edit). The new content is pending until
//   the transaction's batch confirms it; a transaction that aborts reverts it (two-phase).
// - **Following** (§5.5 rules 4, 6): undo, redo, remote and import batches move runtimes to their record's ref (see
//   runtime.ts); remote and import changes of `data` end a preview session on that mesh ("Changed by another user").
// - **GC and budget** (§5.20): reference counts per manifest (ledger.ts) for live records, every doc undo/redo entry,
//   runtimes, the last op's edges and pinned autosave blobs. Commits, evictions and history drops only **schedule**
//   the deferred check (a microtask after the current batch; sweeps at most once per 5 s): the undo byte budget
//   (history-only blob bytes + journal bytes + selection-snapshot bytes) drops the oldest history steps, the journal
//   cap drops the oldest unpinned edges, then a sweep frees what no root references and is not fresh.
import { type Disposer, EkzaError, type ParamValues } from '@ekza-animator/anim-core';
import {
  type AnyChange,
  type ChangeBatch,
  type DocumentStore,
  type MeshId,
  type MeshRecord,
  type MeshRef,
  type Tx,
  type UndoEntry,
} from '@ekza-animator/doc';
import type {
  ComponentKind,
  ComponentSelection,
  EditMesh,
  MeshData,
  MeshDelta,
  MeshOp,
  MeshSetOp,
  OpResult,
  OpWarning,
  Refusal,
  RevisionManifest,
  SymmetryMap,
} from '@ekza-animator/mesh-core';
import { DEFAULT_DEPS } from '../app/deps';
import { internalsOf } from '../app/internals';
import type {
  BlobId,
  BlobStore,
  EditorApp,
  HistoryStep,
  MeshCommitResult,
  MeshOpSession,
  MeshRuntime,
  MeshRuntimeEvent,
  MeshRuntimeRegistry,
  MeshSetCommitResult,
  MeshSelectionSnapshot,
  Notifier,
  SelectionPart,
  SoftSelectSettings,
  SymmetrySettings,
} from '../types';
import { buildOpContext, type RunSettings, softContextOf, symmetryAxisOf, worldPlacement } from './context';
import { dirtyOf, isClean } from './dirty';
import { MeshJournal, type JournalEdge } from './journal';
import { loadMeshKernel, type MeshKernel, meshKernel } from './kernel';
import { BlobLedger } from './ledger';
import { MeshRuntimeImpl, type RuntimeEnv } from './runtime';
import { OpSession, type SessionTarget } from './session';
import { runSetOp } from './setOps';
import { refJointsOf } from './skin';

const MB = 1024 * 1024;
/** §5.20: at most one sweep per 5 s. */
export const SWEEP_INTERVAL_MS = 5000;
/** §5.20: the one toast per session when the budget releases steps. */
export const BUDGET_TOAST = 'Older undo steps were released to save memory';
const DEFAULT_UNDO_BUDGET_MB = 256;
const DEFAULT_JOURNAL_BUDGET_MB = 64;

/** Extra commit inputs the editor's own wrappers pass (`meshOperator`, Adjust Last); the contract needs only `seed`. */
export interface CommitContext {
  readonly seed: string;
  /** Component kind the run reads its selection in; default: the current mode's (null for object-level ops). */
  readonly kind?: ComponentKind | null;
  /** Explicit selections per target (tools, tests); default: the component selection service. */
  readonly selection?: ReadonlyMap<MeshId, ComponentSelection>;
  /** Recorded symmetry/soft settings of a re-run (`LastRun.context`, §5.7); default: the session's. */
  readonly settings?: RunSettings;
}

/** Timers of the deferred work (fake ones in tests). */
export interface MeshClock {
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly microtask: (fn: () => void) => void;
}

export interface GcReport {
  readonly freed: number;
  readonly bytes: number;
  /** History steps the budget dropped. */
  readonly dropped: number;
}

export interface MeshRegistryDeps {
  readonly store: DocumentStore;
  readonly blobs: BlobStore;
  /** §3 rule 8: applied to the kernel when it loads (development and e2e builds). */
  readonly kernelDebug?: boolean;
  /** Called when a runtime's state or data changes (the host requests a frame). */
  readonly changed?: () => void;
  readonly notify?: Notifier;
  readonly clock?: MeshClock;
}

/** The pre-op inputs of the last MeshSetOp (§5.5 rule 5). */
export interface LastSetOp {
  readonly opId: string;
  readonly inputs: ReadonlyMap<MeshId, MeshData>;
  readonly outputs: readonly string[];
}

export interface KernelMeshRuntimes extends MeshRuntimeRegistry {
  commitOp(tx: Tx, op: MeshOp, targets: readonly MeshId[], args: ParamValues, ctx: CommitContext): MeshCommitResult;
  commitSetOp(
    tx: Tx,
    op: MeshSetOp,
    inputs: readonly MeshId[],
    args: ParamValues,
    ctx: CommitContext,
  ): MeshSetCommitResult;
  /** Resolves when the kernel is loaded and no runtime is loading (tests, the test API). */
  settled(): Promise<void>;
  /** Binds the app (history, session, prefs, component selections); idempotent. */
  attach(app: EditorApp): void;
  readonly attached: boolean;
  /** Runs the deferred check now: reconcile, budget, journal cap and a sweep. Never inside a transaction. */
  collect(): GcReport;
  /** Bytes of blobs only the undo history keeps alive (§5.20 budget, first term). */
  readonly historyBytes: number;
  /** Bytes of selection snapshots in history steps and doc entries (§5.6, §5.20). */
  readonly selectionBytes: number;
  /** Pins blobs as roots (an autosave slot or a write in flight, §5.20 root 4). */
  pinBlobs(ids: readonly BlobId[]): Disposer;
  /** Stores a whole revision for a record about to be written (`mesh.create.*`): the ref (rev 1 or prior + 1). */
  storeRevision(data: MeshData, prior?: MeshRef | null, joints?: readonly string[]): MeshRef;
  /** The last MeshSetOp's pre-op inputs. */
  readonly lastSetOp: LastSetOp | null;
  /** The last op's journal edges (pinned). */
  lastOpEdges(): readonly { readonly mesh: MeshId; readonly from: string; readonly to: string }[];
  /** The selection the runtime keeps for a mesh while the component selection service cannot store one (B10). */
  localSelection(mesh: MeshId): ComponentSelection | null;
  /** Stores a selection through the component selection service, else in the runtime's fallback (until B10). */
  select(mesh: MeshId, sel: ComponentSelection): void;
  /** The selection an op on `mesh` reads in `kind` (service, local fallback, else empty). */
  selectionFor(mesh: MeshId, kind: ComponentKind): ComponentSelection | null;
  /** The kernel op's poll on every target that has edit links (closed meshes are checked by the run). */
  pollOp(op: MeshOp, targets: readonly MeshId[], kind: ComponentKind | null, settings?: RunSettings): true | Refusal;
  dispose(): void;
}

interface Accounted {
  readonly entry: UndoEntry;
  readonly manifests: readonly string[];
  readonly selectionBytes: number;
}

function defaultClock(): MeshClock {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    microtask: (fn) => queueMicrotask(fn),
  };
}

const isRefusal = (x: OpResult | Refusal | unknown): x is Refusal =>
  typeof x === 'object' && x !== null && (x as { refused?: unknown }).refused === true;

/** The mesh records a doc change touches with their data refs (before and after). */
function manifestsOfChange(change: AnyChange, out: Set<string>): void {
  if (change.table !== 'meshes') return;
  const before = change.before?.data?.manifest;
  const after = change.after?.data?.manifest;
  if (before !== undefined) out.add(before);
  if (after !== undefined) out.add(after);
}

/** Bytes of the per-mesh bitsets of a stored selection snapshot (`TxMeta.selectionBefore/After`). */
function snapshotBytes(snapshot: unknown): number {
  if (typeof snapshot !== 'object' || snapshot === null) return 0;
  const meshes = (snapshot as { meshes?: unknown }).meshes;
  if (typeof meshes !== 'object' || meshes === null) return 0;
  let bytes = 0;
  for (const value of Object.values(meshes as Record<string, unknown>)) {
    const m = value as Partial<MeshSelectionSnapshot> | null;
    for (const array of [m?.verts, m?.edges, m?.faces, m?.order])
      if (array instanceof Uint32Array) bytes += array.byteLength;
  }
  return bytes;
}

const partBytesCache = new WeakMap<object, number>();
function partBytes(part: SelectionPart): number {
  const cached = partBytesCache.get(part);
  if (cached !== undefined) return cached;
  const bytes = snapshotBytes(part.before) + snapshotBytes(part.after);
  partBytesCache.set(part, bytes);
  return bytes;
}

interface Host {
  readonly app: EditorApp;
}

export function createMeshRuntimeRegistry(deps: MeshRegistryDeps): KernelMeshRuntimes {
  const { store, blobs } = deps;
  const clock = deps.clock ?? defaultClock();
  const runtimes = new Map<MeshId, MeshRuntimeImpl>();
  const listeners = new Set<(id: MeshId, e: MeshRuntimeEvent) => void>();
  const journal = new MeshJournal();
  const ledger = new BlobLedger(blobs);
  /** Live record refs counted in the ledger. */
  const liveRefs = new Map<MeshId, string>();
  /** History entries counted in the ledger, by txId. */
  const accounted = new Map<string, Accounted>();
  let accountedViews: { undo: readonly UndoEntry[]; redo: readonly UndoEntry[] } | null = null;
  let entrySelectionBytes = 0;
  /** Revisions written in this process whose batch has not arrived yet (create, writeData). */
  const preloaded = new Map<BlobId, { readonly data: MeshData; readonly manifest: RevisionManifest }>();
  /** Runtimes a commit path touched in this task: verified against the committed refs in a microtask. */
  const touched = new Set<MeshRuntimeImpl>();
  const localSelections = new Map<MeshId, ComponentSelection>();
  /** Edges of last-op journal pins counted as 'other' roots in the ledger. */
  let pinnedRoots: readonly string[] = [];
  let session: OpSession | null = null;
  let lastSetOp: LastSetOp | null = null;
  let host: Host | null = null;
  const hostDisposers: Disposer[] = [];
  let disposed = false;
  let toasted = false;
  let deferredQueued = false;
  let verifyQueued = false;
  let sweepTimer: unknown = null;
  let lastSweepAt = -Infinity;
  let sweepWanted = false;

  // ---------- kernel ----------

  const ensureKernel = (): void => {
    if (meshKernel() !== null) return;
    void loadMeshKernel().then(
      (k) => {
        if (deps.kernelDebug === true) k.setKernelDebug(true);
        if (disposed) return;
        for (const runtime of runtimes.values()) runtime.follow();
      },
      (error: unknown) => {
        for (const runtime of runtimes.values()) {
          runtime.error = `Mesh tools could not load: ${error instanceof Error ? error.message : String(error)}`;
          runtime.setState('error');
        }
      },
    );
  };
  if (meshKernel() !== null && deps.kernelDebug === true) meshKernel()?.setKernelDebug(true);

  const requireKernel = (): MeshKernel => {
    const kernel = meshKernel();
    if (kernel === null) {
      ensureKernel();
      throw new EkzaError('mesh-loading', 'Mesh tools are loading');
    }
    return kernel;
  };

  // ---------- host-dependent reads ----------

  const symmetrySettings = (id: MeshId): SymmetrySettings | null =>
    host?.app.session.getState().model.symmetry.get(id) ?? null;

  const buildSymmetry = (runtime: MeshRuntimeImpl, settings: SymmetrySettings | null): SymmetryMap | null => {
    const axis = symmetryAxisOf(settings);
    const kernel = meshKernel();
    const record = store.get('meshes', runtime.id);
    if (axis === null || kernel === null || record === undefined || runtime.state !== 'ready') return null;
    const placement = worldPlacement(store, record);
    const key = `${settings?.mode}|${settings?.tolerance}|${runtime.version}|${
      axis.space === 'world' ? JSON.stringify(placement) : ''
    }`;
    return runtime.cachedSymmetry(key, () => {
      try {
        const mesh = runtime.lineage ?? kernel.editMeshFrom(runtime.data() as MeshData);
        return kernel.buildSymmetryMap(mesh, {
          axis: axis.axis,
          space: axis.space,
          placement,
          tolerance: settings?.tolerance ?? 0.001,
        });
      } catch (error) {
        // B2's maps land later (`not-implemented`); a mesh it cannot map has no symmetry.
        if (error instanceof EkzaError) return null;
        throw error;
      }
    });
  };

  const env: RuntimeEnv = {
    blobs,
    journal,
    ledger,
    kernel: meshKernel,
    preloaded: (manifest) => preloaded.get(manifest),
    changed(runtime, e) {
      for (const listener of Array.from(listeners)) listener(runtime.id, e);
      deps.changed?.();
    },
    symmetry: (runtime) => buildSymmetry(runtime, symmetrySettings(runtime.id)),
  };

  // ---------- selections ----------

  const emptySelection = (kernel: MeshKernel, kind: ComponentKind, runtime: MeshRuntimeImpl): ComponentSelection => {
    const counts = runtime.lineage?.counts ?? runtime.data()?.counts ?? { points: 0, edges: 0, faces: 0, corners: 0 };
    return kernel.selectionOf(kind, [], counts);
  };

  const asKind = (sel: ComponentSelection, kind: ComponentKind): ComponentSelection =>
    sel.kind === kind ? sel : { ...sel, kind, order: null, active: -1 };

  const selectionFor = (id: MeshId, kind: ComponentKind): ComponentSelection | null => {
    const kernel = meshKernel();
    const runtime = runtimes.get(id);
    if (kernel === null || runtime === undefined || runtime.state !== 'ready') return null;
    const local = localSelections.get(id);
    if (local !== undefined) return asKind(local, kind);
    const service = host?.app.components;
    if (service !== undefined) {
      try {
        return service.get(id, kind);
      } catch {
        // fall through to an empty selection
      }
    }
    return emptySelection(kernel, kind, runtime);
  };

  const storeSelection = (id: MeshId, sel: ComponentSelection): void => {
    const service = host?.app.components;
    if (service !== undefined) {
      try {
        service.set(id, sel);
        localSelections.delete(id);
        return;
      } catch (error) {
        if (!(error instanceof EkzaError) || error.code !== 'not-implemented') throw error;
      }
    }
    // Until B10 lands the service's writers, the runtime keeps the op's selection itself (READY.b10 fallback).
    localSelections.set(id, sel);
  };

  // ---------- runtimes ----------

  const dispose = (id: MeshId): void => {
    const runtime = runtimes.get(id);
    if (runtime === undefined) return;
    if (session?.meshes.includes(id) === true) endSession('The mesh was deleted');
    runtimes.delete(id);
    localSelections.delete(id);
    runtime.dispose();
  };

  const setLive = (id: MeshId, manifest: string | null): void => {
    const previous = liveRefs.get(id) ?? null;
    if (previous === manifest) return;
    if (previous !== null) ledger.ref(previous, 'other', -1);
    if (manifest === null) liveRefs.delete(id);
    else {
      liveRefs.set(id, manifest);
      ledger.ref(manifest, 'other', 1);
    }
  };

  const endSession = (reason: string): void => {
    const s = session;
    if (s === null || !s.active) return;
    s.endedBecause = reason;
    s.cancel();
  };

  /** Brings a runtime to `record` (its committed ref), creating it when needed. */
  const syncRecord = (id: MeshId, record: MeshRecord | undefined, origin: ChangeBatch['origin'] | null): void => {
    if (record === undefined || record.data === null) {
      setLive(id, null);
      dispose(id);
      return;
    }
    const ref = record.data;
    setLive(id, ref.manifest);
    let runtime = runtimes.get(id);
    if (runtime === undefined) {
      runtime = new MeshRuntimeImpl(id, ref, env);
      runtimes.set(id, runtime);
      if (meshKernel() === null) {
        runtime.setState('loading');
        ensureKernel();
        return;
      }
      runtime.follow();
      return;
    }
    if (runtime.pending !== null) {
      if (runtime.pending.to.manifest === ref.manifest) {
        const edge = runtime.confirm();
        if (edge !== null) confirmedEdges.push(edge);
      } else {
        runtime.revertPending();
      }
    }
    runtime.ref = ref;
    if (session !== null && session.active && session.meshes.includes(id)) {
      const external = origin === 'remote' || origin === 'import' || origin === 'load' || origin === 'migration';
      if (external) endSession('Changed by another user');
      else if (runtime.current !== ref.manifest) endSession('The mesh changed');
      else return;
    }
    if (runtime.current !== ref.manifest && runtime.state === 'ready') localSelections.delete(id);
    runtime.follow();
  };

  /** Edges confirmed while processing one batch (pinned as the last op's edges). */
  let confirmedEdges: JournalEdge[] = [];

  const pinLastOp = (edges: readonly JournalEdge[]): void => {
    journal.pin(edges);
    const roots: string[] = [];
    for (const edge of edges) roots.push(edge.from, edge.to);
    for (const root of roots) ledger.ref(root, 'other', 1);
    for (const root of pinnedRoots) ledger.ref(root, 'other', -1);
    pinnedRoots = roots;
  };

  const onBatch = (batch: ChangeBatch): void => {
    if (disposed) return;
    confirmedEdges = [];
    if (batch.origin === 'load') {
      for (const id of [...runtimes.keys()]) dispose(id);
      for (const id of [...liveRefs.keys()]) setLive(id, null);
      localSelections.clear();
      lastSetOp = null;
      pinLastOp([]);
      for (const record of store.list('meshes')) syncRecord(record.id, record, 'load');
    } else {
      const ids = new Set<MeshId>();
      for (const change of batch.changes) if (change.table === 'meshes') ids.add(change.id);
      for (const id of ids) syncRecord(id, store.get('meshes', id), batch.origin);
      if (confirmedEdges.length > 0) pinLastOp(confirmedEdges);
    }
    // A pending commit whose batch this was not: its transaction aborted.
    for (const runtime of runtimes.values()) {
      if (runtime.pending === null) continue;
      const committed = store.get('meshes', runtime.id)?.data ?? null;
      if (committed?.manifest === runtime.pending.to.manifest) continue;
      runtime.revertPending();
      runtime.follow();
    }
    preloaded.clear();
    if (batch.changes.length > 0 || batch.origin === 'load') schedule();
  };

  /** Microtask after a commit path: confirms or reverts what the transaction's batch did not settle. */
  const verify = (): void => {
    verifyQueued = false;
    for (const runtime of touched) {
      if (runtime.disposed || runtime.previewing) continue;
      const committed = store.get('meshes', runtime.id)?.data ?? null;
      if (runtime.pending !== null) {
        if (committed?.manifest === runtime.pending.to.manifest) {
          const edge = runtime.confirm();
          if (edge !== null) pinLastOp([edge]);
        } else {
          runtime.revertPending();
        }
      }
      if (committed === null) continue;
      if (runtime.ref?.manifest !== committed.manifest || runtime.current !== committed.manifest) {
        runtime.ref = committed;
        runtime.follow();
      }
    }
    touched.clear();
    preloaded.clear();
  };
  const touch = (runtime: MeshRuntimeImpl): void => {
    touched.add(runtime);
    if (!verifyQueued) {
      verifyQueued = true;
      clock.microtask(verify);
    }
  };

  // ---------- history accounting ----------

  const reconcileHistory = (): void => {
    const views = store.undo.entries();
    if (accountedViews !== null && accountedViews.undo === views.undo && accountedViews.redo === views.redo) return;
    accountedViews = views;
    const seen = new Set<string>();
    for (const entry of [...views.undo, ...views.redo]) {
      seen.add(entry.txId);
      const known = accounted.get(entry.txId);
      if (known?.entry === entry) continue;
      const manifests = new Set<string>();
      for (const change of entry.changes) manifestsOfChange(change, manifests);
      const bytes = snapshotBytes(entry.selectionBefore) + snapshotBytes(entry.selectionAfter);
      for (const manifest of manifests) ledger.ref(manifest, 'hist', 1);
      if (known !== undefined) {
        for (const manifest of known.manifests) ledger.ref(manifest, 'hist', -1);
        entrySelectionBytes -= known.selectionBytes;
      }
      entrySelectionBytes += bytes;
      accounted.set(entry.txId, { entry, manifests: [...manifests], selectionBytes: bytes });
    }
    for (const [txId, known] of accounted) {
      if (seen.has(txId)) continue;
      for (const manifest of known.manifests) ledger.ref(manifest, 'hist', -1);
      entrySelectionBytes -= known.selectionBytes;
      accounted.delete(txId);
    }
  };

  const historySteps = (): { readonly undo: readonly HistoryStep[]; readonly redo: readonly HistoryStep[] } | null => {
    const history = host?.app.history as
      | { steps?: () => { undo: readonly HistoryStep[]; redo: readonly HistoryStep[] } }
      | undefined;
    return typeof history?.steps === 'function' ? history.steps() : null;
  };

  const stepSelectionBytes = (): number => {
    const steps = historySteps();
    if (steps === null) return 0;
    let bytes = 0;
    for (const step of steps.undo) if (step.selection) bytes += partBytes(step.selection);
    for (const step of steps.redo) if (step.selection) bytes += partBytes(step.selection);
    return bytes;
  };

  /** Journal edges whose revisions no root references any more are useless (their steps are gone). */
  const pruneJournal = (): void => {
    const referenced = (manifest: string): boolean =>
      ledger.manifestCount(manifest, 'hist') > 0 || ledger.manifestCount(manifest, 'other') > 0;
    for (const runtime of runtimes.values()) {
      journal.retain(runtime.id, (edge) => journal.isPinned(edge) || (referenced(edge.from) && referenced(edge.to)));
      runtime.releaseLineageIfIdle();
    }
  };

  // ---------- deferred work ----------

  const budgets = (): { readonly undo: number; readonly journal: number } => {
    const prefs = host?.app.prefs.getState().modeling;
    return {
      undo: (prefs?.undoBudgetMB ?? DEFAULT_UNDO_BUDGET_MB) * MB,
      journal: (prefs?.journalBudgetMB ?? DEFAULT_JOURNAL_BUDGET_MB) * MB,
    };
  };

  const usedBytes = (): number => ledger.historyOnlyBytes + journal.bytes + entrySelectionBytes + stepSelectionBytes();

  /** The budget check: drops the oldest history steps until the retained bytes fit (§5.20). */
  const enforceBudget = (): number => {
    reconcileHistory();
    pruneJournal();
    const limit = budgets();
    if (journal.cap(limit.journal) > 0) {
      for (const runtime of runtimes.values()) runtime.releaseLineageIfIdle();
    }
    const remaining = (): number => {
      const steps = historySteps();
      if (steps !== null) return steps.undo.length;
      if (host !== null) return host.app.history.canUndo() ? 1 : 0;
      return store.undo.entries().undo.length;
    };
    let dropped = 0;
    for (let guard = 0; guard < 4096 && usedBytes() > limit.undo && remaining() > 0; guard++) {
      if (host !== null) host.app.history.dropOldest(1);
      else store.undo.evictOldest(1);
      dropped++;
      reconcileHistory();
      pruneJournal();
    }
    if (dropped > 0 && !toasted) {
      toasted = true;
      (deps.notify ?? host?.app.services.notify)?.toast({ kind: 'info', text: BUDGET_TOAST });
    }
    return dropped;
  };

  const sweepNow = (): { freed: number; bytes: number } => {
    ledger.resolve();
    sweepWanted = false;
    lastSweepAt = clock.now();
    if (sweepTimer !== null) {
      clock.clearTimeout(sweepTimer);
      sweepTimer = null;
    }
    return blobs.sweep(ledger.reachable);
  };

  const runDeferred = (): void => {
    deferredQueued = false;
    if (disposed) return;
    enforceBudget();
    sweepWanted = true;
    const wait = lastSweepAt + SWEEP_INTERVAL_MS - clock.now();
    if (wait <= 0) sweepNow();
    else if (sweepTimer === null) {
      sweepTimer = clock.setTimeout(() => {
        sweepTimer = null;
        if (!disposed && sweepWanted) sweepNow();
      }, wait);
    }
  };

  /** Schedules the deferred check (never runs inside the current transaction, batch or emit loop). */
  const schedule = (): void => {
    if (deferredQueued || disposed) return;
    deferredQueued = true;
    clock.microtask(runDeferred);
  };

  // ---------- running ops ----------

  const readyRuntime = (id: MeshId): MeshRuntimeImpl => {
    const runtime = runtimes.get(id);
    if (runtime === undefined) throw new EkzaError('invalid-record', `No mesh runtime for ${id} (no record with data)`);
    if (runtime.state === 'loading') throw new EkzaError('mesh-loading', 'Mesh is loading');
    if (runtime.state === 'error') throw new EkzaError('blob-missing', runtime.error ?? 'Mesh data is missing');
    return runtime;
  };

  /** Brings a runtime to the ref the transaction sees (an earlier write of the same transaction, a failed commit). */
  const syncToTx = (tx: Tx | null, runtime: MeshRuntimeImpl): MeshRecord => {
    const record = (tx ?? store).get('meshes', runtime.id);
    if (record === undefined || record.data === null)
      throw new EkzaError('invalid-record', `No mesh record ${runtime.id}`);
    if (runtime.pending !== null && runtime.pending.to.manifest !== record.data.manifest) {
      runtime.revertPending();
    }
    if (runtime.current !== record.data.manifest) {
      runtime.ref = record.data;
      runtime.follow();
      touch(runtime);
      if (runtime.current !== record.data.manifest || runtime.state !== 'ready') {
        throw new EkzaError('mesh-loading', 'Mesh is loading');
      }
    }
    return record;
  };

  const settingsFor = (id: MeshId, settings: RunSettings | undefined) => {
    const symmetry =
      settings?.symmetry !== undefined && settings.symmetry !== null
        ? (settings.symmetry[id] ?? null)
        : symmetrySettings(id);
    const soft: SoftSelectSettings | null =
      settings?.soft !== undefined ? settings.soft : (host?.app.session.getState().model.softSelect ?? null);
    return { symmetry, soft };
  };

  const contextFor = (runtime: MeshRuntimeImpl, record: MeshRecord, mesh: EditMesh, settings?: RunSettings) => {
    const own = settingsFor(runtime.id, settings);
    const map = own.symmetry === null ? null : buildSymmetry(runtime, own.symmetry);
    const hidden = (() => {
      if (host === null) return null;
      try {
        return host.app.components.hidden(runtime.id);
      } catch {
        return null;
      }
    })();
    const curves = host === null ? null : internalsOf(host.app).deps.curves.engine;
    return buildOpContext({
      placement: worldPlacement(store, record),
      faceted: record.faceted,
      symmetry: map === null ? null : { map, preserveSeam: own.symmetry?.preserveSeam ?? true },
      soft: softContextOf(own.soft),
      hidden,
      curves: curves ?? DEFAULT_DEPS.curves.engine,
      mesh,
    });
  };

  /** The selection an op reads on a target, expanded by its symmetry map for 'expand' ops (§5.14). */
  const runSelection = (
    op: MeshOp,
    runtime: MeshRuntimeImpl,
    kind: ComponentKind | null,
    explicit: ReadonlyMap<MeshId, ComponentSelection> | undefined,
    symmetry: SymmetryMap | null,
  ): ComponentSelection | null => {
    if (op.kinds === 'object' && explicit?.get(runtime.id) === undefined) return null;
    const given = explicit?.get(runtime.id);
    const effectiveKind = kind ?? given?.kind ?? null;
    if (effectiveKind === null && given === undefined) return null;
    let sel = given ?? selectionFor(runtime.id, effectiveKind as ComponentKind);
    if (sel !== null && op.symmetry === 'expand' && symmetry !== null) {
      try {
        sel = (meshKernel() as MeshKernel).expandSelection(sel, symmetry);
      } catch (error) {
        if (!(error instanceof EkzaError)) throw error;
      }
    }
    return sel;
  };

  /** Runs `op` once on `mesh` in its own kernel transaction: the delta, or the refusal (log aborted). */
  const runOnce = (
    op: MeshOp,
    mesh: EditMesh,
    sel: ComponentSelection | null,
    args: ParamValues,
    ctx: ReturnType<typeof contextFor>,
  ): { readonly delta: MeshDelta | null; readonly result: OpResult | Refusal } => {
    const kernel = meshKernel() as MeshKernel;
    const verdict = op.poll(mesh, sel, ctx);
    if (verdict !== true) return { delta: null, result: verdict };
    mesh.begin(op.id);
    let result: OpResult | Refusal;
    try {
      result = op.run(mesh, sel, args, ctx);
    } catch (error) {
      mesh.abort();
      throw error;
    }
    if (kernel.isRefusal(result)) {
      mesh.abort();
      return { delta: null, result };
    }
    return { delta: mesh.end(), result };
  };

  interface Ran {
    readonly runtime: MeshRuntimeImpl;
    readonly record: MeshRecord;
    readonly wasOpen: boolean;
    readonly deltas: readonly MeshDelta[];
    readonly result: OpResult;
  }

  const revertRan = (ran: readonly Ran[]): void => {
    for (const r of ran) {
      const mesh = r.runtime.lineage;
      if (mesh === null) continue;
      for (let i = r.deltas.length - 1; i >= 0; i--) mesh.apply(r.deltas[i] as MeshDelta, 'backward');
      if (r.deltas.length > 0) r.runtime.noteChanged(dirtyOf(r.deltas), false);
      if (!r.wasOpen) r.runtime.close();
    }
  };

  const refusalError = (refusal: Refusal, id: MeshId): EkzaError =>
    new EkzaError('op-refused', refusal.reason, { code: refusal.code, mesh: id });

  // ---------- sessions ----------

  const sessionHost = {
    run(op: MeshOp, target: SessionTarget, args: ParamValues) {
      const runtime = target.runtime;
      const mesh = runtime.ensureLineage();
      const record = store.get('meshes', runtime.id) as MeshRecord;
      const ctx = contextFor(runtime, record, mesh);
      return runOnce(op, mesh, target.selection, args, ctx);
    },
    changed(target: SessionTarget, deltas: readonly MeshDelta[]) {
      target.runtime.noteChanged(dirtyOf(deltas), true);
    },
    ended(s: OpSession, how: 'cancel' | 'commit') {
      if (session === s) session = null;
      for (const target of s.targets) {
        target.runtime.previewing = false;
        if (how === 'cancel') {
          // A 'before-last' session undid the last op's edge: follow the committed ref again.
          target.runtime.follow();
          if (!target.wasOpen) target.runtime.close();
        }
      }
    },
  };

  // ---------- the registry ----------

  const unsubscribe = store.subscribe(onBatch);
  const unsubscribeUndo = store.undo.subscribe(schedule);
  const unsubscribeEvict = store.undo.onEvict(() => schedule());
  for (const record of store.list('meshes')) syncRecord(record.id, record, null);

  const registry: KernelMeshRuntimes = {
    get: (id) => runtimes.get(id),
    open(id: MeshId): MeshRuntime {
      const runtime = runtimes.get(id);
      if (runtime === undefined)
        throw new EkzaError('invalid-record', `No mesh runtime for ${id} (no record with data)`);
      runtime.open();
      return runtime;
    },
    close(id: MeshId): void {
      const runtime = runtimes.get(id);
      if (runtime === undefined || runtime.previewing) return;
      runtime.close();
    },
    list: () => [...runtimes.values()],

    beginOp(
      op: MeshOp,
      targets: readonly MeshId[],
      args: ParamValues,
      opts?: {
        readonly base?: 'current' | 'before-last';
        readonly selection?: ReadonlyMap<MeshId, ComponentSelection>;
      },
    ): MeshOpSession {
      requireKernel();
      if (session !== null && session.active) endSession('Another operation started');
      const base = opts?.base ?? 'current';
      const list: SessionTarget[] = [];
      try {
        for (const id of targets) {
          const runtime = readyRuntime(id);
          syncToTx(null, runtime);
          const wasOpen = runtime.isOpen;
          runtime.open();
          let undone: JournalEdge | null = null;
          if (base === 'before-last') {
            const edge =
              journal
                .pinnedEdges()
                .find((e) => e.mesh === id && e.to === runtime.current && e.lineage === runtime.lineage) ?? null;
            if (edge === null) throw new EkzaError('unsupported', 'Nothing to adjust on this mesh');
            runtime.previewing = true;
            runtime.applyEdge(edge, 'backward');
            undone = edge;
          }
          runtime.previewing = true;
          const kind = opts?.selection?.get(id)?.kind ?? null;
          const mode = host?.app.session.getState().model.componentMode ?? 'object';
          const selection = runSelection(
            op,
            runtime,
            kind ?? (mode === 'object' ? null : mode),
            opts?.selection,
            runtime.symmetry(),
          );
          list.push({
            runtime,
            wasOpen,
            undone,
            selection,
            deltas: [],
            result: { refused: true, code: 'pending', reason: '' },
          });
        }
      } catch (error) {
        for (const target of list) {
          target.runtime.previewing = false;
          target.runtime.follow();
          if (!target.wasOpen) target.runtime.close();
        }
        throw error;
      }
      const s = new OpSession(op, list, args, base, sessionHost);
      for (const target of list) {
        const { delta, result } = sessionHost.run(op, target, args);
        target.result = result;
        target.deltas = delta === null ? [] : [delta];
        if (delta !== null) target.runtime.noteChanged(delta.dirty, true);
      }
      session = s;
      return s;
    },
    get session(): MeshOpSession | null {
      return session !== null && session.active ? session : null;
    },

    commitOp(tx: Tx, op: MeshOp, targets: readonly MeshId[], args: ParamValues, ctx: CommitContext): MeshCommitResult {
      const kernel = requireKernel();
      if (targets.length === 0) throw new EkzaError('op-refused', 'Select components first');
      const ran: Ran[] = [];
      const s = session;
      if (
        s !== null &&
        s.active &&
        s.matches(op, targets, args) &&
        s.targets.every((t) => {
          const record = tx.get('meshes', t.runtime.id);
          return record?.data?.manifest === t.runtime.current;
        })
      ) {
        for (const target of s.take()) {
          ran.push({
            runtime: target.runtime,
            record: tx.get('meshes', target.runtime.id) as MeshRecord,
            wasOpen: target.wasOpen,
            deltas: target.deltas,
            result: target.result as OpResult,
          });
        }
      } else {
        if (s !== null && s.active) endSession('Another operation ran');
        const mode = host?.app.session.getState().model.componentMode ?? 'object';
        const kind = ctx.kind !== undefined ? ctx.kind : op.kinds === 'object' ? null : mode === 'object' ? null : mode;
        try {
          for (const id of targets) {
            const runtime = readyRuntime(id);
            const record = syncToTx(tx, runtime);
            const wasOpen = runtime.isOpen;
            const mesh = runtime.ensureLineage();
            const opCtx = contextFor(runtime, record, mesh, ctx.settings);
            const selection = runSelection(op, runtime, kind, ctx.selection, opCtx.symmetry?.map ?? null);
            const { delta, result } = runOnce(op, mesh, selection, args, opCtx);
            if (isRefusal(result)) {
              if (!wasOpen) runtime.close();
              throw refusalError(result, id);
            }
            const deltas = delta === null ? [] : [delta];
            ran.push({ runtime, record, wasOpen, deltas, result });
            if (delta !== null) runtime.noteChanged(delta.dirty, false);
          }
        } catch (error) {
          revertRan(ran);
          throw error;
        }
      }
      // Write the revisions (two-phase: pending until the batch confirms).
      const refs = new Map<MeshId, MeshRef>();
      const selection = new Map<MeshId, ComponentSelection>();
      const warnings: OpWarning[] = [];
      const pending: MeshRuntimeImpl[] = [];
      try {
        for (const r of ran) {
          const { runtime, record } = r;
          const previous = record.data as MeshRef;
          const dirty = dirtyOf(r.deltas);
          for (const warning of r.result.warnings) warnings.push(warning);
          selection.set(runtime.id, r.result.selection);
          if (isClean(dirty)) {
            refs.set(runtime.id, previous);
            continue;
          }
          const mesh = runtime.lineage as EditMesh;
          const data = mesh.snapshot();
          const out = kernel.writeRevision(data, {
            ...(runtime.manifest === null ? {} : { previous: runtime.manifest }),
            dirty,
          });
          if (out.manifestId === previous.manifest) {
            refs.set(runtime.id, previous);
            continue;
          }
          for (const [, bytes] of out.newChunks) blobs.put(bytes);
          blobs.put(out.manifestBytes);
          const ref: MeshRef = {
            manifest: out.manifestId,
            rev: previous.rev + 1,
            base: previous.manifest,
            joints: refJointsOf(record, data),
          };
          tx.patch('meshes', runtime.id, record.generator === null ? { data: ref } : { data: ref, generator: null });
          runtime.pending = {
            from: runtime.current as string,
            fromManifest: runtime.manifest,
            to: ref,
            toManifest: out.manifest,
            deltas: r.deltas,
            lineage: mesh,
            pin: true,
          };
          pending.push(runtime);
          runtime.hold(ref.manifest);
          runtime.manifest = out.manifest;
          runtime.cacheStored(data);
          refs.set(runtime.id, ref);
        }
      } catch (error) {
        for (const runtime of pending) {
          runtime.revertPending();
          runtime.follow();
        }
        revertRan(ran.filter((r) => !pending.includes(r.runtime)));
        throw error;
      }
      for (const r of ran) {
        touch(r.runtime);
        if (!r.wasOpen) r.runtime.close();
      }
      if (pending.length === 0) pinLastOp([]);
      lastSetOp = null;
      for (const [id, sel] of selection) storeSelection(id, sel);
      schedule();
      const resolvedArgs = ran[0]?.result.resolvedArgs ?? args;
      return { refs, selection, warnings, resolvedArgs };
    },

    commitSetOp(
      tx: Tx,
      op: MeshSetOp,
      inputs: readonly MeshId[],
      args: ParamValues,
      ctx: CommitContext,
    ): MeshSetCommitResult {
      const kernel = requireKernel();
      if (session !== null && session.active) endSession('Another operation ran');
      const mode = host?.app.session.getState().model.componentMode ?? 'object';
      const kind = ctx.kind !== undefined ? ctx.kind : mode === 'object' ? null : mode;
      const result = runSetOp({
        tx,
        kernel,
        op,
        inputs,
        args,
        seed: ctx.seed,
        kind,
        ...(ctx.selection === undefined ? {} : { selection: ctx.selection }),
        runtime: (id) => {
          const runtime = readyRuntime(id);
          syncToTx(tx, runtime);
          return runtime;
        },
        selectionFor: (id, k) => selectionFor(id, k),
        placement: (record) => worldPlacement(tx, record),
        storeRevision: (data, prior, joints) => registry.storeRevision(data, prior, joints),
      });
      for (const id of [...result.result.created, ...result.result.updated]) {
        const sel = result.selections.get(id);
        if (sel !== undefined && sel !== null) localSelections.set(id, sel);
      }
      pinLastOp([]);
      lastSetOp = { opId: op.id, inputs: result.preOp, outputs: result.outputKeys };
      for (const id of inputs) {
        const runtime = runtimes.get(id);
        if (runtime !== undefined) touch(runtime);
      }
      schedule();
      return result.result;
    },

    writeData(tx: Tx, id: MeshId, data: MeshData): MeshRef {
      requireKernel();
      const record = tx.get('meshes', id);
      if (record === undefined) throw new EkzaError('invalid-record', `writeData: no mesh record ${id}`);
      const ref = registry.storeRevision(data, record.data, refJointsOf(record, data));
      tx.patch('meshes', id, { data: ref });
      pinLastOp([]);
      const runtime = runtimes.get(id);
      if (runtime !== undefined) touch(runtime);
      schedule();
      return ref;
    },

    storeRevision(data: MeshData, prior?: MeshRef | null, joints?: readonly string[]): MeshRef {
      const kernel = requireKernel();
      const out = kernel.writeRevision(data);
      for (const [, bytes] of out.newChunks) blobs.put(bytes);
      blobs.put(out.manifestBytes);
      preloaded.set(out.manifestId, { data, manifest: out.manifest });
      if (!verifyQueued) {
        verifyQueued = true;
        clock.microtask(verify);
      }
      return {
        manifest: out.manifestId,
        rev: (prior?.rev ?? 0) + 1,
        base: prior?.manifest ?? null,
        joints: (joints ?? prior?.joints ?? []) as MeshRef['joints'],
      };
    },

    get journalBytes(): number {
      return journal.bytes;
    },
    get historyBytes(): number {
      reconcileHistory();
      return ledger.historyOnlyBytes;
    },
    get selectionBytes(): number {
      reconcileHistory();
      return entrySelectionBytes + stepSelectionBytes();
    },
    get lastSetOp(): LastSetOp | null {
      return lastSetOp;
    },
    lastOpEdges: () => journal.pinnedEdges().map((e) => ({ mesh: e.mesh, from: e.from, to: e.to })),
    localSelection: (mesh) => localSelections.get(mesh) ?? null,
    select: (mesh, sel) => storeSelection(mesh, sel),
    selectionFor,
    pollOp(op: MeshOp, targets: readonly MeshId[], kind: ComponentKind | null, settings?: RunSettings): true | Refusal {
      const s = session;
      if (s !== null && s.active && s.op.id === op.id && targets.every((id) => s.meshes.includes(id))) return true;
      for (const id of targets) {
        const runtime = runtimes.get(id);
        const record = store.get('meshes', id);
        const mesh = runtime?.lineage ?? null;
        if (runtime === undefined || record === undefined || mesh === null || runtime.state !== 'ready') continue;
        if (runtime.current !== record.data?.manifest) continue;
        const ctx = contextFor(runtime, record, mesh, settings);
        const selection = runSelection(op, runtime, kind, undefined, ctx.symmetry?.map ?? null);
        const verdict = op.poll(mesh, selection, ctx);
        if (verdict !== true) return verdict;
      }
      return true;
    },

    subscribe(listener: (id: MeshId, e: MeshRuntimeEvent) => void): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    pinBlobs(ids: readonly BlobId[]): Disposer {
      const pinned = [...ids];
      ledger.pin(pinned, 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        ledger.pin(pinned, -1);
        schedule();
      };
    },

    attach(app: EditorApp): void {
      if (host !== null || disposed) return;
      host = { app };
      hostDisposers.push(
        app.history.onDrop(() => schedule()),
        app.history.subscribe(() => schedule()),
      );
      // Symmetry settings now readable: open runtimes rebuild their maps on demand.
      schedule();
    },
    get attached(): boolean {
      return host !== null;
    },

    collect(): GcReport {
      deferredQueued = false;
      const dropped = enforceBudget();
      const { freed, bytes } = sweepNow();
      return { freed, bytes, dropped };
    },

    async settled(): Promise<void> {
      if (meshKernel() === null) await loadMeshKernel();
      for (let guard = 0; guard < 100; guard++) {
        await Promise.resolve();
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
        if (![...runtimes.values()].some((r) => r.state === 'loading')) return;
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (sweepTimer !== null) clock.clearTimeout(sweepTimer);
      unsubscribe();
      unsubscribeUndo();
      unsubscribeEvict();
      for (const d of hostDisposers.splice(0)) d();
      for (const runtime of runtimes.values()) runtime.dispose();
      runtimes.clear();
      listeners.clear();
      journal.clear();
      ledger.reset();
    },
  };
  return registry;
}
