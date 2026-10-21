// M2A-SPEC §9.2 (io): the writers are unchanged without `reduce` — byte-identical to the M1 outputs on the three
// fixtures. The SHA-256 values below were recorded from the M1 io sources (A0 merge base) and re-checked after the
// M2a reduction landed; a deliberate writer change updates them in the same commit with the reason.
// Re-recorded for the Ekza Studio rename: `asset.generator` 'Ekza Animator 0.1.0' → 'Ekza Studio 0.1.0' (the only
// change; outputs that keep the source file's generator, polybot and quaternius bake-into-model, are unchanged).
import type { HumanBoneName } from '@ekza-studio/doc';
import { type LicensedFixture, readFixture } from '@ekza-studio/doc/testing';
import type { ReadonlyXf } from '@ekza-studio/anim-core';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { bakeClip, ekzaAnimationMeta } from '../src/bake/bake';
import { parseGlb } from '../src/glb/parse';
import { skeletonFromGltf } from '../src/skeleton/read';
import { humanoidRestPositions } from '../src/skeleton/rest';
import { bakeIntoModel } from '../src/surgeon/bakeIntoModel';
import { createFkPoseSource } from '../src/testing';
import type { BakedClip, PoseSource } from '../src/types';
import { writeAnimationGlb, writeVrma } from '../src/writers/write';
import { bakeOptions, clipMeta, rotated } from './helpers/bake';

/** Waves a few bones (humanoid arms and hips, or the first joints of a generic rig) over the clip. */
function poseSource(skeleton: SkeletonDesc): PoseSource {
  const humanoid = skeleton.humanoid;
  const animated = new Set(
    humanoid !== null
      ? (['leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'spine', 'hips'] as HumanBoneName[])
          .map((b) => humanoid[b])
          .filter((n) => n !== undefined)
      : skeleton.nodes
          .filter((n) => n.isJoint)
          .slice(0, 6)
          .map((n) => n.index),
  );
  return createFkPoseSource(skeleton, {
    pose: (node, frame) => {
      if (!animated.has(node)) return null;
      const rest = skeleton.nodes[node]?.restLocal as ReadonlyXf;
      const r = rotated(rest, [0.3, 0.2, 1], Math.sin(frame / 7) * 0.8);
      return node === humanoid?.hips ? { ...r, t: [rest.t[0] + frame * 0.002, rest.t[1], rest.t[2]] } : r;
    },
  });
}

const PROVENANCE = { toolVersion: '0.1.0', projectSha256: null, baseSha256: null } as const;
const rigOf = (skeleton: SkeletonDesc) => (skeleton.humanoid === null ? 'gltf-nodes' : 'vrm-humanoid');

const M1_SHA256: Readonly<Record<string, string>> = {
  'seed-san.vrm/animation-glb': '099b24e92dc3ab2412da6067f91a11723bb886186902abf57cee6038c88888c5',
  'seed-san.vrm/vrma': 'f4f815417bcab51b4e50f3af5c0be9cac1b6b3ab77135757e57146a3b7fd2587',
  'seed-san.vrm/bake-into-model': 'ae47d2568ef1a23a24ee863858072cddb0bbdb3a9878292683bb2cdaafc8acc9',
  'polybot.vrm/animation-glb': 'd587133052a77cadb1ebedcdefc5d8a3858ffc9c2aa6dccb4e0db1b614209d20',
  'polybot.vrm/vrma': '5d8748c6453c844714f67a72d1e632aa94137a37b22e6024221b0b9d0ac8b381',
  'polybot.vrm/bake-into-model': '24a0623c405b7f3a05400ffb266f4ffc84395cff1fcad4561cc6f311ecb80af1',
  'quaternius-ual.glb/animation-glb': 'b87159ca66e17901cf805cb076c9f578106d6b4f170e1d71174846211966ee77',
  'quaternius-ual.glb/bake-into-model': '8ec653e70cdfb49f444280ad0c49dae7dfa675e4836c4f6eb5c2e9bef452220f',
};

describe('writers without reduce: the M1 bytes', () => {
  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm', 'quaternius-ual.glb'])('%s', async (name) => {
    const source = await parseGlb(readFixture(name));
    const skeleton = skeletonFromGltf(source);
    const pose = poseSource(skeleton);
    const raw: BakedClip[] = [
      bakeClip(pose, bakeOptions({ name: 'wave', meta: clipMeta('wave') })),
      bakeClip(pose, bakeOptions({ name: 'idle', range: { start: 0, end: 12 }, meta: clipMeta('idle', { index: 1 }) })),
    ];
    const got: Record<string, string> = {};
    const glb = await writeAnimationGlb(skeleton, raw, {
      meta: ekzaAnimationMeta(raw, rigOf(skeleton), PROVENANCE),
      fileName: 'out.glb',
      profile: null,
    });
    got[`${name}/animation-glb`] = glb.sha256;
    if (skeleton.humanoid !== null) {
      const clip = bakeClip(pose, bakeOptions({ target: 'humanoid' }));
      const vrma = await writeVrma(skeleton, clip, {
        meta: ekzaAnimationMeta([clip], 'vrm-humanoid', PROVENANCE),
        fileName: 'out.vrma',
        profile: null,
        humanoidRestWorld: humanoidRestPositions(skeleton),
      });
      got[`${name}/vrma`] = vrma.sha256;
    }
    const baked = await bakeIntoModel(source, skeleton, raw, {
      meta: ekzaAnimationMeta(raw, rigOf(skeleton), { ...PROVENANCE, baseSha256: source.sha256 }),
      fileName: 'out.vrm',
      profile: null,
    });
    got[`${name}/bake-into-model`] = baked.sha256;
    expect(got).toEqual(Object.fromEntries(Object.keys(got).map((key) => [key, M1_SHA256[key]])));
  });
});
