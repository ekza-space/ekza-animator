import {
  eulerToQuat,
  mat4Decompose,
  type Quat,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type RotateOrder,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import { controlId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import {
  autoRig,
  CHANNELS_PER_CONTROL,
  compileRig,
  controlWorld,
  HUMAN_BONE_NAMES,
  readControlChannels,
  type RigProgram,
  type SkeletonDesc,
  writeControlChannels,
} from '../src';
import {
  IDS,
  maxAbsDiff,
  quatAngleBetween,
  quatAt,
  restPoseFixture,
  richHumanoid,
  subarray16,
  syntheticSkeleton,
  genericSkeleton,
  vecAt,
  worldQuat,
} from './helpers';

function rigFor(skeleton: SkeletonDesc, kind?: 'humanoid' | 'generic'): RigProgram {
  return compileRig(autoRig(skeleton, IDS, kind === undefined ? {} : { kind }), skeleton);
}

function id(key: string): ControlId {
  return controlId(IDS.rig, key);
}

/** Max deviation of the zero pose from rest: raw locals (t, normalized q, s) and identity normalized rotations. */
function zeroPoseError(skeleton: SkeletonDesc, program: RigProgram): number {
  const pose = program.allocPose();
  program.evaluate(program.allocChannels(), pose);
  let error = 0;
  skeleton.nodes.forEach((node, i) => {
    const local = pose.boneLocal.subarray(i * 10, i * 10 + 10);
    const q = node.restLocal.q;
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    error = Math.max(
      error,
      maxAbsDiff(local.subarray(0, 3), node.restLocal.t),
      maxAbsDiff(local.subarray(3, 7), [q[0] / n, q[1] / n, q[2] / n, q[3] / n]),
      maxAbsDiff(local.subarray(7, 10), node.restLocal.s),
    );
  });
  for (let h = 0; h < HUMAN_BONE_NAMES.length; h++) {
    error = Math.max(error, maxAbsDiff(quatAt(pose.humanLocal, h * 4), [0, 0, 0, 1]));
  }
  return error;
}

describe('kernel: zero pose = rest (ADR 0004 §2)', () => {
  it('reproduces the synthetic rest pose exactly (locals, worlds, hips)', () => {
    const skeleton = syntheticSkeleton();
    const program = rigFor(skeleton);
    expect(zeroPoseError(skeleton, program)).toBeLessThan(1e-9);
    const pose = program.allocPose();
    program.evaluate(program.allocChannels(), pose);
    for (const bone of restPoseFixture().bones) {
      expect(maxAbsDiff(subarray16(pose.boneWorld, bone.node), bone.world)).toBeLessThan(1e-9);
    }
    expect(maxAbsDiff(pose.hipsPosition, [0, 0.95, 0])).toBeLessThan(1e-12);
    expect(pose.version).toBe(1);
  });

  it('holds for humanoid, VRM 0.x-facing, generic and secondary-heavy rigs', () => {
    for (const skeleton of [richHumanoid(), richHumanoid({ vrm0: true }), richHumanoid({ leftToes: false })]) {
      expect(zeroPoseError(skeleton, rigFor(skeleton))).toBeLessThan(1e-9);
    }
    const generic = genericSkeleton();
    expect(zeroPoseError(generic, rigFor(generic))).toBeLessThan(1e-9);
    const forcedGeneric = richHumanoid();
    expect(zeroPoseError(forcedGeneric, rigFor(forcedGeneric, 'generic'))).toBeLessThan(1e-9);
  });

  it('places controls at their rest worlds with default channels', () => {
    const skeleton = richHumanoid();
    const program = rigFor(skeleton);
    const pose = program.allocPose();
    program.evaluate(program.allocChannels(), pose);
    program.controls.forEach((control) => {
      const world = controlWorld(program, pose, control.id);
      const xf = mat4Decompose(world);
      expect(maxAbsDiff(xf.t, control.restWorld.t)).toBeLessThan(1e-12);
      expect(quatAngleBetween(xf.q, control.restWorld.q)).toBeLessThan(1e-9);
    });
  });
});

describe('kernel: forward evaluation', () => {
  it('rotates a world-aligned FK control about character axes in its rotate order', () => {
    const skeleton = syntheticSkeleton();
    const program = rigFor(skeleton);
    const ch = program.allocChannels();
    const pose = program.allocPose();
    const e: Vec3 = [0.3, -0.4, 0.5];
    writeControlChannels(program, ch, id('fk.lowerArm.L'), { rx: e[0], ry: e[1], rz: e[2] });
    program.evaluate(ch, pose);
    const node = skeleton.humanoid?.leftLowerArm as number;
    const rest = restPoseFixture().bones[node] as { q: Quat };
    const expected = quatMultiply(eulerToQuat(e, 'xzy'), rest.q);
    expect(quatAngleBetween(worldQuat(subarray16(pose.boneWorld, node)), expected)).toBeLessThan(1e-12);
    // The child hand follows rigidly (its control has default channels, so its world delta equals the parent's).
    const hand = skeleton.humanoid?.leftHand as number;
    const handRest = restPoseFixture().bones[hand] as { q: Quat; t: Vec3 };
    expect(
      quatAngleBetween(worldQuat(subarray16(pose.boneWorld, hand)), quatMultiply(eulerToQuat(e, 'xzy'), handRest.q)),
    ).toBeLessThan(1e-12);
    // Normalized rotation of the lower arm is the control's local rotation (world-aligned FK under a world-aligned parent).
    const h = HUMAN_BONE_NAMES.indexOf('leftLowerArm');
    expect(quatAngleBetween(quatAt(pose.humanLocal, h * 4), eulerToQuat(e, 'xzy'))).toBeLessThan(1e-12);
  });

  it('moves the body with cog and keeps bone lengths under rotate bindings', () => {
    const skeleton = richHumanoid();
    const program = rigFor(skeleton);
    const ch = program.allocChannels();
    const pose = program.allocPose();
    writeControlChannels(program, ch, id('cog'), { tx: 0.1, ty: -0.2, tz: 0.3, ry: 0.7 });
    writeControlChannels(program, ch, id('fk.upperArm.L'), { rz: -1.1 });
    program.evaluate(ch, pose);
    const hips = skeleton.humanoid?.hips as number;
    expect(maxAbsDiff(vecAt(pose.hipsPosition, 0), [0.1, 0.75, 0.3])).toBeLessThan(1e-12);
    expect(maxAbsDiff(vecAt(pose.boneWorld, hips * 16 + 12), [0.1, 0.75, 0.3])).toBeLessThan(1e-12);
    // Rotate-bound bones keep rest local translations.
    for (const name of ['leftLowerArm', 'leftHand', 'spine', 'head'] as const) {
      const node = skeleton.humanoid?.[name] as number;
      expect(
        maxAbsDiff(pose.boneLocal.subarray(node * 10, node * 10 + 3), skeleton.nodes[node]?.restLocal.t ?? []),
      ).toBeLessThan(1e-12);
    }
    // N_hips = D_hips includes the cog yaw.
    expect(quatAngleBetween(quatAt(pose.humanLocal, 0), eulerToQuat([0, 0.7, 0], 'zxy'))).toBeLessThan(1e-12);
  });

  it('computes N_b from world deltas, not from control locals (fk.spine under cog, twist joints)', () => {
    const skeleton = richHumanoid();
    const program = rigFor(skeleton);
    const ch = program.allocChannels();
    const pose = program.allocPose();
    // Tilt the pelvis only: the spine control (under cog) keeps its world rotation, so N_spine = D_hips⁻¹.
    writeControlChannels(program, ch, id('fk.hips'), { rx: 0.4 });
    // Pose the secondary twist joint: the hand keeps its control-defined world rotation (rotate binding).
    writeControlChannels(program, ch, id('sec.leftForeArmTwist'), { rx: 0.9 });
    program.evaluate(ch, pose);
    const qHips = eulerToQuat([0.4, 0, 0], 'zxy');
    const spine = HUMAN_BONE_NAMES.indexOf('spine');
    expect(quatAngleBetween(quatAt(pose.humanLocal, spine * 4), quatInvert(qHips))).toBeLessThan(1e-12);
    const hand = HUMAN_BONE_NAMES.indexOf('leftHand');
    expect(quatAngleBetween(quatAt(pose.humanLocal, hand * 4), [0, 0, 0, 1])).toBeLessThan(1e-12);
    // …but the raw local of the hand compensates the twist.
    const handNode = skeleton.humanoid?.leftHand as number;
    const handRestQ = skeleton.nodes[handNode]?.restLocal.q as Quat;
    expect(quatAngleBetween(quatAt(pose.boneLocal, handNode * 10 + 3), handRestQ)).toBeGreaterThan(0.5);
  });

  it('applies the π-yaw facing of VRM 0.x skeletons only at the root', () => {
    const vrm1 = richHumanoid();
    const vrm0 = richHumanoid({ vrm0: true });
    const p1 = rigFor(vrm1);
    const p0 = rigFor(vrm0);
    const c1 = p1.allocChannels();
    const c0 = p0.allocChannels();
    for (const [program, ch] of [
      [p1, c1],
      [p0, c0],
    ] as const) {
      writeControlChannels(program, ch, id('fk.upperArm.L'), { rx: 0.2, ry: 0.3, rz: -0.6 });
      writeControlChannels(program, ch, id('cog'), { tx: 0.05, ry: 0.4 });
    }
    const pose1 = p1.allocPose();
    const pose0 = p0.allocPose();
    p1.evaluate(c1, pose1);
    p0.evaluate(c0, pose0);
    // Canonical outputs agree; raw locals differ only at the root (file space).
    expect(maxAbsDiff(pose1.boneWorld, pose0.boneWorld)).toBeLessThan(1e-12);
    expect(maxAbsDiff(pose1.humanLocal, pose0.humanLocal)).toBeLessThan(1e-12);
    expect(maxAbsDiff(pose1.hipsPosition, pose0.hipsPosition)).toBeLessThan(1e-12);
    const root = 0;
    const fileRoot = quatAt(pose0.boneLocal, root * 10 + 3);
    expect(quatAngleBetween(fileRoot, quatAt(pose1.boneLocal, root * 10 + 3))).toBeGreaterThan(3);
  });

  it('drives generic joints with full bindings in bone-aligned frames', () => {
    const skeleton = genericSkeleton();
    const program = rigFor(skeleton);
    const ch = program.allocChannels();
    const pose = program.allocPose();
    const spine = program.controls.find((c) => c.key === 'fk.spine') as { id: ControlId };
    writeControlChannels(program, ch, spine.id, { tx: 0.01, rx: 0.5, sx: 2, sy: 2, sz: 2 });
    program.evaluate(ch, pose);
    const node = 2;
    const local = pose.boneLocal.subarray(node * 10, node * 10 + 10);
    const rest = skeleton.nodes[node]?.restLocal ?? { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    const q = eulerToQuat([0.5, 0, 0], 'xyz');
    // Bone-aligned: the bone's local becomes L⁰ · T(t) · R · S in its own rest frame.
    const expectedQ = quatMultiply(rest.q, q);
    expect(quatAngleBetween(quatAt(local, 3), expectedQ)).toBeLessThan(1e-12);
    expect(maxAbsDiff(local.subarray(7, 10), [2, 2, 2])).toBeLessThan(1e-12);
    const shift = quatRotateVec3(rest.q, [0.01, 0, 0]);
    expect(
      maxAbsDiff(local.subarray(0, 3), [rest.t[0] + shift[0], rest.t[1] + shift[1], rest.t[2] + shift[2]]),
    ).toBeLessThan(1e-12);
  });

  it('keeps every output finite when a control collapses its subtree to scale 0', () => {
    const skeleton = genericSkeleton();
    const program = rigFor(skeleton);
    const ch = program.allocChannels();
    const pose = program.allocPose();
    const spine = program.controls.find((c) => c.key === 'fk.spine') as { id: ControlId };
    writeControlChannels(program, ch, spine.id, { sx: 0, sy: 0, sz: 0, rx: 0.3 });
    program.evaluate(ch, pose);
    for (const buffer of [pose.boneLocal, pose.boneWorld, pose.controlWorld, pose.humanLocal, pose.hipsPosition]) {
      expect(buffer.every((x) => Number.isFinite(x))).toBe(true);
    }
  });

  it('is deterministic and allocation-free in shape (same buffers, same values)', () => {
    const skeleton = richHumanoid();
    const program = rigFor(skeleton);
    const ch = program.allocChannels();
    for (let i = 0; i < ch.values.length; i++)
      if (i % CHANNELS_PER_CONTROL >= 3 && i % 9 < 6) ch.values[i] = Math.sin(i) * 0.5;
    const a = program.allocPose();
    const b = program.allocPose();
    program.evaluate(ch, a);
    program.evaluate(ch, b);
    program.evaluate(ch, b);
    expect([...a.boneLocal]).toEqual([...b.boneLocal]);
    expect([...a.boneWorld]).toEqual([...b.boneWorld]);
    expect([...a.humanLocal]).toEqual([...b.humanLocal]);
    expect(b.version).toBe(2);
  });
});

describe('channel buffers', () => {
  it('reads and writes channels by control and resets to defaults', () => {
    const program = rigFor(syntheticSkeleton());
    const ch = program.allocChannels();
    const control = id('fk.head');
    expect(readControlChannels(program, ch, control)).toEqual({
      tx: 0,
      ty: 0,
      tz: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 1,
      sy: 1,
      sz: 1,
    });
    writeControlChannels(program, ch, control, { rx: 0.5, sz: 2, '@custom': 3 });
    expect(readControlChannels(program, ch, control)).toMatchObject({ rx: 0.5, sz: 2 });
    program.resetChannels(ch);
    expect(readControlChannels(program, ch, control).rx).toBe(0);
    expect(() => readControlChannels(program, ch, 'rig_x:nope' as ControlId)).toThrow(/not part of rig program/);
  });

  it('uses each control rotate order (DCC: first letter applied first)', () => {
    const program = rigFor(syntheticSkeleton());
    const orders = new Map(program.controls.map((c) => [c.key, c.rotateOrder]));
    const expected: Record<string, RotateOrder> = {
      root: 'zxy',
      cog: 'zxy',
      'fk.hips': 'zxy',
      'fk.spine': 'zxy',
      'fk.head': 'zxy',
      'fk.jaw': 'zxy',
      'fk.shoulder.L': 'yxz',
      'fk.upperArm.R': 'yxz',
      'fk.lowerArm.L': 'xzy',
      'fk.hand.L': 'xyz',
      'fk.indexProximal.R': 'xyz',
      'fk.upperLeg.L': 'yzx',
      'fk.foot.R': 'yzx',
      'fk.toes.L': 'yzx',
    };
    for (const [key, order] of Object.entries(expected))
      expect({ key, order: orders.get(key) }).toEqual({ key, order });
  });
});
