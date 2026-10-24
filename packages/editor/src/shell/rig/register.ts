// The Rig & Skin shell UI (M6B-SPEC §8; C7): a lazy chunk loaded on the first Rig & Skin entry (`./index.ts`). It
// contributes the status-line group bodies and the pane overlays, and makes the right and bottom dock tabs follow the
// mode (§5.24: Object → Channels panel / Validation, Skeleton → Rig Toolkit / Validation, Skin → Paint Weights /
// Component Editor), remembering the tabs the user leaves showing in a mode (`RigSessionState.tabMemory`), and watches
// the window width (below 1024 px Rig & Skin is view-only, §5.24 — Pro's rule only: STUDIO-TOUCH-SPEC §16.1, AR-V1).
// The Rig menus, the `rig.modes` marking menu and the two view settings behind them are the page's host's since
// STUDIO-TOUCH-SPEC T3 (`host/registrations/rig.ts`), so they outlive this shell.
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, PANEL, type RigMode } from '@ekza-studio/editor-core';
import { registerSkeletonUi } from '../../panels/rigToolkit/sections/skeleton/register';
import { registerRigOverlays } from '../../panels/viewport/rig/overlays';
import type { RigShellDeps } from './index';
import { kindOfPanel } from '../layout';
import { RIG_SLOTS } from './layouts';
import { setRigHelp } from '../HelpLine';
import { rigHelpLine } from './helpLine';
import { registerRigStatusGroups } from './status';
import { watchRigViewOnly } from './viewOnly';

const RIGHT_TABS: ReadonlySet<string> = new Set(
  RIG_SLOTS.filter((slot) => slot.slot === 'right').map((slot) => slot.kind),
);
const BOTTOM_TABS: ReadonlySet<string> = new Set([PANEL.validation, PANEL.componentEditor]);

/** The panel kinds the dock shows now (each group's active tab). */
function visibleKinds(deps: RigShellDeps): readonly string[] {
  const api = deps.dockview?.() ?? null;
  if (api === null) return [];
  const out: string[] = [];
  for (const panel of api.panels) {
    const kind = kindOfPanel(panel);
    if (kind !== null && panel.api.isVisible) out.push(kind);
  }
  return out;
}

/**
 * Remembers the right and bottom dock tabs a mode was left with (`RigSessionState.tabMemory`, §5.24 "the tab following
 * the mode unless the user changed it in that mode"); a dock with no Rig tab showing keeps its remembered tab.
 */
export function rememberTabs(app: EditorApp, mode: RigMode, visible: readonly string[]): void {
  const state = app.session.getState();
  const tabs = state.rig.tabMemory[mode];
  const right = visible.find((kind) => RIGHT_TABS.has(kind)) ?? tabs.right;
  const bottom = visible.find((kind) => BOTTOM_TABS.has(kind)) ?? tabs.bottom;
  if (right === tabs.right && bottom === tabs.bottom) return;
  const tabMemory = { ...state.rig.tabMemory, [mode]: { right, bottom } };
  app.session.setState({ rig: { ...state.rig, tabMemory } });
}

/**
 * The right and bottom dock tabs follow the mode (§5.24 table); the tabs the user left showing in the previous mode are
 * remembered for it first (§8.2 "remembered per mode").
 */
export function followModeTabs(app: EditorApp, deps: RigShellDeps): Disposer {
  return app.session.subscribe((state, previous) => {
    if (state.workspace !== 'rig' || state.rig.mode === previous.rig.mode) return;
    if (previous.workspace === 'rig') rememberTabs(app, previous.rig.mode, visibleKinds(deps));
    const tabs = app.session.getState().rig.tabMemory[state.rig.mode];
    deps.showPanel(tabs.bottom);
    deps.showPanel(tabs.right);
  });
}

export function registerRigShellUi(app: EditorApp, deps: RigShellDeps): Disposer {
  const disposers: Disposer[] = [
    registerRigStatusGroups(),
    registerRigOverlays(app),
    watchRigViewOnly(app),
    followModeTabs(app, deps),
  ];
  // C3: the skeleton UI's shell parts (the FK FOR TEST badge).
  setRigHelp(rigHelpLine);
  disposers.push(registerSkeletonUi(app), () => setRigHelp(null));
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
