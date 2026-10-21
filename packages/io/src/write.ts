// `@ekza-studio/io/write` (M2A-SPEC §4.4, M-2 §5.21.2): the export path — bake, surgeon, animation-GLB and VRMA
// writers, export lints and the read-back check — behind one subpath, so `editor-core` and `editor` load glTF
// Transform with a dynamic `import('@ekza-studio/io/write')` only when an export runs. The main entry keeps
// exporting the same names in M2a (headless tests and tooling use it).
import type * as MeshIo from './mesh';

export { bakeClip, ekzaAnimationMeta } from './bake/bake';
export { reduceBakedClip, trackLeverArms } from './bake/reduce';
export { lintExport } from './lint/lintExport';
export { bakeIntoModel, preexistingTracks } from './surgeon/bakeIntoModel';
export { readBackCheck } from './validate/readBack';
export { compareValidation } from './validate/validate';
export { writeAnimationGlb, writeVrma } from './writers/write';
// M6a (M6A-SPEC §4.5): the author writer for static models and the surgeon's "replace primitives" step (B8).
export { writeStaticGlb } from './export/author';
export { type ShaderFactors, shaderFactors, shaderKey, shaderLabel } from './export/author/shading';
export { BAKE_MARKER_KEY, BAKE_MARKER_V2_KEY } from './surgeon/marker';
export { rebuildContainer, replacePrimitives } from './surgeon/replacePrimitives';

/** The `io/mesh` module type (for callers of `loadMeshIo`). */
export type MeshIoModule = typeof MeshIo;

/**
 * The lazy mesh entry (`io/mesh`: make editable, `meshToPrimitives`, the palette writer), loaded on first use. The
 * write path reaches the kernel only through it, so animation-only exports never load the mesh kernel; editor-core,
 * whose import rules allow `io/write` but not `io/mesh`, makes meshes editable through this loader (M6A-B8 notes).
 */
export function loadMeshIo(): Promise<MeshIoModule> {
  return import('./mesh');
}
export {
  exportStaticModel,
  isStaticReadBack,
  readBackStatic,
  type StaticExportOptions,
  type StaticReadBackReport,
  type StaticThreeReadBack,
  withThreeReadBack,
} from './export/author/artifact';
export { BUDGET_PRESETS, type BudgetPreset, profileBudget, resolveBudget } from './profiles/budgets';
export type { MeshLintInput } from './lint/meshes';
export { manualModelProvenance, modelBlock } from './provenance/model';
