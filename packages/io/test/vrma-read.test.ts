import { quatAngle, type Quat } from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import { type VRMAnimation, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { makeGlb } from '../src/testing/glb';
import { inspectVrma, readVrma } from '../src/vrma/read';
import { makeSyntheticVrma, VRMA_TIMES } from './helpers/vrma';

async function threeVrma(bytes: Uint8Array): Promise<VRMAnimation> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const gltf = await loader.parseAsync(bytes.slice().buffer, '');
  const animations = gltf.userData['vrmAnimations'] as VRMAnimation[];
  return animations[0] as VRMAnimation;
}

describe('readVrma', () => {
  it('reads a third-party VRMA exactly like three-vrm-animation (non-identity rests, intermediate nodes)', async () => {
    const bytes = makeSyntheticVrma();
    const data = readVrma(await parseGlb(bytes));
    const reference = await threeVrma(bytes);
    expect(data.duration).toBeCloseTo(reference.duration, 9);
    expect(data.restHipsPosition[0]).toBeCloseTo(reference.restHipsPosition.x, 6);
    expect(data.restHipsPosition[1]).toBeCloseTo(reference.restHipsPosition.y, 6);
    expect(data.restHipsPosition[2]).toBeCloseTo(reference.restHipsPosition.z, 6);
    expect(Object.keys(data.rotations).sort()).toEqual([...reference.humanoidTracks.rotation.keys()].sort());
    for (const [bone, track] of reference.humanoidTracks.rotation) {
      const ours = data.rotations[bone as HumanBoneName];
      expect(Array.from(ours?.times ?? [])).toEqual(Array.from(track.times));
      for (let k = 0; k < VRMA_TIMES.length; k++) {
        const a = Array.from(ours?.values.subarray(k * 4, k * 4 + 4) ?? []) as Quat;
        const b = Array.from(track.values.subarray(k * 4, k * 4 + 4)) as Quat;
        expect(quatAngle(a, b)).toBeLessThan(1e-6);
      }
    }
    const hips = reference.humanoidTracks.translation.get('hips');
    Array.from(hips?.values ?? []).forEach((v, i) => expect(data.hips?.values[i]).toBeCloseTo(v, 6));
    expect(data.interpolation).toMatchObject({ hips: 'LINEAR', chest: 'STEP', hipsPosition: 'LINEAR' });
    expect(data.presentBones).toEqual(['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperLeg']);
  });

  it('matches a hand-derived golden: N = q(W⁰_parent) · q · q(W⁰_bone)⁻¹ with rest rotations cancelling at rest', async () => {
    // A file whose animation holds every bone at its rest local rotation must read as identity N_b everywhere.
    const bytes = makeGlb(
      {
        asset: { version: '2.0' },
        nodes: [
          { name: 'hips', translation: [0, 1, 0], rotation: [0, 0.38268343236, 0, 0.92387953251], children: [1] },
          { name: 'mid', translation: [0, 0.1, 0], children: [2] },
          { name: 'spine', translation: [0, 0.1, 0], rotation: [0.2588190451, 0, 0, 0.96592582629] },
        ],
        extensionsUsed: ['VRMC_vrm_animation'],
        extensions: {
          VRMC_vrm_animation: {
            specVersion: '1.0',
            humanoid: { humanBones: { hips: { node: 0 }, spine: { node: 2 } } },
          },
        },
        accessors: [
          { bufferView: 0, componentType: 5126, count: 1, type: 'SCALAR', min: [0], max: [0] },
          { bufferView: 1, componentType: 5126, count: 1, type: 'VEC4' },
          { bufferView: 2, componentType: 5126, count: 1, type: 'VEC4' },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 4 },
          { buffer: 0, byteOffset: 4, byteLength: 16 },
          { buffer: 0, byteOffset: 20, byteLength: 16 },
        ],
        buffers: [{ byteLength: 36 }],
        animations: [
          {
            samplers: [
              { input: 0, output: 1 },
              { input: 0, output: 2 },
            ],
            channels: [
              { sampler: 0, target: { node: 0, path: 'rotation' } },
              { sampler: 1, target: { node: 2, path: 'rotation' } },
            ],
          },
        ],
      },
      new Uint8Array(
        new Float32Array([0, 0, 0.38268343236, 0, 0.92387953251, 0.2588190451, 0, 0, 0.96592582629]).buffer,
      ),
    );
    const data = readVrma(await parseGlb(bytes));
    for (const bone of ['hips', 'spine'] as const) {
      const q = Array.from(data.rotations[bone]?.values ?? []) as Quat;
      expect(quatAngle(q, [0, 0, 0, 1])).toBeLessThan(1e-6);
    }
    expect(data.restHipsPosition).toEqual([0, 1, 0]);
    expect(data.hips).toBeNull();
  });

  it('ignores eye, non-hips translation and scale channels with warnings', async () => {
    const result = inspectVrma(await parseGlb(makeSyntheticVrma({ invalidChannels: true })));
    expect(Object.keys(result.data.rotations)).not.toContain('leftEye');
    expect(result.data.presentBones).toContain('leftEye');
    const text = result.warnings.join('\n');
    expect(text).toMatch(/Eye tracks were ignored/);
    expect(text).toMatch(/Translation of 'spine'/);
    expect(text).toMatch(/'scale' channels/);
    expect(text).toMatch(/non-humanoid node above/);
  });

  it('warns about a missing specVersion and rejects unknown versions and non-VRMA files', async () => {
    expect(inspectVrma(await parseGlb(makeSyntheticVrma({ specVersion: null }))).warnings[0]).toMatch(/specVersion/);
    const future = await parseGlb(makeSyntheticVrma({ specVersion: '2.0' }));
    expect(() => readVrma(future)).toThrow(expect.objectContaining({ code: 'unsupported' }));
    const plain = await parseGlb(makeGlb({ asset: { version: '2.0' } }, null));
    expect(() => readVrma(plain)).toThrow(expect.objectContaining({ code: 'unsupported' }));
    const noHips = await parseGlb(
      makeGlb(
        {
          asset: { version: '2.0' },
          extensionsUsed: ['VRMC_vrm_animation'],
          extensions: { VRMC_vrm_animation: { specVersion: '1.0' } },
        },
        null,
      ),
    );
    expect(() => readVrma(noHips)).toThrow(expect.objectContaining({ code: 'malformed-gltf' }));
  });
});
