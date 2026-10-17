// WorkspaceHost's imperative side (ARCHITECTURE §10): binds the dockview API, restores or builds the Animate layout,
// persists changes (versioned, try/catch) and answers maximize / show-panel / reset requests. dockview stays behind
// this adapter so another docking library could replace it.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, PanelKind, PrefsStorage } from '@ekza-animator/editor-core';
import type { DockviewApi } from 'dockview-react';
import type { StoreApi } from 'zustand/vanilla';
import type { PanelRegistry } from '../panels/types';
import {
  ANIMATE_SLOTS,
  addPanelToDefaultDock,
  buildAnimateLayout,
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

  const resolve = (kind: PanelKind): PanelComponent | null => {
    if (FIXED_KINDS.has(kind)) return null;
    const def = panelDefOfKind(deps.panels, kind);
    if (def !== undefined) return { kind, component: def.id, title: def.title };
    const slot = ANIMATE_SLOTS.find((candidate) => candidate.kind === kind);
    return slot === undefined ? null : { kind, component: PLACEHOLDER_COMPONENT, title: slot.title };
  };

  const height = (target: DockviewApi): number => target.height || globalThis.innerHeight || 900;

  const buildDefault = (target: DockviewApi): void => {
    target.clear();
    buildAnimateLayout(target, resolve, height(target));
  };

  const restore = (target: DockviewApi): void => {
    const stored = readStoredLayout(deps.storage);
    if (stored.kind === 'ok') {
      const layout = reconcileLayout(stored.layout, resolve);
      if (layout !== null) {
        try {
          target.fromJSON(layout);
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
    resolve,
    attach(target: DockviewApi): Disposer {
      api = target;
      restore(target);
      deps.ui.setState({ dockMaximized: target.hasMaximizedGroup() });
      let timer: ReturnType<typeof setTimeout> | null = null;
      const save = (): void => {
        timer = null;
        if (api === target) writeStoredLayout(deps.storage, target.toJSON());
      };
      const subscriptions = [
        target.onDidLayoutChange(() => {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(save, deps.saveDelayMs ?? 250);
        }),
        target.onDidMaximizedGroupChange(() => deps.ui.setState({ dockMaximized: target.hasMaximizedGroup() })),
      ];
      return () => {
        if (timer !== null) {
          clearTimeout(timer);
          save();
        }
        for (const subscription of subscriptions) subscription.dispose();
        if (api === target) api = null;
      };
    },
    reset(): void {
      clearStoredLayout(deps.storage);
      if (api === null) return;
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      buildDefault(api);
      writeStoredLayout(deps.storage, api.toJSON());
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
      addPanelToDefaultDock(api, entry).api.setActive();
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
