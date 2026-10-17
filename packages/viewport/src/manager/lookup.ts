// Typed access to the app → ViewportManager registry (see ./registry.ts).
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp } from '@ekza-animator/editor-core';
import { managerOf, subscribeManager } from './registry';
import type { ViewportManager } from './ViewportManager';

/** The ViewportManager created for `app` by the GL host, or null before the canvas exists. */
export function viewportManagerOf(app: EditorApp): ViewportManager | null {
  return managerOf<ViewportManager>(app);
}

/** Called whenever the app's ViewportManager is created or disposed. */
export function subscribeViewportManager(
  app: EditorApp,
  listener: (manager: ViewportManager | null) => void,
): Disposer {
  return subscribeManager<ViewportManager>(app, listener);
}
