// The clip library (M6B-SPEC §0.4.7, §0.5; C12): the UAL bone map, the starter-pack manifest parser, the world-delta
// retarget and the VRMA writer of normalized humanoid clips. One module each, so a consumer of the manifest parser (the
// clip-library chunk) does not load the retarget or glTF Transform.
export { UAL_BONE_MAP } from './boneMap';
export { parseStarterPackManifest } from './manifest';
export { retargetUalClip } from './retarget';
export { writeHumanoidVrma } from './vrma';
