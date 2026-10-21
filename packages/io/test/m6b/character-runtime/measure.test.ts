// M6B-SPEC §9 C1, §4.4: `measureMeshes` delegates to `measureSkinned` with outputs byte-identical to M2a's on the three
// skinned fixtures (Seed-san, Polybot, the UAL rig); `measureSkinned` on its own (segments, tails, fallbacks).
import { mat4Compose } from '@ekza-studio/anim-core';
import { type LicensedFixture, readFixture } from '@ekza-studio/doc/testing';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../../../src/glb/parse';
import { GltfReader } from '../../../src/gltf/accessor';
import { detectModelFormat } from '../../../src/gltf/format';
import { nodesOf } from '../../../src/gltf/schema';
import { measureSkinned, NO_NODE } from '../../../src/skeleton/measure';
import { measureMeshes } from '../../../src/skeleton/radii';
import { skeletonFromGltf, VRM0_FACING } from '../../../src/skeleton/read';
import { restWorldsOf } from '../../../src/skeleton/rest';
import { readVrmParts } from '../../../src/skeleton/vrm';
import { measureMeshes as measureMeshesM2a } from '../reference/radii-m2a';

function bytesOf(values: readonly (Float32Array | null)[] | null): string {
  if (values === null) return 'null';
  return values
    .map((v) => (v === null ? 'null' : Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('hex')))
    .join(',');
}

function radiiBytes(values: readonly (number | null)[]): string {
  return values.map((v) => (v === null ? 'null' : Buffer.from(Float64Array.of(v).buffer).toString('hex'))).join(',');
}

describe('measureMeshes delegates to measureSkinned (outputs byte-identical to M2a)', () => {
  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm', 'quaternius-ual.glb'])('%s', async (name) => {
    const c = await parseGlb(readFixture(name));
    const skeleton = skeletonFromGltf(c);
    const format = detectModelFormat(c.json);
    const facing = format === 'vrm0' ? VRM0_FACING : skeleton.facing;
    const nodes = skeleton.nodes;
    const indexOfGltf = new Map(nodes.map((node) => [node.gltfIndex, node.index]));
    const childrenOf: number[][] = nodes.map(() => []);
    for (const node of nodes) if (node.parent !== -1) childrenOf[node.parent]?.push(node.index);
    const vrm = readVrmParts(c.json, format, indexOfGltf, childrenOf);
    const worlds = restWorldsOf(nodes, facing).map((xf) => mat4Compose(xf));
    expect(nodesOf(c.json).length).toBe(nodes.length);
    const now = measureMeshes(new GltfReader(c.json, c.bin), nodes, worlds, indexOfGltf, childrenOf, vrm.humanoid);
    const before = measureMeshesM2a(
      new GltfReader(c.json, c.bin),
      nodes,
      worlds,
      indexOfGltf,
      childrenOf,
      vrm.humanoid,
    );
    expect(radiiBytes(now.boneRadii)).toBe(radiiBytes(before.boneRadii));
    expect(now.meshHeight).toBe(before.meshHeight);
    expect(bytesOf(now.boneSupport)).toBe(bytesOf(before.boneSupport));
    expect(now.boneRadii.some((r) => r !== null)).toBe(true);
    // skeletonFromGltf reads the same values.
    expect(radiiBytes(skeleton.boneRadii)).toBe(radiiBytes(before.boneRadii));
  });
});

describe('measureSkinned', () => {
  // Two nodes: a root at the origin and a child 1 m up the Y axis.
  const world = (y: number) => mat4Compose({ t: [0, y, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
  const nodeWorld = new Float64Array(32);
  nodeWorld.set(world(0), 0);
  nodeWorld.set(world(1), 16);

  it('measures the dominated points from the segment to the child, else the tail, else the point', () => {
    const positions = Float32Array.of(0.1, 0.5, 0, 0.2, 0.5, 0, 0, 1.5, 0.3);
    const joints = Uint16Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0);
    const weights = Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0);
    const toChild = measureSkinned({
      positions,
      joints,
      weights,
      nodeWorld,
      segments: [
        { node: 0, child: 1, tail: null },
        { node: 1, child: null, tail: null },
      ],
    });
    expect(toChild.radii[0]).toBeCloseTo(1.25 * 0.2, 6);
    expect(toChild.radii[1]).toBeCloseTo(1.25 * Math.hypot(0.5, 0.3), 6);
    const withTail = measureSkinned({
      positions,
      joints,
      weights,
      nodeWorld,
      segments: [
        { node: 0, child: 1, tail: null },
        { node: 1, child: null, tail: [0, 2, 0] },
      ],
    });
    expect(withTail.radii[1]).toBeCloseTo(1.25 * 0.3, 6);
    expect(toChild.support[0]).toBeInstanceOf(Float32Array);
  });

  it('falls back to secondary influences, then to the measured ancestor for skinned nodes only', () => {
    const positions = Float32Array.of(0.1, 0.5, 0);
    const joints = Uint16Array.of(0, 1, NO_NODE, 0);
    const weights = Float32Array.of(0.8, 0.2, 0, 0);
    const segments = [
      { node: 0, child: 1, tail: null },
      { node: 1, child: null, tail: null },
    ];
    const secondary = measureSkinned({ positions, joints, weights, nodeWorld, segments });
    expect(secondary.radii[1]).toBeCloseTo(1.25 * Math.hypot(0.1, 0.5), 6);
    const none = measureSkinned({
      positions,
      joints: Uint16Array.of(0, 0, 0, 0),
      weights: Float32Array.of(1, 0, 0, 0),
      nodeWorld,
      segments,
    });
    expect(none.radii[1]).toBeNull();
    const inherited = measureSkinned({
      positions,
      joints: Uint16Array.of(0, 0, 0, 0),
      weights: Float32Array.of(1, 0, 0, 0),
      nodeWorld,
      segments,
      parents: Int32Array.of(-1, 0),
      skinned: new Set([0, 1]),
    });
    expect(inherited.radii[1]).toBe(inherited.radii[0]);
  });
});
