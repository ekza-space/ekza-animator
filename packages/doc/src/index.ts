export { EkzaError } from '@ekza-animator/anim-core';
export * from './ids';
export { controlId, derivedId, newId, seededIdSource, setDefaultIdSource, solverId } from './ids/generate';
export { deriveMigratedId, migrateSnapshot } from './migrations/migrate';
export * from './records';
export { defaultChannelValue, isRotationChannel } from './records/channels';
export {
  assetMime,
  makeCamera,
  makeClip,
  makeCurve,
  makeKey,
  makeLayer,
  makeProject,
  toAnimCurve,
} from './records/factories';
export { fractionalIndex, isFractionalIndex } from './records/order';
// M6a (M6A-SPEC §4.2): repairs of loaded content (also run by migrateSnapshot).
export { type RepairResult, repairHierarchy, repairRecord } from './records/repair';
export { emptySnapshot, parseSnapshot, SCHEMA_VERSION, serializeSnapshot } from './snapshot/serialize';
export { requiredWriterVersion } from './snapshot/version';
export * from './store';
export { batchTables, batchTouches } from './store/batchTables';
export { compareStrings, deepEqual, diffFields } from './store/diff';
export { type Reference, referencesOf } from './store/references';
export {
  type ApplyChangesOptions,
  type CommitObserver,
  type CommittedChange,
  createMemoryStore,
  MemoryDocumentStore,
  type MemoryStoreOptions,
} from './store/memory';
export {
  getTableDef,
  isSoftDeletable,
  mergeUnitOf,
  partitionOf,
  registerTable,
  scopeFieldOf,
  validateRecord,
} from './tables/registry';
export { clipToSceneFrame, sceneToClipFrame, wrapClipFrame } from './time/scene';
export { PatchUndoManager, type UndoHost, type UndoWrite } from './undo/patchUndo';
