// The clip library (M6B-SPEC §0.4.7, §0.5; C12): the UAL bone map, the starter-pack manifest parser, the world-delta
// retarget and the VRMA writer of normalized humanoid clips. One module each, so a consumer of the manifest parser (the
// clip-library chunk) does not load the retarget or glTF Transform.
export { UAL_BONE_MAP } from './boneMap';
export { parseStarterPackManifest } from './manifest';
export { retargetUalClip } from './retarget';
export { writeHumanoidVrma } from './vrma';
// AUTORIG-SPEC §5.5.3, §5.4.1 (D5): the clip parameters on VRMA bytes and the range-of-motion test clip.
export {
  applyClipParams,
  CLIP_ARM_SPACE_RANGE,
  CLIP_SPEED_RANGE,
  clipParamsProblem,
  deriveHumanoidVrma,
  type HumanoidClipParams,
  IDENTITY_HUMANOID_CLIP_PARAMS,
  isFullTrim,
  isIdentityClipParams,
  mirrorBone,
} from './params';
export {
  ROM_FPS,
  ROM_FRAMES_PER_POSE,
  ROM_POSES,
  type RomPose,
  romClip,
  romFrameOf,
  romRotation,
  romVrma,
} from './rom';
