// Pose sources and bake helpers over real fixtures (writers and surgeon tests).
import type { ReadonlyXf } from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { bakeClip, ekzaAnimationMeta } from '../../src/bake/bake';
import { createFkPoseSource } from '../../src/testing';
import type { BakedClip, EkzaAnimationV1, PoseSource } from '../../src/types';
import { bakeOptions, clipMeta, rotated } from './bake';

/** Waves the humanoid arms, spine and hips (or, for generic rigs, the first few joints) over the clip. */
export function poseSource(skeleton: SkeletonDesc, phase = 0): PoseSource {
  const humanoid = skeleton.humanoid;
  const animated = new Set(
    humanoid !== null
      ? (['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'spine', 'hips'] as HumanBoneName[])
          .map((b) => humanoid[b])
          .filter((n): n is number => n !== undefined)
      : skeleton.nodes
          .filter((n) => n.isJoint)
          .slice(0, 6)
          .map((n) => n.index),
  );
  return createFkPoseSource(skeleton, {
    pose: (node, frame) => {
      if (!animated.has(node)) return null;
      const rest = skeleton.nodes[node]?.restLocal as ReadonlyXf;
      const r = rotated(rest, [0.3, 0.2, 1], Math.sin((frame + phase) / 7) * 0.8);
      return node === humanoid?.hips ? { ...r, t: [rest.t[0] + frame * 0.002, rest.t[1], rest.t[2]] } : r;
    },
  });
}

export function rawClip(skeleton: SkeletonDesc, name: string, phase = 0): BakedClip {
  return bakeClip(poseSource(skeleton, phase), bakeOptions({ name, meta: clipMeta(name) }));
}

export function metaOf(clips: readonly BakedClip[], skeleton: SkeletonDesc): EkzaAnimationV1 {
  return ekzaAnimationMeta(clips, skeleton.humanoid === null ? 'gltf-nodes' : 'vrm-humanoid', {
    toolVersion: '0.1.0',
    projectSha256: null,
    baseSha256: null,
  });
}
