// Fixtures of io's C10 tests (M6B-SPEC §5.22): bound model characters as writer inputs — the Cube Lad's Standard 33
// truth joints over the generated body or the Cube Lad, Polybot (unskinned, T-pose) with joints at its truth humanoid
// positions, each weighted to its two nearest bones — plus baked clips, the VRM meta and the validators.
import { readFileSync } from 'node:fs';
import type { CharacterVrmMeta, HumanBoneName, JointId, JointRecord } from '@ekza-studio/doc';
import { makeTestJoint, makeTestSkeleton } from '@ekza-studio/doc/testing';
import { type MeshData, withSkin } from '@ekza-studio/mesh-core';
import { HUMAN_BONE_PARENT, type DocSkeletonInput } from '@ekza-studio/rig';
import * as gltfValidator from 'gltf-validator';
import * as vrmValidator from 'vrm-validator';
import { makeVrmMeta } from '@ekza-studio/doc';
import {
  type BakedClip,
  type CharacterMeshIn,
  type CharacterWriteInput,
  characterVertices,
  type EkzaAnimationV1,
  parseGlb,
  patchVrmMeta,
  skeletonFromDoc,
  type StaticSwatch,
} from '../../../src';
import { meshFromGltf } from '../../../src/mesh';
import { manualModelProvenance } from '../../../src/write';
import { IDENTITY16, nearestBoneWeights, order, truthJoints } from '../character-runtime/support';

export const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../../../fixtures/models/${name}`, import.meta.url)));
export const CUBE_TRUTH = JSON.parse(new TextDecoder().decode(fixture('cube-lad-truth.json'))) as Parameters<
  typeof truthJoints
>[0];
const POLYBOT_TRUTH = JSON.parse(new TextDecoder().decode(fixture('polybot-truth.json'))) as {
  readonly poses: {
    readonly tpose: { readonly humanoid: Readonly<Record<string, readonly [number, number, number]>> };
  };
};

export async function meshOf(name: string): Promise<MeshData> {
  const result = await meshFromGltf(await parseGlb(fixture(name)), 0);
  if ('refused' in result) throw new Error(result.reason);
  return result.data;
}

/** Polybot's truth T-pose humanoid as joint records: a root helper, then every bone under its nearest present parent. */
export function polybotJoints(): JointRecord[] {
  const humanoid = POLYBOT_TRUTH.poses.tpose.humanoid;
  const present = new Set(Object.keys(humanoid));
  const joints: JointRecord[] = [
    makeTestJoint('jnt_root', 'skl_truth', {
      parent: null,
      order: order(0),
      name: 'root',
      humanBone: null,
      restPosition: [0, 0, 0],
      restRotation: [0, 0, 0, 1],
      tail: null,
      side: 'C',
      mirror: null,
      role: 'helper',
      key: 'root',
    }),
  ];
  Object.entries(humanoid).forEach(([bone, position], i) => {
    let parent = HUMAN_BONE_PARENT[bone as HumanBoneName] ?? null;
    while (parent !== null && !present.has(parent)) parent = HUMAN_BONE_PARENT[parent] ?? null;
    const side = bone.startsWith('left') ? 'L' : bone.startsWith('right') ? 'R' : 'C';
    joints.push(
      makeTestJoint(`jnt_${bone}` as JointId, 'skl_truth', {
        parent: (parent === null ? 'jnt_root' : `jnt_${parent}`) as JointId,
        order: order(i + 1),
        name: bone,
        humanBone: bone as HumanBoneName,
        restPosition: [...position],
        restRotation: [0, 0, 0, 1],
        tail: null,
        side,
        mirror: null,
        role: 'bone',
        key: bone,
      }),
    );
  });
  return joints;
}

export interface CharacterOptions {
  readonly joints?: readonly JointRecord[];
  readonly preset?: 'unlit' | 'lit';
  readonly colourOutput?: CharacterMeshIn['colourOutput'];
  readonly swatches?: readonly StaticSwatch[];
  readonly vrm?: CharacterVrmMeta | null;
  readonly thumbnailPng?: Uint8Array | null;
  readonly clips?: CharacterWriteInput['clips'];
}

/** A bound character over the given meshes (weights: the two nearest bones; static meshes stay unbound). */
export async function character(
  meshes: readonly { readonly name: string; readonly data: MeshData; readonly bound: boolean }[],
  opts: CharacterOptions = {},
): Promise<{ write: CharacterWriteInput; input: DocSkeletonInput }> {
  const skeleton = makeTestSkeleton('skl_truth', 'chr_truth', { preset: 'standard33' });
  const joints = opts.joints ?? truthJoints(CUBE_TRUTH);
  const docMeshes = meshes.map((mesh, i) => {
    const skin = mesh.bound ? nearestBoneWeights(mesh.data, joints) : null;
    return { id: `msh_${i}`, name: mesh.name, data: skin === null ? mesh.data : withSkin(mesh.data, skin), skin };
  });
  const meshIns: CharacterMeshIn[] = docMeshes.map((mesh) => ({
    id: mesh.id as never,
    name: mesh.name,
    data: mesh.data,
    skin: mesh.skin,
    materials: [{ preset: opts.preset ?? 'unlit', name: 'Palette' }],
    colourOutput: opts.colourOutput ?? 'palette-texture',
    paletteId: 'pal_A',
    prop: false,
  }));
  const palettes = new Map<string, readonly StaticSwatch[]>([
    ['pal_A', opts.swatches ?? [{ slot: 0, srgb: [200, 120, 80] }]],
  ]);
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
    clips: opts.clips ?? [],
    vrm: opts.vrm === undefined ? testMeta() : opts.vrm,
    thumbnailPng: opts.thumbnailPng ?? null,
    model: manualModelProvenance({
      toolVersion: 'test',
      rig: 'vrm-humanoid',
      skeletonTemplate: 'vrm-humanoid@1.0.0/standard33',
    }),
    heightScale: null,
  };
  return { write, input };
}

/** A raw baked clip rotating one joint node about Y over `frames` frames at 30 fps. */
export function bakedTurn(name: string, node: number, frames = 30, opts: { slot?: string | null } = {}): BakedClip {
  const times = new Float32Array(frames + 1).map((_, i) => Math.fround(i / 30));
  const values = new Float32Array(4 * (frames + 1));
  for (let i = 0; i <= frames; i++) {
    const half = (i / frames) * 0.5 * 0.5;
    values.set([0, Math.fround(Math.sin(half)), 0, Math.fround(Math.cos(half))], 4 * i);
  }
  return {
    name,
    target: 'raw',
    fps: { num: 30, den: 1 },
    frameCount: frames + 1,
    duration: frames / 30,
    tracks: [{ node, path: 'rotation', interpolation: 'LINEAR', times, values }],
    restHipsPosition: null,
    meta: {
      index: 0,
      name,
      slot: opts.slot === undefined ? name : opts.slot,
      loop: true,
      fps: 30,
      durationSeconds: frames / 30,
      rootMotion: 'hips',
      contactSeconds: null,
      tags: [],
      derivedFrom: [
        { title: 'Universal Animation Library', author: 'Quaternius', license: 'CC0-1.0', sourceSha256: null },
      ],
      redistributable: 'yes',
    },
    warnings: [],
  };
}

/** The clips' metadata as editor-core builds it (`ekzaAnimationMeta`). */
export function animationMeta(clips: readonly BakedClip[]): EkzaAnimationV1 {
  return {
    schema: 1,
    rig: 'vrm-humanoid',
    clips: clips.map((clip, index) => ({ ...clip.meta, index, name: clip.name })),
    provenance: { tool: 'ekza-animator', toolVersion: 'test', projectSha256: null, baseSha256: null, derivedFrom: [] },
  };
}

/** glTF-Validator errors (VRM extensions are unknown to it: UNSUPPORTED_EXTENSION is ignored). */
export async function gltfErrors(bytes: Uint8Array): Promise<string[]> {
  const report = await gltfValidator.validateBytes(bytes, {
    format: 'glb',
    maxIssues: 0,
    ignoredIssues: ['UNSUPPORTED_EXTENSION'],
    writeTimestamp: false,
  });
  return report.issues.messages.filter((m) => m.severity === 0).map((m) => `${m.code} ${m.pointer ?? ''} ${m.message}`);
}

/** vrm-validator errors (the VRM 1.0 checks, CI only per §2.1). */
export async function vrmErrors(bytes: Uint8Array): Promise<string[]> {
  const report = await vrmValidator.validateBytes(bytes, { format: 'glb', maxIssues: 0, writeTimestamp: false });
  return report.issues.messages.filter((m) => m.severity === 0).map((m) => `${m.code} ${m.pointer ?? ''} ${m.message}`);
}

/** A complete VRM meta: name, one author, the CC0 preset. */
export function testMeta(): CharacterVrmMeta {
  return patchVrmMeta(makeVrmMeta('Lad'), { authors: ['Tester'], licensePreset: 'cc0' });
}
