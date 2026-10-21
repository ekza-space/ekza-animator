// Marking menus in the shell (M6A-SPEC §5.18; B9): an eager facade over the lazy controller and drawing. The facade
// owns the state store (the test API and the host read it); the controller (gestures, geometry, polls) loads when a
// workspace with marking menus is entered (Model) or a menu is opened by command, so Animate never loads it. Until
// it has loaded a pointer press opens nothing and, in a workspace that has marking menus, starts the load. The
// controller and the drawing load together, so the drawing never fails on its own; a failed load says so on the help
// line when the user asked for a menu (a command, a right-button press) and is tried again on the next one.
import type { EditorApp, MarkingMenuDef, RunContext } from '@ekza-studio/editor-core';
import type { PanePointerPress } from '@ekza-studio/viewport';
import { type JSX, lazy, Suspense } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import type * as ControllerModule from './controller';
import type { MarkingMenuController, MarkingMenuDeps } from './controller';
import type * as ViewModule from './MarkingMenuView';
import type { MarkingMenuState } from './types';

export type { MarkingMenuEntry, MarkingMenuState, MarkingMenuTarget, OpenMarkingMenu } from './types';

/** The help-line message of a failed load. */
export const MARKING_MENU_LOAD_FAILED = 'The marking menu could not be loaded';

/** The lazy chunks: the controller and the drawing. */
export interface MarkingMenuChunks {
  readonly controller: typeof ControllerModule;
  readonly view: typeof ViewModule;
}

const importChunks = (): Promise<MarkingMenuChunks> =>
  Promise.all([import('./controller'), import('./MarkingMenuView')]).then(([controller, view]) => ({
    controller,
    view,
  }));

export interface MarkingMenuFacadeDeps extends Omit<MarkingMenuDeps, 'state'> {
  /** Loads the lazy chunks; replaceable for tests. */
  readonly importChunks?: () => Promise<MarkingMenuChunks>;
}

export interface MarkingMenus {
  readonly state: StoreApi<MarkingMenuState>;
  /** The controller once loaded, else null. */
  controller(): MarkingMenuController | null;
  /** Loads the controller (once; later calls share the promise). */
  load(): Promise<MarkingMenuController>;
  /**
   * The viewport's press hook: true when a menu opened. Before the controller has loaded it returns false and starts
   * the load only in a workspace that has marking menus (`marksMenus`): a press in Animate loads nothing.
   */
  handlePress(press: PanePointerPress): boolean;
  /** `ui.markingMenu`: opens the menu once the controller is there. */
  openByCommand(def: MarkingMenuDef, ctx: RunContext): void;
  close(): void;
  /** Page position of each slot of the open menu. */
  screenOfSlot(): Partial<Record<string, { x: number; y: number }>>;
  dispose(): void;
}

/** True when the active workspace has marking menus: Model, or one a registered menu lists. */
export function marksMenus(app: EditorApp): boolean {
  const workspace = app.session.getState().workspace;
  return workspace === 'model' || app.markingMenus.list().some((def) => def.workspaces.includes(workspace));
}

export function createMarkingMenus(deps: MarkingMenuFacadeDeps): MarkingMenus {
  const { importChunks: importer = importChunks, ...controllerDeps } = deps;
  const state = createStore<MarkingMenuState>()(() => ({ open: null }));
  let controller: MarkingMenuController | null = null;
  let loading: Promise<MarkingMenuController> | null = null;
  let disposed = false;
  const load = (): Promise<MarkingMenuController> => {
    loading ??= importer().then(
      (chunks) => {
        controller ??= chunks.controller.createMarkingMenuController({ ...controllerDeps, state });
        if (disposed) controller.dispose();
        return controller;
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
    return loading;
  };
  const failed = (error: unknown): void => {
    console.warn('Ekza Studio: the marking menu could not be loaded', error);
    deps.help(MARKING_MENU_LOAD_FAILED, 'error');
  };
  return {
    state,
    controller: () => controller,
    load,
    handlePress(press) {
      if (controller !== null) return controller.handlePress(press);
      if (marksMenus(deps.app)) {
        // A right-button press asked for a menu: a failed load says so. Other presses only warm the load up.
        const asked = press.button === 2;
        void load().catch((error: unknown) => {
          if (asked) failed(error);
        });
      }
      return false;
    },
    openByCommand(def, ctx) {
      void load().then((loaded) => loaded.openByCommand(def, ctx), failed);
    },
    close() {
      controller?.close();
    },
    screenOfSlot: () => controller?.screenOfSlot() ?? {},
    dispose() {
      disposed = true;
      controller?.dispose();
    },
  };
}

const MarkingMenuView = lazy(() => import('./MarkingMenuView'));

/** Starts loading the drawing and the controller before the first menu opens (entering Model); a failure is quiet
 *  here (nothing was asked for yet) and the next press or command tries again. */
export function prefetchMarkingMenu(menus: MarkingMenus): void {
  void menus.load().catch(() => {});
}

export function MarkingMenuHost(props: { readonly menus: MarkingMenus }): JSX.Element | null {
  const open = useStoreSelector(props.menus.state, (s) => s.open);
  const controller = props.menus.controller();
  if (open === null || !open.visible || controller === null) return null;
  return (
    <Suspense fallback={null}>
      <MarkingMenuView controller={controller} open={open} />
    </Suspense>
  );
}
