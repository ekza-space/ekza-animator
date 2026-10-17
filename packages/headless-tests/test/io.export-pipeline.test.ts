// io.* (WP-4): the export pipeline over the real rig kernel on the licensed fixtures — skeletonFromGltf → autoRig →
// compileRig → bakeClip → bakeIntoModel / writeAnimationGlb / writeVrma → read-back, lints and glTF-Validator
// (§4.11.10, §4.11.13). Skipped until WP-3's autoRig and compileRig land.
import { EkzaError, type Quat, quatAngle } from '@ekza-animator/anim-core';
import { type CharacterId, controlId, type RigId } from '@ekza-animator/doc';
import { type LicensedFixture, readFixture, readSyntheticFixture } from '@ekza-animator/doc/testing';
import {
  bakeClip,
  bakeIntoModel,
  type BakeOptions,
  compareValidation,
  ekzaAnimationMeta,
  parseGlb,
  type PoseSource,
  readVrma,
  setGltfValidator,
  skeletonFromGltf,
  validateGltf,
  writeAnimationGlb,
  writeVrma,
} from '@ekza-animator/io';
import {
  autoRig,
  compileRig,
  humanoidRestWorldPositions,
  type RigProgram,
  type SkeletonDesc,
} from '@ekza-animator/rig';
import * as gltfValidator from 'gltf-validator';
import { beforeAll, describe, expect, it } from 'vitest';

const IDS = { character: 'chr_IoPipeline000001' as CharacterId, rig: 'rig_IoPipeline000001' as RigId };

/** WP-3 has implemented the auto-rig and the compiler. */
function rigReady(): boolean {
  try {
    const skeleton = readSyntheticFixture('humanoid-skeleton.json') as SkeletonDesc;
    compileRig(autoRig(skeleton, IDS), skeleton);
    return true;
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  }
}

/** Rotates one control's rz over the clip (the wave of E2E-16) through the real kernel. */
function wavingSource(program: RigProgram, control: string): PoseSource {
  const channels = program.allocChannels();
  const slot = program.controlIndex.get(controlId(IDS.rig, control)) ?? 1;
  return {
    program,
    evaluate(frame, out) {
      program.resetChannels(channels);
      channels.values[slot * 9 + 5] = Math.sin((frame / 30) * Math.PI * 2) * 0.5;
      program.evaluate(channels, out);
    },
  };
}

function options(name: string, target: 'raw' | 'humanoid'): BakeOptions {
  return {
    name,
    fps: { num: 30, den: 1 },
    range: { start: 0, end: 30 },
    target,
    closeLoop: true,
    loop: true,
    rootMotion: 'hips',
    inPlaceNode: null,
    stepSchedule: new Map(),
    requiredTracks: new Set(),
    meta: {
      index: 0,
      name,
      slot: name,
      loop: true,
      fps: 30,
      durationSeconds: 1,
      rootMotion: 'hips',
      contactSeconds: null,
      tags: [],
      derivedFrom: [],
      redistributable: 'yes',
    },
  };
}

describe.skipIf(!rigReady())('io export pipeline on the real rig [needs WP-3 autoRig/compileRig]', () => {
  beforeAll(() => setGltfValidator(gltfValidator));

  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm', 'quaternius-ual.glb'])(
    'bakes %s into the model and as an animation-only GLB',
    async (name) => {
      const source = await parseGlb(readFixture(name));
      const skeleton = skeletonFromGltf(source);
      const program = compileRig(autoRig(skeleton, IDS), skeleton);
      const control = skeleton.humanoid === null ? (program.controls[1]?.key ?? '') : 'fk.lowerArm.L';
      const raw = bakeClip(wavingSource(program, control), options('wave', 'raw'));
      const meta = ekzaAnimationMeta([raw], skeleton.humanoid === null ? 'gltf-nodes' : 'vrm-humanoid', {
        toolVersion: '0.1.0',
        projectSha256: null,
        baseSha256: source.sha256,
      });
      const sourceReport = await validateGltf(source.bytes);

      const baked = await bakeIntoModel(source, skeleton, [raw], { meta, fileName: name, profile: null });
      expect(baked.readBack?.ok).toBe(true);
      expect(baked.lints.filter((l) => l.severity === 'error')).toEqual([]);
      expect(compareValidation(sourceReport, await validateGltf(baked.bytes))).toEqual([]);

      const animationOnly = await writeAnimationGlb(skeleton, [raw], { meta, fileName: 'wave.glb', profile: null });
      expect(animationOnly.readBack?.ok).toBe(true);
      expect((await validateGltf(animationOnly.bytes)).errors).toBe(0);
    },
  );

  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm'])(
    'writes a %s clip as VRMA with 0 validator errors',
    async (name) => {
      const skeleton = skeletonFromGltf(await parseGlb(readFixture(name)));
      const program = compileRig(autoRig(skeleton, IDS), skeleton);
      const humanoid = bakeClip(wavingSource(program, 'fk.lowerArm.L'), options('wave', 'humanoid'));
      const meta = ekzaAnimationMeta([humanoid], 'vrm-humanoid', {
        toolVersion: '0.1.0',
        projectSha256: null,
        baseSha256: null,
      });
      const vrma = await writeVrma(skeleton, humanoid, {
        meta,
        fileName: 'wave.vrma',
        profile: null,
        humanoidRestWorld: humanoidRestWorldPositions(skeleton),
      });
      expect(vrma.readBack?.ok).toBe(true);
      expect((await validateGltf(vrma.bytes)).errors).toBe(0);
      // io's canonical rest worlds (bakeClip) and rig's humanoidRestWorldPositions (the writer's input) agree.
      const read = readVrma(await parseGlb(vrma.bytes));
      const restHips = humanoid.restHipsPosition ?? [Infinity, Infinity, Infinity];
      expect(Math.hypot(...read.restHipsPosition.map((v, i) => v - (restHips[i] as number)))).toBeLessThan(1e-9);
      // Seed-san's hips rest height is 0.7956 m (§4.11.12).
      const hipsY = name === 'seed-san.vrm' ? 0.7956 : read.restHipsPosition[1];
      expect(Math.abs(read.restHipsPosition[1] - hipsY)).toBeLessThan(1e-4);
    },
  );

  it('bakes the zero pose as the rest pose (raw locals equal the file rest rotations)', async () => {
    const source = await parseGlb(readFixture('polybot.vrm'));
    const skeleton = skeletonFromGltf(source);
    const program = compileRig(autoRig(skeleton, IDS), skeleton);
    const channels = program.allocChannels();
    const rest: PoseSource = {
      program,
      evaluate(_frame, out) {
        program.resetChannels(channels);
        program.evaluate(channels, out);
      },
    };
    const clip = bakeClip(rest, options('rest', 'raw'));
    let maxError = 0;
    for (const track of clip.tracks) {
      if (track.path !== 'rotation') continue;
      const q = Array.from(track.values.subarray(0, 4)) as Quat;
      maxError = Math.max(maxError, quatAngle(q, skeleton.nodes[track.node]?.restLocal.q ?? [0, 0, 0, 1]));
    }
    expect(maxError).toBeLessThan(1e-6);
  });
});
