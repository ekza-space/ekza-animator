// A1 (M2A-SPEC §5.3, §5.3.1, §5.4): the ik2 op — rest exactness, FK at ikFk 0, reach, soft, pole and twist, blend,
// follow and toes rules, foot roll in the foot frame, compile rules, and no allocation per evaluation.
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
  mat4Compose,
  mat4Decompose,
  type Quat,
  quatAngle,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, SolverRecord } from '@ekza-animator/doc';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  autoRig,
  compileRig,
  footPivotWorlds,
  type Ik2Params,
  type LimbDesc,
  mirrorPose,
  type PoseBuffers,
  registerBuiltinRigOps,
  type RigProgram,
  type SkeletonDesc,
  solveTwoBoneIk,
  writeAttr,
} from '../src';
import type { TwoBoneCore } from '../src/ik/core';
import { limbCore } from '../src/limb/match';
import { IDS, richHumanoid } from './helpers';
import {
  allocatedBytesPerCall,
  bonePos,
  boneQuat,
  channels,
  controlPos,
  DEG,
  distance,
  evaluate,
  id,
  ikDef,
  ikRig,
  limbHumanoid,
  localDifference,
  nodeOf,
  random,
  restError,
} from './limb-helpers';

let dispose: () => void = () => undefined;
beforeAll(() => {
  dispose = registerBuiltinRigOps();
});
afterAll(() => dispose());

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => [a[0] / len(a), a[1] / len(a), a[2] / len(a)];
const perp = (v: Vec3, axis: Vec3): Vec3 =>
  sub(v, [axis[0] * dot(v, axis), axis[1] * dot(v, axis), axis[2] * dot(v, axis)]);

/** Relative transform W_a⁻¹ · W_b of two bone worlds as (t, q). */
function relative(pose: PoseBuffers, a: number, b: number): { t: Vec3; q: Quat } {
  const wa = mat4Decompose(pose.boneWorld.slice(a * 16, a * 16 + 16));
  const wb = mat4Decompose(pose.boneWorld.slice(b * 16, b * 16 + 16));
  const qi = quatInvert(wa.q);
  return { t: quatRotateVec3(qi, sub(wb.t, wa.t)), q: quatMultiply(qi, wb.q) };
}

describe('ik2 op: rest exactness and FK fallback (§5.3, §5.7)', () => {
  const variants: readonly [string, () => SkeletonDesc][] = [
    ['T-pose (straight arms, bent knees)', () => richHumanoid()],
    ['VRM 0.x facing', () => richHumanoid({ vrm0: true })],
    ['feet toed out 15°', () => limbHumanoid({ toeOut: 15 * DEG })],
    ['elbows hyperextended at rest', () => limbHumanoid({ hyperElbow: 0.012 })],
    ['elbows bent at rest', () => limbHumanoid({ bentArms: true })],
    ['legs bent off the knee hinge (Polybot-like)', () => limbHumanoid({ splayedLegs: true })],
    ['no left toes', () => richHumanoid({ leftToes: false })],
  ];

  it.each(variants)('reproduces every rest local within 1e-7 with all four limbs in IK: %s', (_, make) => {
    const skeleton = make();
    const program = ikRig(skeleton);
    expect(program.limbs.map((limb) => limb.id)).toEqual(
      [...program.limbs].sort((a, b) => (a.solver < b.solver ? -1 : 1)).map((limb) => limb.id),
    );
    expect(program.limbs).toHaveLength(4);
    expect(program.warnings.filter((w) => ['cycle', 'dangling-ref', 'unsupported-op'].includes(w.code))).toEqual([]);
    const error = restError(program, evaluate(program, channels(program)));
    expect([error.translation < 1e-7, error.rotation < 1e-7, error.worst]).toEqual([true, true, error.worst]);
  });

  it('warns about a hyperextended rest beyond 2° and keeps the hinge (§5.2.1)', () => {
    const program = ikRig(limbHumanoid({ hyperElbow: 0.02 }));
    const warnings = program.warnings.filter((w) => w.code === 'asymmetric-rest' && w.message.includes('elbow'));
    expect(warnings.map((w) => w.message.slice(0, 40))).toEqual([
      'L Arm: the rest pose bends the elbow 9.2',
      'R Arm: the rest pose bends the elbow 9.2',
    ]);
    // The message gives the amendment C band (§5.3) of the rest: its depth and the end's largest overshoot.
    const desc = program.limbs.find((l) => l.id === 'arm.L') as LimbDesc;
    const core = limbCore(program, desc, evaluate(program, channels(program)));
    const { hyper, width } = core.transitionBand();
    const depth = core.reachOfBend(-hyper) - core.reachOfBend(hyper + width);
    expect(warnings[0]?.message).toBe(
      `L Arm: the rest pose bends the elbow 9.2° against its hinge (hyperextended); IK straightens it towards full reach and passes to the normal bend over the first ${(depth * 1000).toFixed(1)} mm closer than the rest, where the hand may pass its target by up to ${warnings[0]?.message.match(/up to ([0-9.]+) mm/)?.[1]} mm`,
    );
    const overshoot = Number(warnings[0]?.message.match(/up to ([0-9.]+) mm/)?.[1]) / 1000;
    expect(overshoot).toBeGreaterThan(0.3 * (core.reachOfBend(0) - core.reachOfBend(-hyper)));
    expect(overshoot).toBeLessThan(2.2 * (core.reachOfBend(0) - core.reachOfBend(-hyper)));
  });

  it('writes nothing at ikFk 0: bone locals bit-identical to the M1 rig for random FK poses (property)', () => {
    const skeleton = richHumanoid();
    const m1 = compileRig(autoRig(skeleton, IDS), skeleton);
    const ik = ikRig(skeleton);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const next = random(seed);
        const values = new Map<ControlId, ChannelValues>();
        for (const control of m1.controls) {
          const v: ChannelValues = {};
          if (control.keyable.r[0]) v.rx = next() * 2;
          if (control.keyable.r[1]) v.ry = next() * 2;
          if (control.keyable.r[2]) v.rz = next() * 2;
          if (control.keyable.t[0]) v.tx = next() * 0.2;
          if (control.keyable.t[1]) v.ty = next() * 0.2;
          values.set(control.id, v);
        }
        const a = evaluate(m1, channels(m1, values));
        // IK controls moved too: at ikFk 0 they change nothing.
        const withIk = new Map(values);
        withIk.set(id('ik.leg.L'), { tx: 0.1, ty: 0.2, rx: 0.4, '@roll': 0.5 });
        withIk.set(id('pole.arm.R'), { tz: -0.3 });
        const b = evaluate(ik, channels(ik, withIk, 0));
        expect(Array.from(b.boneLocal)).toEqual(Array.from(a.boneLocal));
        expect(Array.from(b.humanLocal)).toEqual(Array.from(a.humanLocal));
        expect(Array.from(b.hipsPosition)).toEqual(Array.from(a.hipsPosition));
      }),
      { numRuns: 20 },
    );
  });
});

describe('ik2 op: a rest hyperextended about its hinge (§5.3 amendment C)', () => {
  // The elbows sit 2 cm in front of the shoulder–hand line: 9.2° against the hinge at rest.
  const skeleton = limbHumanoid({ hyperElbow: 0.02 });
  let program: RigProgram;
  let desc: LimbDesc;
  let rest: PoseBuffers;
  let a: Vec3;
  let c0: Vec3;
  let d0: number;
  let ray: Vec3;
  let hyper: number;
  let width: number;
  let rMax: number;
  let bandEnd: number;
  let core: TwoBoneCore;
  // Compiled after registerBuiltinRigOps (the file's beforeAll).
  beforeAll(() => {
    program = ikRig(skeleton);
    desc = program.limbs.find((l) => l.id === 'arm.L') as LimbDesc;
    rest = evaluate(program, channels(program));
    a = bonePos(rest, desc.nodes.upper);
    c0 = bonePos(rest, desc.nodes.end);
    d0 = distance(a, c0);
    ray = unit(sub(c0, a));
    core = limbCore(program, desc, rest);
    ({ hyper, width } = core.transitionBand());
    rMax = core.reachOfBend(0);
    bandEnd = core.reachOfBend(hyper + width);
  });
  /** Pose with the IK hand moved by `inward` metres along the reach ray towards the shoulder. */
  const at = (inward: number): PoseBuffers =>
    evaluate(
      program,
      channels(
        program,
        new Map([[desc.params.ikControl, { tx: -ray[0] * inward, ty: -ray[1] * inward, tz: -ray[2] * inward }]]),
      ),
    );
  const side = (pose: PoseBuffers): number => {
    const x = unit(sub(bonePos(pose, desc.nodes.end), a));
    const m = perp(sub(bonePos(pose, desc.nodes.mid), a), x);
    const k = quatRotateVec3(
      quatMultiply(boneQuat(pose, desc.nodes.mid), quatInvert(boneQuat(rest, desc.nodes.mid))),
      desc.params.hinge,
    );
    return dot(m, cross(x, k));
  };

  it('has the band of the notes: T = the rest hyperextension, W = 2T, and d⁰ between its ends', () => {
    expect(hyper).toBeGreaterThan(8 * DEG);
    expect(hyper).toBeLessThan(10 * DEG);
    expect(width).toBeCloseTo(2 * hyper, 12);
    expect(core.reachOfBend(-hyper)).toBeCloseTo(d0, 12);
    expect(rMax).toBeGreaterThan(d0);
    expect(bandEnd).toBeLessThan(d0);
  });

  it('moves the elbow continuously when the IK hand crosses the rest reach (a jump would not shrink with the step)', () => {
    const from = -(rMax - d0) * 0.9;
    const to = (d0 - bandEnd) * 1.5;
    const largestStep = (count: number): number => {
      let largest = 0;
      let previous = bonePos(at(from), desc.nodes.mid);
      for (let i = 1; i <= count; i++) {
        const elbow = bonePos(at(from + ((to - from) * i) / count), desc.nodes.mid);
        largest = Math.max(largest, distance(elbow, previous));
        previous = elbow;
      }
      return largest;
    };
    const coarse = largestStep(200);
    const fine = largestStep(2000);
    expect(fine).toBeLessThan(0.15 * coarse);
    // Within a few times the ordinary straight-limb rate (the elbow moves ~1/θ times the hand near straight).
    expect(fine / ((to - from) / 2000)).toBeLessThan(4 / hyper);
  });

  it('reaches targets exactly outside the band; inside it the end overshoots along the ray by ≤ 2.2·(R_max − d⁰)', () => {
    const e = rMax - d0;
    const band = d0 - bandEnd;
    const rows = [-0.9 * e, -0.5 * e, 0, 0.1 * band, 0.5 * band, 0.99 * band, 1.01 * band, 2 * band, 0.05].map(
      (inward) => {
        const pose = at(inward);
        const target: Vec3 = [c0[0] - ray[0] * inward, c0[1] - ray[1] * inward, c0[2] - ray[2] * inward];
        const end = bonePos(pose, desc.nodes.end);
        return {
          inward,
          inBand: inward > 1e-12 && inward < band,
          miss: distance(end, target),
          offRay: len(cross(unit(sub(end, a)), ray)),
          past: distance(end, a) - distance(target, a),
          side: side(pose),
        };
      },
    );
    const outside = rows.filter((r) => !r.inBand);
    const inside = rows.filter((r) => r.inBand);
    expect(inside).toHaveLength(3);
    expect(outside.map((r) => [r.inward, r.miss < 1e-9])).toEqual(outside.map((r) => [r.inward, true]));
    // Inside the band the end lies on the ray, past the target.
    expect(inside.map((r) => [r.inward, r.offRay < 1e-9, r.past > 0])).toEqual(
      inside.map((r) => [r.inward, true, true]),
    );
    // Hyperextended between the rest reach and full reach, flexed past the band.
    const hyperextended = rows.filter((r) => r.inward <= 0);
    const flexed = rows.filter((r) => r.inward >= band);
    expect(hyperextended.map((r) => [r.inward, r.side < 0])).toEqual(hyperextended.map((r) => [r.inward, true]));
    expect(flexed.map((r) => [r.inward, r.side > 0])).toEqual(flexed.map((r) => [r.inward, true]));
    const overshoot = Math.max(...inside.map((r) => r.past));
    expect(overshoot).toBeGreaterThan(0.5 * e);
    expect(overshoot).toBeLessThan(2.2 * e);
  });

  it('allocates nothing per evaluation inside the band either', async () => {
    const ch = channels(
      program,
      new Map([
        [
          desc.params.ikControl,
          {
            tx: -ray[0] * 0.5 * (d0 - bandEnd),
            ty: -ray[1] * 0.5 * (d0 - bandEnd),
            tz: -ray[2] * 0.5 * (d0 - bandEnd),
          },
        ],
      ]),
    );
    const pose = program.allocPose();
    for (let i = 0; i < 20000; i++) program.evaluate(ch, pose);
    let perEvaluation = Number.NaN;
    const collections = await collectionsDuring(() => {
      perEvaluation = allocatedBytesPerCall(() => program.evaluate(ch, pose), 10000);
    });
    expect([collections, perEvaluation < 1]).toEqual([0, true]);
  });
});

describe('ik2 op: reach, pole, twist, soft and the end rotation (§5.3)', () => {
  it('keeps the IK feet planted when cog moves (FR-RIG-11) and bends the knees forward, also off-hinge', () => {
    for (const skeleton of [richHumanoid(), limbHumanoid({ splayedLegs: true })]) {
      const program = ikRig(skeleton);
      const foot = nodeOf(skeleton, 'leftFoot');
      const knee = nodeOf(skeleton, 'leftLowerLeg');
      const hips = nodeOf(skeleton, 'hips');
      const rest = evaluate(program, channels(program));
      const lowered = evaluate(program, channels(program, new Map([[id('cog'), { ty: -0.05 }]])));
      expect(distance(bonePos(lowered, foot), bonePos(rest, foot))).toBeLessThan(1e-9);
      expect(quatAngle(boneQuat(lowered, foot), boneQuat(rest, foot))).toBeLessThan(1e-9);
      expect(bonePos(lowered, hips)[1] - bonePos(rest, hips)[1]).toBeCloseTo(-0.05, 12);
      const dz = bonePos(lowered, knee)[2] - bonePos(rest, knee)[2];
      const dx = bonePos(lowered, knee)[0] - bonePos(rest, knee)[0];
      expect(dz).toBeGreaterThan(1e-3);
      // The knee moves forward, not sideways (the hinge-implied direction follows the pole, §5.3 B).
      expect(Math.abs(dx)).toBeLessThan(0.1 * dz);
    }
  });

  it('reaches reachable targets exactly and the soft zone eases monotonically below l1 + l2', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const limb = program.limbs.find((l) => l.id === 'leg.L');
    if (limb === undefined) throw new Error('no leg');
    const L = limb.lengths.upper + limb.lengths.lower;
    const hip = nodeOf(skeleton, 'leftUpperLeg');
    const foot = nodeOf(skeleton, 'leftFoot');
    let previous = 0;
    for (let step = 0; step <= 20; step++) {
      const ty = -0.01 * L * step;
      const values = new Map([[id('ik.leg.L'), { ty }]]);
      const hard = evaluate(program, channels(program, values));
      const target = controlPos(program, hard, id('ik.leg.L'));
      const reach = distance(bonePos(hard, hip), target);
      // Reachable targets are reached exactly (a miss of 0 stands for the unreachable ones).
      const hardMiss = reach < L * (1 - 1e-5) ? distance(bonePos(hard, foot), target) : 0;
      expect(hardMiss).toBeLessThan(1e-9);
      const ch = channels(program, values);
      writeAttr(program, ch, id('ik.leg.L'), 'soft', 0.1);
      const soft = evaluate(program, ch);
      const d = distance(bonePos(soft, hip), bonePos(soft, foot));
      expect(d).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(d).toBeLessThan(L);
      // Inside the soft zone the foot misses the target (1 stands for targets outside it).
      const softMiss = reach > L - 0.1 * L ? distance(bonePos(soft, foot), target) : 1;
      expect(softMiss).toBeGreaterThan(1e-6);
      previous = d;
    }
    // soft is clamped to 0.25 where it is consumed.
    const big = channels(program, new Map([[id('ik.leg.L'), { ty: -0.3 }]]));
    writeAttr(program, big, id('ik.leg.L'), 'soft', 5);
    const clamped = channels(program, new Map([[id('ik.leg.L'), { ty: -0.3 }]]));
    writeAttr(program, clamped, id('ik.leg.L'), 'soft', 0.25);
    expect(localDifference(evaluate(program, big), evaluate(program, clamped))).toBe(0);
  });

  it('turns the knee towards the pole and rotates the bend plane by the twist attribute', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const [hip, knee, foot] = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'].map((b) => nodeOf(skeleton, b)) as [
      number,
      number,
      number,
    ];
    const base = new Map<ControlId, ChannelValues>([[id('ik.leg.L'), { ty: 0.15, tz: 0.05 }]]);
    const bent = evaluate(program, channels(program, base));
    const moved = evaluate(program, channels(program, new Map([...base, [id('pole.leg.L'), { tx: 0.3 }]])));
    expect(bonePos(moved, knee)[0] - bonePos(bent, knee)[0]).toBeGreaterThan(5e-3);
    expect(distance(bonePos(moved, foot), bonePos(bent, foot))).toBeLessThan(1e-9);
    const ch = channels(program, base);
    writeAttr(program, ch, id('ik.leg.L'), 'twist', 30 * DEG);
    const twisted = evaluate(program, ch);
    const axis = unit(sub(bonePos(bent, foot), bonePos(bent, hip)));
    const m0 = perp(sub(bonePos(bent, knee), bonePos(bent, hip)), axis);
    const m1 = perp(sub(bonePos(twisted, knee), bonePos(twisted, hip)), axis);
    const angle = Math.atan2(dot(axis, cross(m0, m1)), dot(m0, m1));
    expect(angle).toBeCloseTo(30 * DEG, 9);
    expect(distance(bonePos(twisted, foot), bonePos(bent, foot))).toBeLessThan(1e-9);
  });

  it('keeps the knee in the (hip, target, pole) plane on a rest bent about its hinge (property)', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const [hip, knee, foot] = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'].map((b) => nodeOf(skeleton, b)) as [
      number,
      number,
      number,
    ];
    const coord = fc.double({ min: -0.25, max: 0.25, noNaN: true });
    fc.assert(
      fc.property(fc.tuple(coord, coord, coord), fc.tuple(coord, coord, coord), ([x, y, z], [px, py, pz]) => {
        const pose = evaluate(
          program,
          channels(
            program,
            new Map([
              [id('ik.leg.L'), { tx: x * 0.5, ty: 0.1 + y * 0.6, tz: z }],
              [id('pole.leg.L'), { tx: px * 2, ty: py, tz: pz }],
            ]),
          ),
        );
        const a = bonePos(pose, hip);
        const b = bonePos(pose, knee);
        const c = bonePos(pose, foot);
        const p = controlPos(program, pose, id('pole.leg.L'));
        const normal = cross(sub(c, a), sub(p, a));
        if (len(normal) < 1e-3) return;
        const off = Math.abs(dot(unit(normal), unit(sub(b, a))));
        expect(off).toBeLessThan(1e-6);
      }),
      { numRuns: 60 },
    );
  });

  it('orients the end bone by the IK control: W_end = W_ik · K_end', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const foot = nodeOf(skeleton, 'leftFoot');
    const rest = evaluate(program, channels(program));
    const turned = evaluate(
      program,
      channels(program, new Map([[id('ik.leg.L'), { ty: 0.1, rx: 0.4, ry: -0.3, rz: 0.2 }]])),
    );
    const slot = program.controlIndex.get(id('ik.leg.L')) as number;
    const qIk = mat4Decompose(turned.controlWorld.slice(slot * 16, slot * 16 + 16)).q;
    const expected = quatMultiply(qIk, boneQuat(rest, foot));
    expect(quatAngle(boneQuat(turned, foot), expected)).toBeLessThan(1e-9);
  });

  it('uses the rest-exact solver through solveTwoBoneIk with restReach and the M1 solver without', () => {
    // A straight chain at rest: with restReach the rest is reproduced, M1 bends it by its ε clamp.
    const parentWorld = mat4Compose({ t: [0, 1, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    const input = {
      parentWorld,
      upperRest: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      midRest: { t: [0, -0.4, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      endRest: { t: [0, -0.4, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      hingeLocal: [1, 0, 0],
      target: [0, 0.2, 0],
      pole: [0, 0.6, 0.8],
      twist: 0,
      soft: 0,
      endWorldRotation: null,
    } as const;
    const out = { upperLocal: [0, 0, 0, 1], midLocal: [0, 0, 0, 1], endLocal: [0, 0, 0, 1], reached: false } as {
      upperLocal: Quat;
      midLocal: Quat;
      endLocal: Quat;
      reached: boolean;
    };
    solveTwoBoneIk({ ...input, restReach: 0.8 }, out);
    expect(quatAngle(out.midLocal, [0, 0, 0, 1])).toBeLessThan(1e-12);
    expect(quatAngle(out.upperLocal, [0, 0, 0, 1])).toBeLessThan(1e-12);
    expect(out.reached).toBe(true);
    solveTwoBoneIk(input, out);
    expect(quatAngle(out.midLocal, [0, 0, 0, 1])).toBeGreaterThan(1e-3);
  });
});

describe('ik2 op: blend, follow rule and toes rule (§5.3 steps 3–6)', () => {
  it('blends each chain bone between FK and IK in chain-relative space at ikFk 0.5', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const values = new Map<ControlId, ChannelValues>([
      [id('fk.upperLeg.L'), { rx: -0.6, rz: 0.2 }],
      [id('fk.lowerLeg.L'), { rx: 0.9 }],
      [id('fk.foot.L'), { rx: 0.3 }],
      [id('ik.leg.L'), { ty: 0.2, tz: 0.1, rx: -0.2 }],
    ]);
    const fk = evaluate(program, channels(program, values, 0));
    const ik = evaluate(program, channels(program, values, 1));
    const half = evaluate(program, channels(program, values, 0.5));
    for (const bone of ['leftUpperLeg', 'leftLowerLeg', 'leftFoot']) {
      const node = nodeOf(skeleton, bone);
      const q = (pose: PoseBuffers): Quat => [
        pose.boneLocal[node * 10 + 3] as number,
        pose.boneLocal[node * 10 + 4] as number,
        pose.boneLocal[node * 10 + 5] as number,
        pose.boneLocal[node * 10 + 6] as number,
      ];
      const total = quatAngle(q(fk), q(ik));
      expect(total).toBeGreaterThan(0.05);
      expect(quatAngle(q(fk), q(half))).toBeCloseTo(total / 2, 9);
      expect(quatAngle(q(half), q(ik))).toBeCloseTo(total / 2, 9);
    }
  });

  it('carries fingers and every control below the FK chain with the IK hand (follow rule)', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const hand = nodeOf(skeleton, 'leftHand');
    const fingers = ['leftIndexProximal', 'leftIndexDistal', 'leftThumbMetacarpal'].map((b) => nodeOf(skeleton, b));
    const values = new Map<ControlId, ChannelValues>([
      [id('fk.indexProximal.L'), { rz: 0.5, rx: 0.2 }],
      [id('fk.thumbMetacarpal.L'), { ry: -0.4 }],
      [id('fk.lowerArm.L'), { ry: 0.7 }],
      [id('ik.arm.L'), { tx: -0.15, ty: -0.2, tz: 0.2, rz: 0.5 }],
    ]);
    const fk = evaluate(program, channels(program, values, 0));
    const ik = evaluate(program, channels(program, values, 1));
    expect(distance(bonePos(ik, hand), bonePos(fk, hand))).toBeGreaterThan(0.05);
    for (const finger of fingers) {
      const a = relative(fk, hand, finger);
      const b = relative(ik, hand, finger);
      expect(distance(a.t, b.t)).toBeLessThan(1e-9);
      expect(quatAngle(a.q, b.q)).toBeLessThan(1e-9);
    }
    // The finger control keeps its place relative to the hand bone too.
    const slot = program.controlIndex.get(id('fk.indexProximal.L')) as number;
    const controlRelative = (pose: PoseBuffers) => {
      const wh = mat4Decompose(pose.boneWorld.slice(hand * 16, hand * 16 + 16));
      const wc = mat4Decompose(pose.controlWorld.slice(slot * 16, slot * 16 + 16));
      return { t: quatRotateVec3(quatInvert(wh.q), sub(wc.t, wh.t)), q: quatMultiply(quatInvert(wh.q), wc.q) };
    };
    expect(distance(controlRelative(fk).t, controlRelative(ik).t)).toBeLessThan(1e-9);
    expect(quatAngle(controlRelative(fk).q, controlRelative(ik).q)).toBeLessThan(1e-9);
    // The forearm twist joint (an intermediate node) keeps its FK local.
    const twist = skeleton.nodes.findIndex((n) => n.name === 'leftForeArmTwist');
    const lower = nodeOf(skeleton, 'leftLowerArm');
    expect(quatAngle(relative(fk, lower, twist).q, relative(ik, lower, twist).q)).toBeLessThan(1e-9);
  });

  it('keeps the toes planted under ball roll and their FK rotation at roll 0 (toes rule)', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const foot = nodeOf(skeleton, 'leftFoot');
    const toes = nodeOf(skeleton, 'leftToes');
    const base = new Map<ControlId, ChannelValues>([
      [id('ik.leg.L'), { ty: 0.05, ry: 0.2 }],
      [id('fk.toes.L'), { rx: 0.3 }],
    ]);
    const fk = evaluate(program, channels(program, base, 0));
    const flat = evaluate(program, channels(program, base));
    // At roll 0 the toes keep their FK local relative to the foot.
    expect(quatAngle(relative(fk, foot, toes).q, relative(flat, foot, toes).q)).toBeLessThan(1e-9);
    const ch = channels(program, base);
    writeAttr(program, ch, id('ik.leg.L'), 'roll', 20 * DEG);
    const rolled = evaluate(program, ch);
    expect(distance(bonePos(rolled, toes), bonePos(flat, toes))).toBeLessThan(1e-9);
    expect(quatAngle(boneQuat(rolled, toes), boneQuat(flat, toes))).toBeLessThan(1e-9);
    expect(quatAngle(boneQuat(rolled, foot), boneQuat(flat, foot))).toBeCloseTo(20 * DEG, 9);
    // Half blended: the toes counter-rotate by half the ball roll (C_w about the same pivot).
    const half = channels(program, base, 0.5);
    writeAttr(program, half, id('ik.leg.L'), 'roll', 20 * DEG);
    const halfPose = evaluate(program, half);
    const halfFlat = evaluate(program, channels(program, base, 0.5));
    const footTurn = quatAngle(boneQuat(halfPose, foot), boneQuat(halfFlat, foot));
    expect(footTurn).toBeGreaterThan(1 * DEG);
  });
});

describe('foot roll in the foot frame (§5.3.1 gates)', () => {
  type Pivots = NonNullable<ReturnType<typeof footPivotWorlds>>;
  const pivotsAt = (
    program: RigProgram,
    values: ReadonlyMap<ControlId, ChannelValues>,
    limb: 'leg.L' | 'leg.R',
  ): {
    pivots: Pivots;
    pose: PoseBuffers;
  } => {
    const ch = channels(program, values);
    const pose = evaluate(program, ch);
    const pivots = footPivotWorlds(program, pose, ch, limb);
    if (pivots === null) throw new Error('no pivots');
    return { pivots, pose };
  };
  const vec = (a: Float64Array): Vec3 => [a[0] as number, a[1] as number, a[2] as number];

  it('pivots the roll about heel, ball and toe tip by the break angle', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const foot = nodeOf(skeleton, 'leftFoot');
    const toes = nodeOf(skeleton, 'leftToes');
    const at = (roll: number) => pivotsAt(program, new Map([[id('ik.leg.L'), { '@roll': roll }]]), 'leg.L');
    const zero = at(0);
    const ball = at(20 * DEG);
    expect(distance(vec(ball.pivots.ball), vec(zero.pivots.ball))).toBeLessThan(1e-9);
    expect(distance(bonePos(ball.pose, toes), bonePos(zero.pose, toes))).toBeLessThan(1e-9);
    expect(quatAngle(boneQuat(ball.pose, toes), boneQuat(zero.pose, toes))).toBeLessThan(1e-9);
    expect(quatAngle(boneQuat(ball.pose, foot), boneQuat(zero.pose, foot))).toBeCloseTo(20 * DEG, 9);
    // The ball roll turns the foot about the toes joint (a rigid ball joint): the toes keep their rest offset from
    // the foot, so the toes bone only rotates (acceptance fix round 1, bug 2).
    expect(distance(relative(ball.pose, foot, toes).t, relative(zero.pose, foot, toes).t)).toBeLessThan(1e-9);
    expect(vec(ball.pivots.heel)[1]).toBeGreaterThan(vec(zero.pivots.heel)[1] + 0.01);
    const heel = at(-15 * DEG);
    expect(distance(vec(heel.pivots.heel), vec(zero.pivots.heel))).toBeLessThan(1e-9);
    expect(vec(heel.pivots.toe)[1]).toBeGreaterThan(vec(zero.pivots.toe)[1] + 0.01);
    const toe = at(50 * DEG);
    expect(distance(vec(toe.pivots.toe), vec(zero.pivots.toe))).toBeLessThan(1e-9);
    expect(quatAngle(boneQuat(toe.pose, toes), boneQuat(zero.pose, toes))).toBeCloseTo(20 * DEG, 9);
    expect(quatAngle(boneQuat(toe.pose, foot), boneQuat(zero.pose, foot))).toBeCloseTo(50 * DEG, 9);
    // Heel twist turns about the heel pivot, toe twist about the toe tip.
    const heelTwist = pivotsAt(program, new Map([[id('ik.leg.L'), { '@heelTwist': 25 * DEG }]]), 'leg.L');
    expect(distance(vec(heelTwist.pivots.heel), vec(zero.pivots.heel))).toBeLessThan(1e-9);
    const toeTwist = pivotsAt(program, new Map([[id('ik.leg.L'), { '@toeTwist': -25 * DEG }]]), 'leg.L');
    expect(distance(vec(toeTwist.pivots.toe), vec(zero.pivots.toe))).toBeLessThan(1e-9);
    expect(distance(vec(toeTwist.pivots.heel), vec(zero.pivots.heel))).toBeGreaterThan(0.01);
  });

  it('banks about the inner edge for bank > 0 and the outer edge for bank < 0 on both feet', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    for (const limb of ['leg.L', 'leg.R'] as const) {
      const control = id(`ik.${limb}`);
      const zero = pivotsAt(program, new Map(), limb).pivots;
      const up = pivotsAt(program, new Map([[control, { '@bank': 10 * DEG }]]), limb).pivots;
      expect(distance(vec(up.inner), vec(zero.inner))).toBeLessThan(1e-9);
      expect(vec(up.outer)[1]).toBeGreaterThan(vec(zero.outer)[1] + 1e-3);
      for (const key of ['heel', 'ball', 'toe', 'inner', 'outer'] as const) {
        expect(vec(up[key])[1]).toBeGreaterThan(vec(zero[key])[1] - 1e-9);
      }
      const down = pivotsAt(program, new Map([[control, { '@bank': -10 * DEG }]]), limb).pivots;
      expect(distance(vec(down.outer), vec(zero.outer))).toBeLessThan(1e-9);
      expect(vec(down.inner)[1]).toBeGreaterThan(vec(zero.inner)[1] + 1e-3);
      // The outer edge lies outside the inner one (left +x, right −x).
      const side = limb === 'leg.L' ? 1 : -1;
      expect(side * (vec(zero.outer)[0] - vec(zero.inner)[0])).toBeGreaterThan(0);
    }
  });

  it('mirrors bank and roll onto the other foot with mirrorPose (1e-9 on the symmetric rig)', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const left = new Map<ControlId, ChannelValues>([
      [
        id('ik.leg.L'),
        {
          tx: 0.03,
          ty: 0.06,
          tz: 0.04,
          rx: 0.2,
          ry: 0.3,
          rz: -0.1,
          '@bank': 10 * DEG,
          '@roll': 20 * DEG,
          '@heelTwist': 0.1,
        },
      ],
      [id('pole.leg.L'), { tx: 0.05 }],
    ]);
    const mirrored = mirrorPose(program, left, 'leftToRight', new Set([id('ik.leg.L'), id('pole.leg.L')]));
    const right = mirrored.values.get(id('ik.leg.R'));
    expect(right).toMatchObject({ '@bank': 10 * DEG, '@roll': 20 * DEG, '@heelTwist': -0.1, '@ikFk': 1, '@soft': 0 });
    const values = new Map([...left, ...mirrored.values]);
    const l = pivotsAt(program, values, 'leg.L').pivots;
    const r = pivotsAt(program, values, 'leg.R').pivots;
    for (const key of ['heel', 'ball', 'toe', 'inner', 'outer'] as const) {
      const a = vec(l[key]);
      expect(distance(vec(r[key]), [-a[0], a[1], a[2]])).toBeLessThan(1e-9);
    }
  });

  it('rolls a 15° toed-out foot about its own lateral axis: inner and outer stay level', () => {
    const skeleton = limbHumanoid({ toeOut: 15 * DEG });
    const program = ikRig(skeleton);
    for (const limb of ['leg.L', 'leg.R'] as const) {
      for (const roll of [30 * DEG, -30 * DEG, 10 * DEG]) {
        const { pivots } = pivotsAt(program, new Map([[id(`ik.${limb}`), { '@roll': roll }]]), limb);
        expect(vec(pivots.inner)[1]).toBeCloseTo(vec(pivots.outer)[1], 9);
      }
    }
  });

  it('returns no pivots for arms and unknown limbs', () => {
    const program = ikRig(richHumanoid(), { legs: true, arms: true });
    const ch = channels(program);
    const pose = evaluate(program, ch);
    expect(footPivotWorlds(program, pose, ch, 'arm.L')).toBeNull();
    const legsOnly = ikRig(richHumanoid(), { legs: true, arms: false });
    expect(footPivotWorlds(legsOnly, evaluate(legsOnly, channels(legsOnly)), channels(legsOnly), 'arm.R')).toBeNull();
  });
});

describe('ik2 compile rules (§5.4)', () => {
  const skeleton = richHumanoid();

  it('schedules chain writes without cycles and independently of record order', () => {
    const def = ikDef(skeleton);
    const program = compileRig(def, skeleton);
    expect(program.warnings.filter((w) => w.code === 'cycle')).toEqual([]);
    const shuffled = compileRig(
      { ...def, controls: [...def.controls].reverse(), solvers: [...def.solvers].reverse() },
      skeleton,
    );
    expect(shuffled.controlIds).toEqual(program.controlIds);
    expect(shuffled.limbs.map((l) => l.solver)).toEqual(program.limbs.map((l) => l.solver));
    const values = new Map<ControlId, ChannelValues>([
      [id('cog'), { ty: -0.04, ry: 0.3 }],
      [id('ik.leg.R'), { tz: 0.1, '@roll': 0.3 }],
      [id('ik.arm.L'), { ty: -0.2 }],
    ]);
    expect(
      localDifference(evaluate(shuffled, channels(shuffled, values)), evaluate(program, channels(program, values))),
    ).toBe(0);
  });

  it('disables ik2 solvers with dangling references or invalid params and warns', () => {
    const def = ikDef(skeleton);
    const withoutPole = { ...def, controls: def.controls.filter((c) => c.key !== 'pole.leg.L') };
    const a = compileRig(withoutPole, skeleton);
    const legL = def.solvers.find((s) => (s.params as unknown as Ik2Params).limb === 'leg.L') as SolverRecord;
    expect(a.warnings.some((w) => w.code === 'dangling-ref' && w.ids[0] === legL.id)).toBe(true);
    expect(a.limbs.map((l) => l.id)).not.toContain('leg.L');
    expect(a.limbs).toHaveLength(3);
    expect(() => evaluate(a, channels(a))).not.toThrow();
    const patch = (params: Record<string, unknown>) =>
      compileRig({ ...def, solvers: def.solvers.map((s) => (s.id === legL.id ? { ...s, params } : s)) }, skeleton);
    const p = legL.params as Record<string, unknown>;
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ ...p, v: 2 }, 'unsupported-op'],
      [{ ...p, hinge: [0, 0, 0] }, 'unsupported-op'],
      [{ ...p, bones: { ...(p['bones'] as object), mid: { humanoid: 'leftHand' } } }, 'unsupported-op'],
      [{ ...p, bones: { ...(p['bones'] as object), end: { name: 'gone', parentName: null } } }, 'dangling-ref'],
      [{ ...p, foot: { ...(p['foot'] as object), breakAngle: 3 } }, 'unsupported-op'],
      [{ ...p, ikControl: id('fk.toes.L') }, 'unsupported-op'],
    ];
    for (const [params, code] of cases) {
      const program = patch(params);
      const found = program.warnings.filter((w) => w.ids[0] === legL.id).map((w) => `${w.code}: ${w.message}`);
      expect([code, found.some((w) => w.startsWith(code)), found]).toEqual([code, true, found]);
      expect(program.limbs.map((l) => l.id)).not.toContain('leg.L');
    }
  });

  it('warns about a second solver on the same limb; the first in id order owns it', () => {
    const def = ikDef(skeleton);
    const legL = def.solvers.find((s) => (s.params as unknown as Ik2Params).limb === 'leg.L') as SolverRecord;
    const twin = { ...legL, id: 'slv_zzzzzzzzzzzzzzzz' as SolverRecord['id'] };
    const program = compileRig({ ...def, solvers: [...def.solvers, twin] }, skeleton);
    expect(program.warnings.some((w) => w.code === 'duplicate-binding' && w.ids[0] === twin.id)).toBe(true);
    expect(program.limbs.find((l) => l.id === 'leg.L')?.solver).toBe(legL.id);
  });

  it('builds LimbDesc with node indices, attribute slots, rest lengths and the control sets', () => {
    const program = ikRig(skeleton);
    const leg = program.limbs.find((l) => l.id === 'leg.L');
    const arm = program.limbs.find((l) => l.id === 'arm.R');
    if (leg === undefined || arm === undefined) throw new Error('limbs');
    expect(leg.nodes).toEqual({
      upper: nodeOf(skeleton, 'leftUpperLeg'),
      mid: nodeOf(skeleton, 'leftLowerLeg'),
      end: nodeOf(skeleton, 'leftFoot'),
      toes: nodeOf(skeleton, 'leftToes'),
    });
    expect(arm.nodes.toes).toBe(-1);
    expect(leg.attrSlots.roll).toBe(program.attrIndex.get(`${id('ik.leg.L')}/@roll`));
    expect(arm.attrSlots.roll).toBe(-1);
    expect(arm.attrSlots.twist).toBe(program.attrIndex.get(`${id('ik.arm.R')}/@twist`));
    expect(leg.fkControls).toEqual([id('fk.upperLeg.L'), id('fk.lowerLeg.L'), id('fk.foot.L')]);
    expect(leg.ikControls).toEqual([id('ik.leg.L'), id('pole.leg.L')]);
    expect(leg.lengths.upper).toBeCloseTo(Math.hypot(0, 0.41, 0.012), 12);
    expect(leg.lengths.lower).toBeCloseTo(Math.hypot(0, 0.41, 0.012), 12);
    expect(leg.lengths.restReach).toBeCloseTo(0.82, 12);
    expect(arm.lengths.restReach).toBeCloseTo(0.5, 12);
  });
});

describe('ik2 op allocates nothing per evaluation (§8 A1 DoD)', () => {
  // 180,000 evaluations: about 5 s alone, over the 30 s default under a loaded machine (the turbo test run with other
  // agents; INT). The timeout is not a tolerance: the assertion is the collection count.
  it('evaluates an IK rig 60 000 times without a young-generation collection', { timeout: 120_000 }, async () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const values = new Map<ControlId, ChannelValues>([
      [id('cog'), { ty: -0.03 }],
      [id('ik.leg.L'), { ty: 0.05, '@roll': 40 * DEG, '@bank': -5 * DEG, '@soft': 0.05 }],
      [id('ik.leg.R'), { '@roll': 10 * DEG, '@twist': 0.2 }],
      [id('ik.arm.L'), { ty: -0.2 }],
    ]);
    for (const ikFk of [1, 0.7]) {
      const ch = channels(program, values, ikFk);
      const pose = program.allocPose();
      // Warm up until the optimizing compiler has the hot functions (unoptimized code boxes numbers).
      for (let i = 0; i < 30000; i++) program.evaluate(ch, pose);
      // An allocation of ≥ 16 bytes per evaluation fills the young generation several times over 60 000 runs.
      const collections = await collectionsDuring(() => {
        for (let i = 0; i < 60000; i++) program.evaluate(ch, pose);
      });
      expect([ikFk, collections]).toEqual([ikFk, 0]);
      const fk = evaluate(program, channels(program, values, 0));
      expect(localDifference(pose, fk)).toBeGreaterThan(1e-3);
    }
  });

  it('allocates no bytes per evaluation, counted in the young generation (and the count sees one small object)', async () => {
    const program = ikRig(richHumanoid());
    const values = new Map<ControlId, ChannelValues>([
      [id('cog'), { ty: -0.03 }],
      [id('ik.leg.L'), { ty: 0.05, '@roll': 40 * DEG, '@bank': -5 * DEG, '@soft': 0.05 }],
      [id('ik.leg.R'), { '@roll': 10 * DEG, '@twist': 0.2, '@heelTwist': 0.1 }],
      [id('ik.arm.L'), { ty: -0.2, '@twist': -0.3 }],
      [id('ik.arm.R'), { tz: 0.1 }],
    ]);
    let sink: unknown = null;
    for (const ikFk of [1, 0.6]) {
      const ch = channels(program, values, ikFk);
      const pose = program.allocPose();
      for (let i = 0; i < 20000; i++) program.evaluate(ch, pose);
      let perEvaluation = Number.NaN;
      let leaky = Number.NaN;
      const collections = await collectionsDuring(() => {
        perEvaluation = allocatedBytesPerCall(() => program.evaluate(ch, pose), 10000);
        // The count is live: one small object per evaluation shows up.
        leaky = allocatedBytesPerCall(() => {
          program.evaluate(ch, pose);
          sink = { ikFk };
        }, 1000);
      });
      // Below 1 byte per evaluation: any allocation made per evaluation (or every few) counts ≥ 16 bytes per
      // evaluation, while one-off allocations of the optimizing compiler installing code under load may land in a
      // round (seen: ~200 bytes per 10 000 evaluations in a parallel run, 0 when run alone).
      expect([ikFk, collections, perEvaluation < 1, leaky >= 16]).toEqual([ikFk, 0, true, true]);
    }
    expect(sink).not.toBeNull();
  });
});

/** Garbage collections V8 reports while `run` executes (after a full collection that empties the young generation). */
async function collectionsDuring(run: () => void): Promise<number> {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  const starts: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) starts.push(entry.startTime);
  });
  observer.observe({ entryTypes: ['gc'] });
  try {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const t0 = performance.now();
    run();
    const t1 = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return starts.filter((t) => t >= t0 && t <= t1).length;
  } finally {
    observer.disconnect();
  }
}
