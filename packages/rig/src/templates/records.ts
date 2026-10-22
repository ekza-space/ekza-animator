// Template joints as records (M6B-SPEC §5.2, §3 rule 3; C2): ids `<skeletonId>:<humanBone>` and `<skeletonId>:root`,
// names = the VRM bone names and `root`, keys = the human bone and `root`, sides from the bone, `mirror` both ways,
// role 'bone' for every humanoid joint and 'helper' for `root`, identity rest rotations (World orientation), order
// keys in template order. `refitTemplateJoints` moves an existing template skeleton onto new template joints in place.
import type { JointId, JointRecord, SkeletonId } from '@ekza-studio/doc';
import { orderKey } from '../autorig/naming';
import { humanBoneSide, mirrorHumanBone } from '../humanoid/map';
import type { JointEdit, TemplateJoint } from '../types';
import type { TemplateKey } from './presets';

const IDENTITY: readonly [number, number, number, number] = [0, 0, 0, 1];

/** The id of a template joint: `<skeletonId>:<key>`. */
export function templateJointId(skeleton: SkeletonId, key: TemplateKey): JointId {
  return `${skeleton}:${key}` as JointId;
}

/** New joint records of a template skeleton (§5.2 identities). */
export function templateJointRecords(template: readonly TemplateJoint[], skeleton: SkeletonId): JointRecord[] {
  const keys = new Set(template.map((joint) => joint.key));
  return template.map((joint, index) => {
    const bone = joint.key === 'root' ? null : joint.key;
    const partner = bone === null ? null : mirrorHumanBone(bone);
    return {
      id: templateJointId(skeleton, joint.key),
      skeleton,
      parent: joint.parent === null ? null : templateJointId(skeleton, joint.parent),
      order: orderKey(index),
      name: joint.key,
      humanBone: bone,
      restPosition: [joint.position[0], joint.position[1], joint.position[2]],
      restRotation: IDENTITY,
      tail: joint.tail === null ? null : [joint.tail[0], joint.tail[1], joint.tail[2]],
      side: bone === null ? 'C' : humanBoneSide(bone),
      mirror: partner !== null && keys.has(partner) ? templateJointId(skeleton, partner) : null,
      deleted: null,
      role: bone === null ? 'helper' : 'bone',
      key: joint.key,
    };
  });
}

/**
 * §0.4.2 Re-run: the live joints of a template skeleton moved onto `template` in place — each joint matched by its
 * human bone (`root` by key) keeps its id, name, key, parent, role, order and rotation and takes the template
 * position and tail; joints the template does not place are left alone. Only changed joints are upserted.
 */
export function refitTemplateJoints(joints: readonly JointRecord[], template: readonly TemplateJoint[]): JointEdit {
  const byKey = new Map<string, TemplateJoint>(template.map((joint) => [joint.key, joint]));
  const upserts: JointRecord[] = [];
  const warnings: string[] = [];
  for (const joint of joints) {
    if (joint.deleted !== null) continue;
    const target = byKey.get(joint.humanBone ?? (joint.key === 'root' ? 'root' : ''));
    if (target === undefined) continue;
    const restPosition: [number, number, number] = [target.position[0], target.position[1], target.position[2]];
    const tail: [number, number, number] | null =
      target.tail === null
        ? joint.tail === null
          ? null
          : [...joint.tail]
        : [target.tail[0], target.tail[1], target.tail[2]];
    const same =
      restPosition.every((v, i) => Object.is(v, joint.restPosition[i])) &&
      (tail === null
        ? joint.tail === null
        : joint.tail !== null && tail.every((v, i) => Object.is(v, joint.tail?.[i])));
    if (!same) upserts.push({ ...joint, restPosition, tail });
  }
  const placed = new Set(joints.map((joint) => joint.humanBone ?? (joint.key === 'root' ? 'root' : '')));
  for (const joint of template) {
    if (!placed.has(joint.key)) warnings.push(`${joint.key} is not in the skeleton; Refit leaves it out`);
  }
  return { upserts, deletes: [], folds: new Map(), rotationDeltas: new Map(), warnings };
}
