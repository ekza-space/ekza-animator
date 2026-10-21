export { AUTORIG_VERSION, autoRig } from './autorig/autoRig';
export { readRigDefinition, writeRigDefinition } from './autorig/definition';
// ---------- M6b (M6B-SPEC §4.3; C0 stub and baseline lines, each owner changes only its own) ----------
export { updateAutoRig } from './autorig/update';
export { compileRig } from './compile/compileRig';
export { bakeConstraints, CONSTRAINT_OPS, mirrorConstraint, withoutConstraints } from './constraints';
export { parseConstraintParams } from './constraints/params';
export { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT, VRM_REQUIRED_BONES, VRM0_BONE_ALIASES } from './humanoid/bones';
export { flipYawHumanLocal, humanoidRestWorldPositions } from './humanoid/rest';
export { plantFeetChannels } from './ik/plantFeet';
export { solveTwoBoneIk } from './ik/twoBone';
export { detectClipFps, importHumanoidClip, importRawClip, remapRawClipByName } from './import/clip';
export {
  controlForNode,
  isHumanoidProgram,
  nodeForControl,
  solveBoneChannels,
  solveControlChannels,
} from './inverse/solve';
export {
  addMissingBones,
  applyPoseAsRest,
  autoSecondary,
  canonicalQuat,
  chainParent,
  convertBoneAlignedRotation,
  deleteJoints,
  duplicateJoints,
  flexJoints,
  frameQuat,
  humanChainChildren,
  insertJoint,
  JointIndex,
  mirrorHumanBone,
  mirrorJoints,
  moveJoints,
  orientJoints,
  removeJoints,
  renameJoint,
  reparentJoints,
  setHumanBone,
  setJointRest,
  sideFromName,
  socketPlacement,
  splitBone,
} from './joints';
export { isRigOpSkipped } from './kernel/internals';
export { type RigOpImpl, registerBuiltinRigOps, registerRigOp } from './kernel/ops';
export { controlWorld } from './kernel/pose';
export { footprintShape, validateFootParams } from './limb/foot';
export {
  evaluateWithLimbMode,
  footPivotWorlds,
  ikControlForEndWorld,
  limbOfControl,
  matchFkToIk,
  matchIkToFk,
} from './limb/match';
export { limbIkRecords } from './limb/records';
export { mirrorPose } from './mirror/mirrorPose';
export { applyPoseClipboard, makePoseClipboard } from './pose/clipboard';
export { convertRotateOrderKeys, convertRotateOrderKeysWith } from './pose/rotateOrder';
export {
  FIT,
  fitQuickRig,
  fitTemplate,
  frontCentreZ,
  frontExtent,
  GUESS,
  guessMarkers,
  type JointLookup,
  markersFromJoints,
  projectedCenter,
  QUICK_RIG_CENTRE_MARKERS,
  QUICK_RIG_SIDE_MARKERS,
  quickRigFacingTurn,
  type QuickRigStartChecks,
  quickRigStartChecks,
  START_CHECKS,
} from './quickrig';
export { type CurveCache, createClipSampler, createCurveCache } from './sampler/cache';
export {
  applyOverrides,
  channelDefaultValue,
  readAttr,
  readControlChannels,
  writeAttr,
  writeControlChannels,
} from './sampler/channels';
export { computeInfluenceKeyTimes } from './schedule/influence';
export { computeStepSchedule } from './schedule/steps';
export { editShapePoints, generatedShape, mirrorShape, transformShape } from './shapes';
export {
  assembleTemplate,
  DEFAULT_FLEXION,
  hingeBend,
  isSkeletonPreset,
  minimumBend,
  PRESET_BONES,
  placeTemplate,
  presetOfBones,
  refitTemplateJoints,
  SKELETON_PRESETS,
  skeletonTemplate,
  type TemplateKey,
  templateJointId,
  templateJointRecords,
  templateParent,
} from './templates';
export * from './types';
export { checkSkeleton, SKELETON_CHECKS } from './validate';
