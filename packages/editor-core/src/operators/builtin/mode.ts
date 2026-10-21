// Component modes and hilite (M6A-SPEC §5.6, §6.2; B10). Modes are U state, never undo steps.
//
// - `select.mode {mode}`: 'vertex' | 'edge' | 'face' enter that mode on the hilite set; the active mode's digit again
//   returns to object mode (`1`/`2`/`3`, the Industry Compatible habit) while F9/F10, menus and scripts are idempotent;
//   'toggle' (F8) switches between object mode and the last component mode; 'object' returns to object mode.
// - Entering from object mode hilites the selected meshes; with none selected the mesh under the pointer (the press
//   point of the RMB mode menu, else the hover point), else it refuses with "Select a mesh first". The RMB mode menu on
//   another mesh adds that mesh to the hilite set. Over a character's glTF mesh without a record (the RMB menu's press
//   point, or the hover point when nothing else is a candidate) it refuses with "Make editable first" and the Outliner
//   action (§5.6, §5.21).
// - Returning to object mode makes the hilited meshes the object selection (one "Select" step when that changes it);
//   `session.model.hilite` keeps the list (not drawn) for the Last-op card's comparison (§5.7).
// - A mode switch ends an open extrude session without a zero-drop (§5.8); with `convertOnModeSwitch` the selection
//   converts to the new kind (touching).
import { EkzaError } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import type { ComponentKind } from '@ekza-studio/mesh-core';
import { meshKernel } from '../../mesh';
import { componentInternals } from '../../selection/component/service';
import { modelPointer } from '../../selection/component/probes';
import { selectionGesture } from '../../selection/component/steps';
import type { ComponentMode, EditorApp, OperatorContext, PollResult } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';

const MODES: readonly (ComponentMode | 'toggle')[] = ['object', 'vertex', 'edge', 'face', 'toggle'];
const HILITE_MODES = ['add', 'replace', 'remove'] as const;

/** Why component modes cannot be used outside Model. */
export const MODEL_ONLY_REASON = 'Component modes are in the Model workspace';
/** `select.mode` without a mesh to hilite (§5.6). */
export const SELECT_A_MESH_FIRST = 'Select a mesh first';
/** A glTF mesh of a character without a record (§5.21). */
export const MAKE_EDITABLE_FIRST = 'Make editable first';
/** `select.mode` over a character's glTF mesh without a record: the reason and the Outliner action (§5.6). */
export const MAKE_EDITABLE_HINT = `${MAKE_EDITABLE_FIRST}: use Make editable on its Outliner row`;

/** A live mesh record with data and a runtime that is not in error: it can be hilited. */
export function isEditableMesh(app: Pick<EditorApp, 'store' | 'meshes'>, id: string): boolean {
  const record = app.store.get('meshes', id as MeshId);
  if (record === undefined || record.deleted !== null || record.data === null) return false;
  const runtime = app.meshes.get(id as MeshId);
  return runtime !== undefined && runtime.state !== 'error';
}

/** The selected objects that are editable meshes, in selection order. */
export function selectedMeshes(app: Pick<EditorApp, 'store' | 'meshes' | 'session'>): MeshId[] {
  return app.session
    .getState()
    .selection.objects.filter((id) => isEditableMesh(app, id))
    .map((id) => id as MeshId);
}

/** The pane a run refers to: its own, else the one under the pointer. */
function paneOf(ctx: OperatorContext): string | null {
  return ctx.paneId ?? ctx.app.session.getState().hoveredPanel?.paneId ?? null;
}

/** The editable mesh under the pointer: the RMB menu's press point for marking-menu runs, else the hover point. */
function pointerMesh(ctx: OperatorContext, at: 'press' | 'hover'): MeshId | null {
  const mesh = modelPointer(ctx.app)?.meshAt(paneOf(ctx), at) ?? null;
  return mesh !== null && isEditableMesh(ctx.app, mesh) ? mesh : null;
}

/** Whether a character's glTF mesh without a record (and no record's mesh) is under the pointer (§5.6). */
function pointerAsset(ctx: OperatorContext, at: 'press' | 'hover'): boolean {
  return modelPointer(ctx.app)?.assetMeshAt?.(paneOf(ctx), at) === true;
}

/** The meshes a component mode entered from object mode hilites (empty: none to hilite). */
function enteringHilite(ctx: OperatorContext): MeshId[] {
  const selected = selectedMeshes(ctx.app);
  const pressed = ctx.source === 'marking-menu' ? pointerMesh(ctx, 'press') : null;
  if (pressed !== null && !selected.includes(pressed)) return [...selected, pressed];
  if (selected.length > 0) return selected;
  const hovered = pointerMesh(ctx, 'hover');
  return hovered === null ? [] : [hovered];
}

/** Whether a keyboard run came from a digit (`1`/`2`/`3`: again → object), not from F9/F10 (idempotent). */
function fromDigit(ctx: OperatorContext): boolean {
  if (ctx.source !== 'keyboard') return false;
  const key = modelPointer(ctx.app)?.lastKey() ?? null;
  return key === null || key.startsWith('Digit') || key.startsWith('Numpad');
}

/** The mode a `select.mode` run switches to. */
export function targetMode(ctx: OperatorContext, mode: ComponentMode | 'toggle'): ComponentMode {
  const model = ctx.app.session.getState().model;
  if (mode === 'toggle') return model.componentMode === 'object' ? model.lastComponentMode : 'object';
  if (mode !== 'object' && mode === model.componentMode && fromDigit(ctx)) return 'object';
  return mode;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Converts the hilited meshes' selection from `from` to `to` (touching), when the kernel's walkers are available. */
function convertOnSwitch(app: EditorApp, meshes: readonly MeshId[], from: ComponentKind, to: ComponentKind): void {
  const kernel = meshKernel();
  const internals = componentInternals(app.components);
  if (kernel === null || internals === null) return;
  internals.batch(() => {
    for (const id of meshes) {
      const runtime = app.meshes.get(id);
      const sel = internals.expanded(id, from);
      if (runtime?.mesh === null || runtime?.mesh === undefined || sel === null) continue;
      try {
        internals.store(id, kernel.convertSelection(runtime.mesh, sel, to, 'touching', app.components.hidden(id)), to);
      } catch (error) {
        if (!(error instanceof EkzaError) || error.code !== 'not-implemented') throw error;
      }
    }
  });
}

const selectMode = defineOperator({
  id: 'select.mode',
  label: 'Selection Mode',
  description: 'Switches between object mode and the vertex, edge and face component modes.',
  category: 'select',
  scope: 'model',
  extraArgs: ['mode'],
  workspaces: ['model'],
  poll(ctx, args): PollResult {
    if (!isRecord(args) || !MODES.includes(args['mode'] as ComponentMode)) {
      return fail(`expects { mode: ${MODES.join(' | ')} }`);
    }
    const state = ctx.app.session.getState();
    if (state.workspace !== 'model') return fail(MODEL_ONLY_REASON);
    const next = targetMode(ctx, args['mode']);
    if (next === 'object') return OK;
    // The RMB mode menu opened over a character's glTF mesh that is not made editable: it cannot be hilited.
    const menu = ctx.source === 'marking-menu';
    if (menu && pointerMesh(ctx, 'press') === null && pointerAsset(ctx, 'press')) return fail(MAKE_EDITABLE_HINT);
    if (state.model.componentMode !== 'object' || enteringHilite(ctx).length > 0) return OK;
    return !menu && pointerAsset(ctx, 'hover') ? fail(MAKE_EDITABLE_HINT) : fail(SELECT_A_MESH_FIRST);
  },
  apply(ctx, args) {
    const app = ctx.app;
    const state = app.session.getState();
    const model = state.model;
    const current = model.componentMode;
    const next = targetMode(ctx, args.mode);
    const pressed = current !== 'object' && ctx.source === 'marking-menu' ? pointerMesh(ctx, 'press') : null;
    const addPressed = pressed !== null && !model.hilite.includes(pressed);
    if (next === current && !addPressed) return;
    if (next !== current && app.extrude.state !== null) app.extrude.end('mode', { drop: false });
    if (next === 'object') {
      const objects = model.hilite.filter((id) => isEditableMesh(app, id));
      const apply = (): void => {
        const s = app.session.getState();
        app.session.setState({
          model: {
            ...s.model,
            componentMode: 'object',
            lastComponentMode: current === 'object' ? s.model.lastComponentMode : current,
          },
        });
        if (!sameIds(objects, s.selection.objects) && objects.length > 0) {
          app.session.setState({ selection: { ...app.session.getState().selection, objects } });
        }
      };
      selectionGesture(app, 'objects', {}, apply);
      return;
    }
    const hilite = current === 'object' ? enteringHilite(ctx) : addPressed ? [...model.hilite, pressed] : model.hilite;
    app.session.setState({
      model: { ...app.session.getState().model, componentMode: next, lastComponentMode: next, hilite },
    });
    if (current !== 'object' && current !== next && app.prefs.getState().modeling.convertOnModeSwitch) {
      convertOnSwitch(app, hilite, current, next);
    }
  },
});

const hilite = defineOperator({
  id: 'model.hilite',
  label: 'Hilite Meshes',
  description: 'Adds, replaces or removes the meshes whose components are edited.',
  category: 'model',
  scope: 'model',
  extraArgs: ['meshes', 'mode'],
  workspaces: ['model'],
  flags: { internal: true },
  poll(ctx, args): PollResult {
    if (
      !isRecord(args) ||
      !Array.isArray(args['meshes']) ||
      !(args['meshes'] as unknown[]).every((id) => typeof id === 'string') ||
      !HILITE_MODES.includes(args['mode'])
    ) {
      return fail('expects { meshes, mode: add | replace | remove }');
    }
    if (ctx.app.session.getState().workspace !== 'model') return fail(MODEL_ONLY_REASON);
    if (args['mode'] === 'remove') return OK;
    for (const id of args['meshes'] as string[]) if (!isEditableMesh(ctx.app, id)) return fail(MAKE_EDITABLE_FIRST);
    return OK;
  },
  apply(ctx, args) {
    const model = ctx.app.session.getState().model;
    const ids = [...new Set(args.meshes)];
    let next: MeshId[];
    if (args.mode === 'replace') next = ids;
    else if (args.mode === 'add') next = [...model.hilite.filter((id) => !ids.includes(id)), ...ids];
    else next = model.hilite.filter((id) => !ids.includes(id));
    if (sameIds(next, model.hilite)) return;
    ctx.app.session.setState({ model: { ...model, hilite: next } });
  },
});

export const MODE_OPERATORS: readonly AnyOperator[] = [selectMode, hilite];
