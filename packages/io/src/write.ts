// `@ekza-animator/io/write` (M2A-SPEC §4.4, M-2 §5.21.2): the export path — bake, surgeon, animation-GLB and VRMA
// writers, export lints and the read-back check — behind one subpath, so `editor-core` and `editor` load glTF
// Transform with a dynamic `import('@ekza-animator/io/write')` only when an export runs. The main entry keeps
// exporting the same names in M2a (headless tests and tooling use it).
export { bakeClip, ekzaAnimationMeta } from './bake/bake';
export { reduceBakedClip, trackLeverArms } from './bake/reduce';
export { lintExport } from './lint/lintExport';
export { bakeIntoModel, preexistingTracks } from './surgeon/bakeIntoModel';
export { readBackCheck } from './validate/readBack';
export { compareValidation } from './validate/validate';
export { writeAnimationGlb, writeVrma } from './writers/write';
