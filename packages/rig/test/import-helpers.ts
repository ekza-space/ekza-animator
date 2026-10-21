import type { Fps, KeyData } from '@ekza-studio/anim-core';
import type { ChannelValues, HumanBoneName, TrsChannel } from '@ekza-studio/doc';
import {
  CHANNELS_PER_CONTROL,
  type ChannelBuffer,
  HUMAN_BONE_NAMES,
  type HumanoidClipData,
  type ImportedClipKeys,
  type PoseBuffers,
  type RawChannel,
  type RawClip,
  type RigProgram,
  writeControlChannels,
} from '../src';

const SLOTS: readonly TrsChannel[] = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];

/** Value of imported keys at a frame for the tangent kinds the importer emits without the AnimX engine. */
export function keyValueAt(keys: readonly KeyData[], frame: number): number {
  const first = keys[0] as KeyData;
  const last = keys[keys.length - 1] as KeyData;
  if (frame <= first.t) return first.v;
  if (frame >= last.t) return last.v;
  let i = 0;
  while ((keys[i + 1] as KeyData).t <= frame) i++;
  const a = keys[i] as KeyData;
  const b = keys[i + 1] as KeyData;
  if (a.t === frame) return a.v;
  if (a.outType === 'step') return a.v;
  if (a.outType === 'linear' && b.inType === 'linear') return a.v + ((b.v - a.v) * (frame - a.t)) / (b.t - a.t);
  throw new Error(`keyValueAt: no exact evaluation for ${a.outType}/${b.inType} without the curve engine`);
}

/** Channel buffer of the imported clip at `frame` (controls without curves at defaults). */
export function channelsAt(
  program: RigProgram,
  clip: ImportedClipKeys,
  frame: number,
  out?: ChannelBuffer,
): ChannelBuffer {
  const ch = out ?? program.allocChannels();
  program.resetChannels(ch);
  for (const curve of clip.curves) {
    const slot = program.controlIndex.get(curve.control);
    const k = SLOTS.indexOf(curve.channel as TrsChannel);
    if (slot === undefined || k === -1) continue;
    ch.values[slot * CHANNELS_PER_CONTROL + k] = keyValueAt(curve.keys, frame);
  }
  return ch;
}

/** A pose per frame (reproducible pseudo-random channel values on every keyable channel). */
export function randomFrames(program: RigProgram, frames: number, seed: number, amplitude = 1): ChannelBuffer[] {
  let state = seed;
  const next = (): number => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647 - 0.5;
  };
  const out: ChannelBuffer[] = [];
  for (let f = 0; f < frames; f++) {
    const ch = program.allocChannels();
    for (const control of program.controls) {
      const values: ChannelValues = {};
      SLOTS.forEach((channel, k) => {
        const group = k < 3 ? control.keyable.t : k < 6 ? control.keyable.r : control.keyable.s;
        if (!group[k % 3]) return;
        values[channel] =
          k < 3 ? next() * 0.2 * amplitude : k < 6 ? next() * 1.6 * amplitude : 1 + next() * 0.4 * amplitude;
      });
      writeControlChannels(program, ch, control.id, values);
    }
    out.push(ch);
  }
  return out;
}

/** Bakes poses to a raw LINEAR clip of every node's local TRS at frames 0, 1, … (float32 like a glTF file). */
export function bakeRaw(
  program: RigProgram,
  frames: readonly ChannelBuffer[],
  fps: Fps,
  name = 'baked',
): {
  readonly clip: RawClip;
  readonly poses: PoseBuffers[];
} {
  const poses = frames.map((ch) => {
    const pose = program.allocPose();
    program.evaluate(ch, pose);
    return pose;
  });
  const times = Float32Array.from(frames.map((_, f) => (f * fps.den) / fps.num));
  const channels: RawChannel[] = [];
  for (let node = 0; node < program.nodeCount; node++) {
    for (const [path, offset, components] of [
      ['translation', 0, 3],
      ['rotation', 3, 4],
      ['scale', 7, 3],
    ] as const) {
      const values = new Float32Array(frames.length * components);
      poses.forEach((pose, f) => {
        for (let c = 0; c < components; c++)
          values[f * components + c] = pose.boneLocal[node * 10 + offset + c] as number;
      });
      channels.push({ node, path, interpolation: 'LINEAR', times, values });
    }
  }
  return {
    clip: { index: 0, name, duration: times[times.length - 1] as number, channels, skipped: [] },
    poses,
  };
}

/** Bakes poses to normalized humanoid data (N_b per present bone, absolute hips position). */
export function bakeHumanoid(
  program: RigProgram,
  frames: readonly ChannelBuffer[],
  fps: Fps,
  restHipsPosition: readonly [number, number, number],
): { readonly data: HumanoidClipData; readonly poses: PoseBuffers[] } {
  const poses = frames.map((ch) => {
    const pose = program.allocPose();
    program.evaluate(ch, pose);
    return pose;
  });
  const times = Float32Array.from(frames.map((_, f) => (f * fps.den) / fps.num));
  const present = HUMAN_BONE_NAMES.filter(
    (name) => program.skeleton.humanoid?.[name] !== undefined && name !== 'leftEye' && name !== 'rightEye',
  );
  const rotations: Partial<Record<HumanBoneName, { times: Float32Array; values: Float32Array }>> = {};
  for (const name of present) {
    const h = HUMAN_BONE_NAMES.indexOf(name);
    const values = new Float32Array(frames.length * 4);
    poses.forEach((pose, f) => {
      for (let c = 0; c < 4; c++) values[f * 4 + c] = pose.humanLocal[h * 4 + c] as number;
    });
    rotations[name] = { times, values };
  }
  const hips = new Float32Array(frames.length * 3);
  poses.forEach((pose, f) => {
    for (let c = 0; c < 3; c++) hips[f * 3 + c] = pose.hipsPosition[c] as number;
  });
  return {
    data: {
      name: 'baked',
      duration: times[times.length - 1] as number,
      presentBones: present,
      rotations,
      hips: { times, values: hips },
      restHipsPosition: restHipsPosition,
      interpolation: {},
    },
    poses,
  };
}
