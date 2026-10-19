// The lazy kernel chunk (M6A-SPEC §2): `loadMeshKernel()` imports `@ekza-animator/mesh-core` on first need (a project
// with mesh records, entering Model, a `mesh.*` run); until it resolves, runtimes are 'loading' and `mesh.*` polls
// fail with "Mesh tools are loading". This is the one module of editor-core that imports the kernel at run time.
import type * as MeshKernelModule from '@ekza-animator/mesh-core';

/** The lazy kernel module (`@ekza-animator/mesh-core`). */
export type MeshKernel = typeof MeshKernelModule;

let kernel: MeshKernel | null = null;
let kernelLoad: Promise<MeshKernel> | null = null;

/** Loads the kernel chunk once (later calls share the promise; a failed load is retried by the next call). */
export function loadMeshKernel(): Promise<MeshKernel> {
  if (kernelLoad === null) {
    // oxlint-disable-next-line no-restricted-imports -- the one lazy kernel loader of editor-core (M6A-SPEC §2)
    const load = import('@ekza-animator/mesh-core').then((module) => {
      kernel = module;
      return module;
    });
    kernelLoad = load;
    load.catch(() => {
      if (kernelLoad === load) kernelLoad = null;
    });
  }
  return kernelLoad;
}

/** The kernel when its chunk has loaded, else null (callers poll-fail "Mesh tools are loading"). */
export function meshKernel(): MeshKernel | null {
  return kernel;
}
