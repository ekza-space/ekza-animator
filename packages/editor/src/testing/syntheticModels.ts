// Model loader for synthetic documents (fixtures/synthetic: rigs without model bytes). It takes the renderer like the
// browser loader, so the shell's GL host owns the ViewportManager (WP-5's viewport panel hosts its own canvas only for
// apps without a loader), but it never produces a display model: synthetic characters show their controls only, and
// the kernel does not warn about a model it cannot display.
import type { DisplayModel, ModelLoader } from '@ekza-studio/editor-core';

export function createSyntheticModelLoader(): ModelLoader {
  return {
    setRenderer(): void {},
    load: () => new Promise<DisplayModel>(() => {}),
  };
}
