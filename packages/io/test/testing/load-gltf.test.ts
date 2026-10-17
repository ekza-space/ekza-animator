import { EkzaError } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import { VRM0_BONE_ALIASES } from '@ekza-animator/rig';
import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { loadGltfInNode, readGlbJson, skeletonNodeOrder } from '../../src/testing';

interface NodeJson {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly translation?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number];
}
interface FixtureJson {
  readonly nodes: readonly NodeJson[];
  readonly extensions?: {
    readonly VRM?: {
      readonly humanoid: { readonly humanBones: readonly { readonly bone: string; readonly node: number }[] };
    };
    readonly VRMC_vrm?: {
      readonly humanoid: { readonly humanBones: Readonly<Record<string, { readonly node: number }>> };
    };
  };
}

/** VRM 1.0 bone name → glTF node index, from either VRM version's humanoid table. */
function humanBones(json: FixtureJson): Map<HumanBoneName, number> {
  const bones = new Map<HumanBoneName, number>();
  for (const entry of json.extensions?.VRM?.humanoid.humanBones ?? []) {
    bones.set(VRM0_BONE_ALIASES[entry.bone] ?? (entry.bone as HumanBoneName), entry.node);
  }
  for (const [bone, entry] of Object.entries(json.extensions?.VRMC_vrm?.humanoid.humanBones ?? {})) {
    bones.set(bone as HumanBoneName, entry.node);
  }
  return bones;
}

/** Humanoid bones whose raw three-vrm node is not the object mapped for that bone's SkeletonDesc index. */
function mismatchedBones(
  bones: ReadonlyMap<HumanBoneName, number>,
  order: readonly number[],
  loaded: Awaited<ReturnType<typeof loadGltfInNode>>,
): HumanBoneName[] {
  return [...bones]
    .filter(
      ([bone, gltfIndex]) => loaded.vrm?.humanoid.getRawBoneNode(bone) !== loaded.nodeByIndex[order.indexOf(gltfIndex)],
    )
    .map(([bone]) => bone);
}

async function load(name: LicensedFixture) {
  const bytes = readFixture(name);
  const json = readGlbJson(bytes) as FixtureJson;
  return { json, order: skeletonNodeOrder(json), loaded: await loadGltfInNode(bytes) };
}

/** Every object sits under its glTF parent's object, with the file's rest translation and rotation. */
function expectHierarchyMatchesFile(
  json: FixtureJson,
  order: readonly number[],
  nodeByIndex: readonly (Object3D | null)[],
  scene: Object3D,
): void {
  const indexOfGltf = new Map(order.map((gltfIndex, index) => [gltfIndex, index]));
  const parentOf = new Map<number, number>();
  json.nodes.forEach((node, index) => {
    for (const child of node.children ?? []) parentOf.set(child, index);
  });
  const problems: string[] = [];
  order.forEach((gltfIndex, index) => {
    const object = nodeByIndex[index];
    const node = json.nodes[gltfIndex] as NodeJson;
    if (object === null || object === undefined) {
      problems.push(`node ${gltfIndex} has no object`);
      return;
    }
    const parent = parentOf.get(gltfIndex);
    const expectedParent = parent === undefined ? scene : nodeByIndex[indexOfGltf.get(parent) ?? -1];
    if (object.parent !== expectedParent) problems.push(`node ${gltfIndex} (${node.name ?? ''}) has the wrong parent`);
    if (parent !== undefined && (indexOfGltf.get(parent) ?? Infinity) >= index)
      problems.push(`node ${gltfIndex} precedes its parent`);
    const t = node.translation ?? [0, 0, 0];
    if (object.position.distanceTo({ x: t[0], y: t[1], z: t[2] }) > 1e-6)
      problems.push(`node ${gltfIndex} translation`);
    const q = node.rotation ?? [0, 0, 0, 1];
    const dot = Math.abs(
      object.quaternion.x * q[0] + object.quaternion.y * q[1] + object.quaternion.z * q[2] + object.quaternion.w * q[3],
    );
    if (1 - dot > 1e-6) problems.push(`node ${gltfIndex} rotation`);
  });
  expect(problems).toEqual([]);
}

describe('io/testing loadGltfInNode (WP-0b)', () => {
  it('loads Polybot (VRM 0.x) with its humanoid and maps every node by SkeletonDesc index', async () => {
    const { json, order, loaded } = await load('polybot.vrm');
    expect(loaded.vrm?.meta.metaVersion).toBe('0');
    expect(loaded.scene).toBe(loaded.vrm?.scene);
    // Polybot's nodes are already parent-first, so the SkeletonDesc order is the glTF order.
    expect(order).toEqual(json.nodes.map((_, i) => i));
    expect(loaded.nodeByIndex).toHaveLength(json.nodes.length);
    expectHierarchyMatchesFile(json, order, loaded.nodeByIndex, loaded.scene);
    const bones = humanBones(json);
    expect(bones.size).toBeGreaterThanOrEqual(15);
    expect(mismatchedBones(bones, order, loaded)).toEqual([]);
  });

  it('loads Seed-san (VRM 1.0) with its humanoid and maps every node by SkeletonDesc index', async () => {
    const { json, order, loaded } = await load('seed-san.vrm');
    expect(loaded.vrm?.meta.metaVersion).toBe('1');
    expect(loaded.nodeByIndex).toHaveLength(json.nodes.length);
    expectHierarchyMatchesFile(json, order, loaded.nodeByIndex, loaded.scene);
    const bones = humanBones(json);
    expect(bones.get('hips')).toBeDefined();
    expect(mismatchedBones(bones, order, loaded)).toEqual([]);
  });

  it('orders a child-first generic GLB topologically (Quaternius UAL) and has no VRM', async () => {
    const { json, order, loaded } = await load('quaternius-ual.glb');
    expect(loaded.vrm).toBeNull();
    expect(order).not.toEqual(json.nodes.map((_, i) => i));
    expectHierarchyMatchesFile(json, order, loaded.nodeByIndex, loaded.scene);
  });

  it('leaves no globals behind and handles concurrent loads', async () => {
    const before = { self: 'self' in globalThis, createImageBitmap: 'createImageBitmap' in globalThis };
    const [a, b] = await Promise.all([
      loadGltfInNode(readFixture('polybot.vrm')),
      loadGltfInNode(readFixture('polybot.vrm')),
    ]);
    expect(a.scene).not.toBe(b.scene);
    expect({ self: 'self' in globalThis, createImageBitmap: 'createImageBitmap' in globalThis }).toEqual(before);
  });

  it('rejects bytes that are not a GLB', async () => {
    await expect(loadGltfInNode(new TextEncoder().encode('{"asset":{"version":"2.0"}}'))).rejects.toMatchObject({
      code: 'not-glb',
    });
  });
});

describe('io/testing skeletonNodeOrder (WP-0b)', () => {
  it('emits parents first, preferring the smallest ready glTF index', () => {
    // 0 ← 2 ← 1, 3 is a second root with child 4.
    const json = { nodes: [{ children: [2] }, {}, { children: [1] }, { children: [4] }, {}] };
    expect(skeletonNodeOrder(json)).toEqual([0, 2, 1, 3, 4]);
    expect(skeletonNodeOrder({ nodes: [{ children: [1] }, {}, {}] })).toEqual([0, 1, 2]);
    expect(skeletonNodeOrder({})).toEqual([]);
  });

  it('rejects malformed hierarchies', () => {
    const code = (json: Parameters<typeof skeletonNodeOrder>[0]): string | null => {
      try {
        skeletonNodeOrder(json);
        return null;
      } catch (error) {
        return error instanceof EkzaError ? error.code : 'other';
      }
    };
    expect(code({ nodes: [{ children: [1] }, { children: [0] }] })).toBe('malformed-gltf');
    expect(code({ nodes: [{ children: [2] }, { children: [2] }, {}] })).toBe('malformed-gltf');
    expect(code({ nodes: [{ children: [7] }] })).toBe('malformed-gltf');
  });
});
