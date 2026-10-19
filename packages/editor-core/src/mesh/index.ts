// Mesh runtimes (M6A-SPEC §4.6, §5.5): B0a's stub registry over the reference kernel, owned by B7 after B0a.
//
// - The kernel is a lazy chunk (§2): `loadMeshKernel()` imports `@ekza-animator/mesh-core` on first need (a project
//   with mesh records, entering Model, a `mesh.*` run); until it resolves runtimes are 'loading'.
// - One runtime per live mesh record with `data` (§5.5 rule 8): its revision is read from resident blobs
//   (`BlobStore.peek`) through the kernel's revision codec; 'ready' then serves `data()`, triangulation and normals
//   whether the runtime is open or closed. A missing or unreadable blob puts the runtime in 'error'.
// - `open`/`close` build and drop edit links; `writeData` writes a whole new revision (blobs + the record's `data`
//   ref). Sessions, `commitOp` and `commitSetOp` are B7's: they throw `not-implemented` here.
import { type Disposer, EkzaError, type ParamValues } from '@ekza-animator/anim-core';
import {
  batchTables,
  type DocumentStore,
  type MeshId,
  type MeshRecord,
  type MeshRef,
  type Tx,
} from '@ekza-animator/doc';
import type * as MeshKernelModule from '@ekza-animator/mesh-core';
import type { MeshData, MeshOp, MeshSetOp, Normals, SymmetryMap, Triangulation } from '@ekza-animator/mesh-core';
import type {
  BlobStore,
  MeshCommitResult,
  MeshOpSession,
  MeshRuntime,
  MeshRuntimeEvent,
  MeshRuntimeRegistry,
  MeshRuntimeState,
  MeshSetCommitResult,
} from '../types';

/** The lazy kernel module (`@ekza-animator/mesh-core`). */
export type MeshKernel = typeof MeshKernelModule;

let kernel: MeshKernel | null = null;
let kernelLoad: Promise<MeshKernel> | null = null;

/** Loads the kernel chunk once (later calls share the promise). */
export function loadMeshKernel(): Promise<MeshKernel> {
  if (kernelLoad === null) {
    // oxlint-disable-next-line no-restricted-imports -- the one lazy kernel loader of editor-core (M6A-SPEC §2)
    kernelLoad = import('@ekza-animator/mesh-core').then((module) => {
      kernel = module;
      return module;
    });
  }
  return kernelLoad;
}

/** The kernel when its chunk has loaded, else null (callers poll-fail "Mesh tools are loading"). */
export function meshKernel(): MeshKernel | null {
  return kernel;
}

const notImplemented = (symbol: string): EkzaError =>
  new EkzaError('not-implemented', `editor-core.MeshRuntimeRegistry.${symbol}`);

class StubRuntime implements MeshRuntime {
  state: MeshRuntimeState = 'loading';
  error: string | null = null;
  ref: MeshRef | null;
  version = 0;
  isOpen = false;
  mesh: MeshKernelModule.EditMesh | null = null;
  private stored: MeshData | null = null;
  private tri: { readonly version: number; readonly value: Triangulation } | null = null;
  private norms: { readonly version: number; readonly value: Normals } | null = null;
  readonly listeners = new Set<(e: MeshRuntimeEvent) => void>();

  constructor(
    readonly id: MeshId,
    ref: MeshRef,
  ) {
    this.ref = ref;
  }

  data(): MeshData | null {
    return this.state === 'ready' ? this.stored : null;
  }

  triangulation(): Triangulation {
    const data = this.ready('triangulation');
    if (this.tri?.version !== this.version)
      this.tri = { version: this.version, value: (kernel as MeshKernel).triangulate(data) };
    return this.tri.value;
  }

  normals(): Normals {
    const data = this.ready('normals');
    if (this.norms?.version !== this.version) {
      this.norms = { version: this.version, value: (kernel as MeshKernel).computeNormals(data) };
    }
    return this.norms.value;
  }

  symmetry(): SymmetryMap | null {
    return null;
  }

  subscribe(listener: (e: MeshRuntimeEvent) => void): Disposer {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Loads `ref` from resident blobs (the kernel must be loaded). */
  load(blobs: BlobStore, k: MeshKernel): void {
    const ref = this.ref;
    if (ref === null) return;
    try {
      const manifestBytes = blobs.peek(ref.manifest);
      if (manifestBytes === undefined)
        throw new EkzaError('blob-missing', `Mesh data is missing (blob ${ref.manifest})`);
      const manifest = k.parseManifest(manifestBytes);
      const data = k.readRevision(manifest, (id) => {
        const bytes = blobs.peek(id);
        if (bytes === undefined) throw new EkzaError('blob-missing', `Mesh data is missing (blob ${id})`);
        return bytes;
      });
      this.stored = data;
      this.version++;
      this.error = null;
      this.mesh = this.isOpen ? k.editMeshFrom(data) : null;
      this.setState('ready');
      this.emit({ type: 'rebuilt' });
    } catch (error) {
      this.stored = null;
      this.mesh = null;
      this.error = error instanceof Error ? error.message : String(error);
      this.setState('error');
    }
  }

  setState(state: MeshRuntimeState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: 'state', state });
  }

  emit(e: MeshRuntimeEvent): void {
    for (const listener of Array.from(this.listeners)) listener(e);
  }

  private ready(what: string): MeshData {
    if (this.state !== 'ready' || this.stored === null || kernel === null) {
      throw new EkzaError('mesh-not-ready', `${what}: mesh ${this.id} is ${this.state}`);
    }
    return this.stored;
  }
}

export interface MeshRegistryDeps {
  readonly store: DocumentStore;
  readonly blobs: BlobStore;
  /** §3 rule 8: applied to the kernel when it loads (development and e2e builds). */
  readonly kernelDebug?: boolean;
  /** Called when a runtime's state or data changes (the host requests a frame). */
  readonly changed?: () => void;
}

export interface KernelMeshRuntimes extends MeshRuntimeRegistry {
  /** Resolves when the kernel is loaded and every runtime has left 'loading' (tests, the test API). */
  settled(): Promise<void>;
  dispose(): void;
}

export function createMeshRuntimeRegistry(deps: MeshRegistryDeps): KernelMeshRuntimes {
  const { store, blobs } = deps;
  const runtimes = new Map<MeshId, StubRuntime>();
  const listeners = new Set<(id: MeshId, e: MeshRuntimeEvent) => void>();
  let disposed = false;

  const forward = (runtime: StubRuntime): void => {
    runtime.subscribe((e) => {
      for (const listener of Array.from(listeners)) listener(runtime.id, e);
      deps.changed?.();
    });
  };

  const ensureKernel = (): void => {
    if (kernel !== null) return;
    void loadMeshKernel().then(
      (k) => {
        if (deps.kernelDebug === true) k.setKernelDebug(true);
        if (disposed) return;
        for (const runtime of runtimes.values()) if (runtime.state === 'loading') runtime.load(blobs, k);
      },
      (error: unknown) => {
        for (const runtime of runtimes.values()) {
          runtime.error = `Mesh tools could not load: ${error instanceof Error ? error.message : String(error)}`;
          runtime.setState('error');
        }
      },
    );
  };

  const sync = (): void => {
    const live = new Map<MeshId, MeshRecord>();
    for (const record of store.list('meshes')) if (record.data !== null) live.set(record.id, record);
    for (const [id, runtime] of runtimes) {
      if (live.has(id)) continue;
      runtimes.delete(id);
      runtime.listeners.clear();
    }
    for (const [id, record] of live) {
      const ref = record.data as MeshRef;
      let runtime = runtimes.get(id);
      if (runtime === undefined) {
        runtime = new StubRuntime(id, ref);
        runtimes.set(id, runtime);
        forward(runtime);
      } else if (runtime.ref?.manifest === ref.manifest) {
        runtime.ref = ref;
        continue;
      } else {
        runtime.ref = ref;
      }
      if (kernel === null) {
        runtime.setState('loading');
        ensureKernel();
      } else {
        runtime.load(blobs, kernel);
      }
    }
  };

  const unsubscribe = store.subscribe((batch) => {
    if (batch.origin === 'load' || batch.origin === 'preview' || batchTables(batch).has('meshes')) sync();
  });
  sync();

  const registry: KernelMeshRuntimes = {
    get: (id) => runtimes.get(id),
    open(id: MeshId): MeshRuntime {
      const runtime = runtimes.get(id);
      if (runtime === undefined)
        throw new EkzaError('invalid-record', `No mesh runtime for ${id} (no record with data)`);
      if (!runtime.isOpen) {
        runtime.isOpen = true;
        const data = runtime.data();
        if (data !== null && kernel !== null) runtime.mesh = kernel.editMeshFrom(data);
      }
      return runtime;
    },
    close(id: MeshId): void {
      const runtime = runtimes.get(id);
      if (runtime === undefined) return;
      runtime.isOpen = false;
      runtime.mesh = null;
    },
    list: () => [...runtimes.values()],
    beginOp(_op: MeshOp, _targets: readonly MeshId[], _args: ParamValues): MeshOpSession {
      throw notImplemented('beginOp');
    },
    session: null,
    commitOp(_tx: Tx, _op: MeshOp, _targets: readonly MeshId[], _args: ParamValues): MeshCommitResult {
      throw notImplemented('commitOp');
    },
    commitSetOp(_tx: Tx, _op: MeshSetOp, _inputs: readonly MeshId[], _args: ParamValues): MeshSetCommitResult {
      throw notImplemented('commitSetOp');
    },
    writeData(tx: Tx, id: MeshId, data: MeshData): MeshRef {
      const k = kernel;
      if (k === null) {
        ensureKernel();
        throw new EkzaError('mesh-loading', 'Mesh tools are loading');
      }
      const record = tx.get('meshes', id);
      if (record === undefined) throw new EkzaError('invalid-record', `writeData: no mesh record ${id}`);
      const out = k.writeRevision(data);
      for (const [, bytes] of out.newChunks) blobs.put(bytes);
      blobs.put(out.manifestBytes);
      const ref: MeshRef = {
        manifest: out.manifestId,
        rev: (record.data?.rev ?? 0) + 1,
        base: record.data?.manifest ?? null,
        joints: record.data?.joints ?? [],
      };
      tx.patch('meshes', id, { data: ref });
      return ref;
    },
    journalBytes: 0,
    subscribe(listener: (id: MeshId, e: MeshRuntimeEvent) => void): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async settled(): Promise<void> {
      if ([...runtimes.values()].some((runtime) => runtime.state === 'loading') || kernel === null) {
        await loadMeshKernel();
        await Promise.resolve();
      }
    },
    dispose(): void {
      disposed = true;
      unsubscribe();
      for (const runtime of runtimes.values()) runtime.listeners.clear();
      runtimes.clear();
      listeners.clear();
    },
  };
  return registry;
}
