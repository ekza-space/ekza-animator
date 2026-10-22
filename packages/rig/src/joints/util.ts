// Shared helpers of the joint edits (M6B-SPEC §5.3–§5.7; C2): lookups over a skeleton's live joint records, the
// topological order (`skeletonFromDoc`'s: parents first, then `order`, then id), subtrees, mirror partners, heights,
// canonical quaternions and the rotation-matrix → quaternion conversion.
import { quatMultiply, quatNormalize, type ReadonlyQuat } from '@ekza-studio/anim-core';
import type { JointId, JointRecord } from '@ekza-studio/doc';
import { sideFromName } from '../autorig/naming';
import { mirrorHumanBone } from '../humanoid/map';
import type { JointEdit } from '../types';

export type V3 = readonly [number, number, number];
export type Q4 = readonly [number, number, number, number];

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class JointIndex {
  readonly byId: ReadonlyMap<JointId, JointRecord>;
  readonly children: ReadonlyMap<JointId | null, readonly JointRecord[]>;
  readonly order: readonly JointRecord[];

  constructor(joints: readonly JointRecord[]) {
    const live = joints.filter((joint) => joint.deleted === null);
    const byId = new Map<JointId, JointRecord>(live.map((joint) => [joint.id, joint]));
    const children = new Map<JointId | null, JointRecord[]>();
    for (const joint of live) {
      const parent = joint.parent !== null && byId.has(joint.parent) && joint.parent !== joint.id ? joint.parent : null;
      const list = children.get(parent);
      if (list === undefined) children.set(parent, [joint]);
      else list.push(joint);
    }
    for (const list of children.values()) list.sort((a, b) => compare(a.order, b.order) || compare(a.id, b.id));
    const order: JointRecord[] = [];
    const seen = new Set<JointId>();
    const visit = (parent: JointId | null): void => {
      for (const joint of children.get(parent) ?? []) {
        if (seen.has(joint.id)) continue;
        seen.add(joint.id);
        order.push(joint);
        visit(joint.id);
      }
    };
    visit(null);
    for (const joint of [...live].sort((a, b) => compare(a.id, b.id))) {
      if (!seen.has(joint.id)) {
        seen.add(joint.id);
        order.push(joint);
        visit(joint.id);
      }
    }
    this.byId = byId;
    this.children = children;
    this.order = order;
  }

  get(id: JointId): JointRecord | undefined {
    return this.byId.get(id);
  }

  parentOf(joint: JointRecord): JointRecord | undefined {
    return joint.parent === null ? undefined : this.byId.get(joint.parent);
  }

  /** The joint and every descendant, parents first. */
  subtree(id: JointId): JointRecord[] {
    const root = this.byId.get(id);
    if (root === undefined) return [];
    const out: JointRecord[] = [root];
    for (let i = 0; i < out.length; i++) {
      for (const child of this.children.get((out[i] as JointRecord).id) ?? []) out.push(child);
    }
    return out;
  }

  isAncestor(ancestor: JointId, joint: JointRecord): boolean {
    let p = this.parentOf(joint);
    const guard = new Set<JointId>();
    while (p !== undefined && !guard.has(p.id)) {
      if (p.id === ancestor) return true;
      guard.add(p.id);
      p = this.parentOf(p);
    }
    return false;
  }

  byHumanBone(bone: string): JointRecord | undefined {
    for (const joint of this.order) if (joint.humanBone === bone) return joint;
    return undefined;
  }

  /** The mirror partner: the `mirror` link, then the mirrored human bone, then the mirrored name (§5.6.1). */
  partnerOf(joint: JointRecord): JointRecord | undefined {
    if (joint.mirror !== null) {
      const linked = this.byId.get(joint.mirror);
      if (linked !== undefined && linked.id !== joint.id) return linked;
    }
    if (joint.humanBone !== null) {
      const bone = mirrorHumanBone(joint.humanBone);
      if (bone !== null) {
        const mapped = this.byHumanBone(bone);
        if (mapped !== undefined) return mapped;
      }
    }
    const swapped = sideFromName(joint.name)?.mirrored;
    if (swapped !== undefined) {
      for (const other of this.order) if (other.name === swapped && other.id !== joint.id) return other;
    }
    return undefined;
  }

  /** Character height from the joints: max y of positions and tails minus min y. */
  height(): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (const joint of this.order) {
      lo = Math.min(lo, joint.restPosition[1]);
      hi = Math.max(hi, joint.restPosition[1]);
      if (joint.tail !== null) hi = Math.max(hi, joint.tail[1]);
    }
    return Number.isFinite(hi - lo) && hi > lo ? hi - lo : 1;
  }

  ground(): number {
    let lo = Infinity;
    for (const joint of this.order) lo = Math.min(lo, joint.restPosition[1]);
    return Number.isFinite(lo) ? lo : 0;
  }
}

export const emptyEdit = (warnings: readonly string[] = []): JointEdit => ({
  upserts: [],
  deletes: [],
  folds: new Map(),
  rotationDeltas: new Map(),
  warnings,
});

/** A unit quaternion with w ≥ 0 (stored form, §0 notation); −0 components become +0. */
export function canonicalQuat(q: ReadonlyQuat): [number, number, number, number] {
  const n = quatNormalize(q);
  const s = n[3] < 0 ? -1 : 1;
  const c = (v: number): number => (v * s === 0 ? 0 : v * s);
  return [c(n[0]), c(n[1]), c(n[2]), c(n[3])];
}

export const isIdentityQuat = (q: ReadonlyQuat, eps = 1e-12): boolean =>
  Math.abs(q[0]) <= eps && Math.abs(q[1]) <= eps && Math.abs(q[2]) <= eps && Math.abs(Math.abs(q[3]) - 1) <= eps;

/** The YZ-plane reflection of a rotation's frame as a rotation (`(x, −y, −z, w)`): M·R·M. */
export const mirrorQuat = (q: ReadonlyQuat): [number, number, number, number] => [q[0], -q[1], -q[2], q[3]];

/** q_X(π) · q: the reflected frame with every axis negated (§5.6.1 Behavior). */
export const behaviorQuat = (q: ReadonlyQuat): [number, number, number, number] =>
  canonicalQuat(quatMultiply([1, 0, 0, 0], q));

/** A quaternion from the columns of a rotation matrix (Shepperd's method), canonical. */
export function quatFromColumns(x: V3, y: V3, z: V3): [number, number, number, number] {
  const m00 = x[0];
  const m10 = x[1];
  const m20 = x[2];
  const m01 = y[0];
  const m11 = y[1];
  const m21 = y[2];
  const m02 = z[0];
  const m12 = z[1];
  const m22 = z[2];
  const trace = m00 + m11 + m22;
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return canonicalQuat(q);
}

export const v3 = (v: readonly number[]): [number, number, number] => [v[0] as number, v[1] as number, v[2] as number];
export const mirrorV3 = (v: readonly number[]): [number, number, number] => [
  (v[0] as number) === 0 ? 0 : -(v[0] as number),
  v[1] as number,
  v[2] as number,
];
export const sameV3 = (a: readonly number[], b: readonly number[]): boolean =>
  Object.is(a[0], b[0]) && Object.is(a[1], b[1]) && Object.is(a[2], b[2]);
export const sameQuat = (a: readonly number[], b: readonly number[]): boolean =>
  Object.is(a[0], b[0]) && Object.is(a[1], b[1]) && Object.is(a[2], b[2]) && Object.is(a[3], b[3]);
