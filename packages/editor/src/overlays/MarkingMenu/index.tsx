// Marking menus in the shell (M6A-SPEC §5.18; B9): an eager facade over the lazy controller and drawing. The facade
// owns the state store (the test API and the host read it); the controller (gestures, geometry, polls) loads when a
// workspace with marking menus is entered (Model) or a menu is opened by command, so Animate never loads it. Until
// it has loaded a pointer press opens nothing and starts the load.
import type { MarkingMenuDef, RunContext } from '@ekza-animator/editor-core';
import type { PanePointerPress } from '@ekza-animator/viewport';
import { type JSX, lazy, Suspense } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import type { MarkingMenuController, MarkingMenuDeps } from './controller';
import type { MarkingMenuState } from './types';

export type { MarkingMenuEntry, MarkingMenuState, MarkingMenuTarget, OpenMarkingMenu } from './types';

export interface MarkingMenus {
  readonly state: StoreApi<MarkingMenuState>;
  /** The controller once loaded, else null. */
  controller(): MarkingMenuController | null;
  /** Loads the controller (once; later calls share the promise). */
  load(): Promise<MarkingMenuController>;
  /** The viewport's press hook: true when a menu opened (false, and the load starts, before it has loaded). */
  handlePress(press: PanePointerPress): boolean;
  /** `ui.markingMenu`: opens the menu once the controller is there. */
  openByCommand(def: MarkingMenuDef, ctx: RunContext): void;
  close(): void;
  /** Page position of each slot of the open menu. */
  screenOfSlot(): Partial<Record<string, { x: number; y: number }>>;
  dispose(): void;
}

export function createMarkingMenus(deps: Omit<MarkingMenuDeps, 'state'>): MarkingMenus {
  const state = createStore<MarkingMenuState>()(() => ({ open: null }));
  let controller: MarkingMenuController | null = null;
  let loading: Promise<MarkingMenuController> | null = null;
  let disposed = false;
  const load = (): Promise<MarkingMenuController> => {
    loading ??= import('./controller').then(
      ({ createMarkingMenuController }) => {
        controller ??= createMarkingMenuController({ ...deps, state });
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
  return {
    state,
    controller: () => controller,
    load,
    handlePress(press) {
      if (controller !== null) return controller.handlePress(press);
      void load().catch(() => {});
      return false;
    },
    openByCommand(def, ctx) {
      void load()
        .then((loaded) => loaded.openByCommand(def, ctx))
        .catch(() => deps.help('The marking menu could not be loaded', 'error'));
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

/** Starts loading the drawing and the controller before the first menu opens (entering Model). */
export function prefetchMarkingMenu(menus: MarkingMenus): void {
  void menus.load().catch(() => {});
  void import('./MarkingMenuView');
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
