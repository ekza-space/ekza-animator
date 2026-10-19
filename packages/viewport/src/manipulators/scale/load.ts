// The loader of the lazy scale chunk (M6A-SPEC §4.7, §5.27; B9): eager and tiny. The Scale tool and the
// ViewportManager share one load; until it resolves the tool does nothing and no scale manipulator shows. A load that
// fails (offline after a redeploy, a network error) is reported once to the user by `requestScaleKit`, and only the
// user's next Scale action (choosing the tool again, a press with it) tries again.
import type { Notifier } from '@ekza-animator/editor-core';
import type * as ScaleKitModule from './kit';

export type ScaleKit = typeof ScaleKitModule;

/** The toast of a failed load. */
export const SCALE_LOAD_FAILED = 'The Scale tool could not be loaded. Check the connection, then press R again.';

const importKit = (): Promise<ScaleKit> => import('./kit');

let kit: ScaleKit | null = null;
let loading: Promise<ScaleKit> | null = null;
let importer: () => Promise<ScaleKit> = importKit;
const loadedListeners = new Set<() => void>();

/** Loads the scale chunk once (later calls share the promise; a failed load is retried by the next call). */
export function loadScaleKit(): Promise<ScaleKit> {
  loading ??= importer().then(
    (loaded) => {
      kit = loaded;
      for (const listener of Array.from(loadedListeners)) listener();
      return loaded;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * Loads the scale chunk for a user action: resolves with the kit, or with null when the load failed. The caller that
 * started the load (not one that joined it) tells the user, so a failed load toasts once however many callers wait.
 */
export function requestScaleKit(notify: Notifier): Promise<ScaleKit | null> {
  if (kit !== null) return Promise.resolve(kit);
  const starts = loading === null;
  return loadScaleKit().then(
    (loaded) => loaded,
    (error: unknown) => {
      if (starts) {
        console.warn('Ekza Animator: the scale chunk could not be loaded', error);
        notify.toast({ kind: 'error', text: SCALE_LOAD_FAILED });
      }
      return null;
    },
  );
}

/** Calls `listener` whenever a load of the scale chunk succeeds (whoever started it). */
export function onScaleKitLoaded(listener: () => void): () => void {
  loadedListeners.add(listener);
  return () => {
    loadedListeners.delete(listener);
  };
}

/** The scale chunk once loaded, else null. */
export function scaleKit(): ScaleKit | null {
  return kit;
}

/**
 * @internal Tests only: replaces the chunk import (null restores the real one) and forgets a loaded kit, so a failed
 * or a slow load can be simulated.
 */
export function setScaleKitImporterForTests(next: (() => Promise<ScaleKit>) | null): void {
  importer = next ?? importKit;
  kit = null;
  loading = null;
}
