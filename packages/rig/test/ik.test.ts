import {
  mat4Compose,
  mat4Decompose,
  type Quat,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  type Vec3,
} from '@ekza-animator/anim-core';
import { type ChannelValues, type ControlId, controlId } from '@ekza-animator/doc';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  autoRig,
  compileRig,
  type FootPin,
  plantFeetChannels,
  readControlChannels,
  type RigProgram,
  type SkeletonDesc,
  solveTwoBoneIk,
  type TwoBoneIkInput,
  type TwoBoneIkOutput,
  writeControlChannels,
} from '../src';
import {
  genericSkeleton,
  IDS,
  quatAngleBetween,
  richHumanoid,
  subarray16,
  syntheticSkeleton,
  worldPos,
  worldQuat,
} from './helpers';

const id = (key: string): ControlId => controlId(IDS.rig, key);
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / len(a));

/** Forward kinematics of the IK result: joint positions a (upper), b (mid), c (end) and world rotations. */
function chainFk(input: TwoBoneIkInput, out: TwoBoneIkOutput) {
  const pa = mat4Decompose(input.parentWorld);
  const s = pa.s[0];
  const a = add(pa.t, quatRotateVec3(pa.q, scale([...input.upperRest.t], s)));
  const qU = quatMultiply(pa.q, out.upperLocal);
  const sU = s * input.upperRest.s[0];
  const b = add(a, quatRotateVec3(qU, scale([...input.midRest.t], sU)));
  const qM = quatMultiply(qU, out.midLocal);
  const sM = sU * input.midRest.s[0];
  const c = add(b, quatRotateVec3(qM, scale([...input.endRest.t], sM)));
  const qE = quatMultiply(qM, out.endLocal);
  const l1 = len(scale([...input.midRest.t], sU));
  const l2 = len(scale([...input.endRest.t], sM));
  return { a, b, c, qU, qM, qE, l1, l2 };
}

const unitVec = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter((v) => Math.hypot(...v) > 0.2)
  .map((v) => unit(v));
const quat = fc
  .tuple(unitVec, fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }))
  .map(
    ([axis, angle]): Quat => [
      axis[0] * Math.sin(angle / 2),
      axis[1] * Math.sin(angle / 2),
      axis[2] * Math.sin(angle / 2),
      Math.cos(angle / 2),
    ],
  );

/** A random chain whose hinge is perpendicular to both segments, with a target inside the reachable band. */
const chainCase = fc
  .record({
    parentQ: quat,
    parentT: fc.tuple(
      fc.double({ min: -1, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 2, noNaN: true }),
      fc.double({ min: -1, max: 1, noNaN: true }),
    ),
    parentS: fc.double({ min: 0.5, max: 2, noNaN: true }),
    upperQ: quat,
    upperT: fc.tuple(
      fc.double({ min: -0.2, max: 0.2, noNaN: true }),
      fc.double({ min: -0.2, max: 0.2, noNaN: true }),
      fc.double({ min: -0.2, max: 0.2, noNaN: true }),
    ),
    midQ: quat,
    endQ: quat,
    hinge: unitVec,
    upperDir: unitVec,
    lowerDir: unitVec,
    l1: fc.double({ min: 0.2, max: 0.6, noNaN: true }),
    l2: fc.double({ min: 0.2, max: 0.6, noNaN: true }),
    reach: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
    targetDir: unitVec,
    poleDir: unitVec,
  })
  .map((r): TwoBoneIkInput => {
    const h = r.hinge;
    // midRest.t ⟂ (q_M0 ⊗ h) in the upper frame; endRest.t ⟂ h in the mid frame.
    const hu = quatRotateVec3(r.midQ, h);
    const perp = (v: Vec3, axis: Vec3): Vec3 => {
      const p = sub(v, scale(axis, dot(v, axis)));
      return len(p) < 1e-3 ? unit(cross(axis, [axis[1], axis[2], -axis[0]])) : unit(p);
    };
    const midT = scale(perp(r.upperDir, hu), r.l1);
    const endT = scale(perp(r.lowerDir, h), r.l2);
    const parentWorld = mat4Compose({ t: r.parentT, q: r.parentQ, s: [r.parentS, r.parentS, r.parentS] });
    const pa = mat4Decompose(parentWorld);
    const a = add(pa.t, quatRotateVec3(pa.q, scale(r.upperT, r.parentS)));
    const L1 = r.l1 * r.parentS;
    const L2 = r.l2 * r.parentS;
    const lo = Math.abs(L1 - L2);
    const hi = L1 + L2;
    const d = lo + (hi - lo) * (0.02 + 0.96 * r.reach);
    return {
      parentWorld,
      upperRest: { t: r.upperT, q: r.upperQ, s: [1, 1, 1] },
      midRest: { t: midT, q: r.midQ, s: [1, 1, 1] },
      endRest: { t: endT, q: r.endQ, s: [1, 1, 1] },
      hingeLocal: h,
      target: add(a, scale(r.targetDir, d)),
      pole: add(a, scale(r.poleDir, hi)),
      twist: 0,
      soft: 0,
      endWorldRotation: null,
    };
  })
  .filter((input) => {
    // Poles on the chain axis do not define a plane.
    const pa = mat4Decompose(input.parentWorld);
    const a = add(pa.t, quatRotateVec3(pa.q, scale([...input.upperRest.t], pa.s[0])));
    const axis = unit(sub([...input.target] as Vec3, a));
    const toPole = sub([...input.pole] as Vec3, a);
    return len(sub(toPole, scale(axis, dot(toPole, axis)))) > 0.05;
  });

function output(): TwoBoneIkOutput {
  return { upperLocal: [0, 0, 0, 1], midLocal: [0, 0, 0, 1], endLocal: [0, 0, 0, 1], reached: false };
}

describe('solveTwoBoneIk (research 07 §9.2, §21.3)', () => {
  it('reaches reachable targets, bends about the hinge only and keeps the mid joint in the pole plane (property)', () => {
    fc.assert(
      fc.property(chainCase, (input) => {
        const out = output();
        solveTwoBoneIk(input, out);
        const fk = chainFk(input, out);
        const L = fk.l1 + fk.l2;
        expect(out.reached).toBe(true);
        expect(len(sub(fk.c, [...input.target] as Vec3))).toBeLessThan(1e-6 * L);
        // Mid local delta from rest is a rotation about the hinge axis.
        const delta = quatMultiply(quatInvert(quatNormalize(input.midRest.q)), out.midLocal);
        const v: Vec3 = [delta[0], delta[1], delta[2]];
        const offHinge = len(v) > 1e-12 ? len(cross(unit(v), [...input.hingeLocal] as Vec3)) : 0;
        expect(offHinge).toBeLessThan(1e-9);
        // Mid joint in the (a, target, pole) plane, on the pole side.
        const n = unit(cross(sub([...input.target] as Vec3, fk.a), sub([...input.pole] as Vec3, fk.a)));
        const ab = sub(fk.b, fk.a);
        expect(Math.abs(Math.asin(dot(ab, n) / len(ab)))).toBeLessThan(1e-6);
        const axis = unit(sub([...input.target] as Vec3, fk.a));
        const m = sub(ab, scale(axis, dot(ab, axis)));
        const toPole = sub([...input.pole] as Vec3, fk.a);
        const pp = sub(toPole, scale(axis, dot(toPole, axis)));
        expect(len(m) > 1e-6 ? dot(m, pp) : 1).toBeGreaterThan(0);
        // Bone lengths are preserved by construction; the end keeps its rest local rotation.
        expect(quatAngleBetween(out.endLocal, quatNormalize(input.endRest.q))).toBeLessThan(1e-12);
      }),
      { numRuns: 200, seed: 42 },
    );
  });

  it('straightens towards unreachable targets and reports them', () => {
    fc.assert(
      fc.property(chainCase, fc.double({ min: 1.05, max: 3, noNaN: true }), (base, factor) => {
        const pa = mat4Decompose(base.parentWorld);
        const a = add(pa.t, quatRotateVec3(pa.q, scale([...base.upperRest.t], pa.s[0])));
        const L = (len([...base.midRest.t] as Vec3) + len([...base.endRest.t] as Vec3)) * pa.s[0];
        const dir = unit(sub([...base.target] as Vec3, a));
        const input = { ...base, target: add(a, scale(dir, L * factor)) };
        const out = output();
        solveTwoBoneIk(input, out);
        expect(out.reached).toBe(false);
        const fk = chainFk(input, out);
        // Fully extended (within the ε = 1e-5·L clamp) and pointing at the target.
        expect(len(sub(fk.c, fk.a))).toBeGreaterThan(L * (1 - 2e-5));
        expect(len(cross(unit(sub(fk.c, fk.a)), dir))).toBeLessThan(1e-9);
      }),
      { numRuns: 100, seed: 5 },
    );
  });

  it('honours the end world rotation, twist and softness', () => {
    fc.assert(
      fc.property(chainCase, quat, (input, end) => {
        const out = output();
        solveTwoBoneIk({ ...input, endWorldRotation: end }, out);
        expect(quatAngleBetween(chainFk(input, out).qE, end)).toBeLessThan(1e-9);
      }),
      { numRuns: 50, seed: 6 },
    );
    fc.assert(
      fc.property(chainCase, fc.double({ min: -2, max: 2, noNaN: true }), (input, twist) => {
        const plain = output();
        solveTwoBoneIk(input, plain);
        const twisted = output();
        solveTwoBoneIk({ ...input, twist }, twisted);
        const p = chainFk(input, plain);
        const t = chainFk(input, twisted);
        // Same reach; the mid joint rotated by `twist` about the chain axis.
        expect(len(sub(t.c, p.c))).toBeLessThan(1e-9);
        const axis = unit(sub(p.c, p.a));
        const m0 = sub(sub(p.b, p.a), scale(axis, dot(sub(p.b, p.a), axis)));
        const m1 = sub(sub(t.b, t.a), scale(axis, dot(sub(t.b, t.a), axis)));
        const angle = len(m0) > 1e-6 ? Math.atan2(dot(axis, cross(m0, m1)), dot(m0, m1)) : twist;
        expect(Math.abs(Math.atan2(Math.sin(angle - twist), Math.cos(angle - twist)))).toBeLessThan(1e-9);
      }),
      { numRuns: 50, seed: 8 },
    );
    // Softness shortens the reach near full extension only.
    const out = output();
    fc.assert(
      fc.property(chainCase, (input) => {
        const soft = { ...input, soft: 0.05 };
        solveTwoBoneIk(soft, out);
        const fk = chainFk(soft, out);
        expect(len(sub(fk.c, fk.a))).toBeLessThanOrEqual(len(sub([...input.target] as Vec3, fk.a)) + 1e-9);
      }),
      { numRuns: 50, seed: 10 },
    );
  });
});

// ---------- Plant Feet (MVP-SPEC §4.11.19) ----------

function rigFor(skeleton: SkeletonDesc): RigProgram {
  return compileRig(autoRig(skeleton, IDS), skeleton);
}

function channelMap(program: RigProgram, ch: ReturnType<RigProgram['allocChannels']>): Map<ControlId, ChannelValues> {
  return new Map(program.controlIds.map((control) => [control, readControlChannels(program, ch, control)]));
}

function footPins(program: RigProgram, skeleton: SkeletonDesc, pose: ReturnType<RigProgram['allocPose']>): FootPin[] {
  return (['L', 'R'] as const).map((side) => {
    const node = skeleton.humanoid?.[side === 'L' ? 'leftFoot' : 'rightFoot'] as number;
    return { side, footWorld: subarray16(pose.boneWorld, node) };
  });
}

describe('plantFeetChannels (MVP-SPEC §4.11.19)', () => {
  for (const [label, skeleton] of [
    ['bent knees', richHumanoid()],
    ['straight legs (synthetic fixture)', syntheticSkeleton()],
    ['VRM 0.x facing', richHumanoid({ vrm0: true })],
  ] as const) {
    it(`returns the feet to their pins after the cog moves (${label})`, () => {
      const program = rigFor(skeleton);
      const ch = program.allocChannels();
      writeControlChannels(program, ch, id('fk.upperLeg.L'), { rx: -0.3, rz: 0.1 });
      writeControlChannels(program, ch, id('fk.lowerLeg.L'), { rx: 0.5 });
      writeControlChannels(program, ch, id('fk.foot.R'), { rx: 0.2 });
      const pose = program.allocPose();
      program.evaluate(ch, pose);
      const pins = footPins(program, skeleton, pose);

      // Lower and shift the body, then plant.
      writeControlChannels(program, ch, id('cog'), { ty: -0.05, tx: 0.03, ry: 0.15 });
      program.evaluate(ch, pose);
      const result = plantFeetChannels(program, pose, pins, channelMap(program, ch));
      expect(result.warnings).toEqual([]);
      expect(result.reached).toBe(true);
      expect([...result.values.keys()].sort()).toEqual(
        ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L', 'fk.upperLeg.R', 'fk.lowerLeg.R', 'fk.foot.R'].map(id).sort(),
      );
      for (const [control, values] of result.values) writeControlChannels(program, ch, control, values);
      program.evaluate(ch, pose);
      for (const pin of pins) {
        const node = skeleton.humanoid?.[pin.side === 'L' ? 'leftFoot' : 'rightFoot'] as number;
        const world = subarray16(pose.boneWorld, node);
        expect(Math.hypot(...sub(worldPos(world), worldPos(pin.footWorld)))).toBeLessThan(1e-9);
        expect(quatAngleBetween(worldQuat(world), worldQuat(pin.footWorld))).toBeLessThan(1e-9);
      }
    });
  }

  it('keeps the bend plane: the knee stays on its side', () => {
    const skeleton = richHumanoid();
    const program = rigFor(skeleton);
    const ch = program.allocChannels();
    const pose = program.allocPose();
    program.evaluate(ch, pose);
    const pins = footPins(program, skeleton, pose);
    writeControlChannels(program, ch, id('cog'), { ty: -0.15 });
    program.evaluate(ch, pose);
    const result = plantFeetChannels(program, pose, pins, channelMap(program, ch));
    for (const [control, values] of result.values) writeControlChannels(program, ch, control, values);
    program.evaluate(ch, pose);
    const knee = worldPos(subarray16(pose.boneWorld, skeleton.humanoid?.leftLowerLeg as number));
    const hip = worldPos(subarray16(pose.boneWorld, skeleton.humanoid?.leftUpperLeg as number));
    // Knees bend forward (+Z) in a crouch.
    expect(knee[2] - hip[2]).toBeGreaterThan(0.02);
  });

  it('straightens unreachable legs towards the pins and warns', () => {
    const skeleton = richHumanoid();
    const program = rigFor(skeleton);
    const ch = program.allocChannels();
    const pose = program.allocPose();
    program.evaluate(ch, pose);
    const pins = footPins(program, skeleton, pose);
    writeControlChannels(program, ch, id('cog'), { ty: 0.4 });
    program.evaluate(ch, pose);
    const result = plantFeetChannels(program, pose, pins, channelMap(program, ch));
    expect(result.reached).toBe(false);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toMatch(/L foot cannot reach its pin/);
    expect(result.values.size).toBe(6);
  });

  it('needs a humanoid rig with leg controls', () => {
    const generic = genericSkeleton();
    const program = rigFor(generic);
    const pose = program.allocPose();
    program.evaluate(program.allocChannels(), pose);
    const result = plantFeetChannels(program, pose, [{ side: 'L', footWorld: new Float64Array(16) }], new Map());
    expect(result).toEqual({ values: new Map(), reached: false, warnings: ['Plant Feet needs a humanoid rig'] });
  });
});
