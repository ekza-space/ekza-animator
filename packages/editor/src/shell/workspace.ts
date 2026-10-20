// WorkspaceHost's imperative side (ARCHITECTURE §10): binds the dockview API, restores or builds the active
// workspace's layout, persists changes (versioned, try/catch) and answers maximize / show-panel / reset requests.
// dockview stays behind this adapter so another docking library could replace it.
//
// M6a (M6A-SPEC §4.8, §5.17; B9): one dockview, the layout JSON swapped per workspace: when `session.workspace`
// changes, the leaving workspace's layout is saved under its key and the entered one's is restored (or built).
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, PanelKind, PrefsStorage } from '@ekza-animator/editor-core';
import type { DockviewApi, SerializedDockview } from 'dockview-react';
import type { StoreApi } from 'zustand/vanilla';
import type { PanelRegistry } from '../panels/types';
import {
  ALL_SLOTS,
  addDopeSheetTab,
  addPanelToDefaultDock,
  buildPresetLayout,
  buildWorkspaceLayout,
  type ChromePart,
  type ChromeVisibility,
  clearStoredLayout,
  FIXED_KINDS,
  type FocusSnapshot,
  kindOfPanel,
  PLACEHOLDER_COMPONENT,
  type PanelComponent,
  type PresetDock,
  readStoredLayout,
  reconcileLayout,
  type StoredExtras,
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

/** The chrome a workspace shows: its toggles over its defaults (tool strip and help line on, the time slider as
 *  the workspace definition says). */
export function chromeOf(
  app: Pick<EditorApp, 'workspaces'>,
  toggles: Readonly<Record<string, Partial<ChromeVisibility>>>,
  workspace: string,
): ChromeVisibility {
  const own = toggles[workspace] ?? {};
  return {
    toolbar: own.toolbar ?? true,
    helpLine: own.helpLine ?? true,
    timeline: own.timeline ?? app.workspaces.get(workspace)?.timeline ?? true,
  };
}

export function createWorkspaceController(deps: WorkspaceDeps): WorkspaceController {
  let api: DockviewApi | null = null;
  /** The workspace the dockview's layout belongs to. */
  let current: string = deps.app.session.getState().workspace;
  /** Focus mode per workspace: what it hid (kept in memory and with the stored layout). */
  const focus = new Map<string, FocusSnapshot>();
  /** Schedules a save of the current layout (set while attached). */
  let scheduleSave: (() => void) | null = null;

  const chromeToggles = (workspace: string): Partial<ChromeVisibility> => deps.ui.getState().chrome[workspace] ?? {};
  const setChromeToggles = (workspace: string, toggles: Partial<ChromeVisibility>): void => {
    deps.ui.setState({ chrome: { ...deps.ui.getState().chrome, [workspace]: toggles } });
  };
  const extrasOf = (workspace: string): StoredExtras => {
    const snapshot = focus.get(workspace);
    return { chrome: chromeToggles(workspace), ...(snapshot === undefined ? {} : { focus: snapshot }) };
  };
  const publishFocus = (): void => {
    const focused = Object.fromEntries([...focus.keys()].map((workspace) => [workspace, true]));
    deps.ui.setState({ focus: focused });
  };

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
    if (stored.kind === 'ok') {
      // The chrome toggles and focus mode come back with the layout (a layout stored without them has neither).
      setChromeToggles(current, stored.chrome ?? {});
      if (stored.focus === undefined) focus.delete(current);
      else focus.set(current, stored.focus);
      publishFocus();
    }
    if (stored.kind === 'ok' || stored.kind === 'migrate') {
      const layout = reconcileLayout(stored.layout, resolve);
      if (layout !== null) {
        try {
          target.fromJSON(layout);
          if (stored.kind === 'migrate') {
            // M2A-SPEC §4.8: the M1 layout gets the Dope Sheet tab and is stored under the v2 key (v1 key kept).
            addDopeSheetTab(target, resolve);
            writeStoredLayout(deps.storage, target.toJSON(), current, extrasOf(current));
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

  /** Shows a serialized layout (reconciled with this build's panels); the default layout when it cannot. */
  const loadLayout = (target: DockviewApi, dockview: SerializedDockview): void => {
    const layout = reconcileLayout(dockview, resolve);
    if (layout !== null) {
      try {
        target.fromJSON(layout);
        return;
      } catch {
        // Fall through to the default layout below.
      }
    }
    deps.notify('Layout reset: the saved layout does not match this version');
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
        if (api === target) writeStoredLayout(deps.storage, target.toJSON(), workspace, extrasOf(workspace));
      };
      const flush = (): void => {
        if (timer === null) return;
        clearTimeout(timer);
        save();
      };
      const schedule = (): void => {
        if (swapping) return;
        if (timer !== null) clearTimeout(timer);
        pending = current;
        timer = setTimeout(save, deps.saveDelayMs ?? 250);
      };
      scheduleSave = schedule;
      const unsubscribeChrome = deps.ui.subscribe((state, previous) => {
        if (state.chrome[current] !== previous.chrome[current]) schedule();
      });
      const subscriptions = [
        target.onDidLayoutChange(schedule),
        target.onDidMaximizedGroupChange(() => deps.ui.setState({ dockMaximized: target.hasMaximizedGroup() })),
      ];
      const unsubscribe = deps.app.session.subscribe((state, previous) => {
        if (state.workspace === previous.workspace || state.workspace === current || api !== target) return;
        // §5.17: the leaving workspace keeps its layout; the entered one comes back as it was left (or its default).
        flush();
        writeStoredLayout(deps.storage, target.toJSON(), current, extrasOf(current));
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
        unsubscribeChrome();
        for (const subscription of subscriptions) subscription.dispose();
        if (scheduleSave === schedule) scheduleSave = null;
        if (api === target) api = null;
      };
    },
    reset(): void {
      clearStoredLayout(deps.storage, current);
      focus.delete(current);
      publishFocus();
      setChromeToggles(current, {});
      if (api === null) return;
      if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
      buildDefault(api);
      writeStoredLayout(deps.storage, api.toJSON(), current, extrasOf(current));
    },
    chrome: () => chromeOf(deps.app, deps.ui.getState().chrome, deps.app.session.getState().workspace),
    setChrome(part: ChromePart, shown: boolean): void {
      const workspace = deps.app.session.getState().workspace;
      setChromeToggles(workspace, { ...chromeToggles(workspace), [part]: shown });
    },
    focused: () => focus.has(current),
    toggleFocus(): boolean {
      const target = api;
      if (target === null) return false;
      const snapshot = focus.get(current);
      if (snapshot !== undefined) {
        // Out of focus mode: the dock layout and the chrome exactly as they were.
        focus.delete(current);
        publishFocus();
        if (target.hasMaximizedGroup()) target.exitMaximizedGroup();
        loadLayout(target, snapshot.dockview);
        setChromeToggles(current, snapshot.chrome);
        scheduleSave?.();
        return false;
      }
      if (target.hasMaximizedGroup()) target.exitMaximizedGroup();
      focus.set(current, { dockview: target.toJSON(), chrome: chromeToggles(current) });
      publishFocus();
      target.clear();
      buildPresetLayout('viewport', target, resolve, height(target));
      setChromeToggles(current, { ...chromeToggles(current), toolbar: false, helpLine: false });
      scheduleSave?.();
      return true;
    },
    capture() {
      if (api === null) return null;
      return { dockview: api.toJSON(), chrome: chromeToggles(current) };
    },
    applyLayout(dock: PresetDock | SerializedDockview, chrome: Partial<ChromeVisibility>): boolean {
      const target = api;
      if (target === null) return false;
      // A preset replaces focus mode: there is nothing to go back to.
      focus.delete(current);
      publishFocus();
      if (target.hasMaximizedGroup()) target.exitMaximizedGroup();
      if (dock === 'default') buildDefault(target);
      else if (typeof dock === 'string') {
        target.clear();
        buildPresetLayout(dock, target, resolve, height(target));
      } else loadLayout(target, dock);
      setChromeToggles(current, chrome);
      scheduleSave?.();
      return true;
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
