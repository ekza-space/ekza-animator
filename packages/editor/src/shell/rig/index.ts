// The Rig & Skin shell hook (M6B-SPEC §8, §0.4.9; C7): eager and tiny. When Rig & Skin is entered (or is active at
// start), it loads the rig shell UI (`./register`: status-line groups, the pose badge, the HUD mode badge, the empty
// state and the Getting started card, the dock tab following the mode, the view-only rule) once. The Rig menus and
// the `rig.modes` marking menu are the page's host's (`host/registrations/rig.ts`, STUDIO-TOUCH-SPEC T3).
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp, PanelKind } from '@ekza-studio/editor-core';
import type { DockviewApi } from 'dockview-react';

export interface RigShellDeps {
  /** Shows (activates) a dock panel of the current workspace (`WorkspaceApi.showPanel`). */
  readonly showPanel: (kind: PanelKind) => boolean;
  /** The bound dockview (null before it mounts): the dock tabs a mode is left with are remembered (§5.24). */
  readonly dockview?: () => DockviewApi | null;
}

export function registerRigShell(app: EditorApp, deps: RigShellDeps): Disposer {
  let detach: Disposer | null = null;
  let loading = false;
  let disposed = false;
  const load = (): void => {
    if (loading || app.session.getState().workspace !== 'rig') return;
    loading = true;
    void import('./register').then((module) => {
      if (!disposed) detach = module.registerRigShellUi(app, deps);
    });
  };
  load();
  const off = app.session.subscribe(load);
  return () => {
    disposed = true;
    off();
    detach?.();
  };
}
