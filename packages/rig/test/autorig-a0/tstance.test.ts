// AUTORIG-SPEC §10 A0 (rig): `tStancePose` and `applyPoseAsRest` unit tests — segments within 0.1° untouched (records
// bit-equal), the out-of-plane angle kept (1e-9 rad), left = mirror(right) bit for bit on a symmetric skeleton,
// deterministic; P-J5: identity-rest joints keep identity, a non-identity (aimed) chain's local +X still points at its
// child after the bake (1e-9).
import { quatRotateVec3, quatShortestArc } from '@ekza-studio/anim-core';
import type { JointId, JointRecord } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { applyPoseAsRest, posedWorldOf, poseDeltaOf, restWorldOf, tStancePose } from '../../src';
import { type V3 } from '../m6b-skeleton/support';
import { polybotAPose, quickRigJoints, SKELETON } from './support';

const DEG = Math.PI / 180;

function apply(joints: readonly JointRecord[]) {
  const pose = tStancePose(joints, SKELETON);
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const edit = applyPoseAsRest(joints, (id) => posedWorldOf(byId.get(id) as JointRecord, pose.deltas));
  const changed = new Map(edit.upserts.map((joint) => [joint.id, joint]));
  return { pose, edit, after: joints.map((joint) => changed.get(joint.id) ?? joint) };
}

const at = (joints: readonly JointRecord[], bone: string): JointRecord => {
  const joint = joints.find((j) => j.humanBone === bone);
  if (joint === undefined) throw new Error(`no ${bone}`);
  return joint;
};
const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] as number) - (b[0] as number),
  (a[1] as number) - (b[1] as number),
  (a[2] as number) - (b[2] as number),
];
/** Out-of-plane angle of a segment (its tilt out of the front XY plane). */
const depth = (v: V3): number => Math.atan2(Math.abs(v[2]), Math.hypot(v[0], v[1]));

/** The A-posed Polybot fit (truth markers), the subject of most tests. */
const aposed = (): JointRecord[] => {
  const f = polybotAPose();
  return quickRigJoints(f, f.markers);
};

/** Joints with every listed bone's subtree moved by `fn` (positions and tails), a hand-made pose for edge cases. */
function edit(joints: readonly JointRecord[], fn: (joint: JointRecord) => Partial<JointRecord> | null): JointRecord[] {
  return joints.map((joint) => {
    const patch = fn(joint);
    return patch === null ? joint : { ...joint, ...patch };
  });
}

describe('tStancePose', () => {
  it('segments within 0.1° of their template direction are untouched; the records stay bit-equal', () => {
    // Arms exactly along ±X except the right lower arm at 0.05° in the front plane; shins exactly vertical.
    const base = aposed();
    const pose0 = apply(base).after;
    const straight = edit(pose0, (joint) => {
      if (joint.humanBone === null) return null;
      if (/(Upper|Lower)Leg|Foot|Toes/.test(joint.humanBone)) {
        const side = joint.humanBone.startsWith('left') ? 'left' : 'right';
        const knee = at(pose0, `${side}LowerLeg`).restPosition;
        if (joint.humanBone.endsWith('Foot'))
          return { restPosition: [knee[0], joint.restPosition[1], joint.restPosition[2]] };
      }
      return null;
    });
    const tilted = edit(straight, (joint) => {
      if (joint.humanBone !== 'rightHand') return null;
      const elbow = at(straight, 'rightLowerArm').restPosition;
      const v = sub(joint.restPosition, elbow);
      const r = Math.hypot(v[0], v[1]);
      return {
        restPosition: [elbow[0] - r * Math.cos(0.05 * DEG), elbow[1] + r * Math.sin(0.05 * DEG), joint.restPosition[2]],
      };
    });
    const { pose, edit: result } = apply(tilted);
    // Only the hand tails are off (they followed the T-Stance of the first pass, so they are along ±X too): nothing moves.
    expect([...pose.turns.keys()]).toEqual([]);
    expect(result.upserts).toEqual([]);
  });

  it('keeps every segment’s out-of-plane angle (1e-9 rad) and only turns about Z', () => {
    const before = aposed();
    const { after, pose } = apply(before);
    expect(pose.turns.size).toBeGreaterThanOrEqual(6);
    for (const side of ['left', 'right']) {
      for (const [a, b] of [
        ['UpperArm', 'LowerArm'],
        ['LowerArm', 'Hand'],
        ['LowerLeg', 'Foot'],
      ]) {
        const v0 = sub(at(before, `${side}${b}`).restPosition, at(before, `${side}${a}`).restPosition);
        const v1 = sub(at(after, `${side}${b}`).restPosition, at(after, `${side}${a}`).restPosition);
        expect(Math.abs(depth(v1) - depth(v0))).toBeLessThan(1e-9);
        expect(Math.abs(Math.hypot(...v1) - Math.hypot(...v0))).toBeLessThan(1e-12);
      }
      const hand0 = at(before, `${side}Hand`);
      const hand1 = at(after, `${side}Hand`);
      const t0 = sub(hand0.tail as V3, hand0.restPosition);
      const t1 = sub(hand1.tail as V3, hand1.restPosition);
      expect(Math.abs(depth(t1) - depth(t0))).toBeLessThan(1e-9);
    }
    // Every delta is a rotation about Z (+ translation in XY): z row and column untouched.
    for (const delta of pose.deltas.values()) {
      expect([delta[2], delta[6], delta[8], delta[9], delta[10], delta[14]]).toEqual([0, 0, 0, 0, 1, 0]);
    }
  });

  it('left = mirror(right) bit for bit on a symmetric skeleton; deterministic', () => {
    const before = aposed();
    const first = apply(before);
    const second = apply(before);
    expect(second.after).toEqual(first.after);
    const byKey = new Map(first.after.map((joint) => [joint.key, joint]));
    let pairs = 0;
    for (const joint of first.after) {
      if (!joint.key.startsWith('left')) continue;
      const right = byKey.get(`right${joint.key.slice(4)}`) as JointRecord;
      // Template records are mirror pairs by construction; the straightened ones must stay so (=== treats ±0 alike).
      const same = (a: readonly number[], b: readonly number[]) =>
        a[0] === -(b[0] as number) && a[1] === b[1] && a[2] === b[2];
      expect(same(joint.restPosition, right.restPosition)).toBe(true);
      expect(joint.tail === null ? right.tail === null : same(joint.tail, right.tail as V3)).toBe(true);
      pairs++;
    }
    expect(pairs).toBeGreaterThanOrEqual(10);
    for (const [id, turn] of first.pose.turns) {
      const key = first.after.find((joint) => joint.id === id)?.key as string;
      if (!key.startsWith('left')) continue;
      const partner = first.after.find((joint) => joint.key === `right${key.slice(4)}`) as JointRecord;
      expect(first.pose.turns.get(partner.id)).toBe(-turn);
    }
  });

  it('the thighs, hips, spine and head are never moved', () => {
    const { pose } = apply(aposed());
    const keys = new Set([...pose.deltas.keys()].map((id) => id.slice(id.lastIndexOf(':') + 1)));
    for (const bone of ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperLeg', 'rightUpperLeg', 'leftShoulder']) {
      expect([...keys].some((key) => key.endsWith(bone))).toBe(false);
    }
  });
});

describe('applyPoseAsRest (P-J5)', () => {
  it('identity-rest joints keep identity; an aimed chain keeps its local +X on its child (1e-9)', () => {
    const base = aposed();
    const hand = at(base, 'rightHand');
    // A three-joint aimed chain under the right hand (a sword or a ponytail: DCC-oriented, local +X → child).
    const points: V3[] = [
      [hand.restPosition[0] - 0.02, hand.restPosition[1] - 0.01, 0.05],
      [hand.restPosition[0] - 0.05, hand.restPosition[1] - 0.06, 0.08],
      [hand.restPosition[0] - 0.07, hand.restPosition[1] - 0.12, 0.09],
    ];
    const chain: JointRecord[] = points.map((p, i) => {
      const next = points[i + 1];
      const dir = next === undefined ? sub(p, points[i - 1] as V3) : sub(next, p);
      const l = Math.hypot(...dir);
      return {
        ...hand,
        id: `${SKELETON}:chain${i}` as JointId,
        parent: i === 0 ? hand.id : (`${SKELETON}:chain${i - 1}` as JointId),
        order: `z${i}`,
        name: `chain${i}`,
        humanBone: null,
        restPosition: p,
        restRotation: quatShortestArc([1, 0, 0], [dir[0] / l, dir[1] / l, dir[2] / l]),
        tail: null,
        side: 'R',
        mirror: null,
        role: 'prop',
        key: `prop.chain${i}`,
      };
    });
    const joints = [...base, ...chain];
    const { after, pose } = apply(joints);
    // Template joints: identity in and out.
    for (const joint of after.filter((j) => j.humanBone !== null)) expect(joint.restRotation).toEqual([0, 0, 0, 1]);
    // The chain moved with the hand and its local +X still points at the next joint.
    for (let i = 0; i < 2; i++) {
      const joint = after.find((j) => j.key === `prop.chain${i}`) as JointRecord;
      const child = after.find((j) => j.key === `prop.chain${i + 1}`) as JointRecord;
      expect(pose.deltas.has(joint.id)).toBe(true);
      const x = quatRotateVec3(joint.restRotation, [1, 0, 0]);
      const d = sub(child.restPosition, joint.restPosition);
      const l = Math.hypot(...d);
      for (let c = 0; c < 3; c++) expect(Math.abs((x[c] as number) - (d[c] as number) / l)).toBeLessThan(1e-9);
    }
    // The posed worlds round-trip: the new rest world of a moved aimed joint equals its posed world (1e-12).
    const byId = new Map(joints.map((joint) => [joint.id, joint]));
    for (const joint of after.filter((j) => j.key.startsWith('prop.'))) {
      const posed = posedWorldOf(byId.get(joint.id) as JointRecord, pose.deltas);
      expect(poseDeltaOf(joint, posed)).toBeNull();
    }
  });

  it('a posed world equal to the rest world leaves the record bit-equal (the same object)', () => {
    const joints = aposed();
    const edit = applyPoseAsRest(joints, (id) => restWorldOf(joints.find((j) => j.id === id) as JointRecord));
    expect(edit.upserts).toEqual([]);
  });
});
