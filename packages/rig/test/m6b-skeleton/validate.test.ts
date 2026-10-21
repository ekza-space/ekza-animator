// checkSkeleton (M6B-SPEC §5.21, §0.4.2; C2): a fitted template is clean; each skel.* and xform.* rule fires on its
// own defect with the ids it concerns.
import { mat4Compose } from '@ekza-studio/anim-core';
import type { JointId, JointRecord, MeshId, SkeletonId, SkeletonRecord } from '@ekza-studio/doc';
import { primitive } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  checkSkeleton,
  DEFAULT_FLEXION,
  type DocSkeletonInput,
  type RigProblemCode,
  skeletonTemplate,
  templateJointRecords,
} from '../../src';

const SKEL = 'skl_v' as SkeletonId;
const skeleton: SkeletonRecord = {
  id: SKEL,
  character: 'chr_v' as never,
  template: 'vrm-humanoid',
  templateVersion: '1.0.0',
  preset: 'standard33',
  symmetry: true,
  deleted: null,
};
const id = (key: string) => `${SKEL}:${key}` as JointId;
const human = () =>
  templateJointRecords(
    skeletonTemplate('standard33', { height: 1.7, proportions: 'standard', flexion: DEFAULT_FLEXION }),
    SKEL,
  );
const patch = (joints: JointRecord[], key: string, fields: Partial<JointRecord>) =>
  joints.map((j) => (j.id === id(key) ? { ...j, ...fields } : j));
const codes = (joints: readonly JointRecord[], meshes: DocSkeletonInput['meshes'] = []): RigProblemCode[] =>
  checkSkeleton({ skeleton, joints, meshes }).map((p) => p.code);
const identity = mat4Compose({ t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
const cube = primitive('cube', {});

describe('checkSkeleton', () => {
  it('a template skeleton (flexed, symmetric, T-posed) is clean', () => {
    expect(codes(human())).toEqual([]);
  });

  it('required bones, unique names and human bones, parent map, multiple roots', () => {
    const joints = human();
    const missing = checkSkeleton({
      skeleton,
      joints: joints.filter(
        (j) => j.key !== 'leftHand' && !j.key.startsWith('leftThumb') && !j.key.startsWith('leftMiddle'),
      ),
      meshes: [],
    });
    expect(missing.find((p) => p.code === 'skel.required-bones')?.ids).toEqual(['leftHand']);
    expect(codes(patch(joints, 'leftHand', { name: 'hips' }))).toContain('skel.unique-names');
    expect(codes(patch(joints, 'leftHand', { humanBone: 'rightHand' }))).toContain('skel.unique-human-bone');
    const wrongParent = checkSkeleton({
      skeleton,
      joints: patch(joints, 'leftHand', { parent: id('chest') }),
      meshes: [],
    });
    expect(wrongParent.find((p) => p.code === 'skel.parent-map')?.ids).toEqual([id('leftHand')]);
    expect(codes(patch(joints, 'leftUpperLeg', { parent: null }))).toContain('skel.multiple-roots');
  });

  it('T-pose: A-posed arms fail, splayed thighs pass; hinge bend; symmetry; facing', () => {
    const joints = human();
    const elbow = joints.find((j) => j.id === id('leftLowerArm')) as JointRecord;
    const hand = joints.find((j) => j.id === id('leftHand')) as JointRecord;
    const aPosed = patch(
      patch(joints, 'leftLowerArm', {
        restPosition: [elbow.restPosition[0], elbow.restPosition[1] - 0.15, elbow.restPosition[2]],
      }),
      'leftHand',
      {
        restPosition: [hand.restPosition[0], hand.restPosition[1] - 0.3, hand.restPosition[2]],
      },
    );
    const tpose = checkSkeleton({ skeleton, joints: aPosed, meshes: [] }).find((p) => p.code === 'skel.tpose');
    expect(tpose?.ids).toContain(id('leftUpperArm'));
    expect(codes(aPosed)).toContain('skel.symmetry');
    const splayed = patch(patch(joints, 'leftUpperLeg', { restPosition: [0.04, 0.83, 0] }), 'rightUpperLeg', {
      restPosition: [-0.04, 0.83, 0],
    });
    expect(codes(splayed)).not.toContain('skel.tpose');
    const straight = patch(joints, 'leftLowerLeg', { restPosition: [0.056 * 1.7, 0.29 * 1.7, 0] });
    expect(codes(straight)).toEqual(['skel.hinge-bend']);
    const toes = joints.find((j) => j.id === id('leftToes')) as JointRecord;
    expect(
      codes(patch(joints, 'leftToes', { restPosition: [toes.restPosition[0], toes.restPosition[1], -0.1] })),
    ).toContain('skel.facing');
  });

  it('grounded and the xform rules use the meshes’ world placements', () => {
    const joints = human();
    const lifted = mat4Compose({ t: [0, 0.6, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    const mesh = (placement: Float64Array, skinned: boolean) => ({
      id: 'msh_a' as MeshId,
      data: cube,
      skin: skinned ? ({} as never) : null,
      placement,
    });
    expect(codes(joints, [mesh(identity, true)])).toContain('skel.grounded'); // a unit cube centred on the origin
    expect(codes(joints, [mesh(lifted, false)])).not.toContain('xform.not-frozen');
    expect(codes(joints, [mesh(lifted, true)])).toContain('xform.not-frozen');
    const scaled = mat4Compose({ t: [0, 0.5, 0], q: [0, 0, 0, 1], s: [2, 2, 2] });
    expect(codes(joints, [mesh(scaled, true)])).toEqual(expect.arrayContaining(['xform.scale', 'xform.not-frozen']));
    const grounded = mat4Compose({ t: [0, 0.5, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });
    expect(codes(joints, [mesh(grounded, false)])).toEqual([]);
  });

  it('orientation-mixed: siblings with World and aimed rests', () => {
    expect(codes(patch(human(), 'leftUpperLeg', { restRotation: [0, 0, 0.2, Math.sqrt(0.96)] }))).toContain(
      'skel.orientation-mixed',
    );
  });
});
