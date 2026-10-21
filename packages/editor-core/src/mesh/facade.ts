// The eager facade of the mesh runtime registry (M6A-SPEC §2, §4.6; B7). `app.meshes` exists from the first frame, but
// everything that edits, follows or collects mesh data lives in the lazy implementation (impl.ts) that
// `loadMeshKernel()` loads with the kernel. Until then the facade keeps one **handle** per live mesh record with
// `data` in state 'loading' (and starts the load), remembers `open` intents, pinned autosave blobs and the attached
// app, and refuses edits with "Mesh tools are loading". Once loaded it delegates; handles stay the same objects (they
// forward to the implementation's runtimes), so a subscriber of a handle sees 'loading' → 'ready' like any change.
import { type Disposer, EkzaError, type ParamValues } from '@ekza-studio/anim-core';
import { type ChangeBatch, type MeshId, type MeshRef, type Tx } from '@ekza-studio/doc';
import type {
  ComponentKind,
  ComponentSelection,
  EditMesh,
  MeshData,
  MeshOp,
  MeshSetOp,
  Normals,
  Refusal,
  SymmetryMap,
  Triangulation,
} from '@ekza-studio/mesh-core';
import type {
  BlobId,
  EditorApp,
  MeshCommitResult,
  MeshOpSession,
  MeshRuntime,
  MeshRuntimeEvent,
  MeshRuntimeState,
  MeshSetCommitResult,
} from '../types';
import type { RunSettings } from './context';
import { loadMeshKernel, meshImpl, whenMeshKernelLoaded } from './kernel';
import type { CommitContext, GcReport, KernelMeshRuntimes, LastSetOp, MeshRegistryDeps } from './shared';

const loading = (): EkzaError => new EkzaError('mesh-loading', 'Mesh tools are loading');

/** A stable `MeshRuntime` for callers: 'loading' until the implementation's runtime is bound, then forwarding. */
class RuntimeHandle implements MeshRuntime {
  private bound: MeshRuntime | null = null;
  private unbind: Disposer | null = null;
  /** The record's ref while no runtime is bound. */
  recordRef: MeshRef | null;
  opened = false;
  readonly listeners = new Set<(e: MeshRuntimeEvent) => void>();

  constructor(
    readonly id: MeshId,
    ref: MeshRef,
    private readonly forward: (id: MeshId, e: MeshRuntimeEvent) => void,
  ) {
    this.recordRef = ref;
  }

  get ref(): MeshRef | null {
    return this.bound === null ? this.recordRef : this.bound.ref;
  }

  bind(runtime: MeshRuntime): void {
    this.unbind?.();
    this.bound = runtime;
    this.unbind = runtime.subscribe((e) => this.emit(e));
    // Whatever the implementation reached while binding is news for the handle's subscribers.
    if (runtime.state !== 'loading') this.emit({ type: 'state', state: runtime.state });
    if (runtime.state === 'ready') this.emit({ type: 'rebuilt' });
  }

  detach(): void {
    this.unbind?.();
    this.unbind = null;
  }

  emit(e: MeshRuntimeEvent): void {
    for (const listener of Array.from(this.listeners)) listener(e);
    this.forward(this.id, e);
  }

  get state(): MeshRuntimeState {
    return this.bound?.state ?? 'loading';
  }
  get error(): string | null {
    return this.bound?.error ?? null;
  }
  get isOpen(): boolean {
    return this.bound?.isOpen ?? this.opened;
  }
  get mesh(): EditMesh | null {
    return this.bound?.mesh ?? null;
  }
  get version(): number {
    return this.bound?.version ?? 0;
  }
  data(): MeshData | null {
    return this.bound?.data() ?? null;
  }
  triangulation(): Triangulation {
    if (this.bound === null) throw new EkzaError('mesh-not-ready', `triangulation: mesh ${this.id} is loading`);
    return this.bound.triangulation();
  }
  normals(): Normals {
    if (this.bound === null) throw new EkzaError('mesh-not-ready', `normals: mesh ${this.id} is loading`);
    return this.bound.normals();
  }
  symmetry(): SymmetryMap | null {
    return this.bound?.symmetry() ?? null;
  }
  subscribe(listener: (e: MeshRuntimeEvent) => void): Disposer {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function createMeshRuntimeRegistry(deps: MeshRegistryDeps): KernelMeshRuntimes {
  const { store } = deps;
  const handles = new Map<MeshId, RuntimeHandle>();
  const listeners = new Set<(id: MeshId, e: MeshRuntimeEvent) => void>();
  /** Autosave pins taken before the implementation loaded: moved into it on load. */
  const earlyPins = new Map<symbol, { readonly ids: readonly BlobId[]; release: Disposer | null }>();
  let impl: KernelMeshRuntimes | null = null;
  let app: EditorApp | null = null;
  let disposed = false;

  const forward = (id: MeshId, e: MeshRuntimeEvent): void => {
    for (const listener of Array.from(listeners)) listener(id, e);
    deps.changed?.();
  };

  /** Handles for the live records with data (before the implementation loads). */
  const syncHandles = (): void => {
    const live = new Set<MeshId>();
    for (const record of store.list('meshes')) {
      if (record.data === null) continue;
      live.add(record.id);
      const existing = handles.get(record.id);
      if (existing === undefined) handles.set(record.id, new RuntimeHandle(record.id, record.data, forward));
      else existing.recordRef = record.data;
    }
    for (const id of handles.keys()) if (!live.has(id)) handles.delete(id);
    if (handles.size > 0) void loadMeshKernel().catch(() => {});
  };

  const bindImpl = (): void => {
    const implModule = meshImpl();
    if (impl !== null || disposed || implModule === null) return;
    unsubscribe();
    // The facade's handles forward runtime events and request frames; the implementation does not do it twice.
    const { changed: _changed, ...rest } = deps;
    impl = implModule.createMeshRuntimeImpl({
      ...rest,
      created(runtime) {
        let handle = handles.get(runtime.id);
        if (handle === undefined) {
          handle = new RuntimeHandle(runtime.id, runtime.ref as MeshRef, forward);
          handles.set(runtime.id, handle);
        }
        handle.bind(runtime);
      },
      disposed(id) {
        handles.get(id)?.detach();
        handles.delete(id);
      },
    });
    // Records that disappeared before the load never got a runtime.
    for (const [id, handle] of handles) {
      if (impl.get(id) === undefined) {
        handle.detach();
        handles.delete(id);
      } else if (handle.opened) impl.open(id);
    }
    if (app !== null) impl.attach(app);
    for (const pin of earlyPins.values()) {
      pin.release?.();
      pin.release = impl.pinBlobs(pin.ids);
    }
  };

  const unsubscribe = store.subscribe((batch: ChangeBatch) => {
    if (impl === null && (batch.origin === 'load' || batch.changes.some((change) => change.table === 'meshes'))) {
      syncHandles();
    }
  });
  syncHandles();
  const stopWaiting = whenMeshKernelLoaded(bindImpl);

  const current = (): KernelMeshRuntimes | null => {
    if (impl === null) bindImpl();
    return impl;
  };
  const required = (): KernelMeshRuntimes => {
    const it = current();
    if (it === null) {
      void loadMeshKernel().catch(() => {});
      throw loading();
    }
    return it;
  };

  return {
    get: (id) => handles.get(id),
    open(id: MeshId): MeshRuntime {
      const handle = handles.get(id);
      if (handle === undefined)
        throw new EkzaError('invalid-record', `No mesh runtime for ${id} (no record with data)`);
      const it = current();
      if (it === null) handle.opened = true;
      else it.open(id);
      return handle;
    },
    close(id: MeshId): void {
      const handle = handles.get(id);
      if (handle !== undefined) handle.opened = false;
      current()?.close(id);
    },
    list: () => [...handles.values()],
    beginOp(
      op: MeshOp,
      targets: readonly MeshId[],
      args: ParamValues,
      opts?: {
        readonly base?: 'current' | 'before-last';
        readonly selection?: ReadonlyMap<MeshId, ComponentSelection>;
      },
    ): MeshOpSession {
      return required().beginOp(op, targets, args, opts);
    },
    get session(): MeshOpSession | null {
      return impl?.session ?? null;
    },
    commitOp: (
      tx: Tx,
      op: MeshOp,
      targets: readonly MeshId[],
      args: ParamValues,
      ctx: CommitContext,
    ): MeshCommitResult => required().commitOp(tx, op, targets, args, ctx),
    commitSetOp: (
      tx: Tx,
      op: MeshSetOp,
      inputs: readonly MeshId[],
      args: ParamValues,
      ctx: CommitContext,
    ): MeshSetCommitResult => required().commitSetOp(tx, op, inputs, args, ctx),
    writeData: (tx: Tx, id: MeshId, data: MeshData): MeshRef => required().writeData(tx, id, data),
    storeRevision: (data: MeshData, prior?: MeshRef | null, joints?: readonly string[]): MeshRef =>
      required().storeRevision(data, prior, joints),
    get journalBytes(): number {
      return impl?.journalBytes ?? 0;
    },
    get historyBytes(): number {
      return impl?.historyBytes ?? 0;
    },
    get selectionBytes(): number {
      return impl?.selectionBytes ?? 0;
    },
    get lastSetOp(): LastSetOp | null {
      return impl?.lastSetOp ?? null;
    },
    lastOpEdges: () => impl?.lastOpEdges() ?? [],
    localSelection: (mesh: MeshId) => impl?.localSelection(mesh) ?? null,
    select: (mesh: MeshId, sel: ComponentSelection) => required().select(mesh, sel),
    selectionFor: (mesh: MeshId, kind: ComponentKind) => current()?.selectionFor(mesh, kind) ?? null,
    pollOp: (
      op: MeshOp,
      targets: readonly MeshId[],
      kind: ComponentKind | null,
      settings?: RunSettings,
    ): true | Refusal => current()?.pollOp(op, targets, kind, settings) ?? true,
    subscribe(listener: (id: MeshId, e: MeshRuntimeEvent) => void): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pinBlobs(ids: readonly BlobId[]): Disposer {
      const it = current();
      if (it !== null) return it.pinBlobs(ids);
      const key = Symbol('pin');
      const pin = { ids: [...ids], release: null as Disposer | null };
      earlyPins.set(key, pin);
      return () => {
        earlyPins.delete(key);
        pin.release?.();
        pin.release = null;
      };
    },
    attach(next: EditorApp): void {
      if (app !== null || disposed) return;
      app = next;
      current()?.attach(next);
    },
    get attached(): boolean {
      return app !== null;
    },
    collect(): GcReport {
      return current()?.collect() ?? { freed: 0, bytes: 0, dropped: 0 };
    },
    reconcile(): void {
      impl?.reconcile();
    },
    async settled(): Promise<void> {
      await loadMeshKernel();
      bindImpl();
      await impl?.settled();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopWaiting();
      unsubscribe();
      impl?.dispose();
      for (const handle of handles.values()) handle.detach();
      handles.clear();
      listeners.clear();
      earlyPins.clear();
    },
  };
}
