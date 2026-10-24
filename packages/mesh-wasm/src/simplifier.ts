// The Decimator's WASM (MODELING-PLAN §3.1 `mesh-wasm`, ADR 0014): meshoptimizer's simplifier module (MIT, pinned
// 1.3.0; the WASM is embedded in the module, ≈ 20 kB gzip), imported on first use only. This module is the one place
// that loads it, so neither the editor route nor the kernel chunk ever carries it: the editor reaches it through the
// intake worker (or this package's lazy chunk in hosts without workers).

/** `MeshoptSimplifier` of `meshoptimizer/simplifier`. */
export type Simplifier = typeof import('meshoptimizer/simplifier').MeshoptSimplifier;

/** `check-size` marker of the mesh-wasm boundary (lazy: never in a route's initial scripts). */
export const MESH_WASM_MARKER = 'ekza-mesh-wasm' as const;

/** The pinned meshoptimizer version (package.json pins it; the wp-note records the check against the registry). */
export const MESHOPTIMIZER_VERSION = '1.3.0' as const;

let loading: Promise<Simplifier> | null = null;

/** Loads and instantiates the simplifier once (a failed load is retried by the next call). */
export function loadSimplifier(): Promise<Simplifier> {
  if (loading === null) {
    const load = import('meshoptimizer/simplifier').then(async ({ MeshoptSimplifier }) => {
      await MeshoptSimplifier.ready;
      if (!MeshoptSimplifier.supported) throw new Error(`${MESH_WASM_MARKER}: WebAssembly is not supported here`);
      return MeshoptSimplifier;
    });
    loading = load;
    load.catch(() => {
      if (loading === load) loading = null;
    });
  }
  return loading;
}
