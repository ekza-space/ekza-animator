export { readAnimations } from './animation/read';
export { bakeClip, ekzaAnimationMeta } from './bake/bake';
export { clipFramesToSeconds } from './bake/meta';
export { reduceBakedClip, trackLeverArms } from './bake/reduce';
export { checkInputBudget } from './budget/check';
export { parseGlb, sha256Hex } from './glb/parse';
export { detectModelFormat, readVrmLicense } from './gltf/format';
export { importProvenance } from './gltf/provenance';
export { lintExport } from './lint/lintExport';
export { LINT_RULES, type LintRuleDef, ruleSeverity } from './lint/rules';
export { ANY_EXPORT_KIND, BUILTIN_EXPORT_PROFILES, profilesForKind } from './profiles/builtin';
export { PROFILE_OMOBA_HANDHELD } from './profiles/handheld';
export { readProjectArchive, writeProjectArchive, writeProjectJson } from './project/archive';
export { skeletonFromGltf } from './skeleton/read';
export { bakeIntoModel, preexistingTracks } from './surgeon/bakeIntoModel';
export * from './types';
export {
  compareValidation,
  type GltfValidatorModule,
  readBackCheck,
  setGltfValidator,
  validateGltf,
} from './validate/validate';
export { inspectVrma, readVrma, type VrmaReadResult } from './vrma/read';
export { clipExportName, exportFileName } from './writers/names';
export { writeAnimationGlb, writeVrma } from './writers/write';
// ---------- M6b (M6B-SPEC §4.4, §0.5; C0 stub and baseline lines, each owner changes only its own) ----------
export { synthesizeContainer, writeCharacter } from './character';
export { parseStarterPackManifest, retargetUalClip, UAL_BONE_MAP, writeHumanoidVrma } from './library';
export { VRM_LINT_RULES } from './lint/vrm';
export { jointsFingerprint, measureSkinned, skeletonFromDoc } from './skeleton/fromDoc';
