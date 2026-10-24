// Contracts of the Ekza Game Protocol (GAME-PROTOCOL-SPEC §3–§4, §8.10; ADR 0025; C1): the protocol model
// (`model.ts`: game, rigs, sockets, packaging, rules, slots of a kind — animation, asset, socket —, families, targets
// with sections and offers), canonical JSON and the revision, the strict reader of `ekza.game-contract.v1`, the profile
// modules that check `ext` data (`omoba.character.v1` first) and the bundled snapshot index. Loaded only by the target
// chunk (editor-core `workflows/target`).
export { canonicalJson, contractRevision } from './canonical';
export {
  CONTRACT_PROFILE_MODULES,
  CONTRACT_SLOT_ID,
  type ContractRefusalReason,
  contractRefusalReason,
  CORE_RULE_IDS,
  GAME_CONTRACT_KEYS,
  KNOWN_NAMESPACED_RULE_IDS,
  readGameContract,
} from './gameContract';
export * from './model';
export {
  type ContractProfileModule,
  type ExtPosition,
  OMOBA_CHARACTER_V1,
  OMOBA_CHARACTER_V1_PROFILE,
  omobaSlotExt,
} from './profiles/omobaCharacterV1';
export { CONTRACT_MAX_BYTES, type ContractReadOptions, readContract, readContractText } from './read';
export { type ContractIndex, type ContractIndexEntry, parseContractIndex } from './snapshotIndex';
export {
  type CharacterPackageFill,
  characterOffer,
  characterPackageManifest,
  PACKAGE_MANIFEST_KEY,
  PACKAGE_SCHEMA,
  PACKAGE_SCHEMA_VERSION,
  type PackageFill,
  type PackageManifest,
  packageManifestJson,
  type PackageRequirement,
  readPackageManifest,
} from './packageManifest';
export {
  checkCharacterPackage,
  type GateVerdict,
  gateVerdict,
  type MeasuredValue,
  type PackageCheckOptions,
  type PackageIssue,
  type PackageReport,
  type PackageSlotReport,
  validationReport,
} from './packageCheck';
