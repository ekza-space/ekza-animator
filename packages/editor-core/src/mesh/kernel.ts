// The lazy kernel chunk (M6A-SPEC §2): `loadMeshKernel()` imports `@ekza-animator/mesh-core` on first need (a project
// with mesh records, entering Model, a `mesh.*` run) together with the runtime registry's implementation (impl.ts:
// commits, sessions, journal, GC — B0a's size note: only a facade of the registry fits in the editor route). Until both
// resolve, runtimes are 'loading' and `mesh.*` polls fail with "Mesh tools are loading". This is the one module of
// editor-core that imports the kernel at run time.
import type * as MeshKernelModule from '@ekza-animator/mesh-core';
import type * as MeshImplModule from './impl';

/** The lazy kernel module (`@ekza-animator/mesh-core`). */
export type MeshKernel = typeof MeshKernelModule;
/** The lazy runtime implementation module. */
export type MeshImpl = typeof MeshImplModule;

let kernel: MeshKernel | null = null;
let impl: MeshImpl | null = null;
let kernelLoad: Promise<MeshKernel> | null = null;
const loadedListeners = new Set<() => void>();

/** Loads the kernel chunk and the runtime implementation once (a failed load is retried by the next call). */
export function loadMeshKernel(): Promise<MeshKernel> {
  if (kernelLoad === null) {
    const load = Promise.all([
      // oxlint-disable-next-line no-restricted-imports -- the one lazy kernel loader of editor-core (M6A-SPEC §2)
      import('@ekza-animator/mesh-core'),
      import('./impl'),
    ]).then(([kernelModule, implModule]) => {
      impl = implModule;
      kernel = kernelModule;
      for (const listener of Array.from(loadedListeners)) listener();
      loadedListeners.clear();
      return kernelModule;
    });
    kernelLoad = load;
    load.catch(() => {
      if (kernelLoad === load) kernelLoad = null;
    });
  }
  return kernelLoad;
}

/** The kernel when its chunk (and the runtime implementation) has loaded, else null ("Mesh tools are loading"). */
export function meshKernel(): MeshKernel | null {
  return kernel;
}

/** The runtime implementation module once loaded (with the kernel), else null. */
export function meshImpl(): MeshImpl | null {
  return impl;
}

/** Calls `listener` once when the kernel loads (at once when it already has). */
export function whenMeshKernelLoaded(listener: () => void): () => void {
  if (kernel !== null) {
    listener();
    return () => {};
  }
  loadedListeners.add(listener);
  return () => {
    loadedListeners.delete(listener);
  };
}
