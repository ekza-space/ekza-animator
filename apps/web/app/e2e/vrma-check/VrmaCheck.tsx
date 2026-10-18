'use client';

// The e2e VRMA check (MVP-SPEC E2E-17): an independent player for the editor's VRMA output. It loads the bundled
// Seed-san (VRM 1.0) and Polybot (VRM 0.x) with three.js + `@pixiv/three-vrm`, plays a VRMA with
// `@pixiv/three-vrm-animation` (the reference reader, §4.11.7) and reports the normalized bone rotations at the
// requested times. No editor code is involved: what the spec compares is the third-party reading of our file.
import { type VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { createVRMAnimationClip, type VRMAnimation, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { type JSX, useEffect, useState } from 'react';
import { AnimationMixer, LoopOnce } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Bundled samples the check plays on (served from `public/samples/`, see `scripts/copy-assets.mjs`). */
const MODELS = { 'seed-san': '/samples/seed-san.vrm', polybot: '/samples/polybot.vrm' } as const;
type ModelId = keyof typeof MODELS;

type Quat = readonly [number, number, number, number];

export interface VrmaCheckModelResult {
  /** `'0'` for VRM 0.x (three-vrm's normalized space then faces −Z: rotations are `flipYaw(N_b)`), `'1'` otherwise. */
  readonly metaVersion: '0' | '1';
  /** Humanoid bones the model has (normalized nodes). */
  readonly bones: readonly string[];
  /** Normalized bone rotations per requested time, keyed by VRM 1.0 humanoid bone name. */
  readonly samples: readonly { readonly time: number; readonly rotations: Readonly<Record<string, Quat>> }[];
}

export interface VrmaCheckApi {
  /** Both models loaded. */
  readonly ready: Promise<void>;
  /** Plays the VRMA (once, holding the end) on every model and samples the normalized rotations at `times` (s). */
  play(vrma: Uint8Array, times: readonly number[]): Promise<Record<ModelId, VrmaCheckModelResult>>;
}

declare global {
  interface Window {
    __EKZA_VRMA_CHECK__?: VrmaCheckApi;
  }
}

function newLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

async function loadVrm(url: string): Promise<VRM> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const gltf = await newLoader().parseAsync(bytes, '');
  const vrm = gltf.userData['vrm'] as VRM | undefined;
  if (vrm === undefined) throw new Error(`${url} is not a VRM`);
  return vrm;
}

async function readAnimation(vrma: Uint8Array): Promise<VRMAnimation> {
  const gltf = await newLoader().parseAsync(vrma.slice().buffer, '');
  const animation = (gltf.userData['vrmAnimations'] as VRMAnimation[] | undefined)?.[0];
  if (animation === undefined) throw new Error('The file has no VRMC_vrm_animation');
  return animation;
}

function sample(vrm: VRM, animation: VRMAnimation, times: readonly number[]): VrmaCheckModelResult {
  const bones = Object.keys(vrm.humanoid.humanBones).filter(
    (bone) => vrm.humanoid.getNormalizedBoneNode(bone as never) !== null,
  );
  vrm.humanoid.resetNormalizedPose();
  const mixer = new AnimationMixer(vrm.scene);
  // Once, holding the end: a time at the clip's duration shows the last sample instead of wrapping to the first.
  const action = mixer.clipAction(createVRMAnimationClip(animation, vrm)).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const samples = times.map((time) => {
    mixer.setTime(time);
    vrm.update(0);
    const rotations: Record<string, Quat> = {};
    for (const bone of bones) {
      const q = vrm.humanoid.getNormalizedBoneNode(bone as never)?.quaternion;
      if (q !== undefined) rotations[bone] = [q.x, q.y, q.z, q.w];
    }
    return { time, rotations };
  });
  action.stop();
  mixer.uncacheRoot(vrm.scene);
  vrm.humanoid.resetNormalizedPose();
  return { metaVersion: vrm.meta.metaVersion === '0' ? '0' : '1', bones, samples };
}

export function VrmaCheck(): JSX.Element {
  const [status, setStatus] = useState('Loading Seed-san and Polybot…');

  useEffect(() => {
    let disposed = false;
    const models = Promise.all(
      (Object.keys(MODELS) as ModelId[]).map(async (id) => [id, await loadVrm(MODELS[id])] as const),
    ).then((entries) => new Map<ModelId, VRM>(entries));
    const api: VrmaCheckApi = {
      ready: models.then(() => undefined),
      async play(vrma, times) {
        const [loaded, animation] = await Promise.all([models, readAnimation(vrma)]);
        const result = {} as Record<ModelId, VrmaCheckModelResult>;
        for (const [id, vrm] of loaded) result[id] = sample(vrm, animation, times);
        if (!disposed) setStatus(`Played a VRMA at ${times.length} times on ${loaded.size} models.`);
        return result;
      },
    };
    window.__EKZA_VRMA_CHECK__ = api;
    models.then(
      () => !disposed && setStatus('Ready: Seed-san and Polybot loaded.'),
      (error: unknown) => !disposed && setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`),
    );
    return () => {
      disposed = true;
      if (window.__EKZA_VRMA_CHECK__ === api) delete window.__EKZA_VRMA_CHECK__;
    };
  }, []);

  return (
    <main className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-2">
      <output data-testid="vrma-check-status">{status}</output>
    </main>
  );
}
