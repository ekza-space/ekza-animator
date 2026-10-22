// AUTORIG-SPEC §10 A0 (rig): the A-pose path's kernel gates on A-posed Polybot — the One-Click guess within 0.05 H of
// the A-pose truth markers with its arm angle within 5° of the truth's (M6B-SPEC §5.8's gate), bit-identical over two
// runs; the fit on the synthesized A-pose markers within 0.03 H of the A-pose truth (P-J4 for the A-pose); and the
// straighten (T-Stance → Apply Pose as Rest over the records): `skel.tpose` clean, every humanoid joint within 0.05 H of
// the T-pose truth, both hand tails within 5° of ±X, every tail = the pose delta × the old tail (1e-9 m), the thighs
// bit-equal, template rest rotations identity. Plus the 35° Cube Lad (E2E-QR-02's synthetic A-pose).
import type { JointRecord } from '@ekza-studio/doc';
import { TriangleBvh } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  applyPoseAsRest,
  checkSkeleton,
  guessMarkers,
  posedWorldOf,
  QUICK_RIG_CENTRE_MARKERS,
  QUICK_RIG_SIDE_MARKERS,
  tStancePose,
} from '../../src';
import { dist, type V3 } from '../m6b-skeleton/support';
import { cubeLadAPose, polybotAPose, quickRigJoints, SKELETON, skeletonRecord } from './support';

const DEG = Math.PI / 180;
const MARKERS = [...QUICK_RIG_CENTRE_MARKERS, ...QUICK_RIG_SIDE_MARKERS];

/** The straightened records of a skeleton (T-Stance → Apply Pose as Rest), with the pose it applied. */
function straighten(joints: readonly JointRecord[]) {
  const pose = tStancePose(joints, SKELETON);
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  const edit = applyPoseAsRest(joints, (id) => posedWorldOf(byId.get(id) as JointRecord, pose.deltas));
  const changed = new Map(edit.upserts.map((joint) => [joint.id, joint]));
  return { pose, edit, after: joints.map((joint) => changed.get(joint.id) ?? joint) };
}

const byBone = (joints: readonly JointRecord[], bone: string): JointRecord => {
  const joint = joints.find((j) => j.humanBone === bone);
  if (joint === undefined) throw new Error(`no ${bone}`);
  return joint;
};

/** Angle (radians) between `v` and `axis`. */
const angle = (v: readonly number[], axis: V3): number => {
  const l = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
  const c = ((v[0] as number) * axis[0] + (v[1] as number) * axis[1] + (v[2] as number) * axis[2]) / l;
  return Math.acos(Math.min(1, Math.max(-1, c)));
};
const sub = (a: readonly number[], b: readonly number[]): V3 => [
  (a[0] as number) - (b[0] as number),
  (a[1] as number) - (b[1] as number),
  (a[2] as number) - (b[2] as number),
];

describe('A-posed Polybot: the guess (M6B §5.8 gate, A0 calibration)', () => {
  it('every marker within 0.05 H of the A-pose truth markers; arm angle within 5°; bit-identical over two runs', () => {
    const f = polybotAPose();
    const first = guessMarkers(f.bvh, f.bounds);
    const second = guessMarkers(new TriangleBvh(f.triangles.positions, f.triangles.tris), f.bounds);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    if (first === null) return;
    expect(first.aPose).toBe(true);
    const off = MARKERS.map((name) => [name, dist(first.markers[name], f.markers[name]) / f.height] as const).filter(
      ([, error]) => error > 0.05,
    );
    expect(off).toEqual([]);
    // The truth's arm angle: the shoulder → wrist line below horizontal.
    const shoulder = f.markers.shoulder;
    const wrist = f.markers.wrist;
    const truthAngle = Math.atan2(
      shoulder[1] - wrist[1],
      shoulder[0] - wrist[0] < 0 ? wrist[0] - shoulder[0] : shoulder[0] - wrist[0],
    );
    expect(Math.abs(first.armAngle - Math.abs(truthAngle))).toBeLessThan(5 * DEG);
  });
});

describe('A-posed Polybot: the fit (P-J4 for the A-pose)', () => {
  it('every humanoid joint within 0.03 H of the A-pose truth on the synthesized markers', () => {
    const f = polybotAPose();
    const joints = quickRigJoints(f, f.markers);
    const truth = f.joints as Readonly<Record<string, V3>>;
    const compared = joints.filter((joint) => joint.humanBone !== null && truth[joint.humanBone] !== undefined);
    expect(compared.length).toBeGreaterThanOrEqual(21);
    const off = compared
      .map(
        (joint) =>
          [joint.humanBone, dist(joint.restPosition, truth[joint.humanBone as string] as V3) / f.height] as const,
      )
      .filter(([, error]) => error > 0.03);
    expect(off).toEqual([]);
    // Before straightening, Validation's T-pose rule flags the arms (M6b's gate stays until the straighten).
    expect(checkSkeleton({ skeleton: skeletonRecord(), joints, meshes: [] }).map((row) => row.code)).toContain(
      'skel.tpose',
    );
  });
});

describe('A-posed Polybot: straighten (T-Stance → Apply Pose as Rest)', () => {
  for (const source of ['truth markers', 'One-Click guess'] as const) {
    it(`${source}: skel.tpose clean; joints within 0.05 H of the T-pose truth; hands along ±X; thighs bit-equal`, () => {
      const f = polybotAPose();
      const markers = source === 'truth markers' ? f.markers : (guessMarkers(f.bvh, f.bounds)?.markers ?? f.markers);
      const before = quickRigJoints(f, markers);
      const { pose, edit, after } = straighten(before);
      const codes = checkSkeleton({ skeleton: skeletonRecord(), joints: after, meshes: [] }).map((row) => row.code);
      expect(codes).not.toContain('skel.tpose');
      // Every humanoid joint against the T-pose truth.
      const truth = f.tpose as Readonly<Record<string, V3>>;
      const off = after
        .filter((joint) => joint.humanBone !== null && truth[joint.humanBone] !== undefined)
        .map(
          (joint) =>
            [joint.humanBone, dist(joint.restPosition, truth[joint.humanBone as string] as V3) / f.height] as const,
        )
        .filter(([, error]) => error > 0.05);
      expect(off).toEqual([]);
      // Hands: hand → tail within 5° of ±X.
      for (const [side, x] of [
        ['left', 1],
        ['right', -1],
      ] as const) {
        const hand = byBone(after, `${side}Hand`);
        expect(angle(sub(hand.tail as V3, hand.restPosition), [x, 0, 0])).toBeLessThan(5 * DEG);
      }
      // Tails = the pose delta × the old tail (1e-9 m); template rotations identity; unmoved records bit-equal.
      const rotations: string[] = [];
      const unmovedChanged: string[] = [];
      const tailErrors: number[] = [];
      for (const joint of before) {
        const moved = after.find((j) => j.id === joint.id) as JointRecord;
        if (moved.restRotation.join() !== '0,0,0,1') rotations.push(joint.key);
        const delta = pose.deltas.get(joint.id);
        if (delta === undefined) {
          if (moved !== joint) unmovedChanged.push(joint.key);
          continue;
        }
        const t = joint.tail;
        if (t === null) continue;
        const expected = [0, 1, 2].map(
          (r) =>
            (delta[r] as number) * t[0] +
            (delta[4 + r] as number) * t[1] +
            (delta[8 + r] as number) * t[2] +
            (delta[12 + r] as number),
        );
        tailErrors.push(dist(moved.tail as V3, expected));
      }
      expect(rotations).toEqual([]);
      expect(unmovedChanged).toEqual([]);
      expect(tailErrors.length).toBeGreaterThanOrEqual(2);
      expect(Math.max(...tailErrors)).toBeLessThan(1e-9);
      for (const bone of ['leftUpperLeg', 'rightUpperLeg', 'hips', 'spine', 'chest', 'neck', 'head']) {
        expect(after.find((j) => j.humanBone === bone)).toBe(byBone(before, bone));
      }
      // Only the arm chains and the shins (with their subtrees) move.
      const moved = new Set(edit.upserts.map((joint) => joint.humanBone ?? joint.key));
      for (const bone of moved)
        expect(bone).toMatch(/(UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little|LowerLeg|Foot|Toes)/);
    });
  }
});

describe('the 35° Cube Lad (E2E-QR-02 variant)', () => {
  it('guess → fit → straighten: skel.tpose present before and clean after', () => {
    const f = cubeLadAPose(35 * DEG);
    const guess = guessMarkers(f.bvh, f.bounds);
    expect(guess?.aPose).toBe(true);
    const before = quickRigJoints(f, guess?.markers ?? f.markers);
    const skeleton = skeletonRecord();
    expect(checkSkeleton({ skeleton, joints: before, meshes: [] }).map((row) => row.code)).toContain('skel.tpose');
    const { after } = straighten(before);
    expect(checkSkeleton({ skeleton, joints: after, meshes: [] }).map((row) => row.code)).not.toContain('skel.tpose');
  });
});
