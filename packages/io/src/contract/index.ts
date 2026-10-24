// Contracts (CHARACTER-CONTRACT-SPEC §3, §8.1; ADR 0024; C1). Layered: a game-agnostic model (`model.ts`: game,
// characters, slots of a kind, defaults, rules), canonical JSON and the revision, the generic reader that dispatches on
// the document's `schema` to a profile, the bundled snapshot index — and the profiles, each a strict parser of one
// document format mapped to the model (`omoba.character-contract.v1` first). Loaded only by the contract chunk
// (editor-core `workflows/target`).
export { canonicalJson, contractRevision } from './canonical';
export * from './model';
export {
  CONTRACT_V1_KEYS,
  CONTRACT_V1_RULES,
  CONTRACT_V1_SLOT_ID,
  characterContractV1Model,
  parseCharacterContractV1,
} from './profiles/characterContractV1';
export * from './profiles/characterContractV1Types';
export {
  CONTRACT_MAX_BYTES,
  CONTRACT_PROFILES,
  CONTRACT_SCHEMAS,
  type ContractProfile,
  type ContractReadOptions,
  readContract,
  readContractText,
} from './read';
export { type ContractIndex, type ContractIndexEntry, parseContractIndex } from './snapshotIndex';
