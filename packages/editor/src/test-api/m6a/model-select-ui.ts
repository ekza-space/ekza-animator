// M6a test API, B10 group (M6A-SPEC §4.8): component modes, selections, picking positions, HUD, Mesh Check, panes.
// `model()` lists every mesh with a ready runtime: `selected` = the visible picks (with the current kind's pick order
// and active component), `expanded` = the picks plus their symmetry partners (what walkers and ops run on), `hidden`
// = the hidden components (the closure). `screenOf*` are page CSS px of components of hilited meshes in component
// modes (null when the pane does not draw them, they are occluded, off-screen or back-facing).
import type { MeshId } from '@ekza-studio/doc';
import { componentInternals, objectsDrawnIn } from '@ekza-studio/editor-core';
import type { BitSet, ComponentKind } from '@ekza-studio/mesh-core';
import { modelSelectOf } from '@ekza-studio/viewport';
import { checkRows, meshProblems } from '../../panels/meshcheck/checks';
import { hudData } from '../../panels/viewport/hud/data';
import type { EkzaAnimatorTestApi } from '../types';
import type { M6aTestApiContext } from './support';

export type ModelSelectUiTestApi = Pick<
  EkzaAnimatorTestApi,
  'model' | 'screenOfVertex' | 'screenOfEdge' | 'screenOfFace' | 'hud' | 'meshCheck' | 'paneObjects'
>;

const list = (set: BitSet): number[] => [...set.toArray()];

export function modelSelectUiTestApi(ctx: M6aTestApiContext): ModelSelectUiTestApi {
  const { app } = ctx.shell;

  const screenOf = (
    mesh: string,
    kind: ComponentKind,
    index: number,
    paneId: string,
    t?: number,
  ): { x: number; y: number } | null => {
    ctx.sync();
    const vm = ctx.shell.ui.getState().viewport;
    const runtime = modelSelectOf(app);
    const rect = vm?.paneRect(paneId) ?? null;
    if (runtime === null || rect === null) return null;
    const point = runtime.screenOf(mesh as MeshId, kind, index, paneId, t ?? 0.5);
    return point === null ? null : { x: rect.x + point.x, y: rect.y + point.y };
  };

  return {
    model() {
      ctx.sync();
      const state = app.session.getState();
      const model = state.model;
      const kind: ComponentKind = model.componentMode === 'object' ? model.lastComponentMode : model.componentMode;
      const internals = componentInternals(app.components);
      const selected: ReturnType<EkzaAnimatorTestApi['model']>['selected'] = {};
      const expanded: ReturnType<EkzaAnimatorTestApi['model']>['expanded'] = {};
      const hidden: ReturnType<EkzaAnimatorTestApi['model']>['hidden'] = {};
      for (const runtime of app.meshes.list()) {
        if (runtime.state !== 'ready') continue;
        const id = runtime.id;
        try {
          const sel = (k: ComponentKind) => app.components.get(id, k);
          const current = sel(kind);
          selected[id] = {
            vertex: list(sel('vertex').verts),
            edge: list(sel('edge').edges),
            face: list(sel('face').faces),
            active: current.active,
            order: current.order === null ? [] : [...current.order],
          };
          const grown = (k: ComponentKind): number[] => {
            const value = internals?.expanded(id, k) ?? null;
            if (value === null) return [];
            return list(k === 'vertex' ? value.verts : k === 'edge' ? value.edges : value.faces);
          };
          expanded[id] = { vertex: grown('vertex'), edge: grown('edge'), face: grown('face') };
          const h = app.components.hidden(id);
          hidden[id] = { vertex: list(h.verts), edge: list(h.edges), face: list(h.faces) };
        } catch {
          // A mesh without readable state (kernel loading) is left out.
        }
      }
      const isolate: Record<string, string[] | null> = {};
      for (const [pane, ids] of Object.entries(model.isolate)) isolate[pane] = ids === null ? null : [...ids];
      return {
        mode: model.componentMode,
        hilite: [...model.hilite],
        selected,
        expanded,
        hidden,
        hiddenObjects: [...model.hiddenObjects],
        isolate,
        style: model.selectionStyle,
        cameraBased: model.cameraBased,
      };
    },
    screenOfVertex: (mesh, v, paneId) => screenOf(mesh, 'vertex', v, paneId),
    screenOfEdge: (mesh, e, paneId, t) => screenOf(mesh, 'edge', e, paneId, t),
    screenOfFace: (mesh, f, paneId) => screenOf(mesh, 'face', f, paneId),
    hud(paneId) {
      ctx.sync();
      const vm = ctx.shell.ui.getState().viewport;
      if (vm === null || vm.paneState(paneId) === null) return null;
      const data = hudData(app, paneId);
      if (data === null) return null;
      return {
        mode: data.mode,
        scene: { ...data.scene },
        object: { ...data.object },
        selected: { ...data.selected },
        selectedSym: { ...data.selectedSym },
        budget: { tris: data.budget.tris, limit: data.budget.limit, state: data.budget.state },
      };
    },
    meshCheck(mesh) {
      ctx.sync();
      return checkRows(meshProblems(app, mesh as MeshId) ?? []).map((row) => ({
        code: row.code,
        count: row.count,
        elements: [...row.elements],
      }));
    },
    paneObjects(paneId) {
      ctx.sync();
      return [...objectsDrawnIn(app, paneId)];
    },
  };
}
