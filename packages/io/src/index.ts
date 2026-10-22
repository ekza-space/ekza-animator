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
export { type CharacterWriteOptions, CONTAINER_GENERATOR, synthesizeContainer, writeCharacter } from './character';
export {
  CHARACTER_EXPORT_KIND,
  type CharacterArtifact,
  type CharacterArtifactInput,
  type CharacterReadBack,
  exportCharacterArtifact,
  readBackCharacter,
  trianglesOf,
} from './character/artifact';
export { characterVertices } from './character/vertices';
// C10 (§0.4.6, §5.22): model-character profiles, the VRM 1.0 meta and licence presets, OMOBA's rules as lints.
export {
  CHARACTER_EXPORT_BANNER,
  type CharacterFormat,
  characterExtension,
  characterFormats,
  characterProfileProblem,
  characterProfiles,
  includePropsDefault,
  LOCAL_PROFILE_ID,
  MODEL_CHARACTER_PROFILE_IDS,
  OMOBA_GLB_PROFILE_ID,
  SPACE_PROFILE_ID,
} from './profiles/character';
export {
  checkVrmMeta,
  checkVrmRuntime,
  isVrmLintCode,
  lintVrmBytes,
  pngSize,
  VRM_META_RULE_IDS,
  VRM_RUNTIME_RULE_IDS,
  type VrmRuntimeReport,
} from './lint/vrm';
export {
  CC0_DEED_URL,
  CC_BY_DEED_URL,
  patchVrmMeta,
  thirdPartyLicensesOf,
  VRM_LICENCE_CHOICES,
  VRM_LICENCE_FIELDS,
  VRM_LICENCE_PRESETS,
  VRM_LICENSE_URL,
  vrmcMetaOf,
} from './vrm/meta';
export { renderCharacterThumbnail, THUMBNAIL_SIZE } from './vrm/thumbnail';
export { parseStarterPackManifest, retargetUalClip, UAL_BONE_MAP, writeHumanoidVrma } from './library';
export { VRM_LINT_RULES } from './lint/vrm';
export {
  type DocVertices,
  jointsFingerprint,
  measureSkinned,
  type SkeletonFromDocOptions,
  skeletonFromDoc,
} from './skeleton/fromDoc';
// Auto-Rig D6 (AUTORIG-SPEC §5.6.4): the OMOBA local test kit packer and the deterministic zip of the VRMA bundle.
export * from './omoba';
