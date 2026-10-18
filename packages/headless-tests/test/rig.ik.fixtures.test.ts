// A1 fixture gates (M2A-SPEC §8 A1 tests, §5.2–§5.6, §5.8): limb IK on Seed-san and Polybot through the real io
// skeleton reader — rest exactness, FR-RIG-11, foot parameters from the foot mesh (checked against three.js skinning)
// and the fallback, the §5.3.1 foot-roll gates with E2E-M2A-04's numbers, the follow rule, FK at ikFk 0, the §5.6
// match gates, Plant Feet on IK legs and the evaluation bench with four IK limbs.
import {
  mat4Decompose,
  type Quat,
  quatAngle,
  quatFromAxisAngle,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  quatToEuler,
  type RotateOrder,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId } from '@ekza-animator/doc';
import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import { parseGlb, skeletonFromGltf } from '@ekza-animator/io';
import { loadGltfInNode } from '@ekza-animator/io/testing';
import {
  autoRig,
  type ChannelBuffer,
  compileRig,
  footPivotWorlds,
  humanoidRestWorldPositions,
  type LimbDesc,
  type LimbId,
  matchFkToIk,
  matchIkToFk,
  mirrorPose,
  plantFeetChannels,
  type PoseBuffers,
  readControlChannels,
  type RigProgram,
  registerBuiltinRigOps,
  type SkeletonDesc,
  writeAttr,
  writeControlChannels,
} from '@ekza-animator/rig';
import { type Object3D, type SkinnedMesh, Vector3 } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const IDS = { character: 'chr_IkFixtureGates01' as never, rig: 'rig_IkFixtureGates01' as never };
const DEG = Math.PI / 180;
const ALL = { legs: true, arms: true } as const;
const LIMBS: readonly LimbId[] = ['leg.L', 'leg.R', 'arm.L', 'arm.R'];

let dispose: () => void = () => undefined;
beforeAll(() => {
  dispose = registerBuiltinRigOps();
});
afterAll(() => dispose());

const skeletons = new Map<string, Promise<SkeletonDesc>>();
function loadSkeleton(name: LicensedFixture): Promise<SkeletonDesc> {
  let cached = skeletons.get(name);
  if (cached === undefined) {
    cached = parseGlb(readFixture(name)).then((container) => skeletonFromGltf(container));
    skeletons.set(name, cached);
  }
  return cached;
}

function ikProgram(skeleton: SkeletonDesc, ik: { readonly legs: boolean; readonly arms: boolean } = ALL): RigProgram {
  return compileRig(autoRig(skeleton, IDS, { ik }), skeleton);
}

function controlId(program: RigProgram, key: string): ControlId {
  const control = program.controls.find((c) => c.key === key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

function limbOf(program: RigProgram, limb: LimbId): LimbDesc {
  const desc = program.limbs.find((l) => l.id === limb);
  if (desc === undefined) throw new Error(`no ${limb}`);
  return desc;
}

function humanNode(skeleton: SkeletonDesc, bone: string): number {
  const node = (skeleton.humanoid as Record<string, number | undefined> | null)?.[bone];
  if (node === undefined) throw new Error(`no ${bone}`);
  return node;
}

/** Channels with the given limbs' ikFk (default: all four at 1) and then `values` (keys are template keys). */
function channelsOf(
  program: RigProgram,
  values: Readonly<Record<string, ChannelValues>> = {},
  ikFk: Partial<Record<LimbId, number>> = { 'leg.L': 1, 'leg.R': 1, 'arm.L': 1, 'arm.R': 1 },
): ChannelBuffer {
  const ch = program.allocChannels();
  for (const limb of program.limbs) {
    const w = ikFk[limb.id];
    if (w !== undefined) writeAttr(program, ch, limb.params.ikControl, 'ikFk', w);
  }
  for (const [key, v] of Object.entries(values)) writeControlChannels(program, ch, controlId(program, key), v);
  return ch;
}

function evaluate(program: RigProgram, ch: ChannelBuffer): PoseBuffers {
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  return pose;
}

function pos(pose: PoseBuffers, node: number): Vec3 {
  return [
    pose.boneWorld[node * 16 + 12] as number,
    pose.boneWorld[node * 16 + 13] as number,
    pose.boneWorld[node * 16 + 14] as number,
  ];
}

function rot(pose: PoseBuffers, node: number): Quat {
  return mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16)).q;
}

function controlWorld(program: RigProgram, pose: PoseBuffers, key: string) {
  const slot = program.controlIndex.get(controlId(program, key)) as number;
  return mat4Decompose(pose.controlWorld.slice(slot * 16, slot * 16 + 16));
}

const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );
const vec = (a: Float64Array): Vec3 => [a[0] as number, a[1] as number, a[2] as number];

/** Largest rotation (rad) and translation (m) difference of every bone local against the rest locals. */
function restError(skeleton: SkeletonDesc, pose: PoseBuffers): { rotation: number; translation: number; at: string } {
  let rotation = 0;
  let translation = 0;
  let at = '';
  skeleton.nodes.forEach((node, i) => {
    const q = node.restLocal.q;
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    for (let k = 0; k < 3; k++) {
      const e = Math.max(
        Math.abs((pose.boneLocal[i * 10 + k] as number) - (node.restLocal.t[k] as number)),
        Math.abs((pose.boneLocal[i * 10 + 7 + k] as number) - (node.restLocal.s[k] as number)),
      );
      if (e > translation) {
        translation = e;
        at = `${node.name} t/s`;
      }
    }
    const e = quatAngle(
      [
        pose.boneLocal[i * 10 + 3] as number,
        pose.boneLocal[i * 10 + 4] as number,
        pose.boneLocal[i * 10 + 5] as number,
        pose.boneLocal[i * 10 + 6] as number,
      ],
      [q[0] / n, q[1] / n, q[2] / n, q[3] / n],
    );
    if (e > rotation) {
      rotation = e;
      at = `${node.name} q`;
    }
  });
  return { rotation, translation, at };
}

const FIXTURES = ['seed-san.vrm', 'polybot.vrm'] as const;

describe('limb IK on the fixtures (M2A-SPEC §5.3)', { timeout: 60_000 }, () => {
  it.each(FIXTURES)('reproduces the rest pose within 1e-7 with four IK limbs on %s', async (name) => {
    const skeleton = await loadSkeleton(name);
    const program = ikProgram(skeleton);
    expect(program.limbs.map((l) => l.id).sort()).toEqual([...LIMBS].sort());
    for (const subset of [LIMBS, ['leg.L', 'leg.R'], ['arm.L', 'arm.R']] as const) {
      const ikFk = Object.fromEntries(LIMBS.map((limb) => [limb, subset.includes(limb as never) ? 1 : 0]));
      const error = restError(skeleton, evaluate(program, channelsOf(program, {}, ikFk)));
      expect([name, subset.join(), error.rotation < 1e-7, error.translation < 1e-7, error.at]).toEqual([
        name,
        subset.join(),
        true,
        true,
        error.at,
      ]);
    }
  });

  it.each(FIXTURES)('keeps the IK feet and hands when the cog moves (FR-RIG-11) on %s', async (name) => {
    const skeleton = await loadSkeleton(name);
    const program = ikProgram(skeleton);
    // The hands are brought 8 cm towards the body first: a straight T-pose arm cannot follow a lower shoulder (the
    // hand would be 2.6 mm out of reach on Seed-san; the IK does not stretch).
    const bent = { 'ik.arm.L': { tx: -0.08 }, 'ik.arm.R': { tx: 0.08 } };
    const rest = evaluate(program, channelsOf(program, bent));
    const moved = evaluate(program, channelsOf(program, { ...bent, cog: { ty: -0.05 } }));
    for (const bone of ['leftFoot', 'rightFoot', 'leftHand', 'rightHand']) {
      const node = humanNode(skeleton, bone);
      expect([bone, dist(pos(moved, node), pos(rest, node)) < 1e-6]).toEqual([bone, true]);
      expect([bone, quatAngle(rot(moved, node), rot(rest, node)) < 1e-6]).toEqual([bone, true]);
    }
    const hips = humanNode(skeleton, 'hips');
    expect(pos(moved, hips)[1] - pos(rest, hips)[1]).toBeCloseTo(-0.05, 9);
    // The knees bend forward (+z in canonical space).
    for (const knee of ['leftLowerLeg', 'rightLowerLeg']) {
      const node = humanNode(skeleton, knee);
      expect(pos(moved, node)[2] - pos(rest, node)[2]).toBeGreaterThan(1e-3);
    }
    // A cog turn and shift keeps them too.
    const turned = evaluate(program, channelsOf(program, { cog: { tx: 0.03, ty: -0.04, ry: 0.3, rz: 0.1 } }));
    for (const bone of ['leftFoot', 'rightFoot']) {
      const node = humanNode(skeleton, bone);
      expect(dist(pos(turned, node), pos(rest, node))).toBeLessThan(1e-6);
      expect(quatAngle(rot(turned, node), rot(rest, node))).toBeLessThan(1e-6);
    }
  });

  it('carries the fingers with the IK hand: finger controls relative to the hand unchanged (E2E-M2A-05, 1e-6)', async () => {
    const skeleton = await loadSkeleton('seed-san.vrm');
    const program = ikProgram(skeleton);
    const hand = humanNode(skeleton, 'leftHand');
    const values = { 'fk.indexProximal.L': { rz: 0.4 }, 'fk.thumbProximal.L': { ry: 0.3 } };
    const relative = (pose: PoseBuffers, key: string): { t: Vec3; q: Quat } => {
      const handQ = rot(pose, hand);
      const control = controlWorld(program, pose, key);
      const inverse = quatInvert(handQ);
      const d: Vec3 = [
        control.t[0] - pos(pose, hand)[0],
        control.t[1] - pos(pose, hand)[1],
        control.t[2] - pos(pose, hand)[2],
      ];
      return { t: quatRotateVec3(inverse, d), q: quatMultiply(inverse, control.q) };
    };
    const before = evaluate(program, channelsOf(program, values));
    const after = evaluate(program, channelsOf(program, { ...values, cog: { ty: -0.05 }, 'ik.arm.L': { tz: 0.1 } }));
    expect(dist(pos(after, hand), pos(before, hand))).toBeGreaterThan(0.05);
    for (const key of ['fk.indexProximal.L', 'fk.thumbProximal.L']) {
      const a = relative(before, key);
      const b = relative(after, key);
      expect(dist(a.t, b.t)).toBeLessThan(1e-6);
      expect(quatAngle(a.q, b.q)).toBeLessThan(1e-6);
    }
  });

  it.each(FIXTURES)('writes nothing at ikFk 0: bone locals bit-identical to the M1 rig on %s', async (name) => {
    const skeleton = await loadSkeleton(name);
    const ik = ikProgram(skeleton);
    const m1 = compileRig(autoRig(skeleton, IDS), skeleton);
    let state = 3;
    const next = (): number => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647 - 0.5;
    };
    for (let trial = 0; trial < 5; trial++) {
      const chM1 = m1.allocChannels();
      const chIk = channelsOf(ik, {}, { 'leg.L': 0, 'leg.R': 0, 'arm.L': 0, 'arm.R': 0 });
      for (const control of m1.controls) {
        if (control.group === 'secondary') continue;
        const values: ChannelValues = { rx: next(), ry: next(), rz: next() };
        if (control.keyable.t[1]) values.ty = next() * 0.1;
        writeControlChannels(m1, chM1, control.id, values);
        writeControlChannels(ik, chIk, control.id, values);
      }
      // IK controls far away: they must not matter at ikFk 0.
      writeControlChannels(ik, chIk, controlId(ik, 'ik.leg.L'), { tx: 0.3, ty: 0.2 });
      writeControlChannels(ik, chIk, controlId(ik, 'pole.arm.R'), { tz: -0.5 });
      const a = evaluate(m1, chM1);
      const b = evaluate(ik, chIk);
      expect(Array.from(b.boneLocal)).toEqual(Array.from(a.boneLocal));
      expect(Array.from(b.humanLocal)).toEqual(Array.from(a.humanLocal));
    }
  });
});

/**
 * Canonical rest positions (three.js skinning) of the foot region's vertices: those whose dominant skin joint is the
 * foot bone or a joint below it (toes, a heel helper), and those of the lower leg below the ankle (rigs that skin the
 * heel to the shin, like Polybot).
 */
async function footVertices(name: LicensedFixture, skeleton: SkeletonDesc, side: 'left' | 'right'): Promise<Vec3[]> {
  const gltf = await loadGltfInNode(readFixture(name));
  gltf.scene.updateMatrixWorld(true);
  const foot = gltf.nodeByIndex[humanNode(skeleton, `${side}Foot`)];
  const lowerLeg = gltf.nodeByIndex[humanNode(skeleton, `${side}LowerLeg`)];
  if (foot === null || foot === undefined || lowerLeg === null || lowerLeg === undefined) throw new Error('no leg');
  const ankle = foot.getWorldPosition(new Vector3());
  const ankleY = quatRotateVec3(skeleton.facing, [ankle.x, ankle.y, ankle.z])[1];
  const belowFoot = (bone: Object3D): boolean => {
    for (let current: Object3D | null = bone; current !== null; current = current.parent)
      if (current === foot) return true;
    return false;
  };
  const out: Vec3[] = [];
  const v = new Vector3();
  gltf.scene.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (mesh.isSkinnedMesh !== true) return;
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    for (let i = 0; i < position.count; i++) {
      let slot = 0;
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, slot)) slot = k;
      if (!(skinWeight.getComponent(i, slot) > 0)) continue;
      const bone = mesh.skeleton.bones[skinIndex.getComponent(i, slot)];
      if (bone === undefined || (bone !== lowerLeg && !belowFoot(bone))) continue;
      v.fromBufferAttribute(position, i);
      mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      const canonical = quatRotateVec3(skeleton.facing, [v.x, v.y, v.z]);
      if (bone === lowerLeg && !(canonical[1] < ankleY)) continue;
      out.push(canonical);
    }
  });
  return out;
}

describe('foot parameters from the foot mesh (M2A-SPEC §5.2.3)', { timeout: 60_000 }, () => {
  it.each(FIXTURES)('puts the heel pivot and the toe tip within 3 mm of the foot mesh on %s', async (name) => {
    const skeleton = await loadSkeleton(name);
    expect(skeleton.boneSupport).toBeDefined();
    const program = ikProgram(skeleton, { legs: true, arms: false });
    const rest = humanoidRestWorldPositions(skeleton);
    for (const [limb, side] of [
      ['leg.L', 'left'],
      ['leg.R', 'right'],
    ] as const) {
      const foot = limbOf(program, limb).params.foot;
      if (foot === null) throw new Error('no foot');
      const ankle = rest[`${side}Foot`] as Vec3;
      // three's foot bone, in canonical space, is the rig's ankle.
      const gltf = await loadGltfInNode(readFixture(name));
      gltf.scene.updateMatrixWorld(true);
      const bone = gltf.nodeByIndex[humanNode(skeleton, `${side}Foot`)];
      const p = bone?.getWorldPosition(new Vector3()) ?? new Vector3();
      expect(dist(quatRotateVec3(skeleton.facing as Quat, [p.x, p.y, p.z]), ankle)).toBeLessThan(1e-5);

      const vertices = await footVertices(name, skeleton, side);
      expect(vertices.length).toBeGreaterThan(10);
      const f: Vec3 = [Math.sin(foot.yaw), 0, Math.cos(foot.yaw)];
      const along = vertices.map((v) => (v[0] - ankle[0]) * f[0] + (v[2] - ankle[2]) * f[2]);
      const rear = Math.min(...along);
      const front = Math.max(...along);
      // In the IK control's rest frame the ground lies below the ankle, so heel·f = −heelBack, toe·f = ballFront + toeFront.
      expect([name, limb, 'heel', Math.abs(-foot.heelBack - rear) <= 0.003]).toEqual([name, limb, 'heel', true]);
      expect([name, limb, 'toe', Math.abs(foot.ballFront + foot.toeFront - front) <= 0.003]).toEqual([
        name,
        limb,
        'toe',
        true,
      ]);
      // The ground is the lowest foot vertex (below the ankle).
      const lowest = Math.min(...vertices.map((v) => v[1]));
      expect(foot.ground[1]).toBeCloseTo(lowest - ankle[1], 5);
      expect(foot.innerWidth).toBeGreaterThan(0.01);
      expect(foot.outerWidth).toBeGreaterThan(0.01);
      expect(foot.breakAngle).toBeCloseTo(Math.PI / 6, 12);
      expect(foot.side).toBe(limb === 'leg.L' ? 1 : -1);
    }
  });

  it.each(FIXTURES)('falls back to the bone guesses without mesh data on %s', async (name) => {
    const { boneSupport: _support, ...rest } = await loadSkeleton(name);
    const skeleton: SkeletonDesc = rest;
    const program = ikProgram(skeleton, { legs: true, arms: false });
    for (const limb of ['leg.L', 'leg.R'] as const) {
      const foot = limbOf(program, limb).params.foot;
      if (foot === null) throw new Error('no foot');
      // heelBack = r_f, toeFront = 1.2·r_f, innerWidth = outerWidth = r_f.
      expect(foot.toeFront).toBeCloseTo(1.2 * foot.heelBack, 12);
      expect(foot.innerWidth).toBeCloseTo(foot.heelBack, 12);
      expect(foot.outerWidth).toBeCloseTo(foot.heelBack, 12);
      expect(foot.heelBack).toBeGreaterThan(0.01);
    }
  });
});

describe('foot roll on Seed-san (§5.3.1 gates, E2E-M2A-04 numbers)', { timeout: 60_000 }, () => {
  type Pivots = NonNullable<ReturnType<typeof footPivotWorlds>>;
  const at = (program: RigProgram, values: Readonly<Record<string, ChannelValues>>, limb: LimbId) => {
    const ch = channelsOf(program, values);
    const pose = evaluate(program, ch);
    const pivots = footPivotWorlds(program, pose, ch, limb) as Pivots;
    return { pose, pivots };
  };

  it('rolls about heel, ball and toe tip and banks about the edge chosen by the sign of bank, on both feet', async () => {
    const skeleton = await loadSkeleton('seed-san.vrm');
    const program = ikProgram(skeleton);
    const foot = humanNode(skeleton, 'leftFoot');
    const toes = humanNode(skeleton, 'leftToes');
    const zero = at(program, {}, 'leg.L');
    const roll20 = at(program, { 'ik.leg.L': { '@roll': 20 * DEG } }, 'leg.L');
    expect(dist(pos(roll20.pose, toes), pos(zero.pose, toes))).toBeLessThan(1e-6);
    expect(quatAngle(rot(roll20.pose, toes), rot(zero.pose, toes))).toBeLessThan(1e-6);
    expect(dist(vec(roll20.pivots.ball), vec(zero.pivots.ball))).toBeLessThan(1e-6);
    expect(Math.abs(quatAngle(rot(roll20.pose, foot), rot(zero.pose, foot)) - 20 * DEG)).toBeLessThan(1e-6);
    const roll15 = at(program, { 'ik.leg.L': { '@roll': -15 * DEG } }, 'leg.L');
    expect(dist(vec(roll15.pivots.heel), vec(zero.pivots.heel))).toBeLessThan(1e-6);
    const roll50 = at(program, { 'ik.leg.L': { '@roll': 50 * DEG } }, 'leg.L');
    expect(dist(vec(roll50.pivots.toe), vec(zero.pivots.toe))).toBeLessThan(1e-6);
    expect(Math.abs(quatAngle(rot(roll50.pose, toes), rot(zero.pose, toes)) - 20 * DEG)).toBeLessThan(1e-6);

    const bankUp = at(program, { 'ik.leg.L': { '@bank': 10 * DEG } }, 'leg.L');
    expect(dist(vec(bankUp.pivots.inner), vec(zero.pivots.inner))).toBeLessThan(1e-6);
    expect(vec(bankUp.pivots.outer)[1]).toBeGreaterThan(vec(zero.pivots.outer)[1] + 1e-3);
    const bankDown = at(program, { 'ik.leg.L': { '@bank': -10 * DEG } }, 'leg.L');
    expect(dist(vec(bankDown.pivots.outer), vec(zero.pivots.outer))).toBeLessThan(1e-6);
    expect(vec(bankDown.pivots.inner)[1]).toBeGreaterThan(vec(zero.pivots.inner)[1] + 1e-3);

    const zeroR = at(program, {}, 'leg.R').pivots;
    const bankR = at(program, { 'ik.leg.R': { '@bank': 10 * DEG } }, 'leg.R').pivots;
    expect(dist(vec(bankR.inner), vec(zeroR.inner))).toBeLessThan(1e-6);
    expect(vec(bankR.outer)[1]).toBeGreaterThan(vec(zeroR.outer)[1] + 1e-3);
    for (const key of ['heel', 'ball', 'toe', 'inner', 'outer'] as const) {
      expect(vec(bankR[key])[1]).toBeGreaterThan(vec(zeroR[key])[1] - 1e-6);
    }
  });

  it('mirrors a left bank and roll onto the right foot (pivots mirrored within 1e-3 m)', async () => {
    const skeleton = await loadSkeleton('seed-san.vrm');
    const program = ikProgram(skeleton);
    const left = new Map<ControlId, ChannelValues>([
      [controlId(program, 'ik.leg.L'), { '@bank': 10 * DEG, '@roll': 20 * DEG }],
    ]);
    const mirrored = mirrorPose(program, left, 'leftToRight', null);
    const values: Record<string, ChannelValues> = { 'ik.leg.L': { '@bank': 10 * DEG, '@roll': 20 * DEG } };
    const right = mirrored.values.get(controlId(program, 'ik.leg.R'));
    expect(right?.['@bank']).toBeCloseTo(10 * DEG, 12);
    expect(right?.['@roll']).toBeCloseTo(20 * DEG, 12);
    values['ik.leg.R'] = right ?? {};
    const l = at(program, values, 'leg.L').pivots;
    const r = at(program, values, 'leg.R').pivots;
    for (const key of ['heel', 'ball', 'toe', 'inner', 'outer'] as const) {
      const a = vec(l[key]);
      expect([key, dist(vec(r[key]), [-a[0], a[1], a[2]]) < 1e-3]).toEqual([key, true]);
    }
  });
});

/** Euler channels of a rotation about `axis` (canonical) by `angle`, for a world-aligned rest control. */
function aboutAxis(axis: readonly number[], angle: number, order: RotateOrder): ChannelValues {
  const e = quatToEuler(quatFromAxisAngle([axis[0] as number, axis[1] as number, axis[2] as number], angle), order);
  return { rx: e[0], ry: e[1], rz: e[2] };
}

function orderOf(program: RigProgram, control: ControlId): RotateOrder {
  return program.controls.find((c) => c.id === control)?.rotateOrder ?? 'xyz';
}

/** The rest bend of a limb about its hinge: atan2(h·(u × v), u·v). */
function restBend(program: RigProgram, desc: LimbDesc): number {
  const rest = evaluate(program, channelsOf(program, {}, {}));
  const a = pos(rest, desc.nodes.upper);
  const b = pos(rest, desc.nodes.mid);
  const c = pos(rest, desc.nodes.end);
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const h = desc.params.hinge;
  const x: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return Math.atan2(h[0] * x[0] + h[1] * x[1] + h[2] * x[2], u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
}

function hingeValues(
  program: RigProgram,
  desc: LimbDesc,
  bend: number,
  next: () => number,
): Map<ControlId, ChannelValues> {
  const p = desc.params;
  return new Map<ControlId, ChannelValues>([
    [p.fk.upper, { rx: next() * 1.2, ry: next() * 1.2, rz: next() * 1.2 }],
    [p.fk.mid, aboutAxis(p.hinge, bend - restBend(program, desc), orderOf(program, p.fk.mid))],
    [p.fk.end, { rx: next(), ry: next(), rz: next() }],
    [controlId(program, 'cog'), { tx: next() * 0.1, ty: next() * 0.1, ry: next() }],
  ]);
}

function channelsFrom(program: RigProgram, values: ReadonlyMap<ControlId, ChannelValues>, ikFk: number): ChannelBuffer {
  const ch = program.allocChannels();
  for (const limb of program.limbs) writeAttr(program, ch, limb.params.ikControl, 'ikFk', ikFk);
  for (const [control, v] of values) writeControlChannels(program, ch, control, v);
  return ch;
}

describe('IK/FK matching on the fixtures (§5.6 gates)', { timeout: 60_000 }, () => {
  it.each(FIXTURES)('FK → IK → FK leaves the chain bones unchanged (1e-6) for hinge poses on %s', async (name) => {
    const skeleton = await loadSkeleton(name);
    const program = ikProgram(skeleton);
    let state = 23;
    const next = (): number => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647 - 0.5;
    };
    for (const limb of LIMBS) {
      const desc = limbOf(program, limb);
      const nodes = [desc.nodes.upper, desc.nodes.mid, desc.nodes.end];
      for (let trial = 0; trial < 6; trial++) {
        const values = hingeValues(program, desc, (5 + (next() + 0.5) * 100) * DEG, next);
        const fkCh = channelsFrom(program, values, 0);
        const fkPose = evaluate(program, fkCh);
        const ik = matchIkToFk(program, fkPose, fkCh, limb, new Map());
        expect([limb, trial, ik.endErrorM < 1e-6, ik.midErrorM < 1e-6, ik.maxRotationErrorRad < 1e-6]).toEqual([
          limb,
          trial,
          true,
          true,
          true,
        ]);
        const ikCh = channelsFrom(program, values, 1);
        for (const [control, v] of ik.values) writeControlChannels(program, ikCh, control, v);
        const ikPose = evaluate(program, ikCh);
        const fk = matchFkToIk(program, ikPose, limb, values);
        const backCh = channelsFrom(program, values, 0);
        for (const [control, v] of fk) writeControlChannels(program, backCh, control, v);
        const back = evaluate(program, backCh);
        for (const node of nodes) {
          expect(dist(pos(ikPose, node), pos(fkPose, node))).toBeLessThan(1e-6);
          expect(quatAngle(rot(ikPose, node), rot(fkPose, node))).toBeLessThan(1e-6);
          expect(dist(pos(back, node), pos(fkPose, node))).toBeLessThan(1e-6);
          expect(quatAngle(rot(back, node), rot(fkPose, node))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it.each([
    ['leg.L', -2],
    ['leg.L', -5],
    ['leg.R', -2],
    ['leg.R', -5],
    ['arm.L', -5],
  ] as const)('Seed-san %s hyperextended by %i°: end equal, no flip, mid error reported', async (limb, degrees) => {
    const skeleton = await loadSkeleton('seed-san.vrm');
    const program = ikProgram(skeleton);
    const desc = limbOf(program, limb);
    const theta = degrees * DEG;
    let state = 5;
    const next = (): number => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647 - 0.5;
    };
    const values = hingeValues(program, desc, theta, next);
    const fkCh = channelsFrom(program, values, 0);
    const fkPose = evaluate(program, fkCh);
    const result = matchIkToFk(program, fkPose, fkCh, limb, new Map());
    expect(result.endErrorM).toBeLessThan(1e-6);
    expect(result.midErrorM).toBeGreaterThan(1e-4);
    expect(result.maxRotationErrorRad).toBeLessThan(2 * Math.abs(theta) + 1e-3);
    const ikCh = channelsFrom(program, values, 1);
    for (const [control, v] of result.values) writeControlChannels(program, ikCh, control, v);
    const ikPose = evaluate(program, ikCh);
    expect(dist(pos(ikPose, desc.nodes.end), pos(fkPose, desc.nodes.end))).toBeLessThan(1e-6);
    expect(quatAngle(rot(ikPose, desc.nodes.end), rot(fkPose, desc.nodes.end))).toBeLessThan(1e-6);
    for (const node of [desc.nodes.upper, desc.nodes.mid]) {
      expect(quatAngle(rot(ikPose, node), rot(fkPose, node))).toBeLessThan(2 * Math.abs(theta) + 1e-3);
    }
  });
});

describe('Plant Feet on IK legs (§5.8, US-25 numbers)', { timeout: 60_000 }, () => {
  it.each(FIXTURES)('returns the IK feet to their pins (1e-4) on %s', async (name) => {
    const skeleton = await loadSkeleton(name);
    const program = ikProgram(skeleton, { legs: true, arms: false });
    const start = channelsOf(program, {}, {});
    const startPose = evaluate(program, start);
    const footNode = (side: 'L' | 'R'): number => humanNode(skeleton, side === 'L' ? 'leftFoot' : 'rightFoot');
    const pins = (['L', 'R'] as const).map((side) => ({
      side,
      footWorld: startPose.boneWorld.slice(footNode(side) * 16, footNode(side) * 16 + 16),
    }));
    // US-25: cog ty −0.05 (the IK feet hold by themselves), then the left IK foot was dragged and rolled.
    const ch = channelsOf(program, { cog: { ty: -0.05 }, 'ik.leg.L': { tz: 0.08, ty: 0.02, '@roll': 15 * DEG } }, {});
    const pose = evaluate(program, ch);
    expect(dist(pos(pose, footNode('R')), pos(startPose, footNode('R')))).toBeLessThan(1e-6);
    expect(dist(pos(pose, footNode('L')), pos(startPose, footNode('L')))).toBeGreaterThan(0.01);
    const reference = new Map(program.controlIds.map((c) => [c, readControlChannels(program, ch, c)] as const));
    const result = plantFeetChannels(program, pose, pins, reference, ch);
    expect(result.reached).toBe(true);
    expect(result.warnings).toEqual([]);
    expect([...result.values.keys()].sort()).toEqual(
      [controlId(program, 'ik.leg.L'), controlId(program, 'ik.leg.R')].sort(),
    );
    for (const [control, v] of result.values) writeControlChannels(program, ch, control, v);
    const planted = evaluate(program, ch);
    for (const pin of pins) {
      const node = footNode(pin.side);
      const target = mat4Decompose(pin.footWorld);
      expect(dist(pos(planted, node), target.t)).toBeLessThan(1e-4);
      expect(quatAngle(rot(planted, node), target.q)).toBeLessThan(1e-4);
    }
  });
});

describe('rig bench with IK (report, M2A-SPEC §5.4 rule 5)', { timeout: 60_000 }, () => {
  it('reports the evaluation time of Seed-san with four IK limbs (target ≤ 0.06 ms, pose budget 0.5 ms)', async ({
    annotate,
  }) => {
    const skeleton = await loadSkeleton('seed-san.vrm');
    // Report only (timings under a parallel test run are noisy): interleaved rounds, the best round per program.
    const ik = ikProgram(skeleton);
    const ikCh = channelsOf(ik, { cog: { ty: -0.05 }, 'ik.leg.L': { '@roll': 20 * DEG }, 'ik.arm.L': { tz: 0.05 } });
    const fkCh = channelsOf(ik, {}, { 'leg.L': 0, 'leg.R': 0, 'arm.L': 0, 'arm.R': 0 });
    const m1 = compileRig(autoRig(skeleton, IDS), skeleton);
    const cases = [
      { program: ik, ch: ikCh, pose: ik.allocPose(), best: Number.POSITIVE_INFINITY },
      { program: ik, ch: fkCh, pose: ik.allocPose(), best: Number.POSITIVE_INFINITY },
      { program: m1, ch: m1.allocChannels(), pose: m1.allocPose(), best: Number.POSITIVE_INFINITY },
    ];
    const runs = 400;
    for (let round = 0; round < 8; round++) {
      for (const c of cases) {
        const startedAt = performance.now();
        for (let i = 0; i < runs; i++) c.program.evaluate(c.ch, c.pose);
        c.best = Math.min(c.best, (performance.now() - startedAt) / runs);
      }
    }
    const [withIk, atZero, m1Case] = cases.map((c) => c.best) as [number, number, number];
    await annotate(
      `Seed-san evaluate (best of 8 rounds): four IK limbs ${withIk.toFixed(4)} ms, the same rig at ikFk 0 ${atZero.toFixed(4)} ms, M1 rig ${m1Case.toFixed(4)} ms (target ≤ 0.06 ms; pose budget 0.5 ms)`,
    );
    expect(cases.every((c) => c.pose.version === 8 * runs)).toBe(true);
  });
});
