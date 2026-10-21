// M6B-SPEC §4.4 and §0.5 (C0): io's working baselines (C1 landed measureSkinned, writeCharacter and
// synthesizeContainer: their tests are test/m6b/character-runtime/*) — `skeletonFromDoc` for a skeleton without skinned meshes (rest
// data only: radii null, joint-based height) and `jointsFingerprint` — the spec's UAL bone map against the fixture's
// deformers, and every stub failing `not-implemented`.
import type { JointRecord, SkeletonRecord } from '@ekza-studio/doc';
import { makeTestJoint, makeTestSkeleton, readFixture } from '@ekza-studio/doc/testing';
import { describe, expect, it } from 'vitest';
import {
  jointsFingerprint,
  parseGlb,
  parseStarterPackManifest,
  retargetUalClip,
  skeletonFromDoc,
  skeletonFromGltf,
  UAL_BONE_MAP,
  VRM_LINT_RULES,
  writeHumanoidVrma,
} from '../../src';
import { skeletonFingerprint } from '../../src/skeleton/read';

const SKELETON: SkeletonRecord = makeTestSkeleton('skl_A', 'chr_A', { preset: 'custom' });
const turn = (deg: number): [number, number, number, number] => {
  const half = (deg * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
};

/** root (helper) → hips → spine, hips → prop; given out of order, with a deleted joint and a joint of another skeleton. */
function joints(): JointRecord[] {
  return [
    makeTestJoint('jnt_spine', 'skl_A', {
      parent: 'jnt_hips' as never,
      name: 'Spine',
      humanBone: 'spine',
      restPosition: [0, 1.2, 0],
      restRotation: turn(90),
      key: 'spine',
    }),
    makeTestJoint('jnt_root', 'skl_A', { name: 'Root', role: 'helper', key: 'root' }),
    makeTestJoint('jnt_prop', 'skl_A', {
      parent: 'jnt_hips' as never,
      order: 'a0',
      name: 'Prop',
      role: 'prop',
      restPosition: [0.3, 1, 0],
      key: 'prop',
    }),
    makeTestJoint('jnt_hips', 'skl_A', {
      parent: 'jnt_root' as never,
      name: 'Hips',
      humanBone: 'hips',
      restPosition: [0, 1, 0],
      restRotation: turn(90),
      key: 'hips',
    }),
    makeTestJoint('jnt_spine', 'skl_A', { order: 'a1' }),
    makeTestJoint('jnt_gone', 'skl_A', { parent: 'jnt_hips' as never, deleted: { by: 'u' as never, at: 1 } }),
    makeTestJoint('jnt_other', 'skl_B', {}),
  ].filter((joint, i, all) => all.findIndex((other) => other.id === joint.id) === i);
}

describe('skeletonFromDoc (C0 baseline: rest data only)', () => {
  const desc = skeletonFromDoc({ skeleton: SKELETON, joints: joints(), meshes: [] });

  it('orders live joints of the skeleton parents first, siblings by order then id', () => {
    expect(desc.nodes.map((node) => [node.name, node.parent])).toEqual([
      ['Root', -1],
      ['Hips', 0],
      ['Prop', 1],
      ['Spine', 1],
    ]);
    expect(desc.nodes.every((node) => node.isJoint && !node.hasMesh && !node.hasMatrix)).toBe(true);
    expect(desc.jointKeys).toEqual(['root', 'hips', 'prop', 'spine']);
    expect([desc.helpers, desc.props]).toEqual([[0], [2]]);
  });

  it('derives rest locals from the character-space rest positions and rotations', () => {
    const hips = desc.nodes[1];
    expect(hips?.restLocal.t).toEqual([0, 1, 0]);
    const spine = desc.nodes[3];
    // The parent is turned 90° about +Z: a +Y offset in character space is −X in the parent's frame.
    expect(spine?.restLocal.t[0]).toBeCloseTo(0.2, 12);
    expect(spine?.restLocal.t[1]).toBeCloseTo(0, 12);
    expect(spine?.restLocal.q[3]).toBeCloseTo(1, 12);
  });

  it('maps the humanoid, has no radii and a joint-based height, and fingerprints the joints', () => {
    expect(desc.format).toBe('vrm1');
    expect(desc.humanoid).toEqual({ hips: 1, spine: 3 });
    expect(desc.boneRadii).toEqual([null, null, null, null]);
    expect(desc.heightSource).toBe('joints');
    expect(desc.height).toBeCloseTo(1.2 * 1.15, 12);
    expect(desc.fingerprint).toBe(jointsFingerprint(desc.nodes));
    const generic = skeletonFromDoc({ skeleton: { ...SKELETON, template: 'generic' }, joints: joints(), meshes: [] });
    expect([generic.format, generic.humanoid]).toEqual(['gltf', null]);
  });
});

describe('jointsFingerprint (C0 baseline)', () => {
  it('equals skeletonFingerprint over joint nodes only; mesh nodes never change it', async () => {
    const vrm = skeletonFromGltf(await parseGlb(readFixture('polybot.vrm')));
    const jointsOnly = vrm.nodes.filter((node) => node.isJoint);
    expect(jointsOnly.length).toBeGreaterThan(0);
    expect(vrm.nodes.length).toBeGreaterThan(jointsOnly.length);
    const renamedMeshes = vrm.nodes.map((node) => (node.isJoint ? node : { ...node, name: `${node.name}-mesh` }));
    expect(jointsFingerprint(renamedMeshes)).toBe(jointsFingerprint(vrm.nodes));
    const allJoints = vrm.nodes.map((node) => ({ ...node, isJoint: true }));
    expect(jointsFingerprint(allJoints)).toBe(skeletonFingerprint(allJoints));
  });
});

describe('UAL_BONE_MAP (§0.4.7)', () => {
  it('maps 52 deformers of the fixture to distinct VRM 1.0 humanoid bones', async () => {
    const ual = await parseGlb(readFixture('quaternius-ual.glb'));
    const names = new Set(((ual.json['nodes'] as { name?: string }[]) ?? []).map((node) => node.name));
    const keys = Object.keys(UAL_BONE_MAP);
    expect(keys).toHaveLength(52);
    expect(keys.filter((key) => !names.has(key))).toEqual([]);
    expect(new Set(Object.values(UAL_BONE_MAP)).size).toBe(52);
    expect(UAL_BONE_MAP['DEF-thumb.01.L']).toBe('leftThumbMetacarpal');
    expect(UAL_BONE_MAP['DEF-f_pinky.03.R']).toBe('rightLittleDistal');
  });
});

describe('stubs fail not-implemented (§3 rule 1)', () => {
  const any = null as never;
  it.each([
    ['io.parseStarterPackManifest', () => parseStarterPackManifest({})],
    ['io.retargetUalClip', () => retargetUalClip(any, 'Walk_Loop')],
  ] as const)('%s', (message, call) => {
    expect(call).toThrow(expect.objectContaining({ code: 'not-implemented', message }));
  });
  it.each([
    [
      'io.writeHumanoidVrma',
      () => writeHumanoidVrma(any, { generator: 'g', license: 'CC0-1.0', credit: 'Q', source: 's' }),
    ],
  ] as const)('%s rejects', async (message, call) => {
    await expect(call()).rejects.toMatchObject({ code: 'not-implemented', message });
  });
  it('VRM_LINT_RULES is empty until C10', () => {
    expect(VRM_LINT_RULES).toEqual([]);
  });
});
