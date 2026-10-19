// Mesh runtimes (M6A-SPEC §4.6, §5.5, §5.13, §5.20; B7): the lazy kernel loader, the runtime registry with sessions,
// commits, the MeshSetOp runner, the journal, blob reference counts and the undo budget, and the reader rules of skin
// and morph layers. See registry.ts for the overview.
import type { EditorApp } from '../types';
import type { KernelMeshRuntimes } from './registry';

export { type MeshKernel, loadMeshKernel, meshKernel } from './kernel';
export {
  BUDGET_TOAST,
  type CommitContext,
  createMeshRuntimeRegistry,
  type GcReport,
  type KernelMeshRuntimes,
  type LastSetOp,
  type MeshClock,
  type MeshRegistryDeps,
  SWEEP_INTERVAL_MS,
} from './registry';
export { type RunSettings, worldPlacement } from './context';
export { chunkIdsOfManifest } from './ledger';
export {
  jointPaletteOf,
  morphNamesOf,
  type PaletteJoint,
  readSkin,
  refJointsOf,
  type SkinRead,
} from './skin';
export { uniqueMeshName } from './records';

/** The app's runtime registry with the B7 extensions (every kernel-built app has one). */
export function kernelMeshes(app: EditorApp): KernelMeshRuntimes | null {
  const meshes = app.meshes as Partial<KernelMeshRuntimes>;
  return typeof meshes.attach === 'function' && typeof meshes.collect === 'function'
    ? (meshes as KernelMeshRuntimes)
    : null;
}

/**
 * Binds the app to its mesh registry (history drops and budget, session symmetry/soft settings, component
 * selections). Idempotent; every B7 entry point calls it (operators, autosave, project workflows, the test API), so
 * an app that writes mesh data is attached before its first commit (M6A-MRD-1).
 */
export function attachMeshes(app: EditorApp): KernelMeshRuntimes | null {
  const meshes = kernelMeshes(app);
  meshes?.attach(app);
  return meshes;
}
