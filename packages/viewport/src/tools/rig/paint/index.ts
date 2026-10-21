// The Rig & Skin skin runtime's eager part (M6B-SPEC §5.11, §5.12, §0.4.9; C6): one subscription per viewport that
// loads the lazy runtime (./runtime.ts: the skinned display with the weight display, the Paint Skin Weights tool, the
// brush ring) the first time the Rig & Skin workspace is entered. A failed load is retried on the next workspace change.
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ViewportManager } from '../../../manager/ViewportManager';

export function attachRigSkin(app: EditorApp, vm: ViewportManager): Disposer {
  let stop: Disposer | null = null;
  let loading = false;
  let disposed = false;
  const load = (): void => {
    if (disposed || loading || stop !== null || app.session.getState().workspace !== 'rig') return;
    loading = true;
    import('./runtime').then(
      (chunk) => {
        loading = false;
        if (!disposed) stop = chunk.startRigSkin(app, vm);
      },
      (error: unknown) => {
        loading = false;
        console.error('Ekza Studio: the Skin mode runtime could not load', error);
      },
    );
  };
  const off = app.session.subscribe(load);
  load();
  return () => {
    disposed = true;
    off();
    stop?.();
    stop = null;
  };
}
