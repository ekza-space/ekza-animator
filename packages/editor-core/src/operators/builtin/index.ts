// Built-in contributions (MVP-SPEC §7 WP-7b, ADR 0008): every §4.9 operator owned by WP-7b, the importers,
// exporters, export profiles, menu items and the `maya` keymap — registered through the same registries extensions
// use, explicitly (nothing registers on import).
import type { Disposer } from '@ekza-animator/anim-core';
import { BUILTIN_EXPORT_PROFILES } from '@ekza-animator/io';
import { MAYA_KEYMAP } from '../../keymap/maya';
import type { EditorApp } from '../../types';
import { AUTOSAVE_OPERATORS } from './autosave';
import { BREAKDOWN_OPERATORS } from './breakdown';
import { CLIP_OPERATORS } from './clip';
import type { AnyOperator } from './define';
import { EDIT_OPERATORS } from './edit';
import { BUILTIN_EXPORTERS } from './exporters';
import { FILE_OPERATORS } from './file';
import { GRAPH_OPERATORS } from './graph';
import { GRAPH_BUFFER_OPERATORS } from './graphBuffer';
import { IK_OPERATORS } from './ik';
import { BUILTIN_IMPORTERS } from './importers';
import { KEY_OPERATORS } from './key';
import { BUILTIN_MENU_ITEMS } from './menus';
import { MIRROR_ANIMATION_OPERATORS } from './mirrorAnimation';
import { POSE_OPERATORS } from './pose';
import { RIG_OPERATORS } from './rig';
import { SELECT_OPERATORS } from './select';
import { TIME_OPERATORS } from './time';
import { TWEEN_OPERATORS } from './tween';
import { VIEW_OPERATORS } from './view';
// M6a (M6A-SPEC §6; B0a registers every new operator from its stub file)
import { CREATE_OPERATORS } from './create';
import { EXPORT_MODEL_OPERATORS } from './exportModel';
import { EXTRUDE_SESSION_OPERATORS } from './extrudeSession';
import { HIDE_OPERATORS } from './hide';
import { IMAGE_PLANE_OPERATORS } from './imagePlane';
import { KEYMAP_SHADOW_OPERATORS } from './keymapShadows';
import { LASTOP_OPERATORS } from './lastop';
import { MAKE_EDITABLE_OPERATORS } from './makeEditable';
import { MESH_OPERATORS } from './mesh';
import { MODE_OPERATORS } from './mode';
import { PALETTE_OPERATORS } from './palette';
import { PIVOT_OPERATORS } from './pivot';
import { SCENE_OPERATORS } from './scene';
import { SELECT_MESH_OPERATORS } from './selectMesh';
import { SNAP_OPERATORS } from './snap';
import { SOFT_SELECT_OPERATORS } from './softSelect';
import { SYMMETRY_OPERATORS } from './symmetry';
import { TEMPLATE_OPERATORS } from './templates';
import { WORKSPACE_OPERATORS } from './workspace';
import { registerBuiltinWorkspaces } from '../../workspaces';
import { bindCapture } from '../../edit/capture';
import { attachLastRunTracker } from './lastop';

export { BUILTIN_EXPORTERS, BUILTIN_IMPORTERS, BUILTIN_MENU_ITEMS };

/** Every built-in operator definition (§4.9 rows owned by WP-7b, plus the operators other packages requested). */
export const BUILTIN_OPERATORS: readonly AnyOperator[] = [
  ...FILE_OPERATORS,
  ...EDIT_OPERATORS,
  ...SELECT_OPERATORS,
  ...KEY_OPERATORS,
  ...POSE_OPERATORS,
  ...TIME_OPERATORS,
  ...GRAPH_OPERATORS,
  ...CLIP_OPERATORS,
  ...VIEW_OPERATORS,
  ...RIG_OPERATORS,
  // M2a (M2A-SPEC §3 rule 2: new operators live in new files; A0 registers their stubs here)
  ...IK_OPERATORS,
  ...TWEEN_OPERATORS,
  ...BREAKDOWN_OPERATORS,
  ...GRAPH_BUFFER_OPERATORS,
  ...MIRROR_ANIMATION_OPERATORS,
  ...AUTOSAVE_OPERATORS,
  // M6a (M6A-SPEC §6.1, §6.2)
  ...MESH_OPERATORS,
  ...WORKSPACE_OPERATORS,
  ...MODE_OPERATORS,
  ...SELECT_MESH_OPERATORS,
  ...HIDE_OPERATORS,
  ...SYMMETRY_OPERATORS,
  ...SOFT_SELECT_OPERATORS,
  ...SNAP_OPERATORS,
  ...PIVOT_OPERATORS,
  ...EXTRUDE_SESSION_OPERATORS,
  ...LASTOP_OPERATORS,
  ...KEYMAP_SHADOW_OPERATORS,
  ...CREATE_OPERATORS,
  ...TEMPLATE_OPERATORS,
  ...PALETTE_OPERATORS,
  ...IMAGE_PLANE_OPERATORS,
  ...SCENE_OPERATORS,
  ...MAKE_EDITABLE_OPERATORS,
  ...EXPORT_MODEL_OPERATORS,
];

function disposeAll(disposers: Disposer[]): Disposer {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const dispose of disposers.reverse()) dispose();
  };
}

/** Registers the built-in operators; ids already registered (by the host or an extension) are left as they are. */
export function registerBuiltinOperators(app: EditorApp): Disposer {
  const disposers: Disposer[] = [];
  for (const def of BUILTIN_OPERATORS) {
    if (app.operators.get(def.id) !== undefined) continue;
    disposers.push(app.contribute({ kind: 'operator', def }));
  }
  return disposeAll(disposers);
}

/** Operators, importers, exporters, BUILTIN_EXPORT_PROFILES, menu items, MAYA_KEYMAP and (M6a) workspaces. */
export function registerBuiltins(app: EditorApp): Disposer {
  // M6a (B11): the numeric capture window binds to the app up front (tools arm the capture before any operator runs;
  // the binding loads the B11 runtime chunk on the first Model entry); the Last-op card's tracker binds once that chunk
  // has loaded (the LastRun recorder loads it).
  attachLastRunTracker(app, false);
  bindCapture(app);
  const disposers: Disposer[] = [registerBuiltinOperators(app), registerBuiltinWorkspaces(app)];
  for (const def of BUILTIN_IMPORTERS) {
    if (app.importers.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'importer', def }));
  }
  for (const def of BUILTIN_EXPORTERS) {
    if (app.exporters.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'exporter', def }));
  }
  for (const def of BUILTIN_EXPORT_PROFILES) {
    if (app.exportProfiles.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'exportProfile', def }));
  }
  for (const def of BUILTIN_MENU_ITEMS) {
    if (app.menus.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'menu', def }));
  }
  disposers.push(app.contribute({ kind: 'keymap', bindings: MAYA_KEYMAP }));
  return disposeAll(disposers);
}
