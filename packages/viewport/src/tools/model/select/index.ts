// The Model select runtime, eager part (M6A-SPEC §5.6, §4.4; B10): it loads, once per viewport and only when meshes
// are in the document or the Model workspace is entered, the lazy runtime that hosts mesh-view (B6's `MeshDisplay`,
// which draws props in every workspace and hilited meshes' components in Model), picks components and objects for
// the select tool, tracks the pointer for the headless Model operators, frames component selections and pushes face
// isolate sets. Animate without meshes never loads it.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ViewportManager } from '../../../manager/ViewportManager';
import type { ModelSelectRuntime } from './runtime';

export type { ModelSelectRuntime } from './runtime';

const runtimes = new WeakMap<EditorApp, ModelSelectRuntime>();
const waiting = new WeakMap<EditorApp, Set<(runtime: ModelSelectRuntime | null) => void>>();

/** The app's loaded Model select runtime, or null (not needed yet, or still loading). */
export function modelSelectOf(app: EditorApp): ModelSelectRuntime | null {
  return runtimes.get(app) ?? null;
}

/** Calls `listener` when the app's runtime loads or goes away; the disposer stops listening. */
export function subscribeModelSelect(app: EditorApp, listener: (runtime: ModelSelectRuntime | null) => void): Disposer {
  let set = waiting.get(app);
  if (set === undefined) {
    set = new Set();
    waiting.set(app, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

function announce(app: EditorApp, runtime: ModelSelectRuntime | null): void {
  for (const listener of Array.from(waiting.get(app) ?? [])) listener(runtime);
}

/**
 * Attaches the runtime to a viewport (called where the viewport registers its tools). It loads when the Model
 * workspace is entered or the first mesh runtime appears; a failed load is retried on the next such change.
 */
export function attachModelSelect(app: EditorApp, vm: ViewportManager): Disposer {
  let disposed = false;
  let runtime: ModelSelectRuntime | null = null;
  let loading = false;
  const needed = (): boolean => app.session.getState().workspace === 'model' || app.meshes.list().length > 0;
  const load = (): void => {
    if (disposed || loading || runtime !== null || !needed()) return;
    loading = true;
    import('./runtime')
      .then((module) => module.createModelSelectRuntime(app, vm))
      .then(
        (loaded) => {
          loading = false;
          if (disposed) {
            loaded.dispose();
            return;
          }
          runtime = loaded;
          runtimes.set(app, loaded);
          announce(app, loaded);
        },
        (error: unknown) => {
          loading = false;
          console.error('Ekza Studio: the Model select runtime could not load', error);
        },
      );
  };
  const offSession = app.session.subscribe((state, previous) => {
    if (state.workspace !== previous.workspace) load();
  });
  const offMeshes = app.meshes.subscribe(() => load());
  load();
  return () => {
    disposed = true;
    offSession();
    offMeshes();
    if (runtime !== null) {
      runtime.dispose();
      if (runtimes.get(app) === runtime) runtimes.delete(app);
      announce(app, null);
    }
    runtime = null;
  };
}
