// '@ekza-animator/doc/testing' (Node only; may use node:fs). Final signatures (MVP-SPEC §7 WP-2) plus the building
// blocks other test suites reuse (documented in docs/wp-notes/wp-2.md).
export { runDocumentStoreConformance } from './conformance';
export {
  checkProjections,
  newScene,
  type Scene,
  seedScene,
  writeScene,
} from './conformance/harness';
export {
  makeTestAsset,
  makeTestCharacter,
  makeTestControl,
  makeTestDocument,
  makeTestRig,
  TEST_DOCUMENT_SEED,
} from './document';
export {
  fixturePath,
  type LicensedFixture,
  readFixture,
  readSyntheticFixture,
  type SyntheticFixture,
} from './fixtures';
export { createTestNetwork, TestNetwork } from './network';
export { checkSteps, type PropertyOptions, Rng } from './random';
