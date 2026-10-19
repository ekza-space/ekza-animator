// React bindings shared by B13's Model panels (Outliner, Palette): runtime-driven re-renders.
import type { EditorApp } from '@ekza-animator/editor-core';
import { useMemo, useSyncExternalStore } from 'react';

/**
 * Bumps when a mesh runtime changes state or is rebuilt (a reopened project's meshes become ready after the first
 * render; the triangle badge reads the runtime). Preview `changed` events (per drag frame) are ignored.
 */
export function useMeshRuntimesVersion(app: EditorApp): number {
  const source = useMemo(() => runtimeVersionSource(app), [app]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

function runtimeVersionSource(app: EditorApp): {
  readonly subscribe: (notify: () => void) => () => void;
  readonly getSnapshot: () => number;
} {
  let version = 0;
  return {
    subscribe: (notify) =>
      app.meshes.subscribe((_id, event) => {
        if (event.type === 'changed') return;
        version += 1;
        notify();
      }),
    getSnapshot: () => version,
  };
}
