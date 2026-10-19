// WorkspaceHost's imperative side (ARCHITECTURE §10): binds the dockview API, restores or builds the active
// workspace's layout, persists changes (versioned, try/catch) and answers maximize / show-panel / reset requests.
// dockview stays behind this adapter so another docking library could replace it.
//
// M6a (M6A-SPEC §4.8, §5.17; B9): one dockview, the layout JSON swapped per workspace: when `session.workspace`
// changes, the leaving workspace's layout is saved under its key and the entered one's is restored (or built).
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, PanelKind, PrefsStorage } from '@ekza-animator/editor-core';
import type { DockviewApi } from 'dockview-react';
import type { StoreApi } from 'zustand/vanilla';
import type { PanelRegistry } from '../panels/types';
import {
  ALL_SLOTS,
  addDopeSheetTab,
  addPanelToDefaultDock,
  buildWorkspaceLayout,
  clearStoredLayout,
  FIXED_KINDS,
  kindOfPanel,
  PLACEHOLDER_COMPONENT,
  type PanelComponent,
  readStoredLayout,
  reconcileLayout,
  writeStoredLayout,
} from './layout';
import type { ShellUiState, WorkspaceApi } from './types';

export interface WorkspaceController extends WorkspaceApi {
  attach(api: DockviewApi): Disposer;
  /** The component a panel kind renders with in this build (registered panel or placeholder). */
  resolve(kind: PanelKind): PanelComponent | null;
  /** The workspace whose layout the dockview shows. */
  readonly workspace: string;
}

export interface WorkspaceDeps {
  readonly app: EditorApp;
  readonly panels: PanelRegistry;
  readonly storage: PrefsStorage | null;
  readonly ui: StoreApi<ShellUiState>;
  readonly notify: (text: string) => void;
  /** Debounce of layout saves, ms. */
  readonly saveDelayMs?: number;
}

/** First registered panel of a kind (panel ids are open strings; kinds are what layouts refer to). */
export function panelDefOfKind(panels: PanelRegistry, kind: PanelKind) {
  return panels.list().find((def) => def.kind === kind);
}

export function createWorkspaceController(deps: WorkspaceDeps): WorkspaceController {
  let api: DockviewApi | null = null;
  /** The workspace the dockview's layout belongs to. */
  let current: string = deps.app.session.getState().workspace;

  const resolve = (kind: PanelKind): PanelComponent | null => {
    if (FIXED_KINDS.has(kind)) return null;
    const def = panelDefOfKind(deps.panels, kind);
    if (def !== undefined) return { kind, component: def.id, title: def.title };
    const slot = ALL_SLOTS.find((candidate) => candidate.kind === kind);
    return slot === undefined ? null : { kind, component: PLACEHOLDER_COMPONENT, title: slot.title };
  };

  const height = (target: DockviewApi): number => target.height || globalThis.innerHeight || 900;

  const buildDefault = (target: DockviewApi): void => {
    target.clear();
    buildWorkspaceLayout(current, target, resolve, height(target));
  };

  const restore = (target: DockviewApi): void => {
    const stored = readStoredLayout(deps.storage, current);
    if (stored.kind === 'ok' || stored.kind === 'migrate') {
      const layout = reconcileLayout(stored.layout, resolve);
      if (layout !== null) {
        try {
          target.fromJSON(layout);
          if (stored.kind === 'migrate') {
            // M2A-SPEC §4.8: the M1 layout gets the Dope Sheet tab and is stored under the v2 key (v1 key kept).
            addDopeSheetTab(target, resolve);
            writeStoredLayout(deps.storage, target.toJSON(), current);
          }
          return;
        } catch {
          // Fall through to the default layout below.
        }
      }
      deps.notify('Layout reset: the saved layout does not match this version');
    } else if (stored.kind === 'reset') {
      deps.notify(
        stored.reason === 'newer'
          ? 'Layout reset (saved by a newer version)'
          : 'Layout reset (saved layout unreadable)',
      );
    }
    buildDefault(target);
  };

  const controller: WorkspaceController = {
    get dockview() {
      return api;
    },
    get workspace() {
      return current;
    },
    resolve,
    attach(target: DockviewApi): Disposer {
      api = target;
      current = deps.app.session.getState().workspace;
      // While a layout is swapped in, dockview reports layout changes of the swap itself: they are not edits.
      let swapping = false;
      restore(target);
      deps.ui.setState({ dockMaximized: target.hasMaximizedGroup() });
      let timer: ReturnType<typeof setTimeout> | null = null;
      let pending: string | null = null;
      const save = (): void => {
        timer = null;
        const workspace = pending ?? current;
        pending = null;
        if (api === target) writeStoredLayout(deps.storage, target.toJSON(), workspace);
      };
      const flush = (): void => {
        if (timer === null) return;
        clearTimeout(timer);
        save();
      };
      const subscriptions = [
        target.onDidLayoutChange(() => {
          if (swapping) return;
          if (timer !== null) clearTimeout(timer);
          pending = current;
          timer = setTimeout(save, deps.saveDelayMs ?? 250);
        }),
        target.onDidMaximizedGroupChange(() => deps.ui.setState({ dockMaximized: target.hasMaximizedGroup() })),
      ];
      const unsubscribe = deps.app.session.subscribe((state, previous) => {
        if (state.workspace === previous.workspace || state.workspace === current || api !== target) return;
        // §5.17: the leaving workspace keeps its layout; the entered one comes back as it was left (or its default).
        flush();
        writeStoredLayout(deps.storage, target.toJSON(), current);
        current = state.workspace;
        swapping = true;
        try {
          if (target.hasMaximizedGroup()) target.exitMaximizedGroup();
          target.clear();
          restore(target);
        } finally {
          swapping = false;
        }
        deps.ui.setState({ dockMaximized: target.hasMaximizedGroup() });
      });
      return () => {
        flush();
        unsubscribe();
        for (const subscription of subscriptions) subscription.dispose();
        if (api === target) api = null;
      };
    },
    reset(): void {
      clearStoredLayout(deps.storage, current);
      if (api === null) return;
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      buildDefault(api);
      writeStoredLayout(deps.storage, api.toJSON(), current);
    },
    showPanel(kind: PanelKind): boolean {
      if (api === null) return false;
      const existing = api.panels.find((panel) => kindOfPanel(panel) === kind);
      if (existing !== undefined) {
        existing.api.setActive();
        return true;
      }
      const entry = resolve(kind);
      if (entry === null) return false;
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      addPanelToDefaultDock(api, entry, current).api.setActive();
      return true;
    },
    toggleMaximize(target): boolean {
      if (api === null) return false;
      if (api.hasMaximizedGroup()) {
        api.exitMaximizedGroup();
        return true;
      }
      const byInstance =
        target.instanceId === undefined || target.instanceId === null ? undefined : api.getPanel(target.instanceId);
      const panel =
        byInstance ??
        (target.kind === undefined || target.kind === null
          ? undefined
          : api.panels.find((candidate) => kindOfPanel(candidate) === target.kind));
      if (panel === undefined) return false;
      api.maximizeGroup(panel);
      return true;
    },
    hasMaximized: () => api?.hasMaximizedGroup() ?? false,
    kinds(): readonly PanelKind[] {
      if (api === null) return [];
      return api.panels.map(kindOfPanel).filter((kind): kind is PanelKind => kind !== null);
    },
  };
  return controller;
}
