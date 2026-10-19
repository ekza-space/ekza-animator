// Component selection service (M6A-SPEC §4.6, §5.6): B0a's stub, owned by B10.
//
// The stub stores no component selections: reads return empty selections of the mesh's current revision (through the
// lazy kernel), `snapshot` describes the object-level state, `restore`/`restoreHidden` report every mesh as skipped,
// and the writers throw `EkzaError('not-implemented')` until B10 lands the service.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import type { ComponentKind, ComponentSelection, HiddenSet } from '@ekza-animator/mesh-core';
import { meshKernel } from '../mesh';
import type {
  ComponentSelectionService,
  HideSnapshot,
  MeshRuntimeRegistry,
  SelectionSnapshot,
  SessionStore,
} from '../types';

export interface ComponentSelectionDeps {
  readonly session: SessionStore;
  readonly meshes: () => MeshRuntimeRegistry;
}

const notImplemented = (symbol: string): EkzaError =>
  new EkzaError('not-implemented', `editor-core.ComponentSelectionService.${symbol}`);

export function createComponentSelectionService(deps: ComponentSelectionDeps): ComponentSelectionService {
  const listeners = new Set<(version: number) => void>();

  const empty = (mesh: MeshId, kind: ComponentKind): ComponentSelection => {
    const kernel = meshKernel();
    const data = deps.meshes().get(mesh)?.data() ?? null;
    if (kernel === null || data === null) throw new EkzaError('mesh-not-ready', `No mesh data for ${mesh} yet`);
    return kernel.selectionOf(kind, [], data.counts);
  };

  const modeKind = (): ComponentKind => {
    const model = deps.session.getState().model;
    return model.componentMode === 'object' ? model.lastComponentMode : model.componentMode;
  };

  return {
    version: 0,
    get: (mesh, kind) => empty(mesh, kind ?? modeKind()),
    set() {
      throw notImplemented('set');
    },
    apply() {
      throw notImplemented('apply');
    },
    clear() {
      // Nothing is stored.
    },
    hidden(mesh): HiddenSet {
      const sel = empty(mesh, 'vertex');
      return { verts: sel.verts, edges: sel.edges, faces: sel.faces };
    },
    setHidden() {
      throw notImplemented('setHidden');
    },
    snapshot(meshes?: readonly MeshId[]): SelectionSnapshot {
      const state = deps.session.getState();
      return {
        controls: [...state.selection.controls],
        objects: [...state.selection.objects],
        componentMode: state.model.componentMode,
        hilite: [...(meshes ?? state.model.hilite)],
        meshes: {},
      };
    },
    restore: (snapshot: SelectionSnapshot) => ({ skipped: Object.keys(snapshot.meshes) as MeshId[] }),
    restoreHidden: (snapshot: HideSnapshot) => ({ skipped: Object.keys(snapshot.meshes) as MeshId[] }),
    remap() {
      throw notImplemented('remap');
    },
    subscribe(listener: (version: number) => void): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
