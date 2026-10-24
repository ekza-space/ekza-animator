// Auto-Rig's orchestration in editor-core (STUDIO-TOUCH-SPEC §20.3 item 10, §12.2, §16.3; T5b): the flow both shells
// run — the Auto-Rig wizard (`/autorig`, steps ①–⑤) and Halo's Rig recipes and readiness (`/app`) — so that they issue
// the same operator sequence for the same model (AS-ST-5): intake routing and the first-fix order (`./intake`,
// `./fixes`, `./parts`), Quick Rig and the guess (`./markers`), the `autorig.rig` argument rules with the rebind,
// rigid parts, straighten and its stretch (`./rig`, `./straighten`, `./painted`, `./hands`), the motion test
// (`./motion`), library use (`./library`) and export target naming (`./export`). React-free, string-free and
// shell-free: every document change is an operator run through the host's funnels (`./host`), the shell keeps the U
// state (`AutoRigFlowStore`) and says everything. `./journey` runs ①–⑤ headless and `./log` records its operator
// sequence. Exported from the package root and tree-shaken there (`sideEffects: false`): only lazy shell chunks
// import it, so `/editor` and `/autorig`'s first visit do not grow.
export {
  type AutoRigFlowHost,
  type AutoRigFlowRun,
  type AutoRigFlowState,
  type AutoRigFlowStore,
  type AutoRigStraightened,
  autoRigFlowHost,
  defaultAutoRigFlowState,
  enterFlowWorkspace,
  enterRigWorkspace,
  memoryAutoRigFlowStore,
  quietRun,
  runMessage,
} from './host';
export {
  AUTORIG_FLOW_PROFILE,
  characterIds,
  flowCharacter,
  flowCharacterId,
  liveSubjectMeshes,
  newCharacters,
  type ResolvedAutoRigSubject,
  resolveAutoRigSubject,
} from './subject';
export { CONTACT_GRID, defaultParts, leftOutParts, meshBounds, separateMeshes } from './parts';
export {
  type AutoRigIntakeOp,
  type AutoRigIntakeOutcome,
  type AutoRigIntakeRoute,
  chooseFlowCharacter,
  continueFromSlot,
  discardSlot,
  freshDocument,
  intakeFileArgs,
  intakeModel,
  intakeSampleArgs,
  type OnSubjectTaken,
  reinspectSubject,
  reRigArgs,
  routeIntake,
  takeHandedSubject,
  takeIntakeReport,
} from './intake';
export { AUTORIG_FIX_ORDER, firstFix, transformsUniform } from './checks';
export { applyFix, type AutoRigFixOutcome, fixArgs, nextFix } from './fixes';
export {
  armPoseClass,
  AUTORIG_A_POSE_LIMIT,
  AUTORIG_FINGER_PRESETS,
  type AutoRigFingers,
  type AutoRigMarkersOutcome,
  chooseFingers,
  guessedStartPose,
  markerMeshes,
  openMarkers,
  recordStartPose,
} from './markers';
export {
  adoptRiggedSubject,
  AUTORIG_RIG_LABELS,
  type AutoRigRebindOptions,
  type AutoRigRebindOutcome,
  type AutoRigRigOptions,
  type AutoRigRigOutcome,
  type AutoRigRigPlan,
  type AutoRigRigStage,
  BINDING_LABEL,
  bindPartsRigidly,
  cancelRig,
  followRigStages,
  hasTposeRow,
  type OnRigStage,
  rebindSkin,
  rebindUnasked,
  rememberBound,
  RIG_INTERRUPTED,
  rigidPartsOn,
  rigRunArgs,
  runRig,
  stageAfter,
  wantsStraighten,
  weightsKey,
} from './rig';
export {
  pointsKey,
  STRETCH_LIMIT,
  type StretchData,
  tornLength,
  tornNow,
  tornShare,
  watchStraighten,
} from './straighten';
export { type PaintedPort, paintedAfterRun, paintTracked, watchPaintedSinceBind } from './painted';
export {
  type ArmSnapshot,
  armSnapshot,
  characterJoints,
  FOLLOW_EPSILON,
  type HandTurn,
  handsFollowForearms,
  handTurns,
  turnBetween,
} from './hands';
export { DEFAULT_MOTION_CLIP, MOTION_CLIPS, type MotionTest, type MotionTestState, startMotionTest } from './motion';
export { addLibraryClip, clipAddArgs, IDENTITY_FLOW_CLIP_PARAMS, previewLibraryClip } from './library';
export {
  downloadExport,
  exportArgs,
  exportAvatarName,
  exportFileNameOf,
  exportSaved,
  exportSlugOf,
  prepareExport,
  recommendedTarget,
} from './export';
export {
  type AutoRigFlowLog,
  type AutoRigFlowLogEntry,
  comparableArgs,
  formatLogEntry,
  recordAutoRigFlow,
} from './log';
export { type AutoRigJourneyInput, type AutoRigJourneyResult, runAutoRigJourney } from './journey';
