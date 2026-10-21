// React bindings of the viewport manager for the viewport panel.
import type { EditorApp } from '@ekza-studio/editor-core';
import {
  type PaneState,
  subscribeViewportManager,
  type ViewportManager,
  viewportManagerOf,
} from '@ekza-studio/viewport';
import { useCallback, useSyncExternalStore } from 'react';

/** The app's ViewportManager (created by the GL host), re-rendering when it appears or goes away. */
export function useViewportManager(app: EditorApp): ViewportManager | null {
  const subscribe = useCallback((notify: () => void) => subscribeViewportManager(app, notify), [app]);
  const get = useCallback(() => viewportManagerOf(app), [app]);
  return useSyncExternalStore(subscribe, get, get);
}

/** A pane's state snapshot (camera name, lock, display flags, LOCKED flashes). */
export function usePaneState(vm: ViewportManager | null, paneId: string): PaneState | null {
  const subscribe = useCallback((notify: () => void) => (vm === null ? () => {} : vm.subscribePanes(notify)), [vm]);
  const get = useCallback(() => vm?.paneState(paneId) ?? null, [vm, paneId]);
  return useSyncExternalStore(subscribe, get, get);
}
