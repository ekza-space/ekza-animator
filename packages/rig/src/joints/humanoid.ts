// Humanoid joint edits (M6B-SPEC §5.4, §5.21 fixes; C2): Map Humanoid Bone (uniqueness and the VRM parent map, side
// follows the bone), Rename (unique per skeleton, the partner's swapped name, keys unchanged), Restore Rest Flexion
// (the §0.4.2 minimum bend on elbows and knees) and Add Missing Bones (map an unmapped joint near the template position
// of a missing required bone, else add the bone at that position under its template parent).
import { EkzaError } from '@ekza-studio/anim-core';
import type { HumanBoneName, JointId, JointRecord, SkeletonRecord } from '@ekza-studio/doc';
import { orderKey, sideFromName } from '../autorig/naming';
import { HUMAN_BONE_PARENT, VRM_REQUIRED_BONES } from '../humanoid/bones';
import { humanBoneSide, mirrorHumanBone } from '../humanoid/map';
import { placeTemplate, skeletonTemplate } from '../templates';
import { DEFAULT_FLEXION, ELBOW_HINGE, KNEE_HINGE, minimumBend } from '../templates/build';
import { isSkeletonPreset } from '../templates/presets';
import type { JointEdit } from '../types';
import { emptyEdit, JointIndex, mirrorV3, sameV3, type V3, v3 } from './util';

const edit = (upserts: JointRecord[], warnings: string[] = []): JointEdit => ({
  upserts,
  deletes: [],
  folds: new Map(),
  rotationDeltas: new Map(),
  warnings,
});

/** The nearest mapped humanoid ancestor of a joint in the hierarchy (skipping unmapped joints). */
function mappedAncestor(index: JointIndex, joint: JointRecord, ignore: JointId | null): JointRecord | undefined {
  let p = index.parentOf(joint);
  const guard = new Set<JointId>();
  while (p !== undefined && !guard.has(p.id)) {
    if (p.humanBone !== null && p.id !== ignore) return p;
    guard.add(p.id);
    p = index.parentOf(p);
  }
  return undefined;
}

/** The nearest VRM ancestor of `bone` mapped in the skeleton (other than `ignore`). */
function vrmAncestor(index: JointIndex, bone: HumanBoneName, ignore: JointId | null): JointRecord | undefined {
  let parent = HUMAN_BONE_PARENT[bone];
  while (parent !== null) {
    const mapped = index.byHumanBone(parent);
    if (mapped !== undefined && mapped.id !== ignore) return mapped;
    parent = HUMAN_BONE_PARENT[parent];
  }
  return undefined;
}

/**
 * `skel.joint.setHumanBone`: maps (or with null unmaps) a joint. Refuses (`EkzaError('op-refused')`) a bone another
 * joint holds ("leftHand is mapped to Hand_L") and a mapping that breaks the VRM parent map (the bone's nearest mapped
 * VRM ancestor must be the joint's nearest mapped ancestor in the hierarchy). The side follows the bone.
 */
export function setHumanBone(joints: readonly JointRecord[], id: JointId, bone: HumanBoneName | null): JointEdit {
  const index = new JointIndex(joints);
  const joint = index.get(id);
  if (joint === undefined) throw new EkzaError('invalid-input', `No joint ${id}`);
  if (joint.humanBone === bone) return emptyEdit();
  if (bone === null) return edit([{ ...joint, humanBone: null }]);
  const owner = index.byHumanBone(bone);
  if (owner !== undefined && owner.id !== id) {
    throw new EkzaError('op-refused', `${bone} is already mapped to ${owner.name}`);
  }
  const expected = vrmAncestor(index, bone, id);
  const actual = mappedAncestor(index, joint, id);
  if ((expected?.id ?? null) !== (actual?.id ?? null)) {
    const want = expected === undefined ? 'no humanoid parent' : `${expected.name} (${expected.humanBone})`;
    throw new EkzaError('op-refused', `${bone} must sit under ${want} (VRM parent map)`);
  }
  return edit([{ ...joint, humanBone: bone, side: humanBoneSide(bone) }]);
}

/**
 * `skel.joint.rename`: a unique name per skeleton (a duplicate is refused); with `mirror` the partner takes the
 * swapped name (`sideFromName`) when the name carries a side. Keys never change (P-J6).
 */
export function renameJoint(joints: readonly JointRecord[], id: JointId, name: string, mirror: boolean): JointEdit {
  const index = new JointIndex(joints);
  const joint = index.get(id);
  if (joint === undefined) throw new EkzaError('invalid-input', `No joint ${id}`);
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new EkzaError('invalid-input', 'A joint needs a name');
  const taken = (n: string, except: readonly JointId[]) =>
    index.order.some((other) => other.name === n && !except.includes(other.id));
  const upserts: JointRecord[] = [];
  const warnings: string[] = [];
  const partner = mirror ? index.partnerOf(joint) : undefined;
  const swapped = partner === undefined ? undefined : sideFromName(trimmed)?.mirrored;
  const except = partner === undefined ? [id] : [id, partner.id];
  if (taken(trimmed, except)) throw new EkzaError('op-refused', `Another joint is named ${trimmed}`);
  if (trimmed !== joint.name) upserts.push({ ...joint, name: trimmed });
  if (partner !== undefined && swapped !== undefined && swapped !== partner.name) {
    if (taken(swapped, except) || swapped === trimmed)
      throw new EkzaError('op-refused', `Another joint is named ${swapped}`);
    upserts.push({ ...partner, name: swapped });
  }
  if (joint.humanBone !== null && upserts.length > 0)
    warnings.push(`${joint.name} is a template bone (${joint.humanBone})`);
  return edit(upserts, warnings);
}

/**
 * `skel.joint.flex` (Restore Rest Flexion; the `skel.hinge-bend` fix): the §0.4.2 minimum bend of `angle` on the
 * elbow and knee joints among `ids` (null = all four), parent and child found by human bone. A limb already bent by
 * ≥ angle is unchanged.
 */
export function flexJoints(joints: readonly JointRecord[], angle: number, ids: readonly JointId[] | null): JointEdit {
  const index = new JointIndex(joints);
  const hinges: readonly (readonly [HumanBoneName, HumanBoneName, HumanBoneName, V3])[] = [
    ['leftUpperArm', 'leftLowerArm', 'leftHand', ELBOW_HINGE],
    ['rightUpperArm', 'rightLowerArm', 'rightHand', ELBOW_HINGE],
    ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', KNEE_HINGE],
    ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', KNEE_HINGE],
  ];
  const upserts: JointRecord[] = [];
  for (const [a, b, c, d] of hinges) {
    const A = index.byHumanBone(a);
    const B = index.byHumanBone(b);
    const C = index.byHumanBone(c);
    if (A === undefined || B === undefined || C === undefined) continue;
    if (ids !== null && !ids.includes(B.id)) continue;
    const next = minimumBend(v3(A.restPosition), v3(B.restPosition), v3(C.restPosition), d, angle);
    if (!sameV3(next, B.restPosition)) upserts.push({ ...B, restPosition: v3(next) });
  }
  return edit(upserts);
}

/**
 * `skel.template.addMissing` (the `skel.required-bones` fix): for each missing required bone (VRM order, parents
 * first) an unmapped joint within 0.05 H of the bone's template position is mapped; otherwise the bone is added at
 * that position (`<skeletonId>:<bone>`, the template's identities) under the joint of its template parent. The
 * template is the skeleton's preset (Standard 33 for custom) scaled to the joints' height and stood on their ground.
 */
export function addMissingBones(
  joints: readonly JointRecord[],
  skeleton: SkeletonRecord,
): JointEdit & { readonly added: readonly JointId[]; readonly mapped: readonly JointId[] } {
  const index = new JointIndex(joints);
  const H = index.height();
  const preset = isSkeletonPreset(skeleton.preset) ? skeleton.preset : 'standard33';
  const template = placeTemplate(
    skeletonTemplate(preset, { height: H, proportions: 'standard', flexion: DEFAULT_FLEXION }),
    [0, index.ground(), 0],
  );
  const position = new Map(template.map((joint) => [joint.key, joint]));
  const upserts = new Map<JointId, JointRecord>();
  const added: JointId[] = [];
  const mapped: JointId[] = [];
  const holder = (bone: HumanBoneName): JointRecord | undefined => {
    for (const joint of upserts.values()) if (joint.humanBone === bone) return joint;
    return index.byHumanBone(bone);
  };
  let created = 0;
  for (const bone of VRM_REQUIRED_BONES) {
    if (holder(bone) !== undefined) continue;
    const tpl = position.get(bone);
    if (tpl === undefined) continue;
    let best: JointRecord | undefined;
    let bestD = 0.05 * H;
    for (const joint of index.order) {
      if (joint.humanBone !== null || upserts.has(joint.id) || joint.role !== 'bone') continue;
      const d = Math.hypot(
        joint.restPosition[0] - tpl.position[0],
        joint.restPosition[1] - tpl.position[1],
        joint.restPosition[2] - tpl.position[2],
      );
      if (d <= bestD) {
        bestD = d;
        best = joint;
      }
    }
    if (best !== undefined) {
      upserts.set(best.id, { ...best, humanBone: bone, side: humanBoneSide(bone) });
      mapped.push(best.id);
      continue;
    }
    // The template parent's joint (added earlier in this loop when it was missing too), else the skeleton root.
    let parentBone = tpl.parent;
    let parent: JointRecord | undefined;
    while (parentBone !== null && parent === undefined) {
      parent = parentBone === 'root' ? index.order.find((j) => j.key === 'root') : holder(parentBone);
      if (parent === undefined) parentBone = parentBone === 'root' ? null : (position.get(parentBone)?.parent ?? null);
    }
    parent ??= index.order.find((joint) => joint.parent === null);
    const id = `${skeleton.id}:${bone}` as JointId;
    const partnerBone = mirrorHumanBone(bone);
    const partner = partnerBone === null ? undefined : holder(partnerBone);
    const record: JointRecord = {
      id,
      skeleton: skeleton.id,
      parent: parent?.id ?? null,
      order: orderKey(index.order.length + created++),
      name: index.order.some((joint) => joint.name === bone) ? `${bone}_2` : bone,
      humanBone: bone,
      restPosition: v3(tpl.position),
      restRotation: [0, 0, 0, 1],
      tail: tpl.tail === null ? null : v3(tpl.tail),
      side: humanBoneSide(bone),
      mirror: partner?.id ?? null,
      deleted: null,
      role: 'bone',
      key: index.order.some((joint) => joint.key === bone) ? `${bone}#2` : bone,
    };
    upserts.set(id, record);
    added.push(id);
    if (partner !== undefined && partner.mirror !== id) upserts.set(partner.id, { ...partner, mirror: id });
  }
  return { ...edit([...upserts.values()]), added, mapped };
}

/** The partner position of a sided point: `(−x, y, z)`. */
export const partnerPosition = (p: readonly number[]): [number, number, number] => mirrorV3(p);
