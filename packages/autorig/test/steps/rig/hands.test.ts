// AUTORIG-SPEC §5.4, AS-AR-1 step 12 (AR-D7-16): on *Done* after *Adjust joints* each hand turns with its forearm.
// The pure parts: the forearm snapshot, the shortest-arc turn, and the `skel.joint.rotateRest` arguments of each hand
// whose forearm turned (about the wrist, Euler XYZ in radians, no symmetry) — the turn carries the hand's tail from
// the old forearm line onto the new one; an untouched arm gives no turn.
import { eulerToQuat, quatRotateVec3 } from '@ekza-studio/anim-core';
import type { HumanBoneName, JointId, JointRecord, SkeletonId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { armSnapshot, FOLLOW_EPSILON, handTurns, turnBetween } from '../../../src/steps/rig/hands';

type V3 = [number, number, number];
const DEG = Math.PI / 180;

/** Arms in a T-pose whose elbows sit `drop` below the shoulder line; hands' tails along the (rising) forearm. */
function arms(drop: number): JointRecord[] {
  const out: JointRecord[] = [];
  for (const [side, x] of [
    ['left', 1],
    ['right', -1],
  ] as const) {
    const upper: V3 = [0.2 * x, 1.4, 0];
    const lower: V3 = [0.45 * x, 1.4 - drop, 0.01];
    const hand: V3 = [0.7 * x, 1.4, 0];
    const forearm: V3 = [hand[0] - lower[0], hand[1] - lower[1], hand[2] - lower[2]];
    const tail: V3 = [hand[0] + 0.55 * forearm[0], hand[1] + 0.55 * forearm[1], hand[2] + 0.55 * forearm[2]];
    const joint = (bone: HumanBoneName, position: V3, t: V3 | null): JointRecord => ({
      id: `jnt_${bone}` as JointId,
      skeleton: 'skl_a' as SkeletonId,
      parent: null,
      order: `a${out.length}`,
      name: bone,
      humanBone: bone,
      restPosition: position,
      restRotation: [0, 0, 0, 1],
      tail: t,
      side: x === 1 ? 'L' : 'R',
      mirror: null,
      deleted: null,
      role: 'bone',
      key: bone,
    });
    out.push(
      joint(`${side}UpperArm`, upper, null),
      joint(`${side}LowerArm`, lower, null),
      joint(`${side}Hand`, hand, tail),
    );
  }
  return out;
}

const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] ?? 0) - (b[0] ?? 0),
  (a[1] ?? 0) - (b[1] ?? 0),
  (a[2] ?? 0) - (b[2] ?? 0),
];
const angle = (a: readonly number[], b: readonly number[]): number => {
  const d = (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
  return Math.acos(Math.min(1, Math.max(-1, d / (Math.hypot(...a) * Math.hypot(...b)))));
};
/** The elbows moved back onto the shoulder–wrist line (what *Adjust joints*' `D` + `W` does), hands untouched. */
const elbowsBack = (joints: readonly JointRecord[]): JointRecord[] =>
  joints.map((joint) =>
    joint.humanBone?.endsWith('LowerArm') === true
      ? { ...joint, restPosition: [joint.restPosition[0], 1.4, joint.restPosition[2]] }
      : joint,
  );

describe('hands follow their forearms (AR-D7-16)', () => {
  it('snapshots each forearm (lower arm → hand) with its hand', () => {
    const snapshot = armSnapshot(arms(0.04));
    expect(snapshot.left?.hand).toBe('jnt_leftHand');
    expect(snapshot.right?.hand).toBe('jnt_rightHand');
    expect(snapshot.right?.forearm[0]).toBeCloseTo(-0.25, 12);
    expect(snapshot.right?.forearm[1]).toBeCloseTo(0.04, 12);
    expect(armSnapshot([])).toEqual({});
  });

  it('the shortest-arc turn maps one direction onto the other', () => {
    const a: V3 = [1, 0.2, 0.05];
    const b: V3 = [1, -0.1, 0];
    const q = turnBetween(a, b);
    const turned = quatRotateVec3(q, a);
    expect(angle(turned, b)).toBeLessThan(1e-12);
    expect(Math.hypot(...q)).toBeCloseTo(1, 14);
    expect(turnBetween(b, b)).toEqual([0, 0, 0, 1]);
  });

  it('no turn when no forearm changed; one per side when the elbows moved, about the wrist', () => {
    const before = arms(Math.tan(8 * DEG) * 0.25);
    const snapshot = armSnapshot(before);
    expect(handTurns(snapshot, before)).toEqual([]);
    const after = elbowsBack(before);
    const turns = handTurns(snapshot, after);
    expect(turns.map((turn) => turn.side)).toEqual(['left', 'right']);
    for (const turn of turns) {
      const hand = after.find((joint) => joint.id === turn.args.joints[0]) as JointRecord;
      const lower = after.find((joint) => joint.humanBone === `${turn.side}LowerArm`) as JointRecord;
      expect(turn.args).toMatchObject({ mode: 'subtree', symmetry: false, pivot: hand.restPosition });
      // the operator's own conversion (rotateRest: eulerToQuat(xyz)) carries the tail onto the new forearm line
      const q = eulerToQuat([turn.args.rotateX, turn.args.rotateY, turn.args.rotateZ], 'xyz');
      const tail = quatRotateVec3(q, sub(hand.tail ?? [], hand.restPosition));
      const forearm = sub(hand.restPosition, lower.restPosition);
      expect(angle(tail, forearm)).toBeLessThan(1e-7); // acos resolves ≈ 1e-8 near 0
      // before the turn the tail was ~8° off the new forearm (the skel.tpose row's 5° would hold it)
      expect(angle(sub(hand.tail ?? [], hand.restPosition), forearm)).toBeGreaterThan(5 * DEG);
    }
  });

  it('a turn below the threshold or a different hand joint is left alone', () => {
    const before = arms(0.04);
    const snapshot = armSnapshot(before);
    const nudged = before.map((joint) =>
      joint.humanBone === 'leftLowerArm'
        ? { ...joint, restPosition: [joint.restPosition[0], joint.restPosition[1] + FOLLOW_EPSILON * 1e-3, 0.01] }
        : joint,
    ) as JointRecord[];
    expect(handTurns(snapshot, nudged)).toEqual([]);
    const renamed = elbowsBack(before).map((joint) =>
      joint.humanBone === 'rightHand' ? { ...joint, id: 'jnt_other' as JointRecord['id'] } : joint,
    );
    expect(handTurns(snapshot, renamed).map((turn) => turn.side)).toEqual(['left']);
  });
});
