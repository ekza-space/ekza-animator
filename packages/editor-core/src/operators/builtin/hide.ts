// Hide, show and isolate (M6A-SPEC §5.6 "Hide, show, isolate", §6.2; B10). Hiding is per-user session state: never in
// the document, cleared on a document load. With `undoSelection` (Model) hide and show record a "Hide"/"Show" step
// (a history `hide` part); isolate is U state.
//
// - `view.hide {target}`: in a component mode the faces the selection (of the current kind, its symmetry partners
//   included) touches, or every other visible face (`unselected`), on the hilited meshes; in object mode the selected
//   objects, or every mesh unrelated to the selection.
// - `view.showAll`: shows every hidden object and the hidden components of the hilited meshes (component mode) or of
//   every mesh (object mode).
// - `view.isolate {paneId?}`: toggles the pane's isolate set: the selected objects (object mode), the hilited meshes
//   (component modes) and in face mode only their selected faces.
import type { GroupId, MeshId } from '@ekza-animator/doc';
import type { BitSet, ComponentKind } from '@ekza-animator/mesh-core';
import { componentInternals } from '../../selection/component/service';
import { recordHide } from '../../selection/component/steps';
import type { EditorApp, HideSnapshot, OperatorContext, PollResult, SceneObjectId } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK, optionalArgs } from './define';
import { MODEL_ONLY_REASON } from './mode';
import { NOTHING_SELECTED } from './selectMesh';

const TARGETS = ['selected', 'unselected'] as const;

/** A live mesh or group record. */
function liveObject(app: EditorApp, id: string): boolean {
  const record = app.store.get('meshes', id as MeshId) ?? app.store.get('groups', id as GroupId);
  return record !== undefined && record.deleted === null;
}

function parentOf(app: EditorApp, id: string): string | null {
  const record = app.store.get('meshes', id as MeshId) ?? app.store.get('groups', id as GroupId);
  return record === undefined ? null : record.parent;
}

/** `id` and its ancestors (a cycle in a damaged document ends the walk). */
function lineage(app: EditorApp, id: string): string[] {
  const out: string[] = [];
  let at: string | null = id;
  while (at !== null && !out.includes(at)) {
    out.push(at);
    at = parentOf(app, at);
  }
  return out;
}

/** The hidden objects and the hidden components of `meshes`. */
function hideSnapshot(app: EditorApp, meshes: readonly MeshId[]): HideSnapshot {
  const internals = componentInternals(app.components);
  return {
    objects: [...app.session.getState().model.hiddenObjects],
    meshes: internals === null ? {} : internals.hiddenSnapshot(meshes),
  };
}

/** Visible selection of `kind` (the picks and their symmetry partners) on a hilited mesh, or null. */
function selectedSet(app: EditorApp, mesh: MeshId, kind: ComponentKind): BitSet | null {
  const internals = componentInternals(app.components);
  const sel = internals?.expanded(mesh, kind) ?? null;
  if (sel === null) return null;
  return kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
}

function modelPoll(ctx: OperatorContext): PollResult {
  return ctx.app.session.getState().workspace === 'model' ? OK : fail(MODEL_ONLY_REASON);
}

const hide = defineOperator({
  id: 'view.hide',
  label: 'Hide',
  description: 'Hides the selected (or unselected) objects or components.',
  category: 'view',
  scope: 'model',
  flags: { selection: true },
  extraArgs: ['target'],
  workspaces: ['model'],
  poll(ctx, args): PollResult {
    if (!isRecord(args) || !TARGETS.includes(args['target'])) {
      return fail('expects { target: selected | unselected }');
    }
    const ok = modelPoll(ctx);
    if (ok !== true || args['target'] === 'unselected') return ok;
    const state = ctx.app.session.getState();
    const mode = state.model.componentMode;
    if (mode === 'object')
      return state.selection.objects.some((id) => liveObject(ctx.app, id)) ? OK : fail(NOTHING_SELECTED);
    const any = state.model.hilite.some((mesh) => {
      const set = selectedSet(ctx.app, mesh, mode);
      return set !== null && !set.isEmpty();
    });
    return any ? OK : fail(NOTHING_SELECTED);
  },
  apply(ctx, args) {
    const app = ctx.app;
    const state = app.session.getState();
    const mode = state.model.componentMode;
    if (mode !== 'object') {
      const internals = componentInternals(app.components);
      if (internals === null) return;
      const meshes = state.model.hilite.filter((mesh) => (app.meshes.get(mesh)?.mesh ?? null) !== null);
      const before = hideSnapshot(app, meshes);
      internals.batch(() => {
        for (const mesh of meshes) {
          const set = selectedSet(app, mesh, mode);
          if (set === null) continue;
          if (args.target === 'selected' && set.isEmpty()) continue;
          internals.hide(mesh, mode, set, args.target);
        }
      });
      recordHide(app, 'Hide', before, hideSnapshot(app, meshes));
      return;
    }
    const before = hideSnapshot(app, []);
    const selected = state.selection.objects.filter((id) => liveObject(app, id));
    const hidden = new Set<SceneObjectId>(state.model.hiddenObjects);
    if (args.target === 'selected') {
      for (const id of selected) hidden.add(id);
    } else {
      // Everything unrelated to the selection: the selected objects, their ancestors and descendants stay.
      const keep = new Set<string>(selected.flatMap((id) => lineage(app, id)));
      const meshes = app.store.list('meshes').filter((mesh) => mesh.deleted === null);
      for (const mesh of meshes) {
        if (lineage(app, mesh.id).some((id) => selected.includes(id as SceneObjectId)) || keep.has(mesh.id)) continue;
        hidden.add(mesh.id);
      }
    }
    app.session.setState({ model: { ...app.session.getState().model, hiddenObjects: hidden } });
    recordHide(app, 'Hide', before, hideSnapshot(app, []));
  },
});

const showAll = defineOperator({
  id: 'view.showAll',
  label: 'Show All',
  description: 'Shows every hidden object and component.',
  category: 'view',
  scope: 'model',
  flags: { selection: true },
  workspaces: ['model'],
  poll: (ctx) => modelPoll(ctx),
  apply(ctx) {
    const app = ctx.app;
    const state = app.session.getState();
    const internals = componentInternals(app.components);
    const meshes =
      state.model.componentMode === 'object' ? app.meshes.list().map((runtime) => runtime.id) : [...state.model.hilite];
    const before = hideSnapshot(app, meshes);
    internals?.batch(() => {
      for (const mesh of meshes) internals.show(mesh);
    });
    if (state.model.hiddenObjects.size > 0) {
      app.session.setState({ model: { ...app.session.getState().model, hiddenObjects: new Set() } });
    }
    recordHide(app, 'Show', before, hideSnapshot(app, meshes));
  },
});

/** The pane `view.isolate` acts on: its argument, the run's pane, else the pane under the pointer. */
function isolatePane(ctx: OperatorContext, args: unknown): string | null {
  const explicit = optionalArgs(args)?.['paneId'];
  if (typeof explicit === 'string' && explicit !== '') return explicit;
  return ctx.paneId ?? ctx.app.session.getState().hoveredPanel?.paneId ?? null;
}

const isolate = defineOperator({
  id: 'view.isolate',
  label: 'Isolate Select',
  description: 'Shows only the selection in the pane.',
  category: 'view',
  scope: 'model',
  extraArgs: ['paneId'],
  workspaces: ['model'],
  poll(ctx, args): PollResult {
    if (optionalArgs(args) === null) return fail('expects { paneId? }');
    const ok = modelPoll(ctx);
    if (ok !== true) return ok;
    const pane = isolatePane(ctx, args);
    if (pane === null) return fail('no viewport pane');
    const state = ctx.app.session.getState();
    if ((state.model.isolate[pane] ?? null) !== null) return OK; // toggles off
    if (state.model.componentMode === 'object') {
      return state.selection.objects.some((id) => liveObject(ctx.app, id)) ? OK : fail(NOTHING_SELECTED);
    }
    return state.model.hilite.length > 0 ? OK : fail('Select a mesh first');
  },
  apply(ctx, args) {
    const app = ctx.app;
    const pane = isolatePane(ctx, args);
    if (pane === null) return;
    const state = app.session.getState();
    const internals = componentInternals(app.components);
    const isolates = { ...state.model.isolate };
    if ((isolates[pane] ?? null) !== null) {
      isolates[pane] = null;
      internals?.setFaceIsolate(pane, null);
      app.session.setState({ model: { ...state.model, isolate: isolates } });
      return;
    }
    const mode = state.model.componentMode;
    const objects: SceneObjectId[] =
      mode === 'object' ? state.selection.objects.filter((id) => liveObject(app, id)) : [...state.model.hilite];
    if (mode === 'face' && internals !== null) {
      const faces = new Map<MeshId, BitSet>();
      for (const mesh of state.model.hilite) {
        const set = selectedSet(app, mesh, 'face');
        if (set !== null && !set.isEmpty()) faces.set(mesh, set);
      }
      internals.setFaceIsolate(pane, faces.size === 0 ? null : faces);
    } else {
      internals?.setFaceIsolate(pane, null);
    }
    isolates[pane] = objects;
    app.session.setState({ model: { ...state.model, isolate: isolates } });
  },
});

export const HIDE_OPERATORS: readonly AnyOperator[] = [hide, showAll, isolate];

/** The objects a pane draws in Model (`paneObjects`, §4.8): live meshes not hidden, inside the pane's isolate set. */
export function objectsDrawnIn(app: EditorApp, paneId: string): SceneObjectId[] {
  const model = app.session.getState().model;
  const isolate = model.isolate[paneId] ?? null;
  const isolated = isolate === null ? null : new Set<string>(isolate);
  const out: SceneObjectId[] = [];
  for (const mesh of app.store.list('meshes')) {
    if (mesh.deleted !== null || mesh.data === null) continue;
    if ('character' in mesh.owner && app.session.getState().workspace !== 'model') continue;
    const chain = lineage(app, mesh.id);
    if (chain.some((id) => model.hiddenObjects.has(id as SceneObjectId))) continue;
    if (isolated !== null && !chain.some((id) => isolated.has(id))) continue;
    out.push(mesh.id);
  }
  return out;
}
