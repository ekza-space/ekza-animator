// A1 import gates (M2A-SPEC §5.8, §8 A1 tests) on the fixtures: a humanoid clip baked from Seed-san with IK legs
// comes back through the IK legs (≤ 1e-5 rad / 1e-6 m at key times); E2E-M2A-06's clip (a clean left knee and a 5°
// hyperextended right knee) imports onto Polybot with the left leg IK and the right leg FK, matching an FK-only
// Polybot; UAL `Walk_Loop` (on UAL's own skeleton with a humanoid map) keeps each leg IK within the tolerance or
// falls back with the reported errors, and the pole curves move continuously.
import { curveEngine, type Fps, mat4Decompose, type Quat, quatAngle, type Vec3 } from '@ekza-animator/anim-core';
import type { ChannelValues, HumanBoneName, TrsChannel } from '@ekza-animator/doc';
import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import { parseGlb, readAnimations, skeletonFromGltf } from '@ekza-animator/io';
import {
  autoRig,
  CHANNELS_PER_CONTROL,
  type ChannelBuffer,
  compileRig,
  detectClipFps,
  HUMAN_BONE_NAMES,
  type HumanoidClipData,
  type ImportedClipKeys,
  importHumanoidClip,
  importRawClip,
  type PoseBuffers,
  type RigProgram,
  registerBuiltinRigOps,
  type SkeletonDesc,
  writeAttr,
  writeControlChannels,
} from '@ekza-animator/rig';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const IDS = { character: 'chr_IkImportGates001' as never, rig: 'rig_IkImportGates001' as never };
const DEG = Math.PI / 180;
const FPS30: Fps = { num: 30, den: 1 };
const SLOTS: readonly TrsChannel[] = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];
const LEGS_IK = { legs: true, arms: false } as const;

let dispose: () => void = () => undefined;
beforeAll(() => {
  dispose = registerBuiltinRigOps();
});
afterAll(() => dispose());

async function loadSkeleton(name: LicensedFixture): Promise<SkeletonDesc> {
  return skeletonFromGltf(await parseGlb(readFixture(name)));
}

function controlIdOf(program: RigProgram, key: string) {
  const control = program.controls.find((c) => c.key === key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

function humanNode(skeleton: SkeletonDesc, bone: string): number {
  const node = (skeleton.humanoid as Record<string, number | undefined> | null)?.[bone];
  if (node === undefined) throw new Error(`no ${bone}`);
  return node;
}

/** Channels: the limbs' ikFk (when given), then template-key values. */
function channelsOf(
  program: RigProgram,
  values: Readonly<Record<string, ChannelValues>>,
  ikFk: number | null,
): ChannelBuffer {
  const ch = program.allocChannels();
  if (ikFk !== null) for (const limb of program.limbs) writeAttr(program, ch, limb.params.ikControl, 'ikFk', ikFk);
  for (const [key, v] of Object.entries(values)) writeControlChannels(program, ch, controlIdOf(program, key), v);
  return ch;
}

function evaluate(program: RigProgram, ch: ChannelBuffer): PoseBuffers {
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  return pose;
}

/** Channels of an imported clip at `frame` (the AnimX engine; attributes through writeAttr). */
function clipChannels(program: RigProgram, clip: ImportedClipKeys, frame: number): ChannelBuffer {
  const ch = program.allocChannels();
  for (const curve of clip.curves) {
    const value = curveEngine.evaluate(
      curveEngine.compile({ keys: curve.keys, weighted: false, pre: 'constant', post: 'constant' }),
      frame,
    );
    if (curve.channel.startsWith('@')) {
      writeAttr(program, ch, curve.control, curve.channel.slice(1), value);
      continue;
    }
    const slot = program.controlIndex.get(curve.control) as number;
    ch.values[slot * CHANNELS_PER_CONTROL + SLOTS.indexOf(curve.channel as TrsChannel)] = value;
  }
  return ch;
}

/** Normalized humanoid data (N_b of every present bone and the hips position) of poses at frames 0, 1, …. */
function bakeHumanoid(program: RigProgram, poses: readonly PoseBuffers[], name: string): HumanoidClipData {
  const skeleton = program.skeleton;
  const present = HUMAN_BONE_NAMES.filter(
    (bone) => skeleton.humanoid?.[bone] !== undefined && bone !== 'leftEye' && bone !== 'rightEye',
  );
  const times = Float32Array.from(poses.map((_, f) => f / 30));
  const rotations: Partial<Record<HumanBoneName, { times: Float32Array; values: Float32Array }>> = {};
  for (const bone of present) {
    const h = HUMAN_BONE_NAMES.indexOf(bone);
    const values = new Float32Array(poses.length * 4);
    poses.forEach((pose, f) => {
      for (let c = 0; c < 4; c++) values[f * 4 + c] = pose.humanLocal[h * 4 + c] as number;
    });
    rotations[bone] = { times, values };
  }
  const hips = new Float32Array(poses.length * 3);
  poses.forEach((pose, f) => {
    for (let c = 0; c < 3; c++) hips[f * 3 + c] = pose.hipsPosition[c] as number;
  });
  const rest = evaluate(program, program.allocChannels()).hipsPosition;
  return {
    name,
    duration: (poses.length - 1) / 30,
    presentBones: present,
    rotations,
    hips: { times, values: hips },
    restHipsPosition: [rest[0] as number, rest[1] as number, rest[2] as number],
    interpolation: {},
  };
}

const pos = (pose: PoseBuffers, node: number): Vec3 => [
  pose.boneWorld[node * 16 + 12] as number,
  pose.boneWorld[node * 16 + 13] as number,
  pose.boneWorld[node * 16 + 14] as number,
];
const rot = (pose: PoseBuffers, node: number): Quat => mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16)).q;
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  );
const options = {
  fps: FPS30,
  keyMode: 'source-times' as const,
  eulerFilter: true,
  reduce: null,
  hipsScale: 'auto' as const,
};

describe('import to IK on the fixtures (M2A-SPEC §5.8)', { timeout: 120_000 }, () => {
  it('reproduces a humanoid clip baked from Seed-san through its IK legs (≤ 1e-5 rad / 1e-6 m at key times)', async () => {
    const skeleton = await loadSkeleton('seed-san.vrm');
    const program = compileRig(autoRig(skeleton, IDS, { ik: LEGS_IK }), skeleton);
    let state = 31;
    const next = (): number => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647 - 0.5;
    };
    const poses: PoseBuffers[] = [];
    for (let f = 0; f < 12; f++) {
      const ch = channelsOf(
        program,
        {
          cog: { tx: next() * 0.06, ty: -0.05 + next() * 0.04, tz: next() * 0.06, ry: next() * 0.4 },
          'fk.spine': { rx: next() * 0.3, rz: next() * 0.2 },
          'ik.leg.L': {
            tx: next() * 0.08,
            ty: 0.04 + next() * 0.06,
            tz: next() * 0.2,
            rx: next() * 0.4,
            ry: next() * 0.4,
          },
          'ik.leg.R': { tx: next() * 0.08, ty: 0.04 + next() * 0.06, tz: next() * 0.2, rz: next() * 0.3 },
          'fk.toes.L': { rx: next() * 0.5 },
          'fk.upperArm.L': { rx: next(), rz: next() },
          'fk.lowerArm.R': { ry: next() },
        },
        null,
      );
      poses.push(evaluate(program, ch));
    }
    const imported = importHumanoidClip(bakeHumanoid(program, poses, 'baked'), program, options);
    expect(imported.limbs?.map((row) => [row.limb, row.mode])).toEqual([
      ['leg.L', 'ik'],
      ['leg.R', 'ik'],
    ]);
    const controls = new Set(imported.curves.map((c) => c.control));
    for (const key of ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L', 'fk.upperLeg.R', 'fk.lowerLeg.R', 'fk.foot.R']) {
      expect([key, controls.has(controlIdOf(program, key))]).toEqual([key, false]);
    }
    for (const key of ['ik.leg.L', 'pole.leg.L', 'ik.leg.R', 'pole.leg.R', 'fk.toes.L']) {
      expect([key, controls.has(controlIdOf(program, key))]).toEqual([key, true]);
    }
    let rotation = 0;
    let position = 0;
    poses.forEach((expected, frame) => {
      const pose = evaluate(program, clipChannels(program, imported, frame));
      for (let node = 0; node < program.nodeCount; node++) {
        rotation = Math.max(rotation, quatAngle(rot(pose, node), rot(expected, node)));
        position = Math.max(position, dist(pos(pose, node), pos(expected, node)));
      }
    });
    expect(rotation).toBeLessThan(1e-5);
    expect(position).toBeLessThan(1e-6);
  });

  it('imports E2E-M2A-06’s steps clip onto Polybot: left leg IK, right leg kept FK, matching an FK-only Polybot', async () => {
    const seed = await loadSkeleton('seed-san.vrm');
    const source = compileRig(autoRig(seed, IDS, { ik: LEGS_IK }), seed);
    // Keys at 0/10/20 (linear in between): fk.upperLeg.L rx 30/−20/30, fk.lowerLeg.L rx 0/40/0; the right leg at
    // rx 10 with a 5° hyperextended knee. The source legs are FK (ikFk 0 in that clip).
    const poses: PoseBuffers[] = [];
    for (let f = 0; f <= 20; f++) {
      const t = f <= 10 ? f / 10 : (20 - f) / 10;
      const ch = channelsOf(
        source,
        {
          'fk.upperLeg.L': { rx: (30 - 50 * t) * DEG },
          'fk.lowerLeg.L': { rx: 40 * t * DEG },
          'fk.upperLeg.R': { rx: 10 * DEG },
          'fk.lowerLeg.R': { rx: -5 * DEG },
        },
        0,
      );
      poses.push(evaluate(source, ch));
    }
    const data = bakeHumanoid(source, poses, 'steps');
    const polybot = await loadSkeleton('polybot.vrm');
    const ik = compileRig(autoRig(polybot, IDS, { ik: LEGS_IK }), polybot);
    const fk = compileRig(autoRig(polybot, IDS), polybot);
    const withIk = importHumanoidClip(data, ik, options);
    const fkOnly = importHumanoidClip(data, fk, options);
    expect(fkOnly.limbs).toBeUndefined();
    const rows = new Map((withIk.limbs ?? []).map((row) => [row.limb, row]));
    expect(rows.get('leg.L')?.mode).toBe('ik');
    expect(rows.get('leg.R')?.mode).toBe('fk');
    expect(withIk.warnings.some((w) => w.startsWith("R Leg kept FK in 'steps'"))).toBe(true);
    const curvesOf = (key: string) => withIk.curves.filter((c) => c.control === controlIdOf(ik, key));
    expect(curvesOf('ik.leg.L').map((c) => c.channel)).toContain('tx');
    expect(
      curvesOf('pole.leg.L')
        .map((c) => c.channel)
        .sort(),
    ).toEqual(['tx', 'ty', 'tz']);
    for (const key of ['fk.upperLeg.L', 'fk.lowerLeg.L', 'fk.foot.L']) expect(curvesOf(key)).toEqual([]);
    expect(curvesOf('fk.upperLeg.R').length).toBeGreaterThan(0);
    expect(curvesOf('fk.lowerLeg.R').length).toBeGreaterThan(0);
    expect(curvesOf('ik.leg.R').map((c) => [c.channel, c.keys.map((k) => [k.t, k.v, k.outType])])).toEqual([
      ['@ikFk', [[0, 0, 'step']]],
    ]);

    // Hips-relative foot and knee positions and foot rotations agree with the FK-only Polybot.
    const hips = humanNode(polybot, 'hips');
    const relative = (pose: PoseBuffers, node: number): Vec3 => {
      const p = pos(pose, node);
      const h = pos(pose, hips);
      return [p[0] - h[0], p[1] - h[1], p[2] - h[2]];
    };
    for (const frame of [0, 5, 10, 15, 20]) {
      const a = evaluate(ik, clipChannels(ik, withIk, frame));
      const b = evaluate(fk, clipChannels(fk, fkOnly, frame));
      for (const bone of ['leftFoot', 'leftLowerLeg', 'rightFoot', 'rightLowerLeg']) {
        const node = humanNode(polybot, bone);
        expect([frame, bone, dist(relative(a, node), relative(b, node)) < 1e-4]).toEqual([frame, bone, true]);
      }
      for (const bone of ['leftFoot', 'rightFoot', 'rightUpperLeg', 'rightLowerLeg']) {
        const node = humanNode(polybot, bone);
        expect([frame, bone, quatAngle(rot(a, node), rot(b, node)) < 1e-3]).toEqual([frame, bone, true]);
      }
    }
  });

  it('imports UAL Walk_Loop with IK legs: IK within the tolerance or FK with the errors; continuous poles', async ({
    annotate,
  }) => {
    const container = await parseGlb(readFixture('quaternius-ual.glb'));
    const raw = skeletonFromGltf(container);
    const byName = (name: string): number => {
      const index = raw.nodes.findIndex((node) => node.name === name);
      if (index < 0) throw new Error(`no ${name}`);
      return index;
    };
    // UAL is a Rigify-style generic rig: give it a humanoid map so the rig gets IK legs.
    const map: Partial<Record<HumanBoneName, number>> = {
      hips: byName('DEF-hips'),
      spine: byName('DEF-spine.001'),
      chest: byName('DEF-spine.002'),
      upperChest: byName('DEF-spine.003'),
      neck: byName('DEF-neck'),
      head: byName('DEF-head'),
    };
    for (const [side, s] of [
      ['left', 'L'],
      ['right', 'R'],
    ] as const) {
      Object.assign(map, {
        [`${side}Shoulder`]: byName(`DEF-shoulder.${s}`),
        [`${side}UpperArm`]: byName(`DEF-upper_arm.${s}`),
        [`${side}LowerArm`]: byName(`DEF-forearm.${s}`),
        [`${side}Hand`]: byName(`DEF-hand.${s}`),
        [`${side}UpperLeg`]: byName(`DEF-thigh.${s}`),
        [`${side}LowerLeg`]: byName(`DEF-shin.${s}`),
        [`${side}Foot`]: byName(`DEF-foot.${s}`),
        [`${side}Toes`]: byName(`DEF-toe.${s}`),
      });
    }
    const skeleton: SkeletonDesc = { ...raw, humanoid: map };
    const program = compileRig(autoRig(skeleton, IDS, { ik: LEGS_IK }), skeleton);
    expect(program.limbs.map((l) => l.id).sort()).toEqual(['leg.L', 'leg.R']);
    const clip = readAnimations(container, skeleton).find((c) => c.name === 'Walk_Loop');
    if (clip === undefined) throw new Error('Walk_Loop missing');
    const fps = detectClipFps(clip) ?? { num: 24, den: 1 };
    const rawOptions = { fps, keyMode: 'source-times' as const, eulerFilter: true, reduce: null };
    const imported = importRawClip(clip, program, rawOptions);
    const fkOnly = importRawClip(clip, program, { ...rawOptions, ik: 'none' });
    const rows = imported.limbs ?? [];
    expect(rows.map((row) => row.limb)).toEqual(['leg.L', 'leg.R']);
    const tolerance = { rotationRad: 2 * DEG, positionM: 0.002 };
    const frames = [...new Set(fkOnly.curves.flatMap((c) => c.keys.map((k) => k.t)))].sort((a, b) => a - b);
    expect(frames.length).toBeGreaterThan(10);
    const curvesOf = (control: string) => imported.curves.filter((c) => c.control === control);
    const descOf = (limb: string) => {
      const desc = program.limbs.find((l) => l.id === limb);
      if (desc === undefined) throw new Error(limb);
      return desc;
    };
    for (const row of rows.filter((r) => r.mode === 'fk')) {
      // Kept FK: over the tolerance, FK chain curves, one stepped @ikFk 0 key and a warning naming the clip.
      const p = descOf(row.limb).params;
      expect(row.maxRotationErrorRad > tolerance.rotationRad || row.maxMidErrorM > tolerance.positionM).toBe(true);
      expect(curvesOf(p.fk.mid).length).toBeGreaterThan(0);
      expect(curvesOf(p.ikControl).map((c) => c.channel)).toEqual(['@ikFk']);
      expect(imported.warnings.some((w) => w.includes("kept FK in 'Walk_Loop'"))).toBe(true);
    }
    for (const row of rows.filter((r) => r.mode === 'ik')) {
      const desc = descOf(row.limb);
      const p = desc.params;
      expect(row.maxRotationErrorRad).toBeLessThanOrEqual(tolerance.rotationRad);
      expect(row.maxMidErrorM).toBeLessThanOrEqual(tolerance.positionM);
      expect(curvesOf(p.fk.mid)).toEqual([]);
      // At the key times the IK leg matches the FK import within the reported errors; the foot lands exactly.
      for (const frame of frames) {
        const a = evaluate(program, clipChannels(program, imported, frame));
        // The FK import on the same rig: every leg at ikFk 0 (the rig's default is IK).
        const fkCh = clipChannels(program, fkOnly, frame);
        for (const limb of program.limbs) writeAttr(program, fkCh, limb.params.ikControl, 'ikFk', 0);
        const b = evaluate(program, fkCh);
        expect(dist(pos(a, desc.nodes.end), pos(b, desc.nodes.end))).toBeLessThan(1e-5);
        expect(quatAngle(rot(a, desc.nodes.end), rot(b, desc.nodes.end))).toBeLessThan(1e-4);
        expect(dist(pos(a, desc.nodes.mid), pos(b, desc.nodes.mid))).toBeLessThan(row.maxMidErrorM + 1e-5);
      }
      // Pole continuity: per frame, the pole's direction from the knee turns by no more than the thigh and shin do
      // (plus 0.05 rad): it follows the leg and never swings across it. (The absolute 0.05·L per frame of §8 A1 does
      // not hold for a 24 fps walk: a pole L in front of the knee travels with the leg's swing, A1 notes.)
      const angle = (u: Vec3, v: Vec3): number => {
        const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
        return Math.acos(Math.min(1, Math.max(-1, c)));
      };
      const sub3 = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
      const reach = desc.lengths.upper + desc.lengths.lower;
      const slot = program.controlIndex.get(p.pole) as number;
      const sample = (frame: number) => {
        const pose = evaluate(program, clipChannels(program, imported, frame));
        const pole: Vec3 = [
          pose.controlWorld[slot * 16 + 12] as number,
          pose.controlWorld[slot * 16 + 13] as number,
          pose.controlWorld[slot * 16 + 14] as number,
        ];
        const a = pos(pose, desc.nodes.upper);
        const b = pos(pose, desc.nodes.mid);
        const c = pos(pose, desc.nodes.end);
        return { pole, poleDir: sub3(pole, b), thigh: sub3(b, a), shin: sub3(c, b) };
      };
      let worstExcess = Number.NEGATIVE_INFINITY;
      let worstMove = 0;
      let previous = sample(imported.range.start);
      for (let frame = imported.range.start + 1; frame <= imported.range.end; frame++) {
        const current = sample(frame);
        const turn = angle(current.poleDir, previous.poleDir);
        const legTurn = angle(current.thigh, previous.thigh) + angle(current.shin, previous.shin);
        worstExcess = Math.max(worstExcess, turn - legTurn);
        worstMove = Math.max(worstMove, dist(current.pole, previous.pole));
        previous = current;
      }
      expect([row.limb, worstExcess < 0.05]).toEqual([row.limb, true]);
      await annotate(
        `${row.limb}: max pole travel ${(worstMove / reach).toFixed(3)}·L per frame; pole turn beyond the leg's ${worstExcess.toFixed(4)} rad`,
      );
    }
  });
});
