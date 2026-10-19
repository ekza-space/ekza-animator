// `app.meshes` and `app.blobs` (M6A-SPEC §9.1: one factory file per editor service; owned by B7 after B0a).
import type { DocumentStore } from '@ekza-animator/doc';
import { createMeshRuntimeRegistry, type KernelMeshRuntimes } from '../../mesh';
import { createMemoryBlobStore } from '../../services/blobs';
import type { BlobStore, EditorServices } from '../../types';

/** The host's blob store, else a fresh memory store (Node, tests). */
export function createBlobs(services: EditorServices): BlobStore {
  return services.blobs ?? createMemoryBlobStore();
}

/**
 * The runtime registry. It binds the rest of the app (history, session, prefs, component selections) on first use
 * through `attachMeshes(app)` (M6A-MRD-1): the composition root passes only what exists before the history.
 */
export function createMeshes(deps: {
  readonly store: DocumentStore;
  readonly blobs: BlobStore;
  readonly services: EditorServices;
  readonly requestFrame: () => void;
}): KernelMeshRuntimes {
  return createMeshRuntimeRegistry({
    store: deps.store,
    blobs: deps.blobs,
    ...(deps.services.kernelDebug === undefined ? {} : { kernelDebug: deps.services.kernelDebug }),
    notify: deps.services.notify,
    changed: deps.requestFrame,
  });
}
