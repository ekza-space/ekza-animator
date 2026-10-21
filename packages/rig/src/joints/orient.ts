// Orient Joint (M6B-SPEC §5.5; research 17 §2; C2). World: identity. Aim: the primary axis along the bone (target =
// the humanoid-chain child, else the first child by order, else the tail), the secondary axis toward `secondaryWorld`
// made orthogonal (the parent's secondary axis, then the next of +z, +x, +y when within ≈ 1° of the bone), the third
// their right-handed cross product. A leaf without a tail copies its parent's rotation; a bone shorter than 1e-6 H keeps
// its rotation. With `symmetry` a partner outside the edited set takes its §5.6 mirror (identity stays identity, else
// Behavior). The result reports the old → new local delta Δ = q_old⁻¹·q_new of every re-oriented joint; keys of
// bone-aligned controls convert by R(r′) = Δ⁻¹·R(r) (`convertBoneAlignedRotation`). Deformation and humanoid animation
// do not change (world-aligned controls give D_b = q_c whatever q⁰_b).
import {
  eulerNear,
  eulerToQuat,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type RotateOrder,
} from '@ekza-studio/anim-core';
import type { JointId, JointRecord } from '@ekza-studio/doc';
import { humanChainChildren } from '../humanoid/map';
import type { JointEdit, OrientJointArgs } from '../types';
import {
  behaviorQuat,
  canonicalQuat,
  isIdentityQuat,
  JointIndex,
  type Q4,
  quatFromColumns,
  sameQuat,
  type V3,
} from './util';

type Axis6 = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
const AXES: readonly V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const axisIndex = (a: Axis6): 0 | 1 | 2 => (a[1] === 'x' ? 0 : a[1] === 'y' ? 1 : 2);
const axisSign = (a: Axis6): 1 | -1 => (a[0] === '-' ? -1 : 1);
const axisVector = (a: Axis6): V3 => {
  const v = AXES[axisIndex(a)] as V3;
  const s = axisSign(a);
  return [v[0] * s, v[1] * s, v[2] * s];
};
const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] as number) - (b[0] as number),
  (a[1] as number) - (b[1] as number),
  (a[2] as number) - (b[2] as number),
];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.sqrt(dot(a, a));
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const reject = (w: V3, f: V3): V3 => sub(w, scale(f, dot(w, f)));

/** The axis after `primary` in the cycle x → y → z (positive): `secondary: 'auto'`. */
export function autoSecondary(primary: Axis6): Axis6 {
  const i = axisIndex(primary);
  return (['+y', '+z', '+x'] as const)[i];
}

/** The rest rotation whose `primary` axis points along `f` and `secondary` axis toward `u` (both unit, orthogonal). */
export function frameQuat(primary: Axis6, secondary: Axis6, f: V3, u: V3): Q4 {
  const i = axisIndex(primary);
  const j = axisIndex(secondary);
  const k = 3 - i - j;
  const cols: V3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  cols[i] = scale(f, axisSign(primary));
  cols[j] = scale(u, axisSign(secondary));
  // Right-handed: col_k = ±(col_i × col_j), + when (i, j, k) is a cyclic permutation of (x, y, z).
  const cyclic = (j - i + 3) % 3 === 1;
  cols[k] = scale(cross(cols[i], cols[j]), cyclic ? 1 : -1);
  return quatFromColumns(cols[0] as V3, cols[1] as V3, cols[2] as V3);
}

function aimTarget(index: JointIndex, joint: JointRecord): readonly number[] | null {
  if (joint.humanBone !== null) {
    for (const bone of humanChainChildren(joint.humanBone)) {
      const mapped = index.byHumanBone(bone);
      if (mapped !== undefined && index.isAncestor(joint.id, mapped)) return mapped.restPosition;
    }
  }
  const first = index.children.get(joint.id)?.[0];
  if (first !== undefined) return first.restPosition;
  return joint.tail;
}

export function orientJoints(joints: readonly JointRecord[], args: OrientJointArgs): JointEdit {
  const index = new JointIndex(joints);
  const H = index.height();
  const targets = new Set<JointId>();
  for (const id of args.joints) {
    if (index.get(id) === undefined) continue;
    if (args.children) for (const joint of index.subtree(id)) targets.add(joint.id);
    else targets.add(id);
  }
  const rotation = new Map<JointId, Q4>();
  const current = (joint: JointRecord): Q4 => rotation.get(joint.id) ?? joint.restRotation;
  const secondary: Axis6 = args.secondary === 'auto' ? autoSecondary(args.primary) : args.secondary;
  const w = axisVector(args.secondaryWorld);
  for (const joint of index.order) {
    if (!targets.has(joint.id)) continue;
    if (args.mode === 'world') {
      rotation.set(joint.id, [0, 0, 0, 1]);
      continue;
    }
    const parent = index.parentOf(joint);
    const target = aimTarget(index, joint);
    if (target === null) {
      rotation.set(joint.id, parent === undefined ? joint.restRotation : current(parent));
      continue;
    }
    const bone = sub(target, joint.restPosition);
    const l = len(bone);
    if (l < 1e-6 * H) continue;
    const f = scale(bone, 1 / l);
    let u = reject(w, f);
    if (len(u) < 0.02) {
      u = [0, 0, 0];
      if (parent !== undefined) {
        const parentSecondary = quatRotateVec3(current(parent), axisVector(secondary)) as unknown as V3;
        u = reject(parentSecondary, f);
      }
      if (len(u) < 0.02) {
        for (const candidate of ['+z', '+x', '+y'] as const) {
          const c = axisVector(candidate);
          if (Math.abs(dot(c, w)) > 0.5) continue; // skip ±w
          u = reject(c, f);
          if (len(u) >= 0.02) break;
        }
      }
    }
    rotation.set(joint.id, frameQuat(args.primary, secondary, f, scale(u, 1 / len(u))));
  }
  // Symmetry: partners outside the edited set take the §5.6 mirror of the new rotation.
  if (args.symmetry) {
    for (const id of Array.from(rotation.keys())) {
      const joint = index.get(id) as JointRecord;
      const partner = index.partnerOf(joint);
      if (partner === undefined || targets.has(partner.id)) continue;
      const q = rotation.get(id) as Q4;
      rotation.set(partner.id, isIdentityQuat(q) ? [0, 0, 0, 1] : behaviorQuat(q));
    }
  }
  const upserts: JointRecord[] = [];
  const rotationDeltas = new Map<JointId, readonly [number, number, number, number]>();
  for (const joint of index.order) {
    const q = rotation.get(joint.id);
    if (q === undefined) continue;
    const next = canonicalQuat(q);
    if (sameQuat(next, joint.restRotation)) continue;
    upserts.push({ ...joint, restRotation: next });
    rotationDeltas.set(joint.id, canonicalQuat(quatMultiply(quatInvert(joint.restRotation), next)));
  }
  return { upserts, deletes: [], folds: new Map(), rotationDeltas, warnings: [] };
}

/**
 * §5.5 step 6: a rotation key of a bone-aligned control driving a re-oriented joint, R(r′) = Δ⁻¹·R(r), as the Euler
 * angles nearest `reference` (the previous converted key; the shipped nearest-Euler rule).
 */
export function convertBoneAlignedRotation(
  euler: readonly [number, number, number],
  order: RotateOrder,
  delta: readonly [number, number, number, number],
  reference: readonly [number, number, number],
): [number, number, number] {
  const q = quatMultiply(quatInvert(delta), eulerToQuat(euler, order));
  const out = eulerNear(q, order, reference);
  return [out[0], out[1], out[2]];
}
