// The model and clip import pipelines as one lazy chunk (M2A-SPEC §5.21.2): GLB/VRM parsing and input budgets, the
// auto-rig, clip import and retargeting (rig `import*`), VRMA and animation readers. `importLoader.ts` loads this module
// with a dynamic import on the first import or on intent; nothing on the editor's initial route imports it statically.
export { applyClipImport, type ClipImportPlan, prepareGlbAnimationImport, prepareVrmaImport } from './importAnimation';
export { applyModelImport, type ModelImportPlan, prepareModelImport } from './importModel';
// AUTORIG-SPEC §5.5.3 (D5): library VRMA bytes with clip parameters, and the range-of-motion clip's bytes (§5.4.1).
export { deriveHumanoidVrma, romVrma } from '@ekza-studio/io';
