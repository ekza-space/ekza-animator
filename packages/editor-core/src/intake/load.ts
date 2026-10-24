// The lazy mesh-wasm loader (MODELING-PLAN §7.2 G-a; the `mesh-wasm` size boundary): the one module of editor-core
// that imports `@ekza-studio/mesh-wasm` at run time. The intake operators' bodies call it from `prepare`; in the browser
// the chain runs in the intake worker and this thread only copies the job (the meshoptimizer WASM loads in the
// worker), in hosts without workers the whole chain runs here.
import type * as MeshWasmModule from '@ekza-studio/mesh-wasm';

export type MeshWasm = typeof MeshWasmModule;

let loading: Promise<MeshWasm> | null = null;

/** Loads `@ekza-studio/mesh-wasm` once (a failed load is retried by the next call). */
export function loadMeshWasm(): Promise<MeshWasm> {
  if (loading === null) {
    // oxlint-disable-next-line no-restricted-imports -- the one lazy mesh-wasm loader of editor-core (MODELING-PLAN §7.2)
    const load = import('@ekza-studio/mesh-wasm');
    loading = load;
    load.catch(() => {
      if (loading === load) loading = null;
    });
  }
  return loading;
}
