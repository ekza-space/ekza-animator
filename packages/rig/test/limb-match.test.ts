// A1 (M2A-SPEC §5.6, §5.8): IK/FK matching with the match pole rule, hyperextension, continuity, Plant Feet on IK
// legs and the matching helpers.
import {
  eulerToQuat,
  type Quat,
  quatAngle,
  quatFromAxisAngle,
  quatInvert,
  quatMultiply,
  quatToEuler,
  type RotateOrder,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId } from '@ekza-animator/doc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateWithLimbMode,
  ikControlForEndWorld,
  type LimbId,
  limbOfControl,
  matchFkToIk,
  matchIkToFk,
  type PoseBuffers,
  readAttr,
  registerBuiltinRigOps,
  type RigProgram,
  type SkeletonDesc,
  writeControlChannels,
} from '../src';
import { limbRestIsPlanar, matchPoleDirection } from '../src/limb/match';
import { richHumanoid } from './helpers';
import {
  bonePos,
  boneQuat,
  channels,
  controlPos,
  DEG,
  distance,
  evaluate,
  id,
  ikRig,
  limbHumanoid,
  nodeOf,
  random,
} from './limb-helpers';

let dispose: () => void = () => undefined;
beforeAll(() => {
  dispose = registerBuiltinRigOps();
});
afterAll(() => dispose());

/** Euler channels of a rotation about `axis` (canonical) by `angle` for a world-aligned control. */
function aboutAxis(axis: readonly number[], angle: number, order: RotateOrder): ChannelValues {
  const e = quatToEuler(quatFromAxisAngle([axis[0] as number, axis[1] as number, axis[2] as number], angle), order);
  return { rx: e[0], ry: e[1], rz: e[2] };
}

function controlOrder(program: RigProgram, control: ControlId): RotateOrder {
  return program.controls.find((c) => c.id === control)?.rotateOrder ?? 'xyz';
}

/** FK channels of a hinge pose: random upper and end rotations, the mid bone `bend` about the hinge from rest. */
function hingePose(
  program: RigProgram,
  limb: LimbId,
  bend: number,
  next: () => number,
  extra?: ChannelValues,
): Map<ControlId, ChannelValues> {
  const desc = program.limbs.find((l) => l.id === limb);
  if (desc === undefined) throw new Error(limb);
  const p = desc.params;
  const values = new Map<ControlId, ChannelValues>([
    [p.fk.upper, { rx: next() * 1.2, ry: next() * 1.2, rz: next() * 1.2 }],
    [p.fk.mid, { ...aboutAxis(p.hinge, bend, controlOrder(program, p.fk.mid)), ...extra }],
    [p.fk.end, { rx: next(), ry: next(), rz: next() }],
    [id('cog'), { tx: next() * 0.1, ty: next() * 0.1, ry: next() }],
  ]);
  if (p.fk.toes !== null) values.set(p.fk.toes, { rx: next() * 0.6 });
  return values;
}

function chainNodes(program: RigProgram, limb: LimbId): number[] {
  const desc = program.limbs.find((l) => l.id === limb);
  if (desc === undefined) throw new Error(limb);
  return [desc.nodes.upper, desc.nodes.mid, desc.nodes.end, ...(desc.nodes.toes >= 0 ? [desc.nodes.toes] : [])];
}

function worldError(a: PoseBuffers, b: PoseBuffers, nodes: readonly number[]): { position: number; rotation: number } {
  let position = 0;
  let rotation = 0;
  for (const node of nodes) {
    position = Math.max(position, distance(bonePos(a, node), bonePos(b, node)));
    rotation = Math.max(rotation, quatAngle(boneQuat(a, node), boneQuat(b, node)));
  }
  return { position, rotation };
}

/** Channels with `values` applied over `base` and the limb's ikFk set. */
function withValues(
  program: RigProgram,
  base: ReadonlyMap<ControlId, ChannelValues>,
  update: ReadonlyMap<ControlId, ChannelValues>,
  ikFk: number,
) {
  const ch = channels(program, base, ikFk);
  for (const [control, v] of update) writeControlChannels(program, ch, control, v);
  return ch;
}

describe('FK → IK → FK round trip (§5.6 gate)', () => {
  const rigs: readonly [string, () => SkeletonDesc, readonly LimbId[]][] = [
    ['rest bent about the hinge (legs, straight arms)', () => richHumanoid(), ['leg.L', 'leg.R', 'arm.L', 'arm.R']],
    ['rest bent off the knee hinge (Polybot-like)', () => limbHumanoid({ splayedLegs: true }), ['leg.L', 'leg.R']],
    ['toed-out feet and bent elbows', () => limbHumanoid({ toeOut: 15 * DEG, bentArms: true }), ['leg.R', 'arm.L']],
  ];

  it.each(rigs)('leaves the chain bones unchanged within 1e-6 for random hinge poses: %s', (_, make, limbs) => {
    const skeleton = make();
    const program = ikRig(skeleton);
    const next = random(17);
    for (const limb of limbs) {
      for (let trial = 0; trial < 12; trial++) {
        const bend = (5 + (next() + 0.5) * 110) * DEG;
        const fkValues = hingePose(program, limb, bend, next);
        const fkCh = channels(program, fkValues, 0);
        const fkPose = evaluate(program, fkCh);
        const ik = matchIkToFk(program, fkPose, fkCh, limb, new Map());
        expect(ik.endErrorM).toBeLessThan(1e-9);
        expect(ik.midErrorM).toBeLessThan(1e-9);
        expect(ik.maxRotationErrorRad).toBeLessThan(1e-9);
        const ikPose = evaluate(program, withValues(program, fkValues, ik.values, 1));
        const nodes = chainNodes(program, limb);
        const toIk = worldError(ikPose, fkPose, nodes);
        expect([limb, trial, toIk.position < 1e-6, toIk.rotation < 1e-6]).toEqual([limb, trial, true, true]);
        const fk = matchFkToIk(program, ikPose, limb, fkValues);
        const back = evaluate(program, withValues(program, fkValues, fk, 0));
        const roundTrip = worldError(back, fkPose, nodes);
        expect([limb, trial, roundTrip.position < 1e-6, roundTrip.rotation < 1e-6]).toEqual([limb, trial, true, true]);
      }
    }
  });

  it('matches IK to an FK pose with foot roll, soft and a moved pole, keeping ikFk and roll', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const next = random(5);
    const fkValues = hingePose(program, 'leg.L', 40 * DEG, next);
    fkValues.set(id('ik.leg.L'), { '@roll': 25 * DEG, '@bank': 0.1, '@twist': 0.4 });
    fkValues.set(id('pole.leg.L'), { tx: 0.4, tz: 0.3 });
    const fkCh = channels(program, fkValues, 0);
    const fkPose = evaluate(program, fkCh);
    const ik = matchIkToFk(program, fkPose, fkCh, 'leg.L', new Map());
    // Only the IK side is matched: fk.toes keeps its channels (the toes rule plants the IK toes under ball roll).
    expect([...ik.values.keys()]).toEqual([id('ik.leg.L'), id('pole.leg.L')]);
    expect(ik.values.get(id('ik.leg.L'))?.['@twist']).toBe(0);
    expect(Object.keys(ik.values.get(id('ik.leg.L')) ?? {})).not.toContain('@ikFk');
    expect(Object.keys(ik.values.get(id('pole.leg.L')) ?? {}).sort()).toEqual(['tx', 'ty', 'tz']);
    const ikCh = withValues(program, fkValues, ik.values, 1);
    expect(readAttr(program, ikCh, id('ik.leg.L'), 'roll')).toBeCloseTo(25 * DEG, 12);
    const ikPose = evaluate(program, ikCh);
    const desc = program.limbs.find((l) => l.id === 'leg.L');
    if (desc === undefined) throw new Error('leg.L');
    const error = worldError(ikPose, fkPose, [desc.nodes.upper, desc.nodes.mid, desc.nodes.end]);
    expect(error.position).toBeLessThan(1e-6);
    expect(error.rotation).toBeLessThan(1e-6);
    expect([ik.endErrorM, ik.midErrorM, ik.maxRotationErrorRad].every((e) => e < 1e-9)).toBe(true);
    // The toes rule takes the ball roll off the toes: relative to the foot they are turned back by the 25° roll.
    const relative = (pose: PoseBuffers) =>
      quatMultiply(quatInvert(boneQuat(pose, desc.nodes.end)), boneQuat(pose, desc.nodes.toes));
    expect(quatAngle(relative(ikPose), relative(fkPose))).toBeCloseTo(25 * DEG, 9);
    // The pole keeps its current distance from the knee (≥ 0.25·L).
    const knee = bonePos(fkPose, nodeOf(skeleton, 'leftLowerLeg'));
    expect(distance(controlPos(program, ikPose, id('pole.leg.L')), knee)).toBeCloseTo(
      distance(controlPos(program, fkPose, id('pole.leg.L')), knee),
      9,
    );
  });
});

describe('hyperextended FK poses (§5.6 gate)', () => {
  const cases: readonly [LimbId, number][] = [
    ['leg.L', -2 * DEG],
    ['leg.L', -5 * DEG],
    ['leg.R', -5 * DEG],
    ['arm.L', -5 * DEG],
  ];

  it.each(cases)('%s at %f rad: end world equal, no flip, mid error reported', (limb, theta) => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const desc = program.limbs.find((l) => l.id === limb);
    if (desc === undefined) throw new Error(limb);
    // The rest bend about the hinge, so that the total bend is θ.
    const rest = evaluate(program, channels(program, new Map(), 0));
    const at = (pose: PoseBuffers, node: number): Vec3 => bonePos(pose, node);
    const u = sub(at(rest, desc.nodes.mid), at(rest, desc.nodes.upper));
    const v = sub(at(rest, desc.nodes.end), at(rest, desc.nodes.mid));
    const h = desc.params.hinge;
    const restBend = Math.atan2(dot([h[0], h[1], h[2]], cross(u, v)), dot(u, v));
    const next = random(3);
    const fkValues = hingePose(program, limb, theta - restBend, next);
    const fkCh = channels(program, fkValues, 0);
    const fkPose = evaluate(program, fkCh);
    const result = matchIkToFk(program, fkPose, fkCh, limb, new Map());
    expect(result.endErrorM).toBeLessThan(1e-6);
    expect(result.midErrorM).toBeGreaterThan(1e-3);
    expect(result.maxRotationErrorRad).toBeLessThan(2 * Math.abs(theta) + 1e-3);
    const ikPose = evaluate(program, withValues(program, fkValues, result.values, 1));
    expect(distance(bonePos(ikPose, desc.nodes.end), bonePos(fkPose, desc.nodes.end))).toBeLessThan(1e-6);
    expect(quatAngle(boneQuat(ikPose, desc.nodes.end), boneQuat(fkPose, desc.nodes.end))).toBeLessThan(1e-6);
    for (const node of [desc.nodes.upper, desc.nodes.mid]) {
      expect(quatAngle(boneQuat(ikPose, node), boneQuat(fkPose, node))).toBeLessThan(2 * Math.abs(theta) + 1e-3);
    }
  });
});

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

describe('match pole rule (§5.6)', () => {
  it('moves the pole direction continuously on non-hinge poses (≤ 1e-3 rad for a 1e-4 rad input change)', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const desc = program.limbs.find((l) => l.id === 'leg.L');
    if (desc === undefined) throw new Error('leg');
    const next = random(99);
    const direction = (values: ReadonlyMap<ControlId, ChannelValues>): Vec3 => {
      const ch = channels(program, values, 0);
      const pose = evaluate(program, ch);
      const result = matchIkToFk(program, pose, ch, 'leg.L', new Map());
      const ikPose = evaluate(program, withValues(program, values, result.values, 1));
      return unit(sub(controlPos(program, ikPose, id('pole.leg.L')), bonePos(pose, desc.nodes.mid)));
    };
    let worst = 0;
    for (let trial = 0; trial < 40; trial++) {
      const bend = (2 + (next() + 0.5) * 100) * DEG;
      const base = hingePose(program, 'leg.L', bend, next);
      // Non-hinge: ±10° of ab/adduction and twist on the knee on top of the hinge bend.
      const knee = base.get(desc.params.fk.mid) as ChannelValues;
      const offAxis = quatMultiply(
        quatFromAxisAngle([0, 0, 1], next() * 20 * DEG),
        quatMultiply(
          quatFromAxisAngle([0, 1, 0], next() * 20 * DEG),
          toQuat(knee, controlOrder(program, desc.params.fk.mid)),
        ),
      );
      const e = quatToEuler(offAxis, controlOrder(program, desc.params.fk.mid));
      base.set(desc.params.fk.mid, { rx: e[0], ry: e[1], rz: e[2] });
      const d0 = direction(base);
      for (const [control, channel] of [
        [desc.params.fk.mid, 'ry'],
        [desc.params.fk.mid, 'rx'],
        [desc.params.fk.upper, 'rz'],
      ] as const) {
        const moved = new Map(base);
        const v = { ...moved.get(control) };
        v[channel] = (v[channel] ?? 0) + 1e-4;
        moved.set(control, v);
        const d1 = direction(moved);
        worst = Math.max(worst, Math.acos(Math.min(1, dot(d0, d1))));
      }
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('uses h near straight limbs, blends to the bend offset with the bend, and h for off-hinge rests', () => {
    const a: Vec3 = [0, 1, 0];
    const c: Vec3 = [0, 0.2, 0];
    const k: Vec3 = [1, 0, 0];
    const pole: Vec3 = [0, 0.6, 1];
    // Knee bent forward and sideways: θ large, m̂·h ≈ 0.8.
    const b: Vec3 = [0.12, 0.6, 0.16];
    const blended = matchPoleDirection(a, b, c, k, pole, 0.8, true);
    const mHat = unit([0.12, 0, 0.16]);
    expect(dot(blended, mHat)).toBeCloseTo(1, 12);
    // Off-hinge rest: always the hinge-implied direction.
    const offHinge = matchPoleDirection(a, b, c, k, pole, 0.8, false);
    expect(dot(offHinge, [0, 0, 1])).toBeCloseTo(1, 12);
    // Nearly straight (θ < 2°): h.
    const straight = matchPoleDirection(a, [0.0005, 0.6, 0.0005], c, k, pole, 0.8, true);
    expect(dot(straight, [0, 0, 1])).toBeCloseTo(1, 12);
    // Hyperextended (m̂·h ≤ 0): h, not the knee's side.
    expect(dot(matchPoleDirection(a, [0, 0.6, -0.05], c, k, pole, 0.8, true), [0, 0, 1])).toBeCloseTo(1, 12);
    // Degenerate hinge (along the chain): the current pole direction from b.
    const degenerate = matchPoleDirection(a, [0, 0.6, 0.02], c, [0, 1, 0], [0.5, 0.6, 0.02], 0.8, true);
    expect(degenerate[0]).toBeCloseTo(1, 12);
    expect(limbRestIsPlanar(ikRig(richHumanoid()), ikRig(richHumanoid()).limbs[0] as never)).toBe(true);
    const splayed = ikRig(limbHumanoid({ splayedLegs: true }));
    expect(limbRestIsPlanar(splayed, splayed.limbs.find((l) => l.id === 'leg.L') as never)).toBe(false);
  });
});

function toQuat(values: ChannelValues, order: RotateOrder): Quat {
  return eulerToQuat([values.rx ?? 0, values.ry ?? 0, values.rz ?? 0], order);
}

describe('matching helpers and Plant Feet on IK legs (§5.8)', () => {
  it('finds the limb of a control and evaluates with a limb mode', () => {
    const program = ikRig(richHumanoid());
    for (const key of ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L', 'fk.toes.L', 'ik.leg.L', 'pole.leg.L']) {
      expect([key, limbOfControl(program, id(key))?.id]).toEqual([key, 'leg.L']);
    }
    expect(limbOfControl(program, id('fk.hand.R'))?.id).toBe('arm.R');
    expect(limbOfControl(program, id('cog'))).toBeNull();
    expect(limbOfControl(program, id('fk.indexProximal.L'))).toBeNull();
    const values = new Map<ControlId, ChannelValues>([[id('ik.leg.L'), { ty: 0.2 }]]);
    const ch = channels(program, values, 0);
    const scratch = program.allocChannels();
    const out = program.allocPose();
    evaluateWithLimbMode(program, ch, 'leg.L', 1, scratch, out);
    expect(readAttr(program, ch, id('ik.leg.L'), 'ikFk')).toBe(0);
    expect(readAttr(program, scratch, id('ik.leg.L'), 'ikFk')).toBe(1);
    const expected = evaluate(program, channels(program, values, 0));
    const foot = nodeOf(program.skeleton, 'leftFoot');
    expect(distance(bonePos(out, foot), controlPos(program, out, id('ik.leg.L')))).toBeLessThan(1e-9);
    expect(distance(bonePos(expected, foot), bonePos(out, foot))).toBeGreaterThan(0.1);
    expect(() => evaluateWithLimbMode(program, ch, 'leg.X' as LimbId, 1, scratch, out)).toThrow(/no leg.X IK limb/);
  });

  it('puts an IK foot back on its pin with the current foot roll (US-25 numbers, 1e-4 → 1e-9 here)', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const foot = nodeOf(skeleton, 'leftFoot');
    const start = new Map<ControlId, ChannelValues>([[id('ik.leg.L'), { tz: 0.05, ry: 0.3 }]]);
    const pinned = evaluate(program, channels(program, start));
    const pin = pinned.boneWorld.slice(foot * 16, foot * 16 + 16);
    const moved = new Map<ControlId, ChannelValues>([
      [id('cog'), { ty: -0.05 }],
      [id('ik.leg.L'), { tz: 0.12, ty: 0.03, ry: 0.1, '@roll': 20 * DEG, '@bank': -0.1 }],
    ]);
    const ch = channels(program, moved);
    const pose = evaluate(program, ch);
    expect(distance(bonePos(pose, foot), bonePos(pinned, foot))).toBeGreaterThan(0.01);
    const values = ikControlForEndWorld(program, pose, ch, 'leg.L', pin, moved.get(id('ik.leg.L')) ?? {});
    expect(Object.keys(values).sort()).toEqual(['rx', 'ry', 'rz', 'tx', 'ty', 'tz']);
    writeControlChannels(program, ch, id('ik.leg.L'), values);
    const planted = evaluate(program, ch);
    expect(distance(bonePos(planted, foot), bonePos(pinned, foot))).toBeLessThan(1e-9);
    expect(quatAngle(boneQuat(planted, foot), boneQuat(pinned, foot))).toBeLessThan(1e-9);
    expect(readAttr(program, ch, id('ik.leg.L'), 'roll')).toBeCloseTo(20 * DEG, 12);
  });
});
