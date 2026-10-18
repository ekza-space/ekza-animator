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

/** Operators, importers, exporters, BUILTIN_EXPORT_PROFILES, menu items and MAYA_KEYMAP. */
export function registerBuiltins(app: EditorApp): Disposer {
  const disposers: Disposer[] = [registerBuiltinOperators(app)];
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
