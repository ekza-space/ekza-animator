// A1 (M2A-SPEC §5.8): clip import writes IK controls for limbs whose ikFk default is ≥ 0.5 (the match pole rule at
// every key time), with the fidelity check and the per-limb FK fallback (one stepped @ikFk 0 key, a warning and
// `ImportedClipKeys.limbs`); `ik: 'none'` keeps M1; pole curves move continuously.
import { type Fps, quatAngle, quatFromAxisAngle, quatToEuler, type Vec3 } from '@ekza-animator/anim-core';
import type { ChannelValues, ControlId, TrsChannel } from '@ekza-animator/doc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CHANNELS_PER_CONTROL,
  type ChannelBuffer,
  type ImportedClipKeys,
  importHumanoidClip,
  importRawClip,
  type PoseBuffers,
  type RigProgram,
  registerBuiltinRigOps,
  writeAttr,
  writeControlChannels,
} from '../src';
import { richHumanoid } from './helpers';
import { bakeHumanoid, bakeRaw, keyValueAt } from './import-helpers';
import { bonePos, boneQuat, channels, DEG, distance, id, ikRig, random } from './limb-helpers';

let dispose: () => void = () => undefined;
beforeAll(() => {
  dispose = registerBuiltinRigOps();
});
afterAll(() => dispose());

const FPS30: Fps = { num: 30, den: 1 };
const SLOTS: readonly TrsChannel[] = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];
const opts = (extra: Partial<Parameters<typeof importRawClip>[2]> = {}) => ({
  fps: FPS30,
  keyMode: 'source-times' as const,
  eulerFilter: true,
  reduce: null,
  ...extra,
});

/** Channels of an imported clip at `frame`: TRS curves and attribute curves (controls without curves at defaults). */
function clipChannels(program: RigProgram, clip: ImportedClipKeys, frame: number): ChannelBuffer {
  const ch = program.allocChannels();
  for (const curve of clip.curves) {
    const value = keyValueAt(curve.keys, frame);
    if (curve.channel.startsWith('@')) {
      writeAttr(program, ch, curve.control, curve.channel.slice(1), value);
      continue;
    }
    const slot = program.controlIndex.get(curve.control) as number;
    ch.values[slot * CHANNELS_PER_CONTROL + SLOTS.indexOf(curve.channel as TrsChannel)] = value;
  }
  return ch;
}

function evaluate(program: RigProgram, ch: ChannelBuffer): PoseBuffers {
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  return pose;
}

/** Largest world position and rotation difference of every bone. */
function worldError(program: RigProgram, a: PoseBuffers, b: PoseBuffers): { position: number; rotation: number } {
  let position = 0;
  let rotation = 0;
  for (let node = 0; node < program.nodeCount; node++) {
    position = Math.max(position, distance(bonePos(a, node), bonePos(b, node)));
    rotation = Math.max(rotation, quatAngle(boneQuat(a, node), boneQuat(b, node)));
  }
  return { position, rotation };
}

function controlsWithCurves(clip: ImportedClipKeys): Set<string> {
  return new Set(clip.curves.map((c) => c.control));
}

function channelsOf(clip: ImportedClipKeys, control: ControlId): string[] {
  return clip.curves
    .filter((c) => c.control === control)
    .map((c) => c.channel)
    .sort();
}

/** Source poses with IK legs: random IK feet and body motion, FK arms (their default ikFk 0). */
function ikSourceFrames(program: RigProgram, count: number, seed: number): ChannelBuffer[] {
  const next = random(seed);
  const frames: ChannelBuffer[] = [];
  for (let f = 0; f < count; f++) {
    const values = new Map<ControlId, ChannelValues>([
      [id('cog'), { tx: next() * 0.06, ty: -0.04 + next() * 0.04, tz: next() * 0.06, ry: next() * 0.4 }],
      [id('fk.spine'), { rx: next() * 0.3, ry: next() * 0.3 }],
      [id('ik.leg.L'), { tx: next() * 0.1, ty: 0.03 + next() * 0.06, tz: next() * 0.2, rx: next() * 0.5, ry: next() }],
      [id('ik.leg.R'), { tx: next() * 0.1, ty: 0.03 + next() * 0.06, tz: next() * 0.2, rz: next() * 0.4 }],
      [id('pole.leg.R'), { tx: next() * 0.2 }],
      [id('fk.toes.L'), { rx: next() * 0.6 }],
      [id('fk.upperArm.L'), { rx: next(), rz: next() }],
      [id('fk.lowerArm.R'), { ry: next() }],
    ]);
    const ch = channels(program, values, 1);
    for (const arm of ['ik.arm.L', 'ik.arm.R']) writeAttr(program, ch, id(arm), 'ikFk', 0);
    frames.push(ch);
  }
  return frames;
}

describe('import to IK (M2A-SPEC §5.8)', () => {
  it('writes IK and pole keys instead of the leg FK chains and reproduces a raw clip (≤ 1e-5 rad / 1e-6 m)', () => {
    const program = ikRig(richHumanoid());
    const { clip, poses } = bakeRaw(program, ikSourceFrames(program, 10, 7), FPS30, 'steps');
    const imported = importRawClip(clip, program, opts());
    expect(imported.limbs?.map((row) => [row.limb, row.mode])).toEqual([
      ['leg.L', 'ik'],
      ['leg.R', 'ik'],
    ]);
    for (const row of imported.limbs ?? []) {
      expect(row.maxRotationErrorRad).toBeLessThan(1e-5);
      expect(row.maxMidErrorM).toBeLessThan(1e-5);
    }
    const controls = controlsWithCurves(imported);
    for (const side of ['L', 'R']) {
      for (const fk of ['fk.upperLeg', 'fk.lowerLeg', 'fk.foot']) expect(controls.has(id(`${fk}.${side}`))).toBe(false);
      // Translation always; rotation channels that stay at rest are not written (M1 import rule).
      const ikChannels = channelsOf(imported, id(`ik.leg.${side}`));
      expect(ikChannels.filter((c) => c.startsWith('t'))).toEqual(['tx', 'ty', 'tz']);
      expect(ikChannels.every((c) => ['rx', 'ry', 'rz', 'tx', 'ty', 'tz'].includes(c))).toBe(true);
      expect(ikChannels.some((c) => c.startsWith('r'))).toBe(true);
      expect(channelsOf(imported, id(`pole.leg.${side}`))).toEqual(['tx', 'ty', 'tz']);
      // The arms stay FK (their ikFk default is 0).
      expect(controls.has(id(`ik.arm.${side}`))).toBe(false);
      expect(controls.has(id(`pole.arm.${side}`))).toBe(false);
    }
    expect(controls.has(id('fk.upperArm.L'))).toBe(true);
    // fk.toes keeps its FK curve (the source turns the left toes only).
    expect(channelsOf(imported, id('fk.toes.L'))).toContain('rx');
    expect(imported.curves.some((c) => c.channel.startsWith('@'))).toBe(false);
    expect(imported.warnings).toEqual([]);
    poses.forEach((expected, frame) => {
      const error = worldError(program, evaluate(program, clipChannels(program, imported, frame)), expected);
      expect([frame, error.rotation < 1e-5, error.position < 1e-6]).toEqual([frame, true, true]);
    });
  });

  it('reproduces a humanoid (VRMA-style) clip through the IK legs', () => {
    const program = ikRig(richHumanoid());
    const hips = program.skeleton.humanoid?.hips as number;
    const restHips = bonePos(evaluate(program, program.allocChannels()), hips);
    const { data, poses } = bakeHumanoid(program, ikSourceFrames(program, 8, 19), FPS30, [
      restHips[0],
      restHips[1],
      restHips[2],
    ]);
    const imported = importHumanoidClip(data, program, { ...opts(), hipsScale: 'auto' });
    expect(imported.limbs?.map((row) => row.mode)).toEqual(['ik', 'ik']);
    expect(controlsWithCurves(imported).has(id('fk.lowerLeg.L'))).toBe(false);
    poses.forEach((expected, frame) => {
      const error = worldError(program, evaluate(program, clipChannels(program, imported, frame)), expected);
      expect([frame, error.rotation < 1e-5, error.position < 1e-6]).toEqual([frame, true, true]);
    });
  });

  it('keeps a leg with a hyperextended knee FK for the clip: one stepped @ikFk 0 key and a warning', () => {
    const program = ikRig(richHumanoid());
    const fk = (frame: number): ChannelBuffer => {
      const ch = channels(program, new Map(), 0);
      const bendL = (10 + frame * 4) * DEG;
      const hinge = (limb: string): Vec3 => {
        const h = program.limbs.find((l) => l.id === limb)?.params.hinge ?? [1, 0, 0];
        return [h[0], h[1], h[2]];
      };
      const about = (limb: string, angle: number): ChannelValues => {
        const e = quatToEuler(quatFromAxisAngle(hinge(limb), angle), 'xyz');
        return { rx: e[0], ry: e[1], rz: e[2] };
      };
      writeControlChannels(program, ch, id('fk.upperLeg.L'), { rx: -0.2 - frame * 0.05, rz: 0.05 });
      writeControlChannels(program, ch, id('fk.lowerLeg.L'), about('leg.L', bendL));
      writeControlChannels(program, ch, id('fk.foot.L'), { rx: 0.1 });
      // The right knee bends 5° against its hinge at frame 2 (from the straight rest of the synthetic leg).
      writeControlChannels(program, ch, id('fk.upperLeg.R'), { rx: 0.1 });
      writeControlChannels(program, ch, id('fk.foot.R'), { rx: 0.05 * frame });
      writeControlChannels(program, ch, id('fk.lowerLeg.R'), about('leg.R', frame === 2 ? -5 * DEG : 2 * DEG));
      writeControlChannels(program, ch, id('cog'), { ty: -0.01 * frame });
      return ch;
    };
    const frames = [0, 1, 2, 3].map(fk);
    const { clip, poses } = bakeRaw(program, frames, FPS30, 'Walk_Loop');
    const imported = importRawClip(clip, program, opts());
    const rows = new Map((imported.limbs ?? []).map((row) => [row.limb, row]));
    expect(rows.get('leg.L')?.mode).toBe('ik');
    const right = rows.get('leg.R');
    expect(right?.mode).toBe('fk');
    // IK bends the knee forward by the same amount: the shin turns by about 2·5°·l1/L, and the knee moves > 2 mm.
    expect(right?.maxRotationErrorRad).toBeGreaterThan(1 * DEG);
    expect(right?.maxMidErrorM).toBeGreaterThan(0.002);
    // FK chain curves for the right leg, no IK or pole curves; one stepped @ikFk 0 key at the clip start.
    const controls = controlsWithCurves(imported);
    for (const key of ['fk.upperLeg.R', 'fk.lowerLeg.R', 'fk.foot.R']) expect(controls.has(id(key))).toBe(true);
    expect(controls.has(id('pole.leg.R'))).toBe(false);
    expect(imported.curves.filter((c) => c.control === id('ik.leg.R'))).toEqual([
      {
        control: id('ik.leg.R'),
        channel: '@ikFk',
        keys: [
          {
            t: 0,
            v: 0,
            inType: 'flat',
            outType: 'step',
            inHandle: { dt: 0, dv: 0 },
            outHandle: { dt: 0, dv: 0 },
            broken: false,
            weightLocked: true,
          },
        ],
        stats: { sourceKeys: 1, maxReduceError: 0 },
      },
    ]);
    const degrees = (((right?.maxRotationErrorRad ?? 0) * 180) / Math.PI).toFixed(1);
    const mm = Math.round((right?.maxMidErrorM ?? 0) * 1000);
    expect(imported.warnings).toEqual([
      `R Leg kept FK in 'Walk_Loop': the knee is not a clean hinge (max ${degrees}°, ${mm} mm). Rig › IK/FK › Match Range to IK converts it if you accept the difference.`,
    ]);
    // The clip plays exactly: the left leg through IK, the right one through FK.
    poses.forEach((expected, frame) => {
      const error = worldError(program, evaluate(program, clipChannels(program, imported, frame)), expected);
      expect([frame, error.rotation < 1e-5, error.position < 1e-6]).toEqual([frame, true, true]);
    });

    // A looser tolerance keeps the right leg IK (the end still lands; the knee bends forward instead).
    const loose = importRawClip(clip, program, opts({ ikTolerance: { rotationRad: 1, positionM: 1 } }));
    expect(loose.limbs?.map((row) => row.mode)).toEqual(['ik', 'ik']);
    expect(loose.warnings).toEqual([]);
    const at2 = evaluate(program, clipChannels(program, loose, 2));
    const foot = program.skeleton.humanoid?.rightFoot as number;
    expect(distance(bonePos(at2, foot), bonePos(poses[2] as PoseBuffers, foot))).toBeLessThan(1e-6);

    // ik: 'none' writes FK only (M1) and reports no limbs.
    const none = importRawClip(clip, program, opts({ ik: 'none' }));
    expect(none.limbs).toBeUndefined();
    expect(controlsWithCurves(none).has(id('ik.leg.L'))).toBe(false);
    expect(controlsWithCurves(none).has(id('fk.lowerLeg.L'))).toBe(true);
  });

  it('moves the pole curves continuously through a walk with straight-leg passes (≤ 0.05·L per frame)', () => {
    const program = ikRig(richHumanoid());
    const frames: ChannelBuffer[] = [];
    // A 36-frame (1.2 s at 30 fps) walk cycle, twice; the legs pass straight at mid-stance.
    for (let f = 0; f <= 72; f++) {
      const phase = (f / 36) * Math.PI * 2;
      const values = new Map<ControlId, ChannelValues>([
        [id('cog'), { ty: -0.02 + 0.02 * Math.cos(2 * phase), tx: 0.02 * Math.sin(phase) }],
        [id('ik.leg.L'), { tz: 0.18 * Math.sin(phase), ty: Math.max(0, 0.06 * Math.cos(phase)) }],
        [id('ik.leg.R'), { tz: -0.18 * Math.sin(phase), ty: Math.max(0, -0.06 * Math.cos(phase)), ry: 0.1 }],
        [id('fk.spine'), { ry: 0.1 * Math.sin(phase) }],
      ]);
      const ch = channels(program, values, 1);
      for (const arm of ['ik.arm.L', 'ik.arm.R']) writeAttr(program, ch, id(arm), 'ikFk', 0);
      frames.push(ch);
    }
    const { clip, poses } = bakeRaw(program, frames, FPS30, 'walk');
    const imported = importRawClip(clip, program, opts());
    expect(imported.limbs?.map((row) => row.mode)).toEqual(['ik', 'ik']);
    for (const side of ['L', 'R']) {
      const limb = program.limbs.find((l) => l.id === `leg.${side}`);
      const reach = (limb?.lengths.upper ?? 0) + (limb?.lengths.lower ?? 0);
      const at = (frame: number): Vec3 =>
        (['tx', 'ty', 'tz'] as const).map((channel) => {
          const keys = imported.curves.find((c) => c.control === id(`pole.leg.${side}`) && c.channel === channel)?.keys;
          return keys === undefined ? 0 : keyValueAt(keys, frame);
        }) as Vec3;
      let worst = 0;
      for (let f = 1; f <= 72; f++) worst = Math.max(worst, distance(at(f), at(f - 1)));
      expect(worst).toBeLessThan(0.05 * reach);
    }
    poses.forEach((expected, frame) => {
      const error = worldError(program, evaluate(program, clipChannels(program, imported, frame)), expected);
      expect([frame, error.rotation < 1e-5, error.position < 1e-6]).toEqual([frame, true, true]);
    });
  });
});
