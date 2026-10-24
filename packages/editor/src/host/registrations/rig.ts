// Rig & Skin's host registrations (STUDIO-TOUCH-SPEC §20.3 item 12; T3): the Rig menu items (fixed and
// selection-dependent, `shell/menus/rig.ts`), the `rig.modes` marking menu and the two view settings behind them,
// `rig.snap.projectedCenter` and `rig.jointSize.set` (`shell/rig/operators.ts`). A lazy chunk the host loads on the
// first Rig & Skin entry on every route. The Pro-only parts stay in the Studio shell's rig chunk (`shell/rig/register`):
// the status-line groups, the pane overlays, the dock tabs following the mode, the help line and `watchRigViewOnly`
// (AR-V1: below 1024 px Pro's Rig & Skin is view-only; Halo edits at every width, §16.1).
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { RIG_MARKING_MENUS } from '../../overlays/menus/rig';
import { RIG_MENU_ITEMS, registerRigDynamicMenus } from '../../shell/menus/rig';
import { rigShellOperators } from '../../shell/rig/operators';
import { registerOnce } from './once';

export function register(app: EditorApp): Disposer {
  const fixed = registerOnce(app, [
    ...rigShellOperators(app).map((def) => ({ kind: 'operator', def }) as const),
    ...RIG_MENU_ITEMS.map((def) => ({ kind: 'menu', def }) as const),
    ...RIG_MARKING_MENUS.map((def) => ({ kind: 'markingMenu', def }) as const),
  ]);
  const dynamic = registerRigDynamicMenus(app);
  return () => {
    dynamic();
    fixed();
  };
}
