// M2A-SPEC §9.2 (io): the writers are unchanged without `reduce` — byte-identical to the M1 outputs on the three
// fixtures. The SHA-256 values below were recorded from the M1 io sources (A0 merge base) and re-checked after the
// M2a reduction landed; a deliberate writer change updates them in the same commit with the reason.
import type { HumanBoneName } from '@ekza-animator/doc';
import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import type { SkeletonDesc } from '@ekza-animator/rig';
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
  'seed-san.vrm/animation-glb': 'ea72ec1789db10d94ed1c98f82bd0b824ab5d5f290b86e8cc3c31ffb1140ab41',
  'seed-san.vrm/vrma': 'bf1bcc5e5ab8f9274a81ffe475f1815900bf76d0b94b432018e4ed2cceefc855',
  'seed-san.vrm/bake-into-model': 'feb9e59f75f45ab88994b9ee40dbdee0a9d4eedf2551992a18ac07a911481269',
  'polybot.vrm/animation-glb': '78f67ffe402905892e74c5b6525937af3b3bb1ba07ac3afba55e6313d73ab71d',
  'polybot.vrm/vrma': '76f9b386d83d61b1610b10cff73837a04d75a21e1f1bcbb4147e06f7ec8c633b',
  'polybot.vrm/bake-into-model': '24a0623c405b7f3a05400ffb266f4ffc84395cff1fcad4561cc6f311ecb80af1',
  'quaternius-ual.glb/animation-glb': '5a823f2e87b0e10b25c495ee84f52fc622a1d1374cbfa1ae2033337707e8e66a',
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
