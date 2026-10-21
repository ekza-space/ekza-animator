// The eager hook of the viewport's skeleton runtime (M6B-SPEC §8.3, §0.4.9; C3): tiny. When Rig & Skin is entered (or
// is active at start) it loads the lazy viewport-rig chunk once and creates the runtime (joint overlay, Quick Rig
// markers, the pointer layer); a failed load is retried on the next workspace change. `viewportRigOf` serves the
// test API and the editor's Rig UI.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ViewportManager } from '../../manager/ViewportManager';
import { loadViewportRig } from '../load';
import type { ViewportRigRuntime } from '../runtime';

const runtimes = new WeakMap<EditorApp, ViewportRigRuntime>();

/** The app's loaded skeleton runtime, or null (Rig & Skin not entered yet, or loading). */
export function viewportRigOf(app: EditorApp): ViewportRigRuntime | null {
  return runtimes.get(app) ?? null;
}

export function attachViewportRig(app: EditorApp, vm: ViewportManager): Disposer {
  let runtime: ViewportRigRuntime | null = null;
  let loading = false;
  let disposed = false;
  const load = (): void => {
    if (disposed || loading || runtime !== null || app.session.getState().workspace !== 'rig') return;
    loading = true;
    loadViewportRig().then(
      (module) => {
        loading = false;
        if (disposed || runtime !== null) return;
        runtime = module.createRigRuntime(app, vm);
        runtimes.set(app, runtime);
        vm.invalidate();
      },
      (error: unknown) => {
        loading = false;
        console.error('Ekza Studio: the Rig & Skin viewport overlays could not load', error);
      },
    );
  };
  const off = app.session.subscribe((state, previous) => {
    if (state.workspace !== previous.workspace) load();
  });
  load();
  return () => {
    disposed = true;
    off();
    if (runtime !== null) {
      runtime.dispose();
      if (runtimes.get(app) === runtime) runtimes.delete(app);
    }
    runtime = null;
  };
}
