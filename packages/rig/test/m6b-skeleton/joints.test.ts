// MVP joint edits (M6B-SPEC §5.4–§5.7, §0.3; C2 DoD P-J1, P-J2, P-J3): moves (subtree, joint only, symmetry, centre
// joints), rest rotation and re-orientation, setRest, Orient Joint (World, aim presets, symmetry, deltas and the key
// conversion), Mirror Joint (Orientation/Behavior, update in place, involution), Map Humanoid Bone, Rename, Restore
// Rest Flexion and Add Missing Bones.
import {
  eulerToQuat,
  mat4Compose,
  mat4Invert,
  mat4Multiply,
  quatFromAxisAngle,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type RotateOrder,
} from '@ekza-studio/anim-core';
import type { JointId, JointRecord, SkeletonId, SkeletonRecord } from '@ekza-studio/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addMissingBones,
  convertBoneAlignedRotation,
  DEFAULT_FLEXION,
  flexJoints,
  hingeBend,
  JointIndex,
  mirrorJoints,
  moveJoints,
  type OrientJointArgs,
  orientJoints,
  renameJoint,
  setHumanBone,
  setJointRest,
  skeletonTemplate,
  templateJointRecords,
} from '../../src';

const SKEL = 'skl_t' as SkeletonId;
const H = 1.6;
const human = (): JointRecord[] =>
  templateJointRecords(
    skeletonTemplate('standard33', { height: H, proportions: 'standard', flexion: DEFAULT_FLEXION }),
    SKEL,
  );
const id = (key: string) => `${SKEL}:${key}` as JointId;
const apply = (joints: readonly JointRecord[], edit: { upserts: readonly JointRecord[] }): JointRecord[] => {
  const map = new Map(joints.map((j) => [j.id, j]));
  for (const u of edit.upserts) map.set(u.id, u);
  return [...map.values()];
};
const get = (joints: readonly JointRecord[], key: string): JointRecord => {
  const j = joints.find((x) => x.id === id(key) || x.id === key);
  if (j === undefined) throw new Error(key);
  return j;
};

// ---------- random skeletons (P-J1) ----------
function randomSkeleton(n: number, values: readonly number[]): JointRecord[] {
  const out: JointRecord[] = [];
  const v = (i: number) => values[i % values.length] as number;
  for (let i = 0; i < n; i++) {
    const q = quatFromAxisAngle([v(i), v(i + 1) + 0.1, v(i + 2)], v(i + 3) * 3);
    out.push({
      id: `jnt_${i}` as JointId,
      skeleton: SKEL,
      parent: i === 0 ? null : (`jnt_${Math.floor(v(i + 4) * 1000) % i}` as JointId),
      order: `a${i}`,
      name: `joint_${i}`,
      humanBone: null,
      restPosition: [v(i + 5), v(i + 6), v(i + 7)],
      restRotation: i % 3 === 0 ? [0, 0, 0, 1] : [q[0], q[1], q[2], q[3]],
      tail: i % 2 === 0 ? [v(i + 8), v(i + 9), v(i + 10)] : null,
      side: 'C',
      mirror: null,
      deleted: null,
      role: 'bone',
      key: `joint_${i}`,
    });
  }
  return out;
}
const skeletonArb = fc
  .tuple(
    fc.integer({ min: 2, max: 24 }),
    fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 16, maxLength: 64 }),
  )
  .map(([n, values]) => randomSkeleton(n, values));

describe('P-J1: edits keep every joint they do not move bit-equal', () => {
  it('move (joint only), orient and mirror over random skeletons', () => {
    fc.assert(
      fc.property(skeletonArb, fc.integer({ min: 0, max: 23 }), (joints, pick) => {
        const target = joints[pick % joints.length] as JointRecord;
        const untouched = (edit: { upserts: readonly JointRecord[] }, allowed: ReadonlySet<string>) => {
          const after = new Map(apply(joints, edit).map((j) => [j.id, j]));
          const kept = joints.filter((joint) => !allowed.has(joint.id));
          expect(kept.map((joint) => after.get(joint.id)?.restPosition)).toEqual(
            kept.map((joint) => joint.restPosition),
          );
        };
        // Move (joint only): only the joint moves.
        const move = moveJoints(joints, [target.id], { t: [0.1, -0.2, 0.3], pivot: [0, 0, 0] }, 'joint', false);
        expect(move.upserts.map((u) => u.id)).toEqual([target.id]);
        untouched(move, new Set([target.id]));
        // Orient: no position changes at all.
        for (const mode of ['world', 'aim'] as const) {
          const edit = orientJoints(joints, {
            joints: [target.id],
            mode,
            primary: '+x',
            secondary: '+y',
            secondaryWorld: '+y',
            children: true,
            symmetry: false,
          });
          untouched(edit, new Set());
        }
        // Mirror: only the new or updated counterparts and the source's back links change; sources keep positions.
        let n = 0;
        const mirror = mirrorJoints(
          joints,
          { root: target.id, direction: 'left-to-right', mode: 'auto', search: '', replace: '', update: true },
          () => `jnt_new_${n++}` as JointId,
        );
        const sources = new Set(new JointIndex(joints).subtree(target.id).map((joint) => joint.id));
        untouched(mirror, new Set(mirror.upserts.map((u) => u.id).filter((u) => !sources.has(u))));
      }),
      { seed: 6301, numRuns: 120 },
    );
  });
});

describe('moves (§5.7)', () => {
  it('W (subtree) moves the joint, its descendants and their tails; symmetry moves the partner mirrored', () => {
    const joints = human();
    const edit = moveJoints(joints, [id('leftUpperArm')], { t: [0.01, 0.02, 0.03], pivot: [0, 0, 0] }, 'subtree', true);
    const after = apply(joints, edit);
    const moved = new Set(edit.upserts.map((u) => u.id));
    expect(moved.has(id('leftHand'))).toBe(true);
    expect(moved.has(id('leftThumbDistal'))).toBe(true);
    expect(moved.has(id('rightHand'))).toBe(true);
    expect(moved.has(id('chest'))).toBe(false);
    const lh = get(after, 'leftHand');
    const rh = get(after, 'rightHand');
    expect(lh.restPosition[0]).toBeCloseTo(get(joints, 'leftHand').restPosition[0] + 0.01, 12);
    expect(rh.restPosition).toEqual([-lh.restPosition[0], lh.restPosition[1], lh.restPosition[2]]);
    expect(lh.tail?.[1]).toBeCloseTo((get(joints, 'leftHand').tail?.[1] as number) + 0.02, 12);
  });

  it('D + W (joint only): the knee moves with its partner, the feet stay bit-equal', () => {
    const joints = human();
    const edit = moveJoints(joints, [id('rightLowerLeg')], { t: [0, 0, 0.01], pivot: [0, 0, 0] }, 'joint', true);
    expect(edit.upserts.map((u) => u.key).sort()).toEqual(['leftLowerLeg', 'rightLowerLeg']);
    const after = apply(joints, edit);
    expect(get(after, 'rightFoot')).toEqual(get(joints, 'rightFoot'));
    expect(get(after, 'leftLowerLeg').restPosition[2]).toBe(get(after, 'rightLowerLeg').restPosition[2]);
  });

  it('centre joints keep x = 0 under symmetry; partner deltas mirror x only', () => {
    const joints = human();
    const edit = moveJoints(joints, [id('neck')], { t: [0.05, 0.01, 0], pivot: [0, 0, 0] }, 'joint', true);
    expect(Object.is(get(apply(joints, edit), 'neck').restPosition[0], 0)).toBe(true);
    const free = moveJoints(joints, [id('neck')], { t: [0.05, 0, 0], pivot: [0, 0, 0] }, 'joint', false);
    expect(get(apply(joints, free), 'neck').restPosition[0]).toBeCloseTo(0.05, 15);
  });

  it('W / E on a centre joint with symmetry moves its subtree symmetrically (both sides stay mirrors)', () => {
    const joints = human();
    const mirrorError = (js: readonly JointRecord[]): number => {
      let worst = 0;
      for (const j of js) {
        if (j.side !== 'L') continue;
        const p = get(js, j.key.replace(/^left/, 'right')).restPosition;
        worst = Math.max(
          worst,
          Math.hypot(j.restPosition[0] + p[0], j.restPosition[1] - p[1], j.restPosition[2] - p[2]),
        );
      }
      return worst;
    };
    const chest = get(joints, 'chest').restPosition;
    const moved = apply(
      joints,
      moveJoints(joints, [id('chest')], { t: [0.05, 0.01, 0.002], pivot: chest }, 'subtree', true),
    );
    expect(mirrorError(moved)).toBeLessThan(1e-12);
    expect(get(moved, 'chest').restPosition).toEqual([0, chest[1] + 0.01, chest[2] + 0.002]);
    expect(get(moved, 'leftHand').restPosition[1]).toBeCloseTo(get(joints, 'leftHand').restPosition[1] + 0.01, 12);
    // A lean (about Z) keeps only its mirror-invariant part (none); a bow (about X) passes through.
    const lean = moveJoints(
      joints,
      [id('chest')],
      { q: quatFromAxisAngle([0, 0, 1], 0.3), pivot: chest },
      'subtree',
      true,
    );
    expect(lean.upserts).toEqual([]);
    const bow = apply(
      joints,
      moveJoints(joints, [id('chest')], { q: quatFromAxisAngle([1, 0, 0], 0.2), pivot: chest }, 'subtree', true),
    );
    expect(mirrorError(bow)).toBeLessThan(1e-12);
    expect(get(bow, 'head').restPosition[2]).toBeGreaterThan(get(joints, 'head').restPosition[2] + 0.01);
    // Without symmetry the subtree takes the delta as given.
    const free = apply(joints, moveJoints(joints, [id('chest')], { t: [0.05, 0, 0], pivot: chest }, 'subtree', false));
    expect(get(free, 'leftHand').restPosition[0]).toBeCloseTo(get(joints, 'leftHand').restPosition[0] + 0.05, 12);
  });

  it('E (subtree rotation) rotates positions about the pivot, keeps identity rests identity, rotates the others', () => {
    const joints = human().map((j) => (j.key === 'leftHand' ? { ...j, restRotation: [0, 0, 0.6, 0.8] as const } : j));
    const pivot = get(joints, 'leftUpperArm').restPosition;
    const q = quatFromAxisAngle([0, 0, 1], -0.5);
    const edit = moveJoints(joints, [id('leftUpperArm')], { q, pivot }, 'subtree', false);
    const after = apply(joints, edit);
    const before = get(joints, 'leftLowerArm').restPosition;
    const expected = quatRotateVec3(q, [before[0] - pivot[0], before[1] - pivot[1], before[2] - pivot[2]]);
    const got = get(after, 'leftLowerArm').restPosition;
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo((expected[i] as number) + (pivot[i] as number), 12);
    expect(get(after, 'leftLowerArm').restRotation).toEqual([0, 0, 0, 1]);
    const hand = get(after, 'leftHand').restRotation;
    const want = quatMultiply(q, [0, 0, 0.6, 0.8]);
    for (let i = 0; i < 4; i++) expect(Math.abs(hand[i] as number)).toBeCloseTo(Math.abs(want[i] as number), 12);
  });

  it('D + E re-orients the joint only: its rotation turns, its position and children stay', () => {
    const joints = human();
    const q = quatFromAxisAngle([0, 1, 0], 0.3);
    const edit = moveJoints(joints, [id('leftLowerArm')], { q, pivot: [0, 0, 0] }, 'joint', false);
    expect(edit.upserts).toHaveLength(1);
    expect(edit.upserts[0]?.restPosition).toEqual(get(joints, 'leftLowerArm').restPosition);
    expect(edit.upserts[0]?.restRotation[1]).toBeCloseTo(Math.sin(0.15), 12);
  });

  it('setRest writes one joint and reports the rotation delta', () => {
    const joints = human();
    const edit = setJointRest(joints, id('head'), { position: [0, 1.4, 0.01], rotation: [0, 0.6, 0, 0.8] });
    expect(edit.upserts[0]).toMatchObject({ restPosition: [0, 1.4, 0.01], restRotation: [0, 0.6, 0, 0.8] });
    expect(edit.rotationDeltas.get(id('head'))).toEqual([0, 0.6, 0, 0.8]);
    expect(setJointRest(joints, id('head'), {}).upserts).toEqual([]);
  });
});

const ORIENT = (
  mode: 'world' | 'aim',
  primary: OrientJointArgs['primary'],
  secondary: OrientJointArgs['secondary'],
  symmetry = false,
) => ({ joints: [] as JointId[], mode, primary, secondary, secondaryWorld: '+y', children: true, symmetry }) as const;
const PRESETS = {
  world: ORIENT('world', '+x', '+y'),
  xAim: ORIENT('aim', '+x', '+y'),
  yAim: ORIENT('aim', '+y', '+z'),
  auto: ORIENT('aim', '-z', 'auto'),
} as const;

/** World rest of each joint (position, rotation) and the skinning matrix of a world-delta pose D_j (P-J2). */
function skinMatrices(
  joints: readonly JointRecord[],
  delta: (key: string) => readonly [number, number, number, number],
) {
  const index = new JointIndex(joints);
  const posed = new Map<string, { p: number[]; d: readonly number[] }>();
  const out = new Map<string, Float64Array>();
  for (const joint of index.order) {
    const parent = index.parentOf(joint);
    const D = delta(joint.key);
    let p: number[];
    if (parent === undefined) p = [...joint.restPosition];
    else {
      const pp = posed.get(parent.key) as { p: number[]; d: readonly number[] };
      const local = quatRotateVec3(pp.d as [number, number, number, number], [
        joint.restPosition[0] - parent.restPosition[0],
        joint.restPosition[1] - parent.restPosition[1],
        joint.restPosition[2] - parent.restPosition[2],
      ]);
      p = [(pp.p[0] as number) + local[0], (pp.p[1] as number) + local[1], (pp.p[2] as number) + local[2]];
    }
    posed.set(joint.key, { p, d: D });
    const world = mat4Compose({
      t: p as [number, number, number],
      q: quatMultiply(D, joint.restRotation),
      s: [1, 1, 1],
    });
    const rest = mat4Compose({ t: [...joint.restPosition], q: [...joint.restRotation], s: [1, 1, 1] });
    out.set(joint.key, mat4Multiply(world, mat4Invert(rest) as Float64Array));
  }
  return out;
}

describe('P-J2: Orient Joint is invisible to deformation; keys of bone-aligned controls convert exactly', () => {
  it('every preset on the template skeleton: skinning matrices at random world-delta poses within 1e-9', () => {
    const joints = human();
    const roots = [id('hips')];
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 12, maxLength: 12 }), (v) => {
        const delta = (key: string) => {
          let h = 0;
          for (let i = 0; i < key.length; i++) h += key.charCodeAt(i);
          return quatFromAxisAngle(
            [v[h % 12] as number, (v[(h + 1) % 12] as number) + 0.2, v[(h + 2) % 12] as number],
            v[(h + 3) % 12] as number,
          );
        };
        const before = skinMatrices(joints, delta);
        for (const preset of Object.values(PRESETS)) {
          const edit = orientJoints(joints, { ...preset, joints: roots });
          const after = skinMatrices(apply(joints, edit), delta);
          let worst = 0;
          for (const [key, m] of before) {
            const n = after.get(key) as Float64Array;
            for (let i = 0; i < 16; i++) worst = Math.max(worst, Math.abs((m[i] as number) - (n[i] as number)));
          }
          expect(worst).toBeLessThan(1e-9);
        }
      }),
      { seed: 6302, numRuns: 20 },
    );
  });

  it('a key r on a re-oriented bone-aligned control converts to r′ with q_old·R(r)·q_old⁻¹ = q_new·R(r′)·q_new⁻¹ (every rotate order)', () => {
    const chain: JointRecord[] = [0, 1, 2, 3].map((i) => ({
      id: `jnt_tail_${i}` as JointId,
      skeleton: SKEL,
      parent: i === 0 ? null : (`jnt_tail_${i - 1}` as JointId),
      order: `a${i}`,
      name: `tail_0${i + 1}`,
      humanBone: null,
      restPosition: [0.02 * i, 1 - 0.1 * i, -0.1 - 0.05 * i * i],
      restRotation: [0, 0, 0, 1],
      tail: i === 3 ? [0.08, 0.6, -0.6] : null,
      side: 'C',
      mirror: null,
      deleted: null,
      role: 'bone',
      key: `tail_0${i + 1}`,
    }));
    const edit = orientJoints(chain, { ...PRESETS.xAim, joints: [chain[0]?.id as JointId] });
    expect(edit.rotationDeltas.size).toBe(4);
    for (const order of ['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx'] as RotateOrder[]) {
      for (const joint of chain) {
        const delta = edit.rotationDeltas.get(joint.id) as readonly [number, number, number, number];
        const next = edit.upserts.find((u) => u.id === joint.id)?.restRotation as readonly [
          number,
          number,
          number,
          number,
        ];
        const r: [number, number, number] = [0.3, -0.7, 1.1];
        const r2 = convertBoneAlignedRotation(r, order, delta, r);
        // The world rotation the control gives its bone over the rest (the skinning delta) is unchanged.
        const a = quatMultiply(quatMultiply(joint.restRotation, eulerToQuat(r, order)), quatInvert(joint.restRotation));
        const b = quatMultiply(quatMultiply(next, eulerToQuat(r2, order)), quatInvert(next));
        const s = Math.sign(a[3] * b[3] + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) || 1;
        for (let i = 0; i < 4; i++) expect(Math.abs((a[i] as number) - s * (b[i] as number))).toBeLessThan(1e-9);
      }
    }
  });
});

describe('Orient Joint (§5.5)', () => {
  const chain = (): JointRecord[] =>
    [0, 1, 2].map((i) => ({
      id: `jnt_c${i}` as JointId,
      skeleton: SKEL,
      parent: i === 0 ? null : (`jnt_c${i - 1}` as JointId),
      order: `a${i}`,
      name: `arm_${i}_L`,
      humanBone: null,
      restPosition: [0.2 + 0.25 * i, 1.4 - 0.1 * i, 0.01 * i],
      restRotation: [0, 0, 0, 1],
      tail: i === 2 ? [0.9, 1.15, 0.03] : null,
      side: 'L',
      mirror: null,
      deleted: null,
      role: 'bone',
      key: `arm_${i}_L`,
    }));

  it('aim: the primary axis points at the child (1e-12), the secondary toward +Y; World resets to identity', () => {
    const joints = chain();
    const edit = orientJoints(joints, { ...PRESETS.xAim, joints: [id('x'), 'jnt_c0' as JointId] });
    const after = apply(joints, edit);
    for (const [i, j] of [
      [0, 1],
      [1, 2],
    ] as const) {
      const a = after[i] as JointRecord;
      const b = after[j] as JointRecord;
      const x = quatRotateVec3(a.restRotation, [1, 0, 0]);
      const d = [
        b.restPosition[0] - a.restPosition[0],
        b.restPosition[1] - a.restPosition[1],
        b.restPosition[2] - a.restPosition[2],
      ];
      const l = Math.hypot(...d);
      for (let k = 0; k < 3; k++) expect(x[k]).toBeCloseTo((d[k] as number) / l, 12);
      expect(quatRotateVec3(a.restRotation, [0, 1, 0])[1]).toBeGreaterThan(0.9);
    }
    // The leaf with a tail aims at it.
    const leaf = after[2] as JointRecord;
    const x = quatRotateVec3(leaf.restRotation, [1, 0, 0]);
    expect(x[0]).toBeGreaterThan(0.9);
    const world = orientJoints(after, { ...PRESETS.world, joints: ['jnt_c0' as JointId] });
    for (const u of world.upserts) expect(u.restRotation).toEqual([0, 0, 0, 1]);
    // World on identity-rest humanoid joints changes nothing (E2E-JNT-01's "Auto → World: no change").
    expect(orientJoints(human(), { ...PRESETS.world, joints: [id('hips')] }).upserts).toEqual([]);
  });

  it('symmetry: the partner outside the set takes the Behavior mirror of the new rotation', () => {
    const left = chain();
    const right = left.map((j) => ({
      ...j,
      id: j.id.replace('jnt_c', 'jnt_r') as JointId,
      parent: j.parent === null ? null : (j.parent.replace('jnt_c', 'jnt_r') as JointId),
      name: j.name.replace('_L', '_R'),
      key: j.key.replace('_L', '_R'),
      side: 'R' as const,
      restPosition: [-j.restPosition[0], j.restPosition[1], j.restPosition[2]] as const,
      tail: j.tail === null ? null : ([-j.tail[0], j.tail[1], j.tail[2]] as const),
    }));
    const edit = orientJoints([...left, ...right], { ...PRESETS.xAim, joints: ['jnt_c0' as JointId], symmetry: true });
    const after = apply([...left, ...right], edit);
    const l = get(after, 'jnt_c0').restRotation;
    const r = get(after, 'jnt_r0').restRotation;
    const behavior = quatMultiply([1, 0, 0, 0], l);
    const s = Math.sign(behavior[3]) || 1;
    for (let i = 0; i < 4; i++) expect(r[i]).toBeCloseTo(s * (behavior[i] as number), 12);
  });
});

describe('P-J3: Mirror Joint', () => {
  it('humanoid arm L → R updates in place (ids unchanged), Orientation mode on identity rests', () => {
    const joints = human();
    const moved = apply(
      joints,
      moveJoints(joints, [id('leftLowerArm')], { t: [0, 0.03, -0.01], pivot: [0, 0, 0] }, 'joint', false),
    );
    let n = 0;
    const edit = mirrorJoints(
      moved,
      { root: id('leftUpperArm'), direction: 'auto', mode: 'auto', search: '', replace: '', update: true },
      () => `jnt_new_${n++}` as JointId,
    );
    expect(n).toBe(0);
    const after = apply(moved, edit);
    const l = get(after, 'leftLowerArm');
    const r = get(after, 'rightLowerArm');
    expect(r.id).toBe(id('rightLowerArm'));
    expect(r.restPosition).toEqual([-l.restPosition[0], l.restPosition[1], l.restPosition[2]]);
    expect(r.restRotation).toEqual([0, 0, 0, 1]);
    expect(r.mirror).toBe(l.id);
    expect(after).toHaveLength(joints.length);
  });

  it('involution: twice restores positions bit-equal and rotations within 1e-12 (Behavior on an aim chain)', () => {
    const joints = human();
    const aimed = apply(joints, orientJoints(joints, { ...PRESETS.xAim, joints: [id('leftUpperArm')] }));
    let n = 0;
    const newId = () => `jnt_new_${n++}` as JointId;
    const once = apply(
      aimed,
      mirrorJoints(
        aimed,
        { root: id('leftUpperArm'), direction: 'left-to-right', mode: 'auto', search: '', replace: '', update: true },
        newId,
      ),
    );
    // Behavior picked (the subtree is aim-oriented): q_R = q_X(π)·q_L.
    const lq = get(once, 'leftUpperArm').restRotation;
    const rq = get(once, 'rightUpperArm').restRotation;
    const behavior = quatMultiply([1, 0, 0, 0], lq);
    const s = Math.sign(behavior[3]) || 1;
    for (let i = 0; i < 4; i++) expect(rq[i]).toBeCloseTo(s * (behavior[i] as number), 12);
    // The mirrored aim chain's local X lies along its bone (Behavior points it toward the parent).
    const a = get(once, 'rightUpperArm');
    const b = get(once, 'rightLowerArm');
    const x = quatRotateVec3(a.restRotation, [1, 0, 0]);
    const d: [number, number, number] = [
      b.restPosition[0] - a.restPosition[0],
      b.restPosition[1] - a.restPosition[1],
      b.restPosition[2] - a.restPosition[2],
    ];
    const l = Math.hypot(...d);
    expect(Math.abs(x[0] * d[0] + x[1] * d[1] + x[2] * d[2]) / l).toBeCloseTo(1, 9);
    const twice = apply(
      once,
      mirrorJoints(
        once,
        { root: id('rightUpperArm'), direction: 'right-to-left', mode: 'auto', search: '', replace: '', update: true },
        newId,
      ),
    );
    // The round trip L → R → L restores the source subtree.
    for (const joint of new JointIndex(aimed).subtree(id('leftUpperArm'))) {
      const back = get(twice, joint.id);
      expect([joint.key, back.restPosition]).toEqual([joint.key, joint.restPosition]);
      for (let i = 0; i < 4; i++)
        expect(Math.abs((back.restRotation[i] as number) - (joint.restRotation[i] as number))).toBeLessThan(1e-12);
    }
  });

  it('a chain without a counterpart is created with derived ids, swapped names, links both ways', () => {
    const joints = human();
    const tail: JointRecord = {
      ...get(joints, 'leftHand'),
      id: 'jnt_pony_L' as JointId,
      parent: id('head'),
      name: 'pony_L',
      key: 'pony_L',
      humanBone: null,
      mirror: null,
      restPosition: [0.05, 1.5, -0.1],
      tail: [0.08, 1.4, -0.15],
    };
    let n = 0;
    const edit = mirrorJoints(
      [...joints, tail],
      { root: tail.id, direction: 'auto', mode: 'auto', search: '', replace: '', update: true },
      () => `jnt_new_${n++}` as JointId,
    );
    const created = edit.upserts.find((u) => u.id === 'jnt_new_0');
    expect(created).toMatchObject({
      name: 'pony_R',
      side: 'R',
      parent: id('head'),
      mirror: tail.id,
      restPosition: [-0.05, 1.5, -0.1],
    });
    expect(edit.upserts.find((u) => u.id === tail.id)?.mirror).toBe('jnt_new_0');
  });
});

describe('humanoid edits', () => {
  it('setHumanBone: uniqueness and the VRM parent map are enforced; the side follows the bone', () => {
    const joints = human();
    expect(() => setHumanBone(joints, id('leftHand'), 'rightHand')).toThrow(/already mapped/);
    expect(() => setHumanBone(joints, id('leftThumbMetacarpal'), 'leftIndexProximal')).not.toThrow();
    const unmapped = apply(joints, setHumanBone(joints, id('leftHand'), null));
    expect(() => setHumanBone(unmapped, id('leftHand'), 'head')).toThrow(/VRM parent map|already mapped/);
    const edit = setHumanBone(unmapped, id('leftHand'), 'leftHand');
    expect(edit.upserts[0]).toMatchObject({ humanBone: 'leftHand', side: 'L' });
  });

  it('rename: unique names, the partner takes the swapped name, keys never change', () => {
    const joints = human().map((j) =>
      j.key === 'leftHand' ? { ...j, name: 'hand_L' } : j.key === 'rightHand' ? { ...j, name: 'hand_R' } : j,
    );
    const edit = renameJoint(joints, id('leftHand'), 'paw_L', true);
    expect(edit.upserts.map((u) => [u.key, u.name])).toEqual([
      ['leftHand', 'paw_L'],
      ['rightHand', 'paw_R'],
    ]);
    expect(() => renameJoint(joints, id('leftHand'), 'hips', false)).toThrow(/named hips/);
  });

  it('flex: straight hinges get exactly the minimum bend; bent ones stay', () => {
    const straight = human().map((j) =>
      j.humanBone?.endsWith('LowerArm') || j.humanBone?.endsWith('LowerLeg')
        ? { ...j, restPosition: [j.restPosition[0], j.restPosition[1], 0] as const }
        : j,
    );
    const edit = flexJoints(straight, DEFAULT_FLEXION, null);
    expect(edit.upserts.map((u) => u.key).sort()).toEqual([
      'leftLowerArm',
      'leftLowerLeg',
      'rightLowerArm',
      'rightLowerLeg',
    ]);
    const after = apply(straight, edit);
    const A = get(after, 'leftUpperArm').restPosition;
    const B = get(after, 'leftLowerArm').restPosition;
    const C = get(after, 'leftHand').restPosition;
    const a = Math.hypot(B[0] - A[0], B[1] - A[1], 0);
    const b = Math.hypot(C[0] - B[0], C[1] - B[1], 0);
    expect(hingeBend(A, B, C, [0, 0, -1])).toBeCloseTo((DEFAULT_FLEXION * a * b) / (a + b), 6);
    expect(flexJoints(human(), DEFAULT_FLEXION, null).upserts).toEqual([]);
  });

  it('addMissing: maps an unmapped joint near the template position, else adds the bone under its template parent', () => {
    const joints = human();
    const skeleton: SkeletonRecord = {
      id: SKEL,
      character: 'chr_x' as never,
      template: 'vrm-humanoid',
      templateVersion: '1.0.0',
      preset: 'standard33',
      symmetry: true,
      deleted: null,
    };
    // leftHand unmapped (stays in place: mapped back); rightFoot deleted (added at the template position).
    const broken = joints
      .map((j) => (j.key === 'leftHand' ? { ...j, humanBone: null, name: 'hand' } : j))
      .filter((j) => j.key !== 'rightFoot' && j.parent !== id('rightFoot'));
    const result = addMissingBones(broken, skeleton);
    expect(result.mapped).toEqual([id('leftHand')]);
    expect(result.added).toEqual([id('rightFoot')]);
    const foot = result.upserts.find((u) => u.id === id('rightFoot'));
    expect(foot).toMatchObject({
      parent: id('rightLowerLeg'),
      humanBone: 'rightFoot',
      side: 'R',
      role: 'bone',
      mirror: id('leftFoot'),
    });
    expect((result.upserts.find((u) => u.id === id('leftFoot')) ?? get(broken, 'leftFoot')).mirror).toBe(
      id('rightFoot'),
    );
  });
});
