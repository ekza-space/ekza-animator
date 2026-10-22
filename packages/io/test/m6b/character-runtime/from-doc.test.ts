// M6B-SPEC §5.1, §9 C1 (io): `skeletonFromDoc` of a records copy of Seed-san equals `skeletonFromGltf` on the joint
// subset (names, parent names, rest locals within 1e-6, the humanoid map by name, jointsFingerprint, radii by joint name
// within 1e-4 H); `skeletonFromGltf(writeCharacter(records))` equals `skeletonFromDoc(records)` on the joint subset
// for the generated body and the Cube Lad, also after renaming a mesh and adding a static mesh.
import { readFileSync } from 'node:fs';
import type { JointRecord } from '@ekza-studio/doc';
import { makeTestSkeleton, readFixture } from '@ekza-studio/doc/testing';
import { humanoidBody, type MeshData, withSkin } from '@ekza-studio/mesh-core';
import type { DocSkeletonInput } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import {
  type CharacterMeshIn,
  type CharacterWriteInput,
  characterVertices,
  jointsFingerprint,
  parseGlb,
  skeletonFromDoc,
  skeletonFromGltf,
  writeCharacter,
} from '../../../src';
import { meshFromGltf } from '../../../src/mesh';
import { manualModelProvenance } from '../../../src/write';
import { docCopyOf, expectJointSubsetEqual, IDENTITY16, nearestBoneWeights, skinOfData, truthJoints } from './support';

const fixture = (name: string): Uint8Array =>
  readFileSync(new URL(`../../../../../fixtures/models/${name}`, import.meta.url));
const TRUTH = JSON.parse(new TextDecoder().decode(fixture('cube-lad-truth.json'))) as Parameters<typeof truthJoints>[0];

describe('skeletonFromDoc ≡ skeletonFromGltf on the joint subset (records copy of Seed-san)', () => {
  it('names, parents, rest locals, humanoid, fingerprint and radii agree', async () => {
    const container = await parseGlb(readFixture('seed-san.vrm'));
    const gltf = skeletonFromGltf(container);
    const copy = await docCopyOf(container, gltf);
    const doc = skeletonFromDoc(copy.input, { vertices: copy.vertices });
    expect(doc.nodes.every((node) => node.isJoint && !node.hasMesh)).toBe(true);
    expect(doc.heightSource).toBe('mesh');
    expect(doc.height).toBeCloseTo(gltf.height, 4);
    // Seed-san: eight finger roots sit under transform nodes (palms), copied as helper joints; a few joints have rest
    // scales within 0.2 % of 1, which JointRecords cannot carry (support.ts, expectJointSubsetEqual).
    expect(copy.helpers.size).toBeGreaterThan(0);
    expectJointSubsetEqual(doc, gltf, { radii: true, helpers: copy.helpers, unitScale: true });
    expect(doc.boneSupport?.length).toBe(doc.nodes.length);
  });

  it('without meshes: radii null, joint-based height, no support (the C0 baseline kept)', async () => {
    const container = await parseGlb(readFixture('seed-san.vrm'));
    const copy = await docCopyOf(container, skeletonFromGltf(container));
    const doc = skeletonFromDoc({ ...copy.input, meshes: [] });
    expect(doc.boneRadii.every((r) => r === null)).toBe(true);
    expect(doc.heightSource).toBe('joints');
    expect(doc.boneSupport).toBeUndefined();
  });
});

/** A bound character: the truth joints and the given meshes weighted to their two nearest bones. */
async function character(
  meshes: readonly { readonly name: string; readonly data: MeshData; readonly bound: boolean }[],
) {
  const skeleton = makeTestSkeleton('skl_truth', 'chr_truth', { preset: 'standard33' });
  const joints: JointRecord[] = truthJoints(TRUTH);
  const docMeshes = meshes.map((mesh, i) => {
    const skin = mesh.bound ? nearestBoneWeights(mesh.data, joints) : null;
    return {
      id: `msh_${i}`,
      name: mesh.name,
      data: skin === null ? mesh.data : withSkin(mesh.data, skin),
      skin,
    };
  });
  const meshIns: CharacterMeshIn[] = docMeshes.map((mesh) => ({
    id: mesh.id as never,
    name: mesh.name,
    data: mesh.data,
    skin: mesh.skin,
    materials: [{ preset: 'unlit', name: 'Material' }],
    colourOutput: 'palette-texture',
    paletteId: 'pal_A',
    prop: false,
  }));
  const palettes = new Map([['pal_A', [{ slot: 0, srgb: [200, 120, 80] as const }]]]);
  const input: DocSkeletonInput = {
    skeleton,
    joints,
    meshes: docMeshes.map((mesh) => ({
      id: mesh.id as never,
      data: mesh.data,
      skin: mesh.skin,
      placement: IDENTITY16,
    })),
  };
  const vertices = characterVertices(await import('../../../src/mesh'), meshIns, palettes);
  const desc = skeletonFromDoc(input, { vertices });
  const write: CharacterWriteInput = {
    skeleton: desc,
    joints,
    meshes: meshIns,
    palettes,
    clips: [],
    vrm: null,
    thumbnailPng: null,
    model: manualModelProvenance({
      toolVersion: 'test',
      rig: 'vrm-humanoid',
      skeletonTemplate: 'vrm-humanoid@1.0.0/standard33',
    }),
    heightScale: null,
  };
  return { input, desc, write, points: skeletonFromDoc(input) };
}

async function cubeLad(): Promise<MeshData> {
  const result = await meshFromGltf(await parseGlb(fixture('cube-lad.glb')), 0);
  if ('refused' in result) throw new Error(result.reason);
  return result.data;
}

describe('skeletonFromGltf(writeCharacter(records)) ≡ skeletonFromDoc(records) on the joint subset', () => {
  it.each([
    ['the generated body (smooth)', () => Promise.resolve(humanoidBody({ style: 'smooth', height: 1.7 }))],
    ['the generated body (segmented)', () => Promise.resolve(humanoidBody({ style: 'segmented', height: 1.7 }))],
    ['the Cube Lad', cubeLad],
  ] as const)('%s', async (_, make) => {
    const data = await make();
    const { desc, write, points } = await character([{ name: 'Body', data, bound: true }]);
    const bytes = await writeCharacter(write, { generator: 'test', format: 'vrm' });
    const read = skeletonFromGltf(await parseGlb(bytes));
    expect(read.format).toBe('vrm1');
    expect(desc.nodes).toHaveLength(34);
    expect(read.nodes.slice(0, 34).map((node) => node.name)).toEqual(desc.nodes.map((node) => node.name));
    expectJointSubsetEqual(desc, read, { radii: true });
    // Measured on the points instead, the radii move by the corner splits only (the same joints, mm apart).
    expect(points.fingerprint).toBe(desc.fingerprint);
    const apart = points.boneRadii.map((r, i) => {
      const exact = desc.boneRadii[i] ?? null;
      return r === null || exact === null ? (r === exact ? 0 : Number.POSITIVE_INFINITY) : Math.abs(r - exact);
    });
    expect(Math.max(...apart)).toBeLessThan(0.01 * desc.height);
    expect(read.heightSource).toBe('mesh');
    expect(read.height).toBeCloseTo(desc.height, 5);
    // Renaming the mesh and adding a static mesh change neither the joints nor the fingerprint.
    const more = await character([
      { name: 'Renamed body', data, bound: true },
      { name: 'Hat', data: humanoidBody({ style: 'segmented', height: 0.5 }), bound: false },
    ]);
    const read2 = skeletonFromGltf(
      await parseGlb(await writeCharacter(more.write, { generator: 'test', format: 'vrm' })),
    );
    expectJointSubsetEqual(more.desc, read2, { radii: true });
    expect(more.desc.fingerprint).toBe(desc.fingerprint);
    expect(jointsFingerprint(read2.nodes)).toBe(jointsFingerprint(read.nodes));
  });

  it('places a static mesh in character space under a displaced and rotated root (identity world at rest)', async () => {
    const hat = humanoidBody({ style: 'segmented', height: 0.5 });
    const { write } = await character([
      { name: 'Body', data: await cubeLad(), bound: true },
      { name: 'Hat', data: hat, bound: false },
    ]);
    const s = Math.SQRT1_2;
    const nodes = write.skeleton.nodes.map((node, i) =>
      i === 0 ? { ...node, restLocal: { ...node.restLocal, t: [0.3, 0.5, -0.2], q: [0, s, 0, s] } } : node,
    );
    const moved: CharacterWriteInput = { ...write, skeleton: { ...write.skeleton, nodes } as typeof write.skeleton };
    const c = await parseGlb(await writeCharacter(moved, { generator: 'test', format: 'glb' }));
    const json = c.json as {
      nodes: { name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[] }[];
    };
    const hatIndex = json.nodes.findIndex((node) => node.name === 'Hat');
    expect(hatIndex).toBeGreaterThan(0);
    expect(json.nodes[0]?.children).toContain(hatIndex);
    // root world (t0, q0) × hat local (t1, q1) = (t0 + q0·t1, q0·q1): identity.
    const [t0, q0] = [json.nodes[0]?.translation ?? [0, 0, 0], json.nodes[0]?.rotation ?? [0, 0, 0, 1]];
    const [t1, q1] = [json.nodes[hatIndex]?.translation ?? [0, 0, 0], json.nodes[hatIndex]?.rotation ?? [0, 0, 0, 1]];
    const rotate = (q: number[], v: number[]): number[] => {
      const [x, y, z, w] = q as [number, number, number, number];
      const [vx, vy, vz] = v as [number, number, number];
      const cx = y * vz - z * vy;
      const cy = z * vx - x * vz;
      const cz = x * vy - y * vx;
      return [
        vx + 2 * (w * cx + (y * cz - z * cy)),
        vy + 2 * (w * cy + (z * cx - x * cz)),
        vz + 2 * (w * cz + (x * cy - y * cx)),
      ];
    };
    const world = rotate(q0, t1).map((v, i) => v + (t0[i] as number));
    for (const v of world) expect(Math.abs(v)).toBeLessThan(1e-6);
    const [ax, ay, az, aw] = q0 as [number, number, number, number];
    const [bx, by, bz, bw] = q1 as [number, number, number, number];
    const qw = aw * bw - ax * bx - ay * by - az * bz;
    expect(Math.abs(Math.abs(qw) - 1)).toBeLessThan(1e-6);
  });

  it('is deterministic and writes JOINTS_0 in the skin order with WEIGHTS_0 summing to 1', async () => {
    const { write } = await character([{ name: 'Body', data: await cubeLad(), bound: true }]);
    const a = await writeCharacter(write, { generator: 'test', format: 'glb' });
    const b = await writeCharacter(write, { generator: 'test', format: 'glb' });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = await parseGlb(a);
    const json = c.json as Record<string, unknown>;
    expect(json['extensionsRequired']).toBeUndefined();
    expect((json['extensions'] as Record<string, unknown> | undefined)?.['VRMC_vrm']).toBeUndefined();
    const skins = json['skins'] as { joints: number[]; skeleton: number }[];
    expect(skins).toHaveLength(1);
    expect(skins[0]?.joints).toEqual(Array.from({ length: 34 }, (_, i) => i));
    expect(skins[0]?.skeleton).toBe(0);
    expect((json['buffers'] as { uri?: string }[]).every((buffer) => buffer.uri === undefined)).toBe(true);
    const meshNode = (json['nodes'] as { mesh?: number; skin?: number }[]).find((node) => node.mesh !== undefined);
    expect(meshNode?.skin).toBe(0);
  });

  it('reads back the weights: the dominant joint of every point survives the palette remap', async () => {
    const data = await cubeLad();
    const { write, input } = await character([{ name: 'Body', data, bound: true }]);
    const bytes = await writeCharacter(write, { generator: 'test', format: 'vrm' });
    const back = await meshFromGltf(await parseGlb(bytes), 0);
    if ('refused' in back) throw new Error(back.reason);
    const skin = skinOfData(back.data);
    const original = input.meshes[0]?.skin;
    expect(skin).not.toBeNull();
    expect(original).not.toBeNull();
    if (skin === null || original === null || original === undefined) return;
    const nameOfSkinSlot = (key: string) => write.skeleton.nodes[Number(key.slice('node:'.length))]?.name;
    const nameOfPalette = (key: string) => input.joints.find((joint) => joint.id === key)?.name;
    // The written vertices weld back into points with the same (dominant joint, weight) multiset.
    const dominant = (s: typeof skin, name: (key: string) => string | undefined) => {
      const out: string[] = [];
      for (let p = 0; p < s.points; p++) {
        out.push(`${name(s.palette[s.joints[4 * p] as number]?.key ?? '')}:${(s.weights[4 * p] as number).toFixed(5)}`);
      }
      return out.sort();
    };
    expect(new Set(dominant(skin, nameOfSkinSlot))).toEqual(new Set(dominant(original, nameOfPalette)));
  });
});
