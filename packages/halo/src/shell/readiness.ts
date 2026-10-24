// The frame's one readiness list (STUDIO-TOUCH-SPEC §7.2, ST-36): T6b's pure `readiness(app, destination)` read by the
// Path's glyphs, the status corner, the Next chip and the test API — computed once per change, not once per reader.
// It is marked stale when the document, a mesh runtime (Mesh Check reads ready meshes), the active character, the
// workspace (the rig chunk), the rig chunk's arrival or the destination changes, and computed again on the next read.
import type { EditorApp } from '@ekza-studio/editor-core';
import { useSyncExternalStore } from 'react';
import { type Readiness, readiness } from '../path/readiness';
import type { HaloStore } from './store';

export interface ReadinessSource {
  readonly get: () => Readiness;
  readonly subscribe: (listener: () => void) => () => void;
  /** Starts watching the app; the disposer stops (the controller's lifetime). */
  readonly start: () => () => void;
}

export function createReadinessSource(app: EditorApp, store: HaloStore): ReadinessSource {
  let current: Readiness | null = null;
  let rigLoaded = app.rig.loaded;
  let queued = false;
  const listeners = new Set<() => void>();
  const stale = (): void => {
    current = null;
    if (queued) return;
    queued = true;
    // several changes of one run notify once
    queueMicrotask(() => {
      queued = false;
      for (const listener of Array.from(listeners)) listener();
    });
  };
  return {
    get: () => {
      current ??= readiness(app, store.get().destination);
      return current;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      const offs = [
        app.store.subscribe(stale),
        app.meshes.subscribe(stale),
        app.session.subscribe((state, previous) => {
          const loaded = app.rig.loaded;
          if (
            state.activeCharacter !== previous.activeCharacter ||
            state.workspace !== previous.workspace ||
            loaded !== rigLoaded
          ) {
            rigLoaded = loaded;
            stale();
          }
        }),
        store.subscribe((next, previous) => {
          if (next.destination !== previous.destination) stale();
        }),
      ];
      stale();
      return () => {
        for (const off of offs) off();
      };
    },
  };
}

/** The current readiness list (re-renders when it changes). */
export function useReadiness(source: ReadinessSource): Readiness {
  return useSyncExternalStore(source.subscribe, source.get, source.get);
}
