// A1 (M2A-SPEC §5.2): limb IK records — controls, attributes, solver params, hinge, rest pole and foot parameters.
import { type AttrDef, type ControlRecord, controlId, solverId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import {
  AUTORIG_VERSION,
  autoRig,
  type FootRollParams,
  footprintShape,
  type Ik2Params,
  limbIkRecords,
  type SkeletonDesc,
  validateFootParams,
} from '../src';
import { limbHinge, restPole } from '../src/limb/records';
import { LIMB_TEMPLATES } from '../src/limb/template';
import { genericSkeleton, IDS, richHumanoid, skeletonFromWorld, richHumanoidSpecs } from './helpers';
import { DEG, distance, id, ikDef, limbHumanoid } from './limb-helpers';

const controlOf = (controls: readonly ControlRecord[], key: string): ControlRecord => {
  const control = controls.find((c) => c.key === key);
  if (control === undefined) throw new Error(`no ${key}`);
  return control;
};

const paramsOf = (def: ReturnType<typeof ikDef>, limb: string): Ik2Params => {
  const solver = def.solvers.find((s) => s.id === solverId(IDS.rig, `ik2.${limb}`));
  if (solver === undefined) throw new Error(`no ${limb}`);
  return solver.params as unknown as Ik2Params;
};

const worldOf = (skeleton: SkeletonDesc, bone: string): [number, number, number] => {
  // Rest world position via the M1 FK rig (controls at rest).
  const node = skeleton.humanoid?.[bone as 'hips'] as number;
  let t: [number, number, number] = [0, 0, 0];
  let q: [number, number, number, number] = [0, 0, 0, 1];
  const chain: number[] = [];
  for (let n = node; n !== -1; n = skeleton.nodes[n]?.parent ?? -1) chain.unshift(n);
  q = [skeleton.facing[0], skeleton.facing[1], skeleton.facing[2], skeleton.facing[3]];
  t = [0, 0, 0];
  for (const n of chain) {
    const local = skeleton.nodes[n]?.restLocal;
    if (local === undefined) continue;
    const v = rotate(q, local.t as [number, number, number]);
    t = [t[0] + v[0], t[1] + v[1], t[2] + v[2]];
    q = mul(q, local.q as [number, number, number, number]);
  }
  return t;
};

function rotate(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
  const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
  const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [
    v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
    v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
    v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
  ];
}

function mul(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  return [
    a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
    a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
    a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

describe('autoRig ik option and limbIkRecords (M2A-SPEC §5.2)', () => {
  const skeleton = richHumanoid();

  it('absent or empty ik keeps the M1 output; ik adds four limbs and marks the generator 0.3.0', () => {
    const m1 = autoRig(skeleton, IDS);
    expect(autoRig(skeleton, IDS, { ik: { legs: false, arms: false } })).toEqual(m1);
    expect(autoRig(genericSkeleton(), IDS, { ik: { legs: true, arms: true } })).toEqual(
      autoRig(genericSkeleton(), IDS),
    );
    const def = ikDef(skeleton);
    expect(m1.rig.generator.version).toBe(AUTORIG_VERSION);
    expect(def.rig.generator).toEqual({ name: 'ekza-autorig-humanoid', version: '0.3.0' });
    expect(def.controls.slice(0, m1.controls.length)).toEqual(m1.controls);
    expect(def.controls.slice(m1.controls.length).map((c) => c.key)).toEqual([
      'ik.leg.L',
      'pole.leg.L',
      'ik.leg.R',
      'pole.leg.R',
      'ik.arm.L',
      'pole.arm.L',
      'ik.arm.R',
      'pole.arm.R',
    ]);
    expect(def.solvers.map((s) => s.id)).toEqual(
      ['ik2.leg.L', 'ik2.leg.R', 'ik2.arm.L', 'ik2.arm.R'].map((key) => solverId(IDS.rig, key)),
    );
    expect(def.solvers.every((s) => s.type === 'ik2' && s.enabled && s.deleted === null && s.rig === IDS.rig)).toBe(
      true,
    );
    const legsOnly = autoRig(skeleton, IDS, { ik: { legs: true, arms: false } });
    expect(legsOnly.solvers.map((s) => (s.params as unknown as Ik2Params).limb)).toEqual(['leg.L', 'leg.R']);
    // Deterministic: the same records every time.
    expect(ikDef(skeleton)).toEqual(def);
  });

  it('builds the IK and pole controls of the §5.2 table', () => {
    const def = ikDef(skeleton);
    const root = controlOf(def.controls, 'root');
    const legIk = controlOf(def.controls, 'ik.leg.L');
    const legPole = controlOf(def.controls, 'pole.leg.R');
    const armIk = controlOf(def.controls, 'ik.arm.R');
    const hand = controlOf(def.controls, 'fk.hand.R');
    expect(legIk).toMatchObject({
      id: controlId(IDS.rig, 'ik.leg.L'),
      name: 'L Leg IK',
      side: 'L',
      group: 'body',
      parent: root.id,
      rotateOrder: 'zxy',
      keyable: { t: [true, true, true], r: [true, true, true], s: [false, false, false] },
      drives: null,
      mirror: controlId(IDS.rig, 'ik.leg.R'),
      hiddenByDefault: false,
      deleted: null,
    });
    expect(legIk.restWorld.q).toEqual([0, 0, 0, 1]);
    expect(distance(legIk.restWorld.t, worldOf(skeleton, 'leftFoot'))).toBeLessThan(1e-12);
    expect(legIk.shape).toMatchObject({ kind: 'custom', size: 1 });
    expect(legPole).toMatchObject({
      name: 'R Knee Pole',
      rotateOrder: 'xyz',
      keyable: { t: [true, true, true], r: [false, false, false], s: [false, false, false] },
      mirror: controlId(IDS.rig, 'pole.leg.L'),
      attrs: {},
    });
    expect(legPole.shape).toMatchObject({ kind: 'diamond', size: 0.015 * skeleton.height });
    expect(armIk).toMatchObject({ name: 'R Arm IK', side: 'R', rotateOrder: 'zxy' });
    expect(armIk.shape.kind).toBe('cube');
    expect(armIk.shape.size).toBeCloseTo(1.2 * hand.shape.size, 12);
    expect(controlOf(def.controls, 'pole.arm.L').name).toBe('L Elbow Pole');
    // Ordered after the existing children of root.
    const rootChildren = def.controls.filter((c) => c.parent === root.id);
    const orders = rootChildren.map((c) => c.order);
    expect([...orders].sort()).toEqual(orders);
    expect(rootChildren[0]?.key).toBe('cog');
  });

  it('gives legs all seven attributes and arms three, with the §5.2 defaults, ranges, units and keyAll rules', () => {
    const def = ikDef(skeleton);
    const leg = controlOf(def.controls, 'ik.leg.L').attrs;
    const arm = controlOf(def.controls, 'ik.arm.L').attrs;
    expect(Object.keys(leg)).toEqual(['ikFk', 'soft', 'twist', 'roll', 'bank', 'heelTwist', 'toeTwist']);
    expect(Object.keys(arm)).toEqual(['ikFk', 'soft', 'twist']);
    const ikFk = leg['ikFk'] as AttrDef;
    expect(ikFk).toMatchObject({
      type: 'float',
      default: 1,
      min: 0,
      max: 1,
      keyable: true,
      keyAll: false,
      stepped: true,
      mirror: 'copy',
    });
    expect(arm['ikFk']?.default).toBe(0);
    expect(leg['soft']).toMatchObject({ default: 0, min: 0, max: 0.25, keyAll: false, mirror: 'copy' });
    expect(leg['soft']?.unit).toBeUndefined();
    for (const [name, mirror] of [
      ['twist', 'negate'],
      ['roll', 'copy'],
      ['bank', 'copy'],
      ['heelTwist', 'negate'],
      ['toeTwist', 'negate'],
    ] as const) {
      expect([name, leg[name]]).toEqual([name, { type: 'float', default: 0, keyable: true, unit: 'angle', mirror }]);
    }
  });

  it('writes Ik2Params v1 with humanoid bone refs, the FK controls, the hinge and the foot', () => {
    const def = ikDef(skeleton);
    const leg = paramsOf(def, 'leg.L');
    expect(leg).toMatchObject({
      v: 1,
      limb: 'leg.L',
      bones: {
        upper: { humanoid: 'leftUpperLeg' },
        mid: { humanoid: 'leftLowerLeg' },
        end: { humanoid: 'leftFoot' },
        toes: { humanoid: 'leftToes' },
      },
      fk: { upper: id('fk.upperLeg.L'), mid: id('fk.lowerLeg.L'), end: id('fk.foot.L'), toes: id('fk.toes.L') },
      ikControl: id('ik.leg.L'),
      pole: id('pole.leg.L'),
      hinge: [1, 0, 0],
    });
    expect(leg.foot?.side).toBe(1);
    expect(paramsOf(def, 'leg.R').foot?.side).toBe(-1);
    const arm = paramsOf(def, 'arm.L');
    expect(arm.bones.toes).toBeNull();
    expect(arm.fk.toes).toBeNull();
    expect(arm.foot).toBeNull();
    // T-pose arms: the hinge equals the R07 table.
    expect(arm.hinge).toEqual([0, -1, 0]);
    expect(paramsOf(def, 'arm.R').hinge).toEqual([0, 1, 0]);
    // A limb without toes (Polybot's left foot) has none.
    const noToes = ikDef(richHumanoid({ leftToes: false }));
    expect(paramsOf(noToes, 'leg.L').bones.toes).toBeNull();
    expect(paramsOf(noToes, 'leg.L').fk.toes).toBeNull();
  });

  it('adds IK with ikFk 0 for rig.addLimbIk, only for the requested limbs, and refuses limbs that have it', () => {
    const m1 = autoRig(skeleton, IDS);
    const added = limbIkRecords(m1, skeleton, { limbs: ['arm.R', 'leg.L'], ikFkDefault: 0 });
    expect(added.warnings).toEqual([]);
    expect(added.solvers.map((s) => (s.params as unknown as Ik2Params).limb)).toEqual(['leg.L', 'arm.R']);
    for (const control of added.controls)
      if (control.key.startsWith('ik.')) expect(control.attrs['ikFk']?.default).toBe(0);
    // No counterpart yet: no mirror pair.
    expect(controlOf(added.controls, 'ik.leg.L').mirror).toBeNull();
    // The same records as autoRig gives (apart from the ikFk default and the mirror).
    const full = ikDef(skeleton);
    expect(controlOf(added.controls, 'pole.leg.L').restWorld).toEqual(controlOf(full.controls, 'pole.leg.L').restWorld);
    const upgraded = { ...m1, controls: [...m1.controls, ...added.controls], solvers: [...added.solvers] };
    const again = limbIkRecords(upgraded, skeleton, { limbs: ['leg.L', 'leg.R'], ikFkDefault: 0 });
    expect(again.warnings).toEqual(['L Leg already has IK']);
    expect(again.solvers.map((s) => (s.params as unknown as Ik2Params).limb)).toEqual(['leg.R']);
    // The right leg now pairs with the existing left leg.
    expect(controlOf(again.controls, 'ik.leg.R').mirror).toBe(id('ik.leg.L'));
  });

  it('skips non-humanoid skeletons, missing bones and limbs without FK controls with warnings', () => {
    const generic = genericSkeleton();
    expect(limbIkRecords(autoRig(generic, IDS), generic, { limbs: ['leg.L'], ikFkDefault: 0 })).toEqual({
      controls: [],
      solvers: [],
      warnings: ['Limb IK needs a humanoid rig (the 15 VRM-required bones)'],
    });
    const m1 = autoRig(skeleton, IDS);
    const withoutFk = { ...m1, controls: m1.controls.filter((c) => c.key !== 'fk.lowerArm.L') };
    const result = limbIkRecords(withoutFk, skeleton, { limbs: ['arm.L'], ikFkDefault: 0 });
    expect(result.solvers).toEqual([]);
    expect(result.warnings).toEqual(['L Arm: the limb is not driven by its FK controls; no IK was added']);
  });
});

describe('limb placement (§5.2.1 hinge, §5.2.2 rest pole)', () => {
  it('uses normalize(x̂⁰_U × s) and the R07 table when the upper bone is parallel to s', () => {
    const t = LIMB_TEMPLATES;
    const h = limbHinge(t['arm.L'], [0.1, 1.4, 0], [0.3, 1.2, 0]);
    expect(h[0]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(h[1]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(limbHinge(t['arm.L'], [0, 1.4, 0], [0, 1.4, 0.3])).toEqual([0, -1, 0]);
    expect(limbHinge(t['arm.R'], [0, 1.4, 0], [0, 1.4, 0.3])).toEqual([0, 1, 0]);
    expect(limbHinge(t['leg.R'], [0, 1, 0], [0, 1, -0.4])).toEqual([1, 0, 0]);
    const knee = limbHinge(t['leg.L'], [0.09, 0.9, 0], [0.15, 0.5, 0]);
    expect(Math.hypot(...knee)).toBeCloseTo(1, 12);
  });

  it('puts the rest pole at b⁰ + p̂⁰·(l1 + l2) for rests bent about the hinge and straight rests', () => {
    // Bent knee (m⁰ along the flexion direction): the spec's b⁰ + m̂⁰·L.
    const a: [number, number, number] = [0, 1, 0];
    const b: [number, number, number] = [0, 0.6, 0.02];
    const c: [number, number, number] = [0, 0.2, 0];
    const pole = restPole(a, b, c, [1, 0, 0], 0.8);
    expect(distance(pole, [0, 0.6, 0.02 + 0.8])).toBeLessThan(1e-12);
    // Straight rest: in front along x̂⁰ × k⁰.
    expect(distance(restPole(a, [0, 0.6, 0], c, [1, 0, 0], 0.8), [0, 0.6, 0.8])).toBeLessThan(1e-12);
    // Elbow: the pole sits behind (x̂ × k points back for a left T-pose arm).
    expect(
      distance(restPole([0.1, 1.4, 0], [0.35, 1.4, 0], [0.6, 1.4, 0], [0, -1, 0], 0.5), [0.35, 1.4, -0.5]),
    ).toBeLessThan(1e-12);
    // A rest bent off the hinge: the pole's offset from the chain line lies along h⁰ (twist-free rest).
    const off = restPole(a, [0.05, 0.6, 0.02], c, [1, 0, 0], 0.8);
    // The chain line is vertical (x̂⁰ = −y), so the perpendicular offset is the pole's (x, z) relative to a.
    expect(Math.abs(off[0] - a[0])).toBeLessThan(1e-12);
    expect(off[2] - a[2]).toBeGreaterThan(0.8);
  });
});

describe('foot parameters (§5.2.3)', () => {
  it('falls back to the bone guesses without mesh data and takes forward and the ball from the toes', () => {
    const skeleton = richHumanoid();
    const def = ikDef(skeleton);
    const foot = paramsOf(def, 'leg.L').foot as FootRollParams;
    const r = controlOf(def.controls, 'fk.foot.L').shape.size;
    const ankle = worldOf(skeleton, 'leftFoot');
    const toes = worldOf(skeleton, 'leftToes');
    expect(foot.ground[0]).toBe(0);
    expect(foot.ground[2]).toBe(0);
    expect(foot.ground[1]).toBeCloseTo(-ankle[1], 12);
    expect(foot.yaw).toBeCloseTo(Math.atan2(toes[0] - ankle[0], toes[2] - ankle[2]), 12);
    expect(foot.ballFront).toBeCloseTo(Math.hypot(toes[0] - ankle[0], toes[2] - ankle[2]), 12);
    expect(foot.heelBack).toBeCloseTo(r, 12);
    expect(foot.toeFront).toBeCloseTo(1.2 * r, 12);
    expect(foot.innerWidth).toBeCloseTo(r, 12);
    expect(foot.outerWidth).toBeCloseTo(r, 12);
    expect(foot.breakAngle).toBe(Math.PI / 6);
    // No toes: forward +z and the ball 1.5·r_f ahead.
    const noToes = ikDef(richHumanoid({ leftToes: false }));
    const bare = paramsOf(noToes, 'leg.L').foot as FootRollParams;
    expect(bare.yaw).toBe(0);
    expect(bare.ballFront).toBeCloseTo(1.5 * controlOf(noToes.controls, 'fk.foot.L').shape.size, 12);
  });

  it('places a low ankle half a foot size above the ground and mirrors yaw on toed-out feet', () => {
    const lowered = skeletonFromWorld(
      richHumanoidSpecs().map((spec) => ({
        ...spec,
        t: [spec.t[0], spec.t[1] - 0.07, spec.t[2]] as [number, number, number],
      })),
    );
    const def = ikDef(lowered);
    const r = controlOf(def.controls, 'fk.foot.L').shape.size;
    expect(paramsOf(def, 'leg.L').foot?.ground[1]).toBeCloseTo(-0.5 * r, 12);
    const out = ikDef(limbHumanoid({ toeOut: 15 * DEG }));
    expect(paramsOf(out, 'leg.L').foot?.yaw).toBeCloseTo(15 * DEG, 9);
    expect(paramsOf(out, 'leg.R').foot?.yaw).toBeCloseTo(-15 * DEG, 9);
  });

  it('measures heel, toe tip and edge widths from the foot mesh support function, with range fallbacks', () => {
    // A box-shaped sole under each foot: x ∈ ±0.045 around the ankle, z ∈ [−0.06, 0.18], y ∈ [0, 0.1].
    const base = richHumanoid();
    const support = (node: number, box: { x0: number; x1: number; z0: number; z1: number }) => {
      const p = worldOf(base, base.nodes[node]?.name as string);
      const values = new Float32Array(34);
      for (let k = 0; k < 32; k++) {
        const theta = (k * 2 * Math.PI) / 32;
        let best = Number.NEGATIVE_INFINITY;
        for (const x of [box.x0, box.x1])
          for (const z of [box.z0, box.z1]) {
            best = Math.max(best, (x - p[0]) * Math.sin(theta) + (z - p[2]) * Math.cos(theta));
          }
        values[k] = best;
      }
      values[32] = 0 - p[1];
      values[33] = 0.1 - p[1];
      return values;
    };
    const boneSupport: (Float32Array | null)[] = base.nodes.map(() => null);
    for (const side of [1, -1]) {
      const prefix = side === 1 ? 'left' : 'right';
      const foot = base.humanoid?.[`${prefix}Foot` as 'leftFoot'] as number;
      const toes = base.humanoid?.[`${prefix}Toes` as 'leftToes'] as number;
      // The foot node carries the heel half, the toes node the front.
      const inner = side * (0.09 - 0.045);
      const outer = side * (0.09 + 0.05);
      boneSupport[foot] = support(foot, { x0: Math.min(inner, outer), x1: Math.max(inner, outer), z0: -0.06, z1: 0.1 });
      boneSupport[toes] = support(toes, { x0: side * 0.09 - 0.04, x1: side * 0.09 + 0.04, z0: 0.08, z1: 0.18 });
    }
    // Helpers must read the support relative to the node's rest position; worldOf uses node names.
    const skeleton: SkeletonDesc = { ...base, boneSupport };
    const def = ikDef(skeleton);
    const result = limbIkRecords(autoRig(skeleton, IDS), skeleton, { limbs: ['leg.L', 'leg.R'], ikFkDefault: 0 });
    for (const limb of ['leg.L', 'leg.R'] as const) {
      const foot = paramsOf(def, limb).foot as FootRollParams;
      const side = limb === 'leg.L' ? 1 : -1;
      const ankle = worldOf(skeleton, side === 1 ? 'leftFoot' : 'rightFoot');
      expect(foot.ground[1]).toBeCloseTo(-ankle[1], 6);
      // The foot points along +z: heel and toe tip at the box ends, ball from the toes bone.
      expect(foot.yaw).toBeCloseTo(0, 9);
      expect(ankle[2] - foot.heelBack).toBeCloseTo(-0.06, 4);
      expect(ankle[2] + foot.ballFront + foot.toeFront).toBeCloseTo(0.18, 4);
      // Outer = +x on the left foot, −x on the right.
      expect(foot.outerWidth).toBeCloseTo(0.05, 4);
      expect(foot.innerWidth).toBeCloseTo(0.045, 4);
    }
    expect(result.warnings).toEqual([]);
    // A value outside [0.2·r_f, 6·r_f] falls back and warns.
    const tiny = base.nodes.map((_, node) => {
      const values = boneSupport[node];
      if (values === null || values === undefined) return null;
      const copy = Float32Array.from(values);
      copy[16] = -0.5; // the heel would sit in front of the ankle
      return copy;
    });
    const warned = limbIkRecords(
      autoRig(base, IDS),
      { ...base, boneSupport: tiny },
      { limbs: ['leg.L'], ikFkDefault: 0 },
    );
    expect(warned.warnings).toHaveLength(1);
    expect(warned.warnings[0]).toMatch(/^L Leg: the foot mesh gives heelBack .* the bone guess .* is used$/);
    const fallback = (warned.solvers[0]?.params as unknown as Ik2Params).foot as FootRollParams;
    const r = controlOf(autoRig(base, IDS).controls, 'fk.foot.L').shape.size;
    expect(fallback.heelBack).toBeCloseTo(r, 12);
  });

  it('validates rig.setFootParams patches and rewrites the footprint', () => {
    const current: FootRollParams = {
      side: 1,
      ground: [0, -0.08, 0],
      yaw: 0.1,
      heelBack: 0.05,
      ballFront: 0.12,
      toeFront: 0.05,
      innerWidth: 0.04,
      outerWidth: 0.05,
      breakAngle: Math.PI / 6,
    };
    expect(validateFootParams(current, { heelBack: 0.07, breakAngle: Math.PI / 2 })).toEqual({
      ...current,
      heelBack: 0.07,
      breakAngle: Math.PI / 2,
    });
    expect(validateFootParams(current, {})).toEqual(current);
    for (const patch of [
      { heelBack: -0.01 },
      { toeFront: Number.NaN },
      { innerWidth: Number.POSITIVE_INFINITY },
      { breakAngle: -0.1 },
      { breakAngle: Math.PI / 2 + 1e-9 },
      { side: 0 as 1 },
      { ground: [0, 0] as unknown as [number, number, number] },
      { yaw: Number.NaN },
      { unknown: 1 } as unknown as Partial<FootRollParams>,
    ]) {
      expect('error' in (validateFootParams(current, patch) as object)).toBe(true);
    }
    const shape = footprintShape(current);
    expect(shape.splines).toHaveLength(1);
    const ring = shape.splines[0];
    expect(ring?.closed).toBe(true);
    const points = ring?.points ?? [];
    expect(points).toHaveLength(4);
    // On the ground plane; the heel corners lie heelBack behind the ankle along the foot line.
    for (const p of points) expect(p[1]).toBeCloseTo(-0.08, 12);
    const f = [Math.sin(0.1), 0, Math.cos(0.1)];
    const corner = (i: number): readonly number[] => points[i] ?? [Number.NaN, Number.NaN, Number.NaN];
    const along = (p: readonly number[]) => (p[0] as number) * (f[0] as number) + (p[2] as number) * (f[2] as number);
    expect(along(corner(0))).toBeCloseTo(-0.05, 12);
    expect(along(corner(2))).toBeCloseTo(0.17, 12);
    // Width: inner + outer across the foot.
    expect(distance(corner(0), corner(1))).toBeCloseTo(0.09, 12);
  });
});
