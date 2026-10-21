// C2 (skeleton kernel; M6B-SPEC §5.21, §0.4.2): the skel.* and xform.* problems of a skeleton, pure over records.
// Severity is the panel's (C7, per export profile); every row here is a finding with the ids it concerns.
//
// MVP readings (docs/wp-notes/m6b-skeleton-kernel.md): `skel.tpose` checks the arms (upper arm → lower arm → hand along
// ±X), the hands' tails and the shins (lower leg → foot along −Y) within 5°, so an A-posed arm is caught while splayed
// thighs (Polybot) pass; `skel.hinge-bend` measures the bend as δ·(a + b)/(a·b) (the minimum-bend angle);
// `skel.facing` compares the toes' z with the feet's (joints), `skel.grounded` the meshes' min y.
import { mat4Decompose } from '@ekza-studio/anim-core';
import type { HumanBoneName, JointRecord } from '@ekza-studio/doc';
import { HUMAN_BONE_PARENT, VRM_REQUIRED_BONES } from '../humanoid/bones';
import { JointIndex } from '../joints/util';
import { ELBOW_HINGE, hingeBend, KNEE_HINGE } from '../templates/build';
import type { DocSkeletonInput, RigProblem, RigProblemCode } from '../types';

type V3 = readonly [number, number, number];

export const SKELETON_CHECKS = Object.freeze({
  /** T-pose tolerance per bone direction (research 14 §4.4). */
  tposeDegrees: 5,
  /** Hinge joints flexed at least this much on their hinge side (research 17 J8). */
  hingeDegrees: 0.5,
  /** Pairs mirror within 0.01 H; meshes grounded within 0.01 H. */
  symmetry: 0.01,
  grounded: 0.01,
});

const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] as number) - (b[0] as number),
  (a[1] as number) - (b[1] as number),
  (a[2] as number) - (b[2] as number),
];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const angleTo = (v: V3, axis: V3): number => {
  const l = len(v);
  if (l === 0) return 0;
  const c = (v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2]) / l;
  return Math.acos(Math.min(1, Math.max(-1, c)));
};
const DEG = Math.PI / 180;

/** skel.* and xform.* (§5.21; xform.* on the meshes' world placements). */
export function checkSkeleton(input: DocSkeletonInput): readonly RigProblem[] {
  const out: RigProblem[] = [];
  const push = (code: RigProblemCode, ids: readonly string[], message: string): void => {
    out.push({ code, ids, message });
  };
  const index = new JointIndex(input.joints.filter((joint) => joint.skeleton === input.skeleton.id));
  const joints = index.order;
  const bone = (name: HumanBoneName): JointRecord | undefined => index.byHumanBone(name);
  const meshBounds = boundsOfMeshes(input.meshes);
  const H = meshBounds === null ? index.height() : meshBounds[1][1] - meshBounds[0][1] || index.height();
  const humanoid = input.skeleton.template === 'vrm-humanoid' || joints.some((joint) => joint.humanBone !== null);

  // ---------- required bones ----------
  if (humanoid) {
    const missing = VRM_REQUIRED_BONES.filter((name) => bone(name) === undefined);
    if (missing.length > 0) push('skel.required-bones', missing, `Missing VRM bones: ${missing.join(', ')}`);
  }
  // ---------- uniqueness ----------
  const byName = new Map<string, string[]>();
  const byBone = new Map<string, string[]>();
  for (const joint of joints) {
    byName.set(joint.name, [...(byName.get(joint.name) ?? []), joint.id]);
    if (joint.humanBone !== null) byBone.set(joint.humanBone, [...(byBone.get(joint.humanBone) ?? []), joint.id]);
  }
  for (const [name, ids] of byName)
    if (ids.length > 1) push('skel.unique-names', ids, `${ids.length} joints are named ${name}`);
  for (const [name, ids] of byBone) {
    if (ids.length > 1) push('skel.unique-human-bone', ids, `${ids.length} joints map ${name}`);
  }
  // ---------- parent map: each humanoid joint's nearest mapped ancestor is its nearest mapped VRM ancestor ----------
  const hips = bone('hips');
  for (const joint of joints) {
    if (joint.humanBone === null) continue;
    let expected: JointRecord | undefined;
    let parent = HUMAN_BONE_PARENT[joint.humanBone];
    while (parent !== null && expected === undefined) {
      expected = bone(parent);
      parent = HUMAN_BONE_PARENT[parent];
    }
    let actual: JointRecord | undefined = index.parentOf(joint);
    const guard = new Set<string>();
    while (actual !== undefined && actual.humanBone === null && !guard.has(actual.id)) {
      guard.add(actual.id);
      actual = index.parentOf(actual);
    }
    const outsideHips = hips !== undefined && joint.id !== hips.id && !index.isAncestor(hips.id, joint);
    if ((expected?.id ?? null) !== (actual?.id ?? null) || outsideHips) {
      push(
        'skel.parent-map',
        [joint.id],
        outsideHips
          ? `${joint.name} (${joint.humanBone}) is outside the hips' subtree`
          : `${joint.name} (${joint.humanBone}) should hang under ${expected?.humanBone ?? 'no humanoid bone'}`,
      );
    }
  }
  // ---------- roots ----------
  const roots = joints.filter((joint) => joint.parent === null || index.get(joint.parent) === undefined);
  if (roots.length > 1)
    push(
      'skel.multiple-roots',
      roots.map((joint) => joint.id),
      `${roots.length} root joints`,
    );

  // ---------- T-pose (arms, hands, shins) ----------
  const off: string[] = [];
  const along = (a: HumanBoneName, b: HumanBoneName | 'tail', axis: V3): void => {
    const from = bone(a);
    const to = b === 'tail' ? from?.tail : bone(b)?.restPosition;
    if (from === undefined || to === undefined || to === null) return;
    if (angleTo(sub(to, from.restPosition), axis) > SKELETON_CHECKS.tposeDegrees * DEG) off.push(from.id);
  };
  for (const [side, x] of [
    ['left', 1],
    ['right', -1],
  ] as const) {
    along(`${side}UpperArm`, `${side}LowerArm`, [x, 0, 0]);
    along(`${side}LowerArm`, `${side}Hand`, [x, 0, 0]);
    along(`${side}Hand`, 'tail', [x, 0, 0]);
    along(`${side}LowerLeg`, `${side}Foot`, [0, -1, 0]);
  }
  if (off.length > 0) push('skel.tpose', off, 'Not in the VRM T-pose (arms along ±X, shins vertical, 5°)');

  // ---------- hinge bend ----------
  const straight: string[] = [];
  for (const [a, b, c, d] of [
    ['leftUpperArm', 'leftLowerArm', 'leftHand', ELBOW_HINGE],
    ['rightUpperArm', 'rightLowerArm', 'rightHand', ELBOW_HINGE],
    ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', KNEE_HINGE],
    ['rightUpperLeg', 'rightLowerLeg', 'rightFoot', KNEE_HINGE],
  ] as const) {
    const A = bone(a);
    const B = bone(b);
    const C = bone(c);
    if (A === undefined || B === undefined || C === undefined) continue;
    const la = len(sub(B.restPosition, A.restPosition));
    const lb = len(sub(C.restPosition, B.restPosition));
    if (la === 0 || lb === 0) continue;
    const angle = (hingeBend(A.restPosition, B.restPosition, C.restPosition, d) * (la + lb)) / (la * lb);
    if (angle < SKELETON_CHECKS.hingeDegrees * DEG - 1e-12) straight.push(B.id);
  }
  if (straight.length > 0) push('skel.hinge-bend', straight, 'Elbows and knees need a slight bend on their hinge side');

  // ---------- symmetry ----------
  const asym: string[] = [];
  for (const joint of joints) {
    if (joint.side !== 'L') continue;
    const partner = index.partnerOf(joint);
    if (partner === undefined) continue;
    const p = partner.restPosition;
    const d = len(sub(joint.restPosition, [-p[0], p[1], p[2]]));
    if (d > SKELETON_CHECKS.symmetry * H) asym.push(joint.id, partner.id);
  }
  if (asym.length > 0) push('skel.symmetry', asym, 'Left and right joints do not mirror (0.01 H)');

  // ---------- grounded, facing ----------
  if (meshBounds !== null && Math.abs(meshBounds[0][1]) > SKELETON_CHECKS.grounded * H) {
    push(
      'skel.grounded',
      input.meshes.map((mesh) => mesh.id),
      `The model's lowest point is at y = ${meshBounds[0][1].toFixed(3)}`,
    );
  }
  const backward: string[] = [];
  for (const side of ['left', 'right'] as const) {
    const foot = bone(`${side}Foot`);
    const toes = bone(`${side}Toes`);
    const front = toes?.restPosition ?? foot?.tail;
    if (foot === undefined || front === undefined || front === null) continue;
    if (front[2] <= foot.restPosition[2]) backward.push(foot.id);
  }
  if (backward.length > 0) push('skel.facing', backward, 'The toes are not in front of the feet (face +Z)');

  // ---------- orientation modes mixed among siblings ----------
  for (const [parent, children] of index.children) {
    if (children.length < 2 || parent === null) continue;
    const identity = children.map((c) => isIdentity(c.restRotation));
    if (identity.some((v) => v) && identity.some((v) => !v)) {
      push(
        'skel.orientation-mixed',
        children.map((c) => c.id),
        'One chain mixes World and aimed orientations',
      );
    }
  }

  // ---------- xform ----------
  for (const mesh of input.meshes) {
    if (mesh.skin === null) continue;
    const xf = mat4Decompose(mesh.placement);
    const [sx, sy, sz] = xf.s;
    if (
      !(sx > 0 && sy > 0 && sz > 0) ||
      Math.abs(sx - sy) > 1e-6 ||
      Math.abs(sy - sz) > 1e-6 ||
      Math.abs(sx - 1) > 1e-6
    ) {
      push('xform.scale', [mesh.id], 'Skinned meshes need scale 1');
    }
    let identity = true;
    for (let i = 0; i < 16; i++) {
      if (Math.abs((mesh.placement[i] as number) - (i % 5 === 0 ? 1 : 0)) > 1e-9) identity = false;
    }
    if (!identity) push('xform.not-frozen', [mesh.id], 'Freeze the transformations of skinned meshes');
  }
  return out;
}

const isIdentity = (q: readonly number[]): boolean =>
  Math.abs(q[0] as number) <= 1e-12 &&
  Math.abs(q[1] as number) <= 1e-12 &&
  Math.abs(q[2] as number) <= 1e-12 &&
  Math.abs(Math.abs(q[3] as number) - 1) <= 1e-12;

/** World bounds of the meshes (positions through their placements), or null without points. */
function boundsOfMeshes(meshes: DocSkeletonInput['meshes']): [V3, V3] | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    const m = mesh.placement;
    const P = mesh.data.position;
    for (let i = 0; i < mesh.data.counts.points; i++) {
      const x = P[3 * i] as number;
      const y = P[3 * i + 1] as number;
      const z = P[3 * i + 2] as number;
      for (let c = 0; c < 3; c++) {
        const v = (m[c] as number) * x + (m[4 + c] as number) * y + (m[8 + c] as number) * z + (m[12 + c] as number);
        if (v < (lo[c] as number)) lo[c] = v;
        if (v > (hi[c] as number)) hi[c] = v;
      }
    }
  }
  return Number.isFinite(lo[0]) ? [lo as unknown as V3, hi as unknown as V3] : null;
}
