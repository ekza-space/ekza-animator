// E2E-17 in Node: a VRMA written from Seed-san plays through @pixiv/three-vrm-animation on Seed-san (VRM 1.0) and
// Polybot (VRM 0.x); the normalized bone rotations equal N_b (Seed-san) and flipYaw(N_b) (Polybot), §4.11.9.
import { flipYawQuat, quatAngle, type Quat } from '@ekza-animator/anim-core';
import type { HumanBoneName } from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import { HUMAN_BONE_NAMES } from '@ekza-animator/rig';
import { createVRMAnimationClip, type VRMAnimation, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { AnimationMixer, LoopOnce } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { bakeClip } from '../src/bake/bake';
import { parseGlb } from '../src/glb/parse';
import { skeletonFromGltf } from '../src/skeleton/read';
import { humanoidRestPositions } from '../src/skeleton/rest';
import { loadGltfInNode } from '../src/testing';
import { writeVrma } from '../src/writers/write';
import { bakeOptions } from './helpers/bake';
import { metaOf, poseSource } from './helpers/poses';

describe('VRMA playback through three-vrm-animation', () => {
  it('reproduces N_b on Seed-san and flipYaw(N_b) on Polybot (< 1e-3 rad at 10 frames)', async () => {
    const source = skeletonFromGltf(await parseGlb(readFixture('seed-san.vrm')));
    const clip = bakeClip(poseSource(source), bakeOptions({ target: 'humanoid' }));
    const artifact = await writeVrma(source, clip, {
      meta: metaOf([clip], source),
      fileName: 'wave.vrma',
      profile: null,
      humanoidRestWorld: humanoidRestPositions(source),
    });
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    const gltf = await loader.parseAsync(artifact.bytes.slice().buffer, '');
    const animation = (gltf.userData['vrmAnimations'] as VRMAnimation[])[0] as VRMAnimation;

    for (const target of ['seed-san.vrm', 'polybot.vrm'] as const) {
      const { vrm } = await loadGltfInNode(readFixture(target));
      if (vrm === null) throw new Error(`${target} is not a VRM`);
      const mixer = new AnimationMixer(vrm.scene);
      // Play once and hold the end, so t = duration shows the last sample instead of wrapping to the first.
      const action = mixer.clipAction(createVRMAnimationClip(animation, vrm)).setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      const vrm0 = vrm.meta.metaVersion === '0';
      let maxError = 0;
      let compared = 0;
      for (let frame = 0; frame <= 30; frame += 3) {
        mixer.setTime(frame / 30);
        for (const track of clip.tracks) {
          if (track.path !== 'rotation' || track.times.length < 31) continue;
          const bone = HUMAN_BONE_NAMES[track.node] as HumanBoneName;
          const node = vrm.humanoid.getNormalizedBoneNode(bone);
          if (node === null) continue;
          const nb = Array.from(track.values.subarray(frame * 4, frame * 4 + 4)) as Quat;
          const expected = vrm0 ? flipYawQuat(nb) : nb;
          const q = node.quaternion;
          maxError = Math.max(maxError, quatAngle([q.x, q.y, q.z, q.w], expected));
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(20);
      expect(maxError).toBeLessThan(1e-3);
    }
  });
});
