// The Rig & Skin shell UI (M6B-SPEC §8; C7): a lazy chunk loaded on the first Rig & Skin entry (`./index.ts`). It
// contributes the Rig menus, the `rig.modes` marking menu, the status-line group bodies and the pane overlays, and
// makes the right and bottom dock tabs follow the mode (§5.24: Object → Channel Box / Validation, Skeleton → Rig
// Toolkit / Validation, Skin → Paint Weights; `RigSessionState.tabMemory`).
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { RIG_MARKING_MENUS } from '../../overlays/menus/rig';
import { registerRigOverlays } from '../../panels/viewport/rig/overlays';
import { RIG_MENU_ITEMS, registerRigDynamicMenus } from '../menus/rig';
import type { RigShellDeps } from './index';
import { registerRigShellOperators } from './operators';
import { registerRigStatusGroups } from './status';

export function registerRigShellUi(app: EditorApp, deps: RigShellDeps): Disposer {
  const disposers: Disposer[] = [registerRigShellOperators(app), registerRigDynamicMenus(app)];
  for (const def of RIG_MENU_ITEMS) {
    if (app.menus.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'menu', def }));
  }
  for (const def of RIG_MARKING_MENUS) {
    if (app.markingMenus.get(def.id) === undefined) disposers.push(app.contribute({ kind: 'markingMenu', def }));
  }
  disposers.push(registerRigStatusGroups(), registerRigOverlays(app));
  disposers.push(
    app.session.subscribe((state, previous) => {
      if (state.workspace !== 'rig' || state.rig.mode === previous.rig.mode) return;
      const tabs = state.rig.tabMemory[state.rig.mode];
      deps.showPanel(tabs.right);
    }),
  );
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
