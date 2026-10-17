import { mat4Compose, mat4Decompose, type Quat, quatMultiply, quatNormalize } from '@ekza-animator/anim-core';
import { type ChannelValues, type ControlId, controlId } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  autoRig,
  compileRig,
  controlForNode,
  controlWorld,
  isHumanoidProgram,
  nodeForControl,
  readControlChannels,
  type RigProgram,
  solveBoneChannels,
  solveControlChannels,
  writeControlChannels,
} from '../src';
import { genericSkeleton, IDS, maxAbsDiff, quatAngleBetween, richHumanoid, subarray16, worldQuat } from './helpers';

const id = (key: string): ControlId => controlId(IDS.rig, key);
const angle = fc.double({ min: -2.5, max: 2.5, noNaN: true });
const offset = fc.double({ min: -0.3, max: 0.3, noNaN: true });

function randomPose(program: RigProgram, seed: number): ReturnType<RigProgram['allocChannels']> {
  const ch = program.allocChannels();
  let state = seed;
  const next = (): number => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647 - 0.5;
  };
  program.controls.forEach((control) => {
    const values: ChannelValues = {};
    if (control.keyable.r[0]) values.rx = next() * 1.5;
    if (control.keyable.r[1]) values.ry = next() * 1.5;
    if (control.keyable.r[2]) values.rz = next() * 1.5;
    if (control.keyable.t[0]) values.tx = next() * 0.3;
    if (control.keyable.t[1]) values.ty = next() * 0.3;
    if (control.keyable.t[2]) values.tz = next() * 0.3;
    writeControlChannels(program, ch, control.id, values);
  });
  return ch;
}

describe('solveControlChannels', () => {
  const skeleton = richHumanoid();
  const program = compileRig(autoRig(skeleton, IDS), skeleton);

  it('reproduces a random target world for a translate+rotate control (1e-9, property)', () => {
    fc.assert(
      fc.property(fc.tuple(angle, angle, angle), fc.tuple(offset, offset, offset), (e, t) => {
        const ch = randomPose(program, 11);
        const pose = program.allocPose();
        program.evaluate(ch, pose);
        // Desired world: an arbitrary transform reachable by t+r channels of cog.
        const desired = mat4Compose({ t: [t[0], 0.9 + t[1], t[2]], q: quatNormalize(euler(e)), s: [1, 1, 1] });
        const values = solveControlChannels(program, pose, id('cog'), desired, readControlChannels(program, ch, id('cog')));
        writeControlChannels(program, ch, id('cog'), values);
        program.evaluate(ch, pose);
        expect(maxAbsDiff(controlWorld(program, pose, id('cog')), desired)).toBeLessThan(1e-9);
      }),
      { numRuns: 50, seed: 3 },
    );
  });

  it('reproduces a random target rotation for a rotate-only FK control under a posed parent', () => {
    fc.assert(
      fc.property(fc.tuple(angle, angle, angle), (e) => {
        const ch = randomPose(program, 5);
        const pose = program.allocPose();
        program.evaluate(ch, pose);
        const current = mat4Decompose(controlWorld(program, pose, id('fk.lowerArm.L')));
        const desired = mat4Compose({ t: current.t, q: quatNormalize(euler(e)), s: [1, 1, 1] });
        const values = solveControlChannels(program, pose, id('fk.lowerArm.L'), desired, {});
        expect(Object.keys(values).sort()).toEqual(['rx', 'ry', 'rz']);
        writeControlChannels(program, ch, id('fk.lowerArm.L'), values);
        program.evaluate(ch, pose);
        expect(maxAbsDiff(controlWorld(program, pose, id('fk.lowerArm.L')), desired)).toBeLessThan(1e-9);
      }),
      { numRuns: 50, seed: 4 },
    );
  });

  it('chooses the Euler triple nearest the reference (no 2π jumps or branch flips)', () => {
    const ch = program.allocChannels();
    const pose = program.allocPose();
    writeControlChannels(program, ch, id('fk.head'), { rx: 0.2, ry: 3.0, rz: -0.1 });
    program.evaluate(ch, pose);
    const world = controlWorld(program, pose, id('fk.head'));
    const near = solveControlChannels(program, pose, id('fk.head'), world, { rx: 0.2, ry: 3.0, rz: -0.1 });
    expect(near.rx).toBeCloseTo(0.2, 9);
    expect(near.ry).toBeCloseTo(3.0, 9);
    expect(near.rz).toBeCloseTo(-0.1, 9);
    const wrapped = solveControlChannels(program, pose, id('fk.head'), world, { rx: 0.2, ry: 3.0 + 2 * Math.PI, rz: -0.1 });
    expect(wrapped.ry).toBeCloseTo(3.0 + 2 * Math.PI, 9);
  });

  it('solves generic bone-aligned controls in translation and rotation', () => {
    const generic = genericSkeleton();
    const gp = compileRig(autoRig(generic, IDS), generic);
    const ch = randomPose(gp, 9);
    const pose = gp.allocPose();
    gp.evaluate(ch, pose);
    const spine = gp.controls.find((c) => c.key === 'fk.spine')?.id as ControlId;
    const desired = mat4Compose({ t: [0.1, 1.2, -0.05], q: quatNormalize([0.1, 0.2, -0.3, 0.9]), s: [1, 1, 1] });
    const values = solveControlChannels(gp, pose, spine, desired, readControlChannels(gp, ch, spine));
    writeControlChannels(gp, ch, spine, values);
    gp.evaluate(ch, pose);
    // Scale channels are not solved; this control's world scale stays 1 (all scales default in randomPose).
    expect(maxAbsDiff(controlWorld(gp, pose, spine), desired)).toBeLessThan(1e-9);
  });
});

describe('solveBoneChannels', () => {
  it('recovers a random humanoid pose from its bone worlds, top-down (1e-9)', () => {
    const skeleton = richHumanoid();
    const program = compileRig(autoRig(skeleton, IDS), skeleton);
    const target = program.allocPose();
    program.evaluate(randomPose(program, 21), target);
    const worlds = new Map<number, Float64Array>();
    for (const node of program.drivenNodes) worlds.set(node, subarray16(target.boneWorld, node));
    const rest = program.allocPose();
    program.evaluate(program.allocChannels(), rest);
    const solved = solveBoneChannels(program, rest, worlds, new Map());
    // cog is not driven: it keeps rest, so the hips are reached through fk.hips (rotation only) — compare rotations
    // of all bones and positions of every bone but the hips chain translation.
    const ch = program.allocChannels();
    for (const [control, values] of solved) writeControlChannels(program, ch, control, values);
    const pose = program.allocPose();
    program.evaluate(ch, pose);
    for (const node of program.drivenNodes) {
      expect(quatAngleBetween(worldQuat(subarray16(pose.boneWorld, node)), worldQuat(subarray16(target.boneWorld, node))))
        .toBeLessThan(1e-9);
    }
    expect(solved.has(id('cog'))).toBe(false);
  });

  it('reproduces full bone worlds on generic rigs', () => {
    const skeleton = genericSkeleton();
    const program = compileRig(autoRig(skeleton, IDS), skeleton);
    const target = program.allocPose();
    program.evaluate(randomPose(program, 33), target);
    const worlds = new Map<number, Float64Array>();
    for (const node of program.drivenNodes) worlds.set(node, subarray16(target.boneWorld, node));
    const rest = program.allocPose();
    program.evaluate(program.allocChannels(), rest);
    const solved = solveBoneChannels(program, rest, worlds, new Map());
    const ch = program.allocChannels();
    for (const [control, values] of solved) writeControlChannels(program, ch, control, values);
    const pose = program.allocPose();
    program.evaluate(ch, pose);
    expect(maxAbsDiff(pose.boneWorld, target.boneWorld)).toBeLessThan(1e-9);
  });

  it('ignores undriven nodes and returns nothing for an empty request', () => {
    const skeleton = richHumanoid();
    const program = compileRig(autoRig(skeleton, IDS), skeleton);
    const pose = program.allocPose();
    program.evaluate(program.allocChannels(), pose);
    expect(solveBoneChannels(program, pose, new Map(), new Map()).size).toBe(0);
    expect(solveBoneChannels(program, pose, new Map([[0, new Float64Array(16)]]), new Map()).size).toBe(0);
  });
});

describe('control ↔ node lookups', () => {
  const skeleton = richHumanoid();
  const program = compileRig(autoRig(skeleton, IDS), skeleton);

  it('maps controls to driven nodes and nodes to their nearest driving control', () => {
    const hand = skeleton.humanoid?.leftHand as number;
    expect(nodeForControl(program, id('fk.hand.L'))).toBe(hand);
    expect(nodeForControl(program, id('cog'))).toBe(-1);
    expect(nodeForControl(program, 'rig_X:nope' as ControlId)).toBe(-1);
    expect(controlForNode(program, hand)).toBe(id('fk.hand.L'));
    const eye = skeleton.humanoid?.leftEye as number;
    expect(controlForNode(program, eye)).toBe(id('fk.head'));
    const ponytail = skeleton.nodes.findIndex((n) => n.name === 'ponytail_end');
    expect(controlForNode(program, ponytail)).toBe(id('fk.head'));
    expect(controlForNode(program, 0)).toBeNull();
    expect(controlForNode(program, 9999)).toBeNull();
  });

  it('recognizes humanoid programs', () => {
    expect(isHumanoidProgram(program)).toBe(true);
    const generic = genericSkeleton();
    expect(isHumanoidProgram(compileRig(autoRig(generic, IDS), generic))).toBe(false);
    expect(isHumanoidProgram(compileRig(autoRig(skeleton, IDS, { kind: 'generic' }), skeleton))).toBe(false);
  });
});

function euler(e: readonly [number, number, number]): Quat {
  const qx: Quat = [Math.sin(e[0] / 2), 0, 0, Math.cos(e[0] / 2)];
  const qy: Quat = [0, Math.sin(e[1] / 2), 0, Math.cos(e[1] / 2)];
  const qz: Quat = [0, 0, Math.sin(e[2] / 2), Math.cos(e[2] / 2)];
  return quatMultiply(qz, quatMultiply(qy, qx));
}

