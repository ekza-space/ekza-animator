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
} from '@ekza-studio/anim-core';
import type { ChannelValues, ControlId } from '@ekza-studio/doc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateWithLimbMode,
  ikControlForEndWorld,
  type LimbId,
  limbOfControl,
  matchFkToIk,
  matchIkToFk,
  plantFeetChannels,
  type PoseBuffers,
  readAttr,
  registerBuiltinRigOps,
  type RigProgram,
  type SkeletonDesc,
  writeControlChannels,
} from '../src';
import { limbCore, matchPoleBasis } from '../src/limb/match';
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

describe('matching a limb whose rest is hyperextended (§5.3 amendment C band)', () => {
  it('reproduces FK hinge poses across the band exactly; the IK control sits inside the hand only there', () => {
    // Elbows 9.2° against the hinge at rest: FK bends from the rest's hyperextension −T up to 3T fall in the band.
    const program = ikRig(limbHumanoid({ hyperElbow: 0.02 }));
    const desc = program.limbs.find((l) => l.id === 'arm.L');
    if (desc === undefined) throw new Error('arm.L');
    const rest = evaluate(program, channels(program, new Map(), 0));
    const core = limbCore(program, desc, rest);
    const { hyper, width } = core.transitionBand();
    const next = random(8);
    const offsets: number[] = [];
    // t = the bend from greatest reach (> 0 flexion); the FK hinge turn from rest is t + T.
    for (const t of [-hyper, -0.5 * hyper, -1e-4, 0, 1e-4, 0.5 * hyper, hyper, 2 * hyper, 2.9 * hyper, 3.2 * hyper]) {
      const fkValues = hingePose(program, 'arm.L', t + hyper, next);
      const fkCh = channels(program, fkValues, 0);
      const fkPose = evaluate(program, fkCh);
      const ik = matchIkToFk(program, fkPose, fkCh, 'arm.L', new Map());
      expect([t, ik.endErrorM < 1e-9, ik.midErrorM < 1e-9, ik.maxRotationErrorRad < 1e-9]).toEqual([
        t,
        true,
        true,
        true,
      ]);
      const ikPose = evaluate(program, withValues(program, fkValues, ik.values, 1));
      const error = worldError(ikPose, fkPose, chainNodes(program, 'arm.L'));
      expect([t, error.position < 1e-9, error.rotation < 1e-9]).toEqual([t, true, true]);
      const back = evaluate(program, withValues(program, fkValues, matchFkToIk(program, ikPose, 'arm.L', fkValues), 0));
      const roundTrip = worldError(back, fkPose, chainNodes(program, 'arm.L'));
      expect([t, roundTrip.position < 1e-9, roundTrip.rotation < 1e-9]).toEqual([t, true, true]);
      // The IK control lies on the shoulder → hand ray, inside the hand by the band's offset (0 outside the band).
      const a = bonePos(fkPose, desc.nodes.upper);
      const hand = bonePos(fkPose, desc.nodes.end);
      const control = controlPos(program, ikPose, desc.params.ikControl);
      const inside = distance(hand, a) - distance(control, a);
      expect(distance(control, hand) - Math.abs(inside)).toBeLessThan(1e-12);
      const inBand = t > -hyper && t < hyper + width;
      expect([t, inBand ? inside > 1e-7 : Math.abs(inside) < 1e-12]).toEqual([t, true]);
      offsets.push(inside);
    }
    // The offset vanishes at both ends of the band (continuous with the exact branches).
    expect(Math.max(...offsets)).toBeLessThan(2 * (core.reachOfBend(0) - core.reachOfBend(hyper + width)));
  });

  it('switches at the rest pose without a pop: the matched IK reproduces the rest exactly', () => {
    const program = ikRig(limbHumanoid({ hyperElbow: 0.02 }));
    const fkCh = channels(program, new Map(), 0);
    const fkPose = evaluate(program, fkCh);
    for (const limb of ['arm.L', 'arm.R'] as const) {
      const ik = matchIkToFk(program, fkPose, fkCh, limb, new Map());
      expect([limb, ik.endErrorM < 1e-12, ik.midErrorM < 1e-12, ik.maxRotationErrorRad < 1e-9]).toEqual([
        limb,
        true,
        true,
        true,
      ]);
      const desc = program.limbs.find((l) => l.id === limb);
      if (desc === undefined) throw new Error(limb);
      const ikPose = evaluate(program, withValues(program, new Map(), ik.values, 1));
      expect(
        distance(controlPos(program, ikPose, desc.params.ikControl), bonePos(fkPose, desc.nodes.end)),
      ).toBeLessThan(1e-12);
    }
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
  const continuityRigs: readonly [string, () => SkeletonDesc, LimbId, number, Vec3, Vec3][] = [
    // name, rig, limb, least bend, ab/adduction axis, twist axis (canonical)
    ['knee, rest bent about the hinge', () => richHumanoid(), 'leg.L', 2 * DEG, [0, 0, 1], [0, 1, 0]],
    [
      'knee, rest bent off the hinge (Polybot-like)',
      () => limbHumanoid({ splayedLegs: true }),
      'leg.L',
      5 * DEG,
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      'elbow, rest hyperextended 9.2°',
      () => limbHumanoid({ hyperElbow: 0.02 }),
      'arm.L',
      5 * DEG,
      [0, 0, 1],
      [1, 0, 0],
    ],
  ];

  it.each(continuityRigs)(
    'moves the pole direction continuously on non-hinge poses (≤ 1e-3 rad for a 1e-4 rad input change): %s',
    (_, make, limb, least, abduction, twist) => {
      const skeleton = make();
      const program = ikRig(skeleton);
      const desc = program.limbs.find((l) => l.id === limb);
      if (desc === undefined) throw new Error(limb);
      const next = random(99);
      const direction = (values: ReadonlyMap<ControlId, ChannelValues>): Vec3 => {
        const ch = channels(program, values, 0);
        const pose = evaluate(program, ch);
        const result = matchIkToFk(program, pose, ch, limb, new Map());
        const ikPose = evaluate(program, withValues(program, values, result.values, 1));
        return unit(sub(controlPos(program, ikPose, desc.params.pole), bonePos(pose, desc.nodes.mid)));
      };
      let worst = 0;
      for (let trial = 0; trial < 40; trial++) {
        const bend = least + (next() + 0.5) * 100 * DEG;
        const base = hingePose(program, limb, bend, next);
        // Non-hinge: ±10° of ab/adduction and twist on the knee or elbow on top of the hinge bend.
        const mid = base.get(desc.params.fk.mid) as ChannelValues;
        const offAxis = quatMultiply(
          quatFromAxisAngle(abduction, next() * 20 * DEG),
          quatMultiply(
            quatFromAxisAngle(twist, next() * 20 * DEG),
            toQuat(mid, controlOrder(program, desc.params.fk.mid)),
          ),
        );
        const e = quatToEuler(offAxis, controlOrder(program, desc.params.fk.mid));
        base.set(desc.params.fk.mid, { rx: e[0], ry: e[1], rz: e[2] });
        const d0 = direction(base);
        for (const [control, channel] of [
          [desc.params.fk.mid, 'ry'],
          [desc.params.fk.mid, 'rx'],
          [desc.params.fk.mid, 'rz'],
          [desc.params.fk.upper, 'rz'],
          [desc.params.fk.upper, 'rx'],
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
    },
  );

  it('uses h near straight limbs and for hyperextended or degenerate ones, and blends in with the bend', () => {
    const a: Vec3 = [0, 1, 0];
    const c: Vec3 = [0, 0.2, 0];
    const k: Vec3 = [1, 0, 0];
    const pole: Vec3 = [0, 0.6, 1];
    // Knee bent forward (θ ≫ 10°, m̂·h = 1): h = x̂ × k = +z, β = 1.
    const forward = matchPoleBasis(a, [0, 0.6, 0.16], c, k, pole, 0.8);
    expect(dot(forward.h, [0, 0, 1])).toBeCloseTo(1, 12);
    expect(dot(forward.x, [0, -1, 0])).toBeCloseTo(1, 12);
    expect(forward.beta).toBe(1);
    // Knee bent forward and sideways: m̂·h = 0.25 → β = smoothstep(0, 0.5, 0.25) = 0.5.
    const sideways = matchPoleBasis(a, [Math.sqrt(1 - 0.25 ** 2) * 0.16, 0.6, 0.25 * 0.16], c, k, pole, 0.8);
    expect(sideways.beta).toBeCloseTo(0.5, 12);
    // Nearly straight (|m| ≤ 1e-3·L, or θ < 2°): β = 0.
    expect(matchPoleBasis(a, [0, 0.6, 0.0005], c, k, pole, 0.8).beta).toBe(0);
    expect(matchPoleBasis(a, [0, 0.6, 0.006], c, k, pole, 0.8).beta).toBe(0);
    // Hyperextended (m̂·h ≤ 0): β = 0, h still forward.
    const hyper = matchPoleBasis(a, [0, 0.6, -0.05], c, k, pole, 0.8);
    expect(hyper.beta).toBe(0);
    expect(dot(hyper.h, [0, 0, 1])).toBeCloseTo(1, 12);
    // Degenerate hinge (along the chain): h is the current pole direction from b.
    const degenerate = matchPoleBasis(a, [0, 0.6, 0.02], c, [0, 1, 0], [0.5, 0.6, 0.02], 0.8);
    expect(degenerate.h[0]).toBeCloseTo(1, 12);
  });

  it('turns the IK bend plane to an off-hinge knee (β = 1): the IK knee lies in the FK bend plane', () => {
    for (const skeleton of [richHumanoid(), limbHumanoid({ splayedLegs: true })]) {
      const program = ikRig(skeleton);
      const desc = program.limbs.find((l) => l.id === 'leg.L');
      if (desc === undefined) throw new Error('leg');
      const next = random(41);
      const values = hingePose(program, 'leg.L', 60 * DEG, next);
      const knee = values.get(desc.params.fk.mid) as ChannelValues;
      const order = controlOrder(program, desc.params.fk.mid);
      // 8° of ab/adduction on top of the hinge bend.
      const e = quatToEuler(quatMultiply(quatFromAxisAngle([0, 0, 1], 8 * DEG), toQuat(knee, order)), order);
      values.set(desc.params.fk.mid, { rx: e[0], ry: e[1], rz: e[2] });
      const fkCh = channels(program, values, 0);
      const fkPose = evaluate(program, fkCh);
      const result = matchIkToFk(program, fkPose, fkCh, 'leg.L', new Map());
      const ikPose = evaluate(program, withValues(program, values, result.values, 1));
      const at = (pose: PoseBuffers, node: number) => bonePos(pose, node);
      const x = unit(sub(at(fkPose, desc.nodes.end), at(fkPose, desc.nodes.upper)));
      const offset = (pose: PoseBuffers): Vec3 => {
        const d = sub(at(pose, desc.nodes.mid), at(pose, desc.nodes.upper));
        const along = dot(d, x);
        return unit([d[0] - along * x[0], d[1] - along * x[1], d[2] - along * x[2]]);
      };
      expect(dot(offset(ikPose), offset(fkPose))).toBeGreaterThan(Math.cos(1e-6));
      expect(result.endErrorM).toBeLessThan(1e-9);
      // The knee cannot match exactly (IK bends about the hinge only), but it stays in the FK bend plane.
      expect(result.midErrorM).toBeLessThan(0.01);
    }
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

  it('plants IK legs through their IK controls and FK legs through the FK chain (plantFeetChannels)', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton);
    const footL = nodeOf(skeleton, 'leftFoot');
    const footR = nodeOf(skeleton, 'rightFoot');
    // leg.L in IK (with roll and bank), leg.R in FK.
    const start = new Map<ControlId, ChannelValues>([
      [id('ik.leg.L'), { tz: 0.05, ry: 0.3, '@roll': 15 * DEG, '@bank': 0.05 }],
      [id('ik.leg.R'), { '@ikFk': 0 }],
      [id('fk.upperLeg.R'), { rx: -0.3 }],
      [id('fk.lowerLeg.R'), { rx: 0.5 }],
    ]);
    const startCh = channels(program, start);
    const startPose = evaluate(program, startCh);
    const pins = [
      { side: 'L' as const, footWorld: startPose.boneWorld.slice(footL * 16, footL * 16 + 16) },
      { side: 'R' as const, footWorld: startPose.boneWorld.slice(footR * 16, footR * 16 + 16) },
    ];
    // Lower the cog (the IK foot stays), then move the IK foot and its roll away from the pin.
    const moved = new Map(start);
    moved.set(id('cog'), { ty: -0.05, tx: 0.02 });
    moved.set(id('ik.leg.L'), { tz: 0.12, ty: 0.03, ry: 0.1, '@roll': 25 * DEG, '@bank': -0.08 });
    const ch = channels(program, moved);
    const pose = evaluate(program, ch);
    expect(distance(bonePos(pose, footL), bonePos(startPose, footL))).toBeGreaterThan(0.01);
    expect(distance(bonePos(pose, footR), bonePos(startPose, footR))).toBeGreaterThan(0.01);
    const reference = new Map(program.controlIds.map((c) => [c, { ...moved.get(c) }] as const));

    const check = (result: ReturnType<typeof plantFeetChannels>) => {
      expect(result.warnings).toEqual([]);
      expect(result.reached).toBe(true);
      expect([...result.values.keys()].sort()).toEqual(
        ['ik.leg.L', 'fk.upperLeg.R', 'fk.lowerLeg.R', 'fk.foot.R'].map(id).sort(),
      );
      expect(Object.keys(result.values.get(id('ik.leg.L')) ?? {}).sort()).toEqual(['rx', 'ry', 'rz', 'tx', 'ty', 'tz']);
      const planted = channels(program, moved);
      for (const [control, v] of result.values) writeControlChannels(program, planted, control, v);
      const after = evaluate(program, planted);
      for (const [node, pin] of [
        [footL, pins[0]],
        [footR, pins[1]],
      ] as const) {
        const target = pin?.footWorld as Float64Array;
        expect(distance(bonePos(after, node), [target[12], target[13], target[14]] as number[])).toBeLessThan(1e-4);
      }
      // The IK foot lands exactly; the roll and bank stay.
      expect(distance(bonePos(after, footL), bonePos(startPose, footL))).toBeLessThan(1e-9);
      expect(quatAngle(boneQuat(after, footL), boneQuat(startPose, footL))).toBeLessThan(1e-9);
      expect(readAttr(program, planted, id('ik.leg.L'), 'roll')).toBeCloseTo(25 * DEG, 12);
    };
    // With the channel buffer, and with the attributes in the reference ('@name' entries).
    check(plantFeetChannels(program, pose, pins, reference, ch));
    check(plantFeetChannels(program, pose, pins, reference));
  });

  it('warns when an IK foot cannot reach its pin and uses the default ikFk without attribute values', () => {
    const skeleton = richHumanoid();
    const program = ikRig(skeleton, { legs: true, arms: false });
    const footL = nodeOf(skeleton, 'leftFoot');
    const far = evaluate(program, channels(program)).boneWorld.slice(footL * 16, footL * 16 + 16);
    far[13] = (far[13] as number) - 0.4;
    const pose = evaluate(program, channels(program));
    // No '@ikFk' in the reference: the leg's default (1) applies, so the IK control is planted.
    const result = plantFeetChannels(program, pose, [{ side: 'L', footWorld: far }], new Map());
    expect([...result.values.keys()]).toEqual([id('ik.leg.L')]);
    expect(result.reached).toBe(false);
    expect(result.warnings).toEqual([
      'Plant Feet: the L foot cannot reach its pin; the leg was straightened towards it',
    ]);
  });
});
