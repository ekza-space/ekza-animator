// `app.components`, eager side (M6A-SPEC §4.6, §5.27; M6A-INT-14). B10's component selection service
// (`./service`, with its state and topology helpers) loads with the mesh kernel: every component selection belongs to
// a mesh runtime, and no runtime is ready before the kernel has loaded. The facade answers what the service would
// with no mesh ready — reads of a mesh throw `mesh-not-ready` (as for a mesh whose data has not loaded), nothing is
// stored, snapshots carry the object-level state, restores skip every mesh — and creates the service the moment the
// kernel chunk resolves (before the runtimes report ready, so the service follows them from the start). From then on
// every call, the subscriptions and `componentInternals` reach the service.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import { componentServiceModule, whenMeshKernelLoaded } from '../../mesh/kernel';
import type {
  ComponentSelectionService,
  HideSnapshot,
  MeshRuntimeRegistry,
  SelectionSnapshot,
  SessionStore,
} from '../../types';

/** The symbol `componentInternals` reads (a registered symbol: the service module defines the same one). */
const INTERNALS = Symbol.for('ekza.componentSelection.internals');

export interface ComponentSelectionFacadeDeps {
  readonly session: SessionStore;
  readonly meshes: () => MeshRuntimeRegistry;
}

export function createComponentSelectionFacade(deps: ComponentSelectionFacadeDeps): ComponentSelectionService {
  const listeners = new Set<(version: number) => void>();
  let service: ComponentSelectionService | null = null;

  const create = (): ComponentSelectionService | null => {
    if (service !== null) return service;
    const loadedModule = componentServiceModule();
    if (loadedModule === null) return null;
    const created = loadedModule.createComponentSelectionService(deps);
    service = created;
    created.subscribe((version) => {
      for (const listener of Array.from(listeners)) listener(version);
    });
    return created;
  };
  whenMeshKernelLoaded(() => {
    create();
  });

  /** The service, or the error it would give before any runtime is ready (no runtime: a caller error). */
  const loaded = (mesh: MeshId): ComponentSelectionService => {
    const current = create();
    if (current !== null) return current;
    if (deps.meshes().get(mesh) === undefined) throw new EkzaError('invalid-record', `No mesh runtime for ${mesh}`);
    throw new EkzaError('mesh-not-ready', 'Mesh tools are loading');
  };

  const facade: ComponentSelectionService & { readonly [INTERNALS]: unknown } = {
    get version() {
      return create()?.version ?? 0;
    },
    get: (mesh, kind) => loaded(mesh).get(mesh, kind),
    set: (mesh, sel) => loaded(mesh).set(mesh, sel),
    apply: (mesh, kind, indices, mode) => loaded(mesh).apply(mesh, kind, indices, mode),
    clear(mesh) {
      create()?.clear(mesh);
    },
    hidden: (mesh) => loaded(mesh).hidden(mesh),
    setHidden: (mesh, hidden) => loaded(mesh).setHidden(mesh, hidden),
    snapshot(meshes?: readonly MeshId[]): SelectionSnapshot {
      const current = create();
      if (current !== null) return current.snapshot(meshes);
      const state = deps.session.getState();
      return {
        controls: [...state.selection.controls],
        objects: [...state.selection.objects],
        componentMode: state.model.componentMode,
        hilite: [...(meshes ?? state.model.hilite)],
        meshes: {},
      };
    },
    restore(snapshot: SelectionSnapshot) {
      const current = create();
      return current !== null ? current.restore(snapshot) : { skipped: Object.keys(snapshot.meshes) as MeshId[] };
    },
    restoreHidden(snapshot: HideSnapshot) {
      const current = create();
      return current !== null ? current.restoreHidden(snapshot) : { skipped: Object.keys(snapshot.meshes) as MeshId[] };
    },
    remap: (mesh, remap) => loaded(mesh).remap(mesh, remap),
    subscribe(listener: (version: number) => void): Disposer {
      create();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get [INTERNALS]() {
      const current = create();
      return current === null ? undefined : (current as unknown as Record<symbol, unknown>)[INTERNALS];
    },
  };
  return facade;
}
