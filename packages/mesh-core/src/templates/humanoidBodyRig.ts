// CR-2 (M6B-SPEC §2.4, §5.2; C2 under the MVP's direct-edit rule §0.4.1): the joint positions the humanoid body
// generator (`humanoidBody`, M6A-SPEC §5.16) was built around, in generator-local space (T-pose, facing +Z, grounded,
// left = +X), straight limbs (the template applies its rest flexion). The same positions serve both styles: the
// segmented shells split the smooth body at these joints. Scaled uniformly from the 1.6 m base like the mesh.
//
// Built around the body's rings: hips at the hip ring above the crotch, the knees between the two knee rings, the
// elbows between the two elbow rings, the wrists at the wrist ring, the ankles above the foot ring, the toes at the
// ball of the foot; spine and chest on the waist and chest rings, the clavicles halfway to the shoulder joints.

/** Humanoid bone names this rig places (a subset of the VRM 1.0 humanoid bones; mesh-core does not import doc). */
export type HumanoidBodyRigBone =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftShoulder'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'leftHand'
  | 'rightShoulder'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'rightHand'
  | 'leftUpperLeg'
  | 'leftLowerLeg'
  | 'leftFoot'
  | 'leftToes'
  | 'rightUpperLeg'
  | 'rightLowerLeg'
  | 'rightFoot'
  | 'rightToes';

const BASE_HEIGHT = 1.6;

/** Centre joints (x = 0) at the 1.6 m base. */
const CENTRE: readonly (readonly [HumanoidBodyRigBone, number, number])[] = [
  ['hips', 0.82, 0],
  ['spine', 1.0, 0],
  ['chest', 1.19, 0],
  ['upperChest', 1.29, 0],
  ['neck', 1.4, 0],
  ['head', 1.46, 0],
];
/** Left joints at the 1.6 m base (the right ones are their mirrors). */
const SIDE: readonly (readonly [string, number, number, number])[] = [
  ['Shoulder', 0.1, 1.26, 0],
  ['UpperArm', 0.2, 1.25, 0],
  ['LowerArm', 0.475, 1.25, 0],
  ['Hand', 0.7, 1.25, 0],
  ['UpperLeg', 0.09, 0.79, 0],
  ['LowerLeg', 0.09, 0.47, 0],
  ['Foot', 0.09, 0.08, 0],
  ['Toes', 0.09, 0.03, 0.085],
];

/** CR-2: the generator's joint positions for `height` (clamped to 0.5…3 like `humanoidBody`). */
export function humanoidBodyRig(params: {
  readonly height: number;
}): Readonly<Partial<Record<HumanoidBodyRigBone, readonly [number, number, number]>>> {
  const height = Number.isFinite(params.height) ? Math.min(3, Math.max(0.5, params.height)) : BASE_HEIGHT;
  const s = height / BASE_HEIGHT;
  const out: Partial<Record<HumanoidBodyRigBone, readonly [number, number, number]>> = {};
  for (const [bone, y, z] of CENTRE) out[bone] = [0, y * s, z * s];
  for (const [stem, x, y, z] of SIDE) {
    out[`left${stem}` as HumanoidBodyRigBone] = [x * s, y * s, z * s];
    out[`right${stem}` as HumanoidBodyRigBone] = [-(x * s), y * s, z * s];
  }
  return out;
}
