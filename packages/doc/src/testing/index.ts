// '@ekza-studio/doc/testing' (Node only; may use node:fs). Final signatures (MVP-SPEC §7 WP-2) plus the building
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
// M6a (M6A-SPEC §4.2): complete records of the seven modeling tables.
export {
  makeTestGroup,
  makeTestImageAsset,
  makeTestImagePlane,
  makeTestJoint,
  makeTestMesh,
  makeTestPalette,
  makeTestSkeleton,
  makeTestSwatch,
  testHash,
  withSchemaV3,
} from './records-v3';
export { checkSteps, type PropertyOptions, Rng } from './random';
// M6a B7 (M6A-SPEC §9 B7): mesh-ref fork detection and the observed refs of a batch.
export { type MeshRefFork, meshRefForks, type ObservedRef, refsOfBatch } from './meshRefs';
