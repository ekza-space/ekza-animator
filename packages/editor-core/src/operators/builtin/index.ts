// Built-in contributions (MVP-SPEC §7 WP-7b, ADR 0008): every §4.9 operator owned by WP-7b, the importers,
// exporters, export profiles, menu items and the `maya` keymap — registered through the same registries extensions
// use, explicitly (nothing registers on import).
import type { Disposer } from '@ekza-studio/anim-core';
import { BUILTIN_EXPORT_PROFILES } from '@ekza-studio/io';
import { MAYA_KEYMAP } from '../../keymap/maya';
import { RIG_SHADOW_KEYMAP } from '../../keymap/maya.rig';
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
// M6a (M6A-SPEC §6; B0a registers every new operator from its stub file). The Model-only operators are proxies until
// their chunk loads on the first Model entry (`./modelOps`, M6A-INT-13); the others are eager.
import { bindExtrude, EXTRUDE_SESSION_OPERATORS } from './extrudeSession';
import { KEYMAP_SHADOW_OPERATORS } from './keymapShadows';
import { LASTOP_OPERATORS } from './lastop';
import { loadModelOperators, MODEL_OPERATOR_PROXIES, modelOperatorExtras, whenModelOperatorsLoaded } from './modelOps';
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
  // M6a (M6A-SPEC §6.1, §6.2): the proxies' groups keep the order the eager operators had (`MODEL_OPERATOR_GROUPS`)
  ...MODEL_OPERATOR_PROXIES.mesh,
  ...WORKSPACE_OPERATORS,
  ...MODEL_OPERATOR_PROXIES.select,
  ...EXTRUDE_SESSION_OPERATORS,
  ...LASTOP_OPERATORS,
  ...KEYMAP_SHADOW_OPERATORS,
  ...MODEL_OPERATOR_PROXIES.content,
  // M-AI: the explicit-target operators register lazily (`agentChunk.ts`, MCP-SPEC §0.4).
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
  for (const def of [...BUILTIN_OPERATORS, ...modelOperatorExtras()]) {
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
  // M6a (B12b): the extrude session binds up front too (its engine loads on the first Model entry).
  bindExtrude(app);
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
  // M6b C7 (M6B-C7-15): `S` keys nothing in Rig & Skin before the rig-workspace chunk (and its rows) has loaded.
  disposers.push(app.contribute({ kind: 'keymap', bindings: RIG_SHADOW_KEYMAP }));
  disposers.push(registerModelOperators(app));
  return disposeAll(disposers);
}

/**
 * M6a (M6A-INT-13): the Model operators chunk loads on the first Model entry (and with the first run or poll of a
 * Model operator); once it has, this app gets the Model menu items (the menu bar lists registry changes).
 */
function registerModelOperators(app: EditorApp): Disposer {
  const menus: Disposer[] = [];
  let disposed = false;
  const offLoaded = whenModelOperatorsLoaded((module) => {
    if (disposed) return;
    for (const def of module.MODEL_MENU_ITEMS) {
      if (app.menus.get(def.id) === undefined) menus.push(app.contribute({ kind: 'menu', def }));
    }
  });
  const load = (workspace: string): void => {
    if (workspace === 'model') void loadModelOperators().catch(() => {});
  };
  load(app.session.getState().workspace);
  const offSession = app.session.subscribe((state, previous) => {
    if (state.workspace !== previous.workspace) load(state.workspace);
  });
  return () => {
    disposed = true;
    offLoaded();
    offSession();
    for (const dispose of menus.splice(0).reverse()) dispose();
  };
}
