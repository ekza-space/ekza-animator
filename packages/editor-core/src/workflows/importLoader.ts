// Loader of the import pipelines (`importPath.ts`), a lazy chunk of the editor route (M2A-SPEC §5.21.2, like the model
// loader it feeds and the export path): the import operators load it in `prepare`, so their synchronous `apply` finds
// it loaded; hosts start it on intent (a file dragged over the window, a sample hovered, the Open dialog).
import { EkzaError } from '@ekza-animator/anim-core';
import type * as ImportPathModule from './importPath';

export type ImportPath = typeof ImportPathModule;

let loading: Promise<ImportPath> | null = null;
let loaded: ImportPath | null = null;

/** Loads the import pipelines once; later calls share the load, and a failed load is retried by the next call. */
export function loadImportPath(): Promise<ImportPath> {
  if (loading === null) {
    loading = import('./importPath').then((module) => {
      loaded = module;
      return module;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Intent prefetch of the import pipelines; errors are left to the import that needs them. */
export function preloadImportPath(): Promise<void> {
  return loadImportPath().then(() => undefined);
}

/** The loaded import pipelines (an operator's `apply` after its `prepare` loaded them). */
export function importPathLoaded(): ImportPath {
  if (loaded === null) throw new EkzaError('internal', 'the import pipelines are not loaded (prepare loads them)');
  return loaded;
}
