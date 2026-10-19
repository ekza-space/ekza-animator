// One mesh runtime (M6A-SPEC §4.6 `MeshRuntime`, §5.5): the content of one live mesh record with `data`.
//
// - **Content** is the revision `current` (a manifest id): its stored form `stored` (MeshData) and/or an EditMesh
//   instance (`lineage`). The lineage is the open mesh while `isOpen`; after `close()` it stays as a dormant instance
//   while the journal holds edges recorded on it, so undo, redo and `edit.adjustLast` keep the O(|delta|) path and a
//   reopen is instant (M6A-B7-3). `data()` is the stored form of the content (a lazy snapshot of the lineage).
// - **Following the ref** (undo, redo, remote, load): through a journal edge on the lineage when one joins the two
//   revisions, else by a rebuild from resident chunks (synchronous), else by loading the chunks (`BlobStore.get`,
//   async: state 'loading'; a missing or corrupt blob: 'error').
// - **Two-phase** (`pending`): a commit changes the content before its transaction ends; the batch that carries the
//   new ref confirms it (the journal edge is recorded then), anything else reverts it, so the runtime never
//   diverges from the committed ref.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { MeshId, MeshRef } from '@ekza-animator/doc';
import type {
  ComponentSelection,
  DirtySet,
  EditMesh,
  MeshData,
  MeshDelta,
  Normals,
  RevisionManifest,
  SymmetryMap,
  Triangulation,
} from '@ekza-animator/mesh-core';
import type { BlobId, BlobStore, MeshRuntime, MeshRuntimeEvent, MeshRuntimeState } from '../types';
import { ALL_DIRTY, CLEAN, dirtyOf, mergeDirty, trianglesDirty } from './dirty';
import type { OpInput } from './input';
import type { JournalEdge, MeshJournal } from './journal';
import type { MeshKernel } from './kernel';
import type { BlobLedger } from './ledger';

/** What a runtime needs from its registry. */
export interface RuntimeEnv {
  readonly blobs: BlobStore;
  readonly journal: MeshJournal;
  readonly ledger: BlobLedger;
  kernel(): MeshKernel | null;
  /** Revisions this registry wrote in this process, before their batch arrives (no chunk read needed). */
  preloaded(manifest: BlobId): { readonly data: MeshData; readonly manifest: RevisionManifest } | undefined;
  /** A change of any runtime (the host requests a frame). */
  changed(runtime: MeshRuntimeImpl, e: MeshRuntimeEvent): void;
  /** Symmetry map for the runtime's current settings (null: off, B2 not landed, or not readable). */
  symmetry(runtime: MeshRuntimeImpl): SymmetryMap | null;
}

/** A commit whose transaction has not completed yet (§5.5 rule 3). */
export interface PendingCommit {
  readonly from: BlobId;
  readonly fromManifest: RevisionManifest | null;
  readonly to: MeshRef;
  readonly toManifest: RevisionManifest;
  readonly deltas: readonly MeshDelta[];
  readonly lineage: EditMesh;
  /** Pinned as the last op's edge once confirmed. */
  readonly pin: boolean;
  /** What the op read on this mesh and the selection it left (copies kept on the journal edge). */
  readonly input: OpInput | null;
  readonly output: ComponentSelection | null;
}

const missingMessage = (id: string): string => `Mesh data is missing (blob ${id})`;

export class MeshRuntimeImpl implements MeshRuntime {
  state: MeshRuntimeState = 'loading';
  error: string | null = null;
  ref: MeshRef | null;
  version = 0;
  isOpen = false;
  /** Manifest the content reflects (without a session's preview). */
  current: BlobId | null = null;
  manifest: RevisionManifest | null = null;
  lineage: EditMesh | null = null;
  stored: MeshData | null = null;
  pending: PendingCommit | null = null;
  /** True while a preview session has changed the content (the registry's session sets it). */
  previewing = false;
  disposed = false;
  private loadToken = 0;
  private storedVersion = -1;
  private tri: { version: number; value: Triangulation } | null = null;
  private triDirty: Uint32Array | 'all' = 'all';
  private norms: { version: number; value: Normals } | null = null;
  private normDirty: DirtySet = ALL_DIRTY;
  private sym: { key: string; value: SymmetryMap | null } | null = null;
  readonly listeners = new Set<(e: MeshRuntimeEvent) => void>();

  constructor(
    readonly id: MeshId,
    ref: MeshRef,
    private readonly env: RuntimeEnv,
  ) {
    this.ref = ref;
  }

  // ---------- MeshRuntime ----------

  get mesh(): EditMesh | null {
    return this.isOpen && this.state === 'ready' ? this.lineage : null;
  }

  data(): MeshData | null {
    if (this.state !== 'ready') return null;
    if (this.lineage !== null && (this.stored === null || this.storedVersion !== this.version)) {
      this.stored = this.lineage.snapshot();
      this.storedVersion = this.version;
    }
    return this.stored;
  }

  triangulation(): Triangulation {
    const source = this.source('triangulation');
    if (this.tri?.version === this.version) return this.tri.value;
    const kernel = this.env.kernel() as MeshKernel;
    const value =
      this.tri !== null && this.triDirty !== 'all'
        ? kernel.triangulate(source, this.tri.value, this.triDirty)
        : kernel.triangulate(source);
    this.tri = { version: this.version, value };
    this.triDirty = new Uint32Array(0);
    return value;
  }

  normals(): Normals {
    const source = this.source('normals');
    if (this.norms?.version === this.version) return this.norms.value;
    const kernel = this.env.kernel() as MeshKernel;
    const value =
      this.norms !== null && !this.normDirty.topology
        ? kernel.computeNormals(source, this.norms.value, this.normDirty)
        : kernel.computeNormals(source);
    this.norms = { version: this.version, value };
    this.normDirty = CLEAN;
    return value;
  }

  symmetry(): SymmetryMap | null {
    if (this.state !== 'ready') return null;
    return this.env.symmetry(this);
  }

  subscribe(listener: (e: MeshRuntimeEvent) => void): Disposer {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------- registry side ----------

  /** The EditMesh for `id` (open or dormant), built from the stored form when there is none. */
  ensureLineage(): EditMesh {
    if (this.lineage !== null) return this.lineage;
    const kernel = this.env.kernel();
    const data = this.stored;
    if (kernel === null || data === null || this.state !== 'ready') {
      throw new EkzaError('mesh-not-ready', `Mesh ${this.id} is ${this.state}`);
    }
    this.lineage = kernel.editMeshFrom(data);
    return this.lineage;
  }

  open(): void {
    this.isOpen = true;
    if (this.state === 'ready') this.ensureLineage();
  }

  /** Drops edit links: the instance stays dormant while journal edges were recorded on it (M6A-B7-3). */
  close(): void {
    this.isOpen = false;
    this.sym = null;
    this.releaseLineageIfIdle();
  }

  /** Drops a dormant lineage no journal edge or pending commit needs (after a close or a journal eviction). */
  releaseLineageIfIdle(): void {
    if (this.isOpen || this.lineage === null || this.pending !== null || this.previewing) return;
    if (this.env.journal.holds(this.id, this.lineage)) return;
    if (this.storedVersion !== this.version || this.stored === null) {
      this.stored = this.lineage.snapshot();
      this.storedVersion = this.version;
    }
    this.lineage = null;
  }

  /** Content changed by `deltas` (already applied to the lineage). */
  noteChanged(dirty: DirtySet, preview: boolean): void {
    this.version++;
    this.stored = null;
    this.storedVersion = -1;
    if (this.lineage !== null) {
      const faces = trianglesDirty(this.lineage, dirty);
      this.triDirty = faces === 'all' || this.triDirty === 'all' ? 'all' : mergeFaces(this.triDirty, faces);
    } else {
      this.triDirty = 'all';
    }
    this.normDirty = mergeDirty(this.normDirty, dirty);
    if (dirty.topology) this.sym = null;
    this.emit({ type: 'changed', dirty, preview });
  }

  /** Sets the content to a revision read whole (rebuild, load, writeData). Drops the lineage and its edges. */
  setRebuilt(manifestId: BlobId, manifest: RevisionManifest, data: MeshData): void {
    const kernel = this.env.kernel() as MeshKernel;
    if (this.lineage !== null) this.env.journal.retain(this.id, (edge) => edge.lineage !== this.lineage);
    this.hold(manifestId);
    this.manifest = manifest;
    this.stored = data;
    this.lineage = this.isOpen ? kernel.editMeshFrom(data) : null;
    this.version++;
    this.storedVersion = this.version;
    this.tri = null;
    this.triDirty = 'all';
    this.norms = null;
    this.normDirty = ALL_DIRTY;
    this.sym = null;
    this.error = null;
    this.setState('ready');
    this.emit({ type: 'rebuilt' });
  }

  /** Moves the ledger hold from the previous content revision to `manifest`. */
  hold(manifest: BlobId | null): void {
    if (this.current === manifest) return;
    if (this.current !== null) this.env.ledger.ref(this.current, 'other', -1);
    this.current = manifest;
    if (manifest !== null) this.env.ledger.ref(manifest, 'other', 1);
  }

  /**
   * Makes the content equal `ref` (the committed one): nothing when it already does, a journal edge on the lineage,
   * a synchronous rebuild from resident (or preloaded) blobs, else an asynchronous load.
   */
  follow(): void {
    const ref = this.ref;
    const kernel = this.env.kernel();
    // A session's preview and a commit in flight are ahead of the ref on purpose: they settle it themselves.
    if (ref === null || this.disposed || this.previewing || this.pending !== null) return;
    if (kernel === null) {
      this.setState('loading');
      return;
    }
    if (this.current === ref.manifest && this.state === 'ready') return;
    if (this.state === 'ready' && this.lineage !== null && this.current !== null) {
      const edge = this.env.journal.find(this.id, this.current, ref.manifest, this.lineage);
      if (edge !== null && this.applyEdge(edge, edge.from === this.current ? 'forward' : 'backward')) return;
    }
    const pre = this.env.preloaded(ref.manifest);
    if (pre !== undefined) {
      this.loadToken++;
      this.loading = null;
      this.setRebuilt(ref.manifest, pre.manifest, pre.data);
      return;
    }
    const resident = this.readResident(kernel, ref.manifest);
    if (resident !== null) {
      this.loadToken++;
      this.loading = null;
      if ('error' in resident) this.fail(resident.error);
      else this.setRebuilt(ref.manifest, resident.manifest, resident.data);
      return;
    }
    void this.load(kernel, ref.manifest);
  }

  /** Applies a journal edge (forward: from → to). False when the lineage refused it (the caller rebuilds). */
  applyEdge(edge: JournalEdge, dir: 'forward' | 'backward'): boolean {
    const lineage = this.lineage as EditMesh;
    const deltas = dir === 'forward' ? edge.deltas : [...edge.deltas].reverse();
    try {
      for (const delta of deltas) lineage.apply(delta, dir);
    } catch {
      this.env.journal.retain(this.id, (e) => e.lineage !== lineage);
      this.lineage = null;
      return false;
    }
    const target = dir === 'forward' ? edge.to : edge.from;
    this.hold(target);
    this.manifest = this.revisionManifest(target);
    this.noteChanged(dirtyOf(edge.deltas), false);
    return true;
  }

  /** The parsed manifest of a resident revision (null when its bytes are not resident). */
  revisionManifest(id: BlobId): RevisionManifest | null {
    const pre = this.env.preloaded(id);
    if (pre !== undefined) return pre.manifest;
    const bytes = this.env.blobs.peek(id);
    const kernel = this.env.kernel();
    if (bytes === undefined || kernel === null) return null;
    try {
      return kernel.parseManifest(bytes);
    } catch {
      return null;
    }
  }

  /** Confirms the pending commit: its batch carried the new ref (§5.5 rule 3). Returns the journal edge. */
  confirm(): JournalEdge | null {
    const pending = this.pending;
    if (pending === null) return null;
    this.pending = null;
    if (pending.deltas.length === 0) return null;
    return this.env.journal.add(this.id, pending.from, pending.to.manifest, pending.deltas, pending.lineage, {
      input: pending.input,
      output: pending.output,
    });
  }

  /** Reverts the pending commit (its transaction aborted). */
  revertPending(): void {
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    if (this.lineage === pending.lineage) {
      for (let i = pending.deltas.length - 1; i >= 0; i--)
        pending.lineage.apply(pending.deltas[i] as MeshDelta, 'backward');
      this.hold(pending.from);
      this.manifest = pending.fromManifest;
      this.noteChanged(dirtyOf(pending.deltas), false);
      this.releaseLineageIfIdle();
    } else {
      // The content no longer descends from the commit: forget it; the caller follows the committed ref.
      this.hold(null);
      this.lineage = null;
      this.stored = null;
    }
  }

  /** Caches a stored form of the current content (a commit's snapshot). */
  cacheStored(data: MeshData): void {
    this.stored = data;
    this.storedVersion = this.version;
  }

  /** True while an asynchronous load is in flight. */
  get isLoading(): boolean {
    return this.loading !== null;
  }

  setState(state: MeshRuntimeState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
  }

  emit(e: MeshRuntimeEvent): void {
    for (const listener of Array.from(this.listeners)) listener(e);
    this.env.changed(this, e);
  }

  dispose(): void {
    this.disposed = true;
    this.loadToken++;
    this.pending = null;
    this.hold(null);
    this.env.journal.drop(this.id);
    this.lineage = null;
    this.stored = null;
    this.listeners.clear();
  }

  /** Symmetry cache (the registry computes the value; the key covers settings, placement and version). */
  cachedSymmetry(key: string, build: () => SymmetryMap | null): SymmetryMap | null {
    if (this.sym?.key === key) return this.sym.value;
    const value = build();
    this.sym = { key, value };
    return value;
  }

  // ---------- internals ----------

  private source(what: string): EditMesh | MeshData {
    if (this.state !== 'ready' || this.env.kernel() === null) {
      throw new EkzaError('mesh-not-ready', `${what}: mesh ${this.id} is ${this.state}`);
    }
    if (this.lineage !== null) return this.lineage;
    if (this.stored === null) throw new EkzaError('mesh-not-ready', `${what}: mesh ${this.id} has no data`);
    return this.stored;
  }

  private fail(message: string): void {
    this.hold(null);
    this.stored = null;
    this.lineage = null;
    this.manifest = null;
    this.error = message;
    this.version++;
    this.setState('error');
  }

  /** Reads a revision from resident blobs; null when a blob is not resident (load it). */
  private readResident(
    kernel: MeshKernel,
    id: BlobId,
  ): { readonly manifest: RevisionManifest; readonly data: MeshData } | { readonly error: string } | null {
    const bytes = this.env.blobs.peek(id);
    if (bytes === undefined) return null;
    let manifest: RevisionManifest;
    try {
      manifest = kernel.parseManifest(bytes);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    for (const chunk of kernel.manifestChunkIds(manifest)) if (!this.env.blobs.has(chunk)) return null;
    try {
      const data = kernel.readRevision(manifest, (chunk) => {
        const out = this.env.blobs.peek(chunk);
        if (out === undefined) throw new EkzaError('blob-missing', missingMessage(chunk));
        return out;
      });
      return { manifest, data };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Loads a revision through `BlobStore.get` (sources, verification); 'loading' until it resolves. */
  private async load(kernel: MeshKernel, id: BlobId): Promise<void> {
    if (this.loading === id) return;
    const token = ++this.loadToken;
    this.loading = id;
    this.setState('loading');
    try {
      const manifestBytes = await this.env.blobs.get(id).catch((error: unknown) => {
        throw new EkzaError('blob-missing', missingMessage(id), { cause: String(error) });
      });
      const manifest = kernel.parseManifest(manifestBytes);
      const ids = kernel.manifestChunkIds(manifest);
      const chunks = new Map<string, Uint8Array>();
      await Promise.all(
        [...new Set(ids)].map(async (chunk) => {
          try {
            chunks.set(chunk, await this.env.blobs.get(chunk));
          } catch (error) {
            const code = error instanceof EkzaError ? error.code : 'blob-missing';
            throw new EkzaError(
              code,
              code === 'blob-corrupt' ? `Mesh data is corrupt (blob ${chunk})` : missingMessage(chunk),
            );
          }
        }),
      );
      if (token !== this.loadToken || this.disposed) return;
      this.loading = null;
      const data = kernel.readRevision(manifest, (chunk) => chunks.get(chunk) as Uint8Array);
      // Keep what was read resident (a sweep may have run meanwhile): the ledger holds it from now on.
      if (!this.env.blobs.has(id)) this.env.blobs.put(manifestBytes);
      for (const [chunk, bytes] of chunks) if (!this.env.blobs.has(chunk)) this.env.blobs.put(bytes);
      if (this.ref?.manifest !== id) {
        this.follow();
        return;
      }
      this.setRebuilt(id, manifest, data);
    } catch (error) {
      if (token !== this.loadToken || this.disposed) return;
      this.loading = null;
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  /** The revision an asynchronous load is reading (null when none). */
  private loading: BlobId | null = null;
}

function mergeFaces(a: Uint32Array, b: Uint32Array): Uint32Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return Uint32Array.from([...new Set([...a, ...b])].sort((x, y) => x - y));
}
