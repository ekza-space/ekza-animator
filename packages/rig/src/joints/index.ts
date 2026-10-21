// C2 (skeleton kernel; M6B-SPEC §5.3–§5.7): pure joint edits over records. The MVP edits (§0.3: move, rest rotation,
// set rest, Orient, Mirror, Map Humanoid Bone, Rename, Restore Rest Flexion, Add Missing Bones, the template refit)
// are implemented; the deferred ones (Joint tool chains, insert/split, remove/delete, reparent, duplicate, Apply Pose
// as Rest, sockets) keep their C0 stubs.
import { EkzaError } from '@ekza-studio/anim-core';
import type { JointId, JointRecord } from '@ekza-studio/doc';
import type { TriangleBvh } from '@ekza-studio/mesh-core';
import type { JointEdit } from '../types';

const stub = (symbol: string): never => {
  throw new EkzaError('not-implemented', `rig.${symbol}`);
};

export function insertJoint(
  _joints: readonly JointRecord[],
  _bone: { readonly joint: JointId; readonly child: JointId },
  _t: number,
  _id: JointId,
): JointEdit {
  return stub('insertJoint');
}
export function splitBone(
  _joints: readonly JointRecord[],
  _joint: JointId,
  _child: JointId,
  _n: number,
  _newId: (n: number) => JointId,
): JointEdit {
  return stub('splitBone');
}
/** Splice: the children move to the removed joint's parent. */
export function removeJoints(_joints: readonly JointRecord[], _ids: readonly JointId[]): JointEdit {
  return stub('removeJoints');
}
/** Subtree. */
export function deleteJoints(_joints: readonly JointRecord[], _ids: readonly JointId[]): JointEdit {
  return stub('deleteJoints');
}
export function reparentJoints(
  _joints: readonly JointRecord[],
  _ids: readonly JointId[],
  _parent: JointId | null,
): JointEdit {
  return stub('reparentJoints');
}
/** Rest rotation rule of §5.7: identity-rest joints stay identity; every other joint takes q(boneWorld). */
export function applyPoseAsRest(
  _joints: readonly JointRecord[],
  _boneWorld: (joint: JointId) => Float64Array /* mat4 */,
): JointEdit {
  return stub('applyPoseAsRest');
}
/** Duplicate Joints (§5.4): each selected joint with its subtree, same parent, names suffixed, humanBone null. */
export function duplicateJoints(
  _joints: readonly JointRecord[],
  _ids: readonly JointId[],
  _opts: { readonly mirror: boolean },
  _newId: (n: number) => JointId,
): JointEdit {
  return stub('duplicateJoints');
}
/** The parent rule of the Joint tool and Add Chain (§5.3): the selected joint, else the preset's parent, else the joint
 *  whose segment is nearest `point`; null only for an empty skeleton or the tool option "new root". */
export function chainParent(
  _joints: readonly JointRecord[],
  _point: readonly number[],
  _opts: {
    readonly selected: JointId | null;
    readonly preset: 'tail' | 'ear' | 'hair' | 'skirt' | 'prop' | null;
    readonly newRoot: boolean;
  },
): JointId | null {
  return stub('chainParent');
}
/** Socket placement for a preset (§5.6.3): the parent joint and the rest position; null when the preset's parent bone
 *  is missing. */
export function socketPlacement(
  _joints: readonly JointRecord[],
  _preset: 'back' | 'hipL' | 'hipR' | 'handL' | 'handR',
  _bvh: TriangleBvh,
  _height: number,
): { readonly parent: JointId; readonly position: readonly [number, number, number] } | null {
  return stub('socketPlacement');
}

export { addMissingBones, flexJoints, renameJoint, setHumanBone } from './humanoid';
export { mirrorJoints } from './mirror';
export { moveJoints, setJointRest } from './move';
export { autoSecondary, convertBoneAlignedRotation, frameQuat, orientJoints } from './orient';
export { canonicalQuat, JointIndex } from './util';
