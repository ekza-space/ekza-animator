// What the joint overlay draws (M6B-SPEC §8.3, §5.17; C3): the joints of every model-sourced character's skeleton in
// world space — their rests in the Bind view, the evaluated pose (`pose.boneWorld`) in the Test view or while a clip
// preview drives the character — with their bones (joint → child, leaf → tail; dashed out of a helper), side, role,
// the hollow rule (a joint without a human bone in a humanoid skeleton), the selection and the missing required bones
// at the template's guess. Built from the document and the session; cheap (one pass over the joints).
import { type Mat4, mat4Compose, mat4Decompose, mat4Invert, mat4Multiply, type Quat } from '@ekza-studio/anim-core';
import type { CharacterId, CharacterRecord, HumanBoneName, JointId, JointRecord, SkeletonId } from '@ekza-studio/doc';
import { type EditorApp, previewValues } from '@ekza-studio/editor-core';
import { isSkeletonPreset, placeTemplate, skeletonTemplate, VRM_REQUIRED_BONES } from '@ekza-studio/rig';

export type Vec3 = readonly [number, number, number];

export interface DrawnJoint {
  readonly id: JointId;
  readonly character: CharacterId;
  readonly skeleton: SkeletonId;
  readonly name: string;
  readonly humanBone: HumanBoneName | null;
  readonly side: 'L' | 'R' | 'C';
  readonly role: JointRecord['role'];
  /** World position and rotation as drawn (rest or posed). */
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly parent: JointId | null;
  /** World tail of a leaf (rest tail through the pose), else null. */
  readonly tail: Vec3 | null;
  /** Sphere radius in metres (§8.3: `jointSize × 0.012 H`; panes clamp it to ≥ 4 CSS px). */
  readonly radius: number;
  readonly hollow: boolean;
  readonly helper: boolean;
  readonly selected: boolean;
  readonly lead: boolean;
  /** Not pickable (Outliner lock column). */
  readonly locked: boolean;
}

export interface DrawnBone {
  /** The joint the bone leaves (picking a bone picks it). */
  readonly joint: JointId;
  /** The child joint, or null for a leaf's tail. */
  readonly child: JointId | null;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly dashed: boolean;
  readonly radius: number;
}

export interface MissingBone {
  readonly bone: HumanBoneName;
  readonly skeleton: SkeletonId;
  readonly position: Vec3;
  readonly radius: number;
}

export interface JointSceneData {
  readonly joints: readonly DrawnJoint[];
  readonly bones: readonly DrawnBone[];
  readonly missing: readonly MissingBone[];
}

export const EMPTY_SCENE: JointSceneData = { joints: [], bones: [], missing: [] };

/** A rest-space override of joints while a drag previews a rest edit (the overlay draws it before the commit). */
export type JointPreview = ReadonlyMap<JointId, Pick<JointRecord, 'restPosition' | 'restRotation' | 'tail'>>;

const IDENTITY_Q: Quat = [0, 0, 0, 1];

function transformPoint(m: Mat4 | Float64Array, p: readonly number[], offset = 0): Vec3 {
  const x = p[0] as number;
  const y = p[1] as number;
  const z = p[2] as number;
  const e = (i: number): number => m[offset + i] as number;
  return [
    e(0) * x + e(4) * y + e(8) * z + e(12),
    e(1) * x + e(5) * y + e(9) * z + e(13),
    e(2) * x + e(6) * y + e(10) * z + e(14),
  ];
}

function slice16(buffer: Float64Array, offset: number): Mat4 {
  return buffer.slice(offset, offset + 16);
}

/** The skeleton's height H over its rests and tails (≥ 0.1 m). */
export function skeletonHeight(joints: readonly JointRecord[]): number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const joint of joints) {
    for (const p of joint.tail === null ? [joint.restPosition] : [joint.restPosition, joint.tail]) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
  }
  return Number.isFinite(lo) && hi - lo > 0.1 ? hi - lo : 1.7;
}

/** Whether the character's joints are drawn posed (Test view or a clip preview) rather than at rest. */
function posedView(app: EditorApp, character: CharacterId): boolean {
  if (app.session.getState().rig.poseView !== 'bind') return true;
  return previewValues(character) !== null;
}

/** The node index of each joint name in the character's runtime skeleton (posed view), or null without one. */
function runtimeNodes(app: EditorApp, character: CharacterId): Map<string, number> | null {
  const runtime = app.characters.get(character);
  if (runtime === undefined) return null;
  const out = new Map<string, number>();
  for (const node of runtime.skeleton.nodes) out.set(node.name, node.index);
  return out;
}

/** The overlay data of every model character's skeleton (hidden joints left out). */
export function buildJointScene(app: EditorApp, opts?: { readonly preview?: JointPreview | null }): JointSceneData {
  const state = app.session.getState();
  const jointSize = app.prefs.getState().rigging?.jointSize ?? 1;
  const hidden = state.rig.hiddenJoints;
  const locked = state.rig.lockedJoints;
  const selection = state.selection.joints;
  const lead = selection.at(-1) ?? null;
  const selected = new Set(selection);
  const preview = opts?.preview ?? null;
  const joints: DrawnJoint[] = [];
  const bones: DrawnBone[] = [];
  const missing: MissingBone[] = [];
  for (const character of app.store.list('characters')) {
    if (character.deleted !== null || character.source.kind !== 'model') continue;
    const skeleton = app.store.query.skeletonOfCharacter(character.id);
    if (skeleton === undefined) continue;
    const records = app.store.query
      .jointsOfSkeleton(skeleton.id)
      .filter((joint) => joint.deleted === null)
      .map((joint) => {
        const over = preview?.get(joint.id);
        return over === undefined ? joint : { ...joint, ...over };
      });
    if (records.length === 0) continue;
    const H = skeletonHeight(records);
    const radius = Math.max(jointSize, 0.05) * 0.012 * H;
    const placement = mat4Compose(character.placement);
    const placementQ = mat4Decompose(placement).q;
    const posed = preview === null && posedView(app, character.id) ? runtimeNodes(app, character.id) : null;
    const pose = posed === null ? null : (app.characters.get(character.id)?.pose ?? null);
    const humanoid = records.some((joint) => joint.humanBone !== null);
    const world = new Map<JointId, { position: Vec3; rotation: Quat; tail: Vec3 | null }>();
    for (const joint of records) {
      const node = posed?.get(joint.name);
      if (pose !== null && node !== undefined) {
        const posedWorld = mat4Multiply(placement, slice16(pose.boneWorld, node * 16));
        const rest = mat4Compose({
          t: [joint.restPosition[0], joint.restPosition[1], joint.restPosition[2]],
          q: [joint.restRotation[0], joint.restRotation[1], joint.restRotation[2], joint.restRotation[3]],
          s: [1, 1, 1],
        });
        const delta = mat4Multiply(posedWorld, mat4Invert(rest) ?? rest);
        const decomposed = mat4Decompose(posedWorld);
        world.set(joint.id, {
          position: [decomposed.t[0], decomposed.t[1], decomposed.t[2]],
          rotation: decomposed.q,
          tail: joint.tail === null ? null : transformPoint(delta, joint.tail),
        });
      } else {
        world.set(joint.id, {
          position: transformPoint(placement, joint.restPosition),
          rotation: quatMul(placementQ, joint.restRotation),
          tail: joint.tail === null ? null : transformPoint(placement, joint.tail),
        });
      }
    }
    const byId = new Map(records.map((joint) => [joint.id, joint]));
    const children = new Map<JointId, JointId[]>();
    for (const joint of records) {
      if (joint.parent === null || !byId.has(joint.parent)) continue;
      const list = children.get(joint.parent);
      if (list === undefined) children.set(joint.parent, [joint.id]);
      else list.push(joint.id);
    }
    for (const joint of records) {
      if (hidden.has(joint.id)) continue;
      const at = world.get(joint.id) as { position: Vec3; rotation: Quat; tail: Vec3 | null };
      const helper = joint.role === 'helper';
      const kids = children.get(joint.id) ?? [];
      joints.push({
        id: joint.id,
        character: character.id,
        skeleton: skeleton.id,
        name: joint.name,
        humanBone: joint.humanBone,
        side: joint.side,
        role: joint.role,
        position: at.position,
        rotation: at.rotation,
        parent: joint.parent,
        tail: kids.length === 0 ? at.tail : null,
        radius: helper ? radius * 0.6 : radius,
        hollow: humanoid && joint.humanBone === null && !helper,
        helper,
        selected: selected.has(joint.id),
        lead: joint.id === lead,
        locked: locked.has(joint.id),
      });
      for (const kid of kids) {
        if (hidden.has(kid)) continue;
        const to = world.get(kid)?.position;
        if (to === undefined) continue;
        bones.push({ joint: joint.id, child: kid, from: at.position, to, dashed: helper, radius });
      }
      if (kids.length === 0 && at.tail !== null) {
        bones.push({ joint: joint.id, child: null, from: at.position, to: at.tail, dashed: helper, radius });
      }
    }
    if (humanoid) missing.push(...missingBones(character, skeleton.id, skeleton.preset, records, H, radius));
  }
  return { joints, bones, missing };
}

function quatMul(a: Quat, b: readonly number[]): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b as [number, number, number, number];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** The required VRM bones a humanoid skeleton lacks, at the template's guess (§8.3 "Missing required bone"). */
function missingBones(
  character: CharacterRecord,
  skeleton: SkeletonId,
  preset: string,
  records: readonly JointRecord[],
  H: number,
  radius: number,
): MissingBone[] {
  const present = new Set(records.map((joint) => joint.humanBone));
  const lacking = VRM_REQUIRED_BONES.filter((bone) => !present.has(bone));
  if (lacking.length === 0) return [];
  let ground = Number.POSITIVE_INFINITY;
  for (const joint of records)
    ground = Math.min(ground, joint.restPosition[1], joint.tail?.[1] ?? Number.POSITIVE_INFINITY);
  const template = placeTemplate(
    skeletonTemplate(isSkeletonPreset(preset) ? preset : 'standard33', {
      height: H,
      proportions: 'standard',
      flexion: (2 * Math.PI) / 180,
    }),
    [0, Number.isFinite(ground) ? ground : 0, 0],
  );
  const placement = mat4Compose(character.placement);
  const out: MissingBone[] = [];
  for (const bone of lacking) {
    const guess = template.find((joint) => joint.key === bone);
    if (guess === undefined) continue;
    out.push({ bone, skeleton, position: transformPoint(placement, guess.position), radius: radius * 1.6 });
  }
  return out;
}

export { IDENTITY_Q };
