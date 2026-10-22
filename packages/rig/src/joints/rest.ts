// Apply Pose as Rest and the T-Stance (M6B-SPEC §5.7, §5.17; AUTORIG-SPEC §10 A0): the A-pose path's pure maths.
//
// - `tStancePose(joints, skeleton)`: per side, root-first, exactly the four segments `skel.tpose` measures
//   (`validate/index.ts`, `along(…)`): upper arm → lower arm, lower arm → hand, hand → its tail (to ±X) and lower leg →
//   foot (to −Y). Each segment turns **about the character Z axis only**, at its start joint, so that its front-plane
//   (XY) direction equals the template direction; the subtree inherits the turn. Thighs are never turned. A Z turn
//   keeps a segment's depth and its XY length, so the out-of-plane angle (the hinge depth, the 2° minimum bend) stays.
//   Segments within 0.1° are untouched (bit-equal). The right side computes in a mirrored frame with the same
//   operations as the left, so a symmetric skeleton gives bit-mirrored poses. Deterministic.
// - `applyPoseAsRest(joints, boneWorld)`: the §5.7 record rule over posed worlds W_j(P) (character space): each moved
//   joint's `restPosition` = its posed world position; `restRotation` stays identity for joints whose rest rotation
//   was identity (every template joint: World-oriented, so the exported VRM stays normalized) and takes the posed
//   world rotation q(W_j(P)) for the others; `tail` = the pose delta M_j = W_j(P)·W⁰_j⁻¹ applied to the old tail
//   (tails are character-space points: what `skel.tpose` checks for the hands, the head-top marker source and the bone
//   ends the writer uses). A joint whose delta is within 1e-12 of identity keeps its record bit-equal.
// - `poseDeltaOf`, `restWorldOf`: the matrices both use; the skin bake (mesh-core `bakeSkinnedPoints`) applies the same
//   deltas M_j = W_j(P)·IBM_j to the bound points.
import type { Mat4 } from '@ekza-studio/anim-core';
import { mat4Compose, mat4Multiply } from '@ekza-studio/anim-core';
import type { HumanBoneName, JointId, JointRecord, SkeletonId } from '@ekza-studio/doc';
import type { JointEdit } from '../types';
import { isIdentityQuat, JointIndex, quatFromColumns } from './util';

/** T-Stance constants (AUTORIG-SPEC §10 A0). */
export const T_STANCE = Object.freeze({
  /** A segment whose front-plane direction is within this angle of its template direction is not turned. */
  untouchedDegrees: 0.1,
  /** A pose delta within this (max abs element difference) of identity leaves the joint's record bit-equal. */
  identityEps: 1e-12,
});

const DEG = Math.PI / 180;

/** The rest world of a joint (character space): T(restPosition)·R(restRotation). */
export function restWorldOf(joint: JointRecord): Mat4 {
  return mat4Compose({ t: joint.restPosition, q: joint.restRotation, s: [1, 1, 1] });
}

/** Inverse of a rigid transform (rotation + translation): Rᵀ, −Rᵀ·t. */
function rigidInverse(m: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) out[c * 4 + r] = m[r * 4 + c] as number;
  const tx = m[12] as number;
  const ty = m[13] as number;
  const tz = m[14] as number;
  out[12] = -((out[0] as number) * tx + (out[4] as number) * ty + (out[8] as number) * tz);
  out[13] = -((out[1] as number) * tx + (out[5] as number) * ty + (out[9] as number) * tz);
  out[14] = -((out[2] as number) * tx + (out[6] as number) * ty + (out[10] as number) * tz);
  out[15] = 1;
  return out;
}

/** True when `m` is within `eps` of the identity (every element). */
export function isIdentityMat4(m: Mat4, eps: number = T_STANCE.identityEps): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs((m[i] as number) - (i % 5 === 0 ? 1 : 0)) > eps) return false;
  return true;
}

/** The pose delta M = W(P)·W⁰⁻¹ of a joint (character space), null when within `T_STANCE.identityEps` of identity. */
export function poseDeltaOf(joint: JointRecord, posedWorld: Mat4): Mat4 | null {
  const delta = mat4Multiply(posedWorld, rigidInverse(restWorldOf(joint)));
  return isIdentityMat4(delta) ? null : delta;
}

/** `m` applied to the point `p`. */
function transform(m: Mat4, p: readonly number[]): [number, number, number] {
  const x = p[0] as number;
  const y = p[1] as number;
  const z = p[2] as number;
  return [
    (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
    (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
    (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
  ];
}

/**
 * §5.7 Apply Pose as Rest over posed worlds (`boneWorld(id)` = W_j(P), character space; a joint whose posed world
 * equals its rest world within 1e-12 keeps its record bit-equal). Weights are the caller's (never changed); keys are
 * not converted: clips authored on the old rest shift by the pose delta (the confirm says so).
 */
export function applyPoseAsRest(
  joints: readonly JointRecord[],
  boneWorld: (joint: JointId) => Float64Array /* mat4 */,
): JointEdit {
  const index = new JointIndex(joints);
  const upserts: JointRecord[] = [];
  for (const joint of index.order) {
    const world = boneWorld(joint.id);
    const delta = poseDeltaOf(joint, world);
    if (delta === null) continue;
    const restRotation: JointRecord['restRotation'] = isIdentityQuat(joint.restRotation)
      ? joint.restRotation
      : quatFromColumns(
          [world[0] as number, world[1] as number, world[2] as number],
          [world[4] as number, world[5] as number, world[6] as number],
          [world[8] as number, world[9] as number, world[10] as number],
        );
    upserts.push({
      ...joint,
      restPosition: [world[12] as number, world[13] as number, world[14] as number],
      restRotation,
      tail: joint.tail === null ? null : transform(delta, joint.tail),
    });
  }
  return { upserts, deletes: [], folds: new Map(), rotationDeltas: new Map(), warnings: [] };
}

/** The T-Stance (§5.17): pose deltas of the joints it moves, and the turn per segment start joint. */
export interface TStancePose {
  /** Joint → its pose delta M_j (character space, a rigid transform: W_j(P) = M_j·W⁰_j). Absent = not moved. */
  readonly deltas: ReadonlyMap<JointId, Mat4>;
  /** Segment start joint → the signed turn about +Z (radians) applied there. */
  readonly turns: ReadonlyMap<JointId, number>;
}

/** The posed world of a joint under a T-Stance (or any delta map): M_j·W⁰_j, the rest world when not moved. */
export function posedWorldOf(joint: JointRecord, deltas: ReadonlyMap<JointId, Mat4>): Mat4 {
  const delta = deltas.get(joint.id);
  const rest = restWorldOf(joint);
  return delta === undefined ? rest : mat4Multiply(delta, rest);
}

/** The segments of `skel.tpose`, root-first per side (the bone names without their side prefix). */
const SEGMENTS: readonly (readonly [
  'UpperArm' | 'LowerArm' | 'Hand' | 'LowerLeg',
  'LowerArm' | 'Hand' | 'Foot' | 'tail',
  'arm' | 'leg',
])[] = [
  ['UpperArm', 'LowerArm', 'arm'],
  ['LowerArm', 'Hand', 'arm'],
  ['Hand', 'tail', 'arm'],
  ['LowerLeg', 'Foot', 'leg'],
];

/**
 * The T-Stance of a skeleton's joints (`skeleton` null: every live joint, which must then be one skeleton). Pure and
 * deterministic; see the module comment for the rule. Joints without a human bone are moved only as part of a turned
 * subtree (fingers, a prop under a hand).
 */
export function tStancePose(joints: readonly JointRecord[], skeleton: SkeletonId | null = null): TStancePose {
  const index = new JointIndex(skeleton === null ? joints : joints.filter((joint) => joint.skeleton === skeleton));
  const deltas = new Map<JointId, Mat4>();
  const turns = new Map<JointId, number>();
  const posed = (joint: JointRecord, p: readonly number[]): [number, number, number] => {
    const delta = deltas.get(joint.id);
    return delta === undefined ? [p[0] as number, p[1] as number, p[2] as number] : transform(delta, p);
  };
  const untouched = T_STANCE.untouchedDegrees * DEG;
  for (const [side, mirror] of [
    ['left', 1],
    ['right', -1],
  ] as const) {
    for (const [from, to, kind] of SEGMENTS) {
      const start = index.byHumanBone(`${side}${from}` satisfies HumanBoneName);
      if (start === undefined) continue;
      const endJoint = to === 'tail' ? start : index.byHumanBone(`${side}${to}` satisfies HumanBoneName);
      const endRest = to === 'tail' ? start.tail : endJoint?.restPosition;
      if (endJoint === undefined || endRest === null || endRest === undefined) continue;
      const pivot = posed(start, start.restPosition);
      const end = posed(endJoint, endRest);
      // The canonical (left-side) frame: the right side's x is mirrored, so both sides run the same operations.
      const x = mirror * (end[0] - pivot[0]);
      const y = end[1] - pivot[1];
      const r = Math.hypot(x, y);
      if (!(r > 0)) continue;
      // Rotation (c, s) about +Z taking (x, y) to the template direction: arms (r, 0) along +X, shins (0, −r).
      let c: number;
      let s: number;
      let off: number;
      if (kind === 'arm') {
        off = Math.atan2(Math.abs(y), x);
        c = x / r;
        s = -y / r;
      } else {
        off = Math.atan2(Math.abs(x), -y);
        c = -y / r;
        s = -x / r;
      }
      if (off <= untouched) continue;
      // Back to the side's frame: a mirrored rotation turns the other way.
      const sn = mirror * s;
      const turn = rotationAbout(pivot, c, sn);
      for (const joint of index.subtree(start.id)) {
        const delta = deltas.get(joint.id);
        deltas.set(joint.id, delta === undefined ? turn.slice() : mat4Multiply(turn, delta));
      }
      turns.set(start.id, Math.atan2(sn, c));
    }
  }
  return { deltas, turns };
}

/** The rotation about the Z axis through `p` with cosine `c` and sine `s` (column-major). */
function rotationAbout(p: readonly number[], c: number, s: number): Mat4 {
  const px = p[0] as number;
  const py = p[1] as number;
  const m = new Float64Array(16);
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  m[10] = 1;
  m[12] = px - (c * px - s * py);
  m[13] = py - (s * px + c * py);
  m[15] = 1;
  return m;
}
