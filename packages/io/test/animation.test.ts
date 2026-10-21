import { readFixture } from '@ekza-studio/doc/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { readAnimations } from '../src/animation/read';
import { parseGlb } from '../src/glb/parse';
import { skeletonFromGltf } from '../src/skeleton/read';
import { GltfBuilder } from '../src/testing/glb';
import { loadGltfInNode } from '../src/testing';

const PROPERTY = {
  translation: 'position',
  rotation: 'quaternion',
  scale: 'scale',
  weights: 'morphTargetInfluences',
} as const;

describe('readAnimations', () => {
  it("matches three's GLTFLoader on every clip of the Universal Animation Library (1e-6)", async () => {
    const bytes = readFixture('quaternius-ual.glb');
    const c = await parseGlb(bytes);
    const skeleton = skeletonFromGltf(c);
    const clips = readAnimations(c, skeleton);
    const three = await loadGltfInNode(bytes);
    expect(clips.map((clip) => clip.name)).toEqual(three.animations.map((clip) => clip.name));
    const problems: string[] = [];
    clips.forEach((clip, i) => {
      const reference = three.animations[i];
      if (reference === undefined) return;
      expect(clip.index).toBe(i);
      expect(clip.skipped).toEqual([]);
      expect(Math.abs(clip.duration - reference.duration)).toBeLessThan(1e-6);
      expect(clip.channels).toHaveLength(reference.tracks.length);
      for (const channel of clip.channels) {
        const object = three.nodeByIndex[channel.node];
        const track = reference.tracks.find((t) => t.name === `${object?.name}.${PROPERTY[channel.path]}`);
        if (track === undefined) {
          problems.push(`${clip.name}: no three track for node ${channel.node} ${channel.path}`);
          continue;
        }
        const interpolation = { 2300: 'STEP', 2301: 'LINEAR' }[track.getInterpolation() as number];
        if (interpolation !== channel.interpolation) problems.push(`${clip.name}: interpolation of ${track.name}`);
        if (!close(channel.times, track.times) || !close(channel.values, track.values))
          problems.push(`${clip.name}: ${track.name}`);
      }
    });
    expect(problems).toEqual([]);
  });

  it('rejects meshopt-compressed animation data with compressed-animation', async () => {
    const c = await parseGlb(readFixture('quaternius-idle-meshopt.glb'));
    expect(() => readAnimations(c, skeletonFromGltf(c))).toThrow(
      expect.objectContaining({ code: 'compressed-animation' }),
    );
  });

  it('skips pointer, node-less and unknown-path channels and reads weights, normalized and sparse data', async () => {
    const b = new GltfBuilder();
    const json = b.json as Record<string, unknown>;
    json['nodes'] = [
      { name: 'root', children: [1] },
      { name: 'child', mesh: 0 },
    ];
    const pos = b.accessor(new Float32Array(9), 'VEC3', { minMax: true });
    json['meshes'] = [
      { primitives: [{ attributes: { POSITION: pos }, targets: [{ POSITION: pos }, { POSITION: pos }] }] },
    ];
    const times = b.accessor(new Float32Array([0, 0.5, 1]), 'SCALAR', { minMax: true });
    const rotations = b.accessor(new Int16Array([0, 0, 0, 32767, 0, 0, 32767, 0, -32767, 0, 0, 0]), 'VEC4', {
      normalized: true,
    });
    const weights = b.accessor(new Float32Array([0, 1, 0.5, 0.5, 1, 0]), 'SCALAR');
    const translations = b.accessor(new Float32Array(9), 'VEC3');
    // Sparse translation output: zeros except element 2 = (1, 2, 3).
    const sparseIndices = b.view(new Uint8Array(new Uint8Array([2, 0, 0, 0])));
    const sparseValues = b.view(new Uint8Array(new Float32Array([1, 2, 3]).buffer));
    b.json.accessors.push({
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      sparse: {
        count: 1,
        indices: { bufferView: sparseIndices, componentType: 5121 },
        values: { bufferView: sparseValues },
      },
    });
    const sparse = b.json.accessors.length - 1;
    json['animations'] = [
      {
        name: 'mixed',
        samplers: [
          { input: times, output: rotations },
          { input: times, output: weights, interpolation: 'STEP' },
          { input: times, output: translations },
          { input: times, output: sparse },
        ],
        channels: [
          { sampler: 0, target: { node: 0, path: 'rotation' } },
          { sampler: 1, target: { node: 1, path: 'weights' } },
          { sampler: 2, target: { path: 'translation' } },
          {
            sampler: 2,
            target: { path: 'pointer', extensions: { KHR_animation_pointer: { pointer: '/materials/0' } } },
          },
          { sampler: 2, target: { node: 0, path: 'bounce' } },
          { sampler: 3, target: { node: 1, path: 'translation' } },
        ],
      },
      { samplers: [], channels: [] },
    ];
    const c = await parseGlb(b.build());
    const [clip, empty] = readAnimations(c, skeletonFromGltf(c));
    expect(clip?.skipped).toEqual([
      { reason: 'no-target-node', channel: 2 },
      { reason: 'pointer', channel: 3 },
      { reason: 'unsupported-path', channel: 4 },
    ]);
    expect(clip?.duration).toBe(1);
    const [rotation, weight, translation] = clip?.channels ?? [];
    expect(Array.from(rotation?.values ?? [])).toEqual([0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, 0]);
    expect(weight).toMatchObject({ node: 1, path: 'weights', interpolation: 'STEP' });
    expect(weight?.values).toHaveLength(6);
    expect(Array.from(translation?.values ?? [])).toEqual([0, 0, 0, 0, 0, 0, 1, 2, 3]);
    expect(empty).toMatchObject({ name: 'animation_1', duration: 0, channels: [] });
  });

  it('drops keys whose time does not increase and truncates inconsistent outputs', async () => {
    const b = new GltfBuilder();
    const json = b.json as Record<string, unknown>;
    json['nodes'] = [{ name: 'n' }];
    const times = b.accessor(new Float32Array([0, 1, 1, 0.5, 2]), 'SCALAR');
    const values = b.accessor(new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]), 'VEC3');
    json['animations'] = [
      { samplers: [{ input: times, output: values }], channels: [{ sampler: 0, target: { node: 0, path: 'scale' } }] },
    ];
    const c = await parseGlb(b.build());
    const channel = readAnimations(c, skeletonFromGltf(c))[0]?.channels[0];
    expect(Array.from(channel?.times ?? [])).toEqual([0, 1]);
    expect(Array.from(channel?.values ?? [])).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('keeps the CUBICSPLINE layout (in, value, out per key) and maps nodes to SkeletonDesc order', async () => {
    const b = new GltfBuilder();
    const json = b.json as Record<string, unknown>;
    // Child-first file: node 0 is the child of node 1.
    json['nodes'] = [{ name: 'child' }, { name: 'parent', children: [0] }];
    const times = b.accessor(new Float32Array([0, 1]), 'SCALAR', { minMax: true });
    const values = b.accessor(
      new Float32Array(18).map((_, i) => i),
      'VEC3',
    );
    json['animations'] = [
      {
        samplers: [{ input: times, output: values, interpolation: 'CUBICSPLINE' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      },
    ];
    const c = await parseGlb(b.build());
    const skeleton: SkeletonDesc = skeletonFromGltf(c);
    const channel = readAnimations(c, skeleton)[0]?.channels[0];
    expect(skeleton.nodes[channel?.node ?? -1]?.name).toBe('child');
    expect(channel?.node).toBe(1);
    expect(channel?.interpolation).toBe('CUBICSPLINE');
    expect(channel?.values).toHaveLength(18);
  });
});

function close(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] as number) - (b[i] as number)) > 1e-6) return false;
  return true;
}
