'use client';

// The e2e character check (M6B-SPEC §5.22 "three-vrm `VRMLoaderPlugin` loads the VRM, `humanoid.getRawBoneNode`
// resolves every mapped bone, a VRMA idle plays on it"; E2E-SKIN-05; C10): an independent reader of the editor's
// character export. three.js + `@pixiv/three-vrm` load the bytes; the report lists the meta, the humanoid bones and
// whether each raw bone resolves, the skinned meshes' triangles and joints, the embedded clips, and the motion of a
// VRMA idle (`@pixiv/three-vrm-animation`: the bytes the caller passes, else a built-in two-key idle on the arms and
// spine) and of the first embedded clip. No editor code is involved.
import { type VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimation, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { type JSX, useEffect, useState } from 'react';
import {
  AnimationMixer,
  type Bone,
  type Mesh,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  type SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface CharacterCheckResult {
  readonly metaVersion: '0' | '1' | null;
  readonly meta: {
    readonly name: string | null;
    readonly authors: readonly string[];
    readonly licenseUrl: string | null;
    readonly thumbnail: { readonly width: number; readonly height: number } | null;
  };
  /** Mapped humanoid bones (by the file), and the ones whose raw bone node three-vrm cannot resolve. */
  readonly humanoid: readonly string[];
  readonly unresolved: readonly string[];
  readonly skinnedMeshes: number;
  readonly tris: number;
  readonly joints: number;
  readonly clips: readonly string[];
  /** Largest normalized-bone rotation (rad) the VRMA idle produced over its first half second. */
  readonly vrmaMotion: number;
  readonly vrmaPlayed: boolean;
  /** Largest raw-bone rotation (rad) the first embedded clip produced over its first half second (0 without clips). */
  readonly clipMotion: number;
}

export interface CharacterCheckApi {
  check(bytes: Uint8Array, opts?: { readonly vrma?: Uint8Array }): Promise<CharacterCheckResult>;
}

declare global {
  interface Window {
    __EKZA_CHARACTER_CHECK__?: CharacterCheckApi;
  }
}

function newLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

/** A two-key idle (0 → 0.5 s → 1 s): the upper arms down 20°, the spine forward 5°. */
function builtinIdle(): VRMAnimation {
  const animation = new VRMAnimation();
  animation.duration = 1;
  const turn = (axis: [number, number, number], degrees: number) =>
    new Quaternion().setFromAxisAngle(new Vector3(axis[0], axis[1], axis[2]), (degrees * Math.PI) / 180);
  const track = (bone: string, q: Quaternion) =>
    new QuaternionKeyframeTrack(bone, [0, 0.5, 1], [0, 0, 0, 1, q.x, q.y, q.z, q.w, 0, 0, 0, 1]);
  animation.humanoidTracks.rotation.set('leftUpperArm', track('leftUpperArm', turn([0, 0, 1], -20)));
  animation.humanoidTracks.rotation.set('rightUpperArm', track('rightUpperArm', turn([0, 0, 1], 20)));
  animation.humanoidTracks.rotation.set('spine', track('spine', turn([1, 0, 0], 5)));
  return animation;
}

function angleBetween(a: Quaternion, b: Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
}

function rotations(objects: readonly Object3D[]): Quaternion[] {
  return objects.map((object) => object.quaternion.clone());
}

/** Largest rotation change of `objects` between t = 0 and the sampled times of `mixer`'s clip. */
function motion(mixer: AnimationMixer, update: () => void, objects: readonly Object3D[]): number {
  mixer.setTime(0);
  update();
  const start = rotations(objects);
  let most = 0;
  for (const t of [0.1, 0.25, 0.4, 0.5]) {
    mixer.setTime(t);
    update();
    objects.forEach((object, i) => {
      most = Math.max(most, angleBetween(start[i] as Quaternion, object.quaternion));
    });
  }
  return most;
}

async function check(bytes: Uint8Array, opts?: { readonly vrma?: Uint8Array }): Promise<CharacterCheckResult> {
  const gltf = await newLoader().parseAsync(bytes.slice().buffer, '');
  const vrm = gltf.userData['vrm'] as VRM | undefined;
  const json = gltf.parser.json as {
    extensions?: { VRMC_vrm?: { humanoid?: { humanBones?: Record<string, unknown> } } };
  };
  const humanoid = Object.keys(json.extensions?.VRMC_vrm?.humanoid?.humanBones ?? {});
  let tris = 0;
  let skinnedMeshes = 0;
  const bones = new Set<Bone>();
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh & Partial<SkinnedMesh>;
    if (mesh.isMesh !== true) return;
    const geometry = mesh.geometry;
    tris += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    if (mesh.isSkinnedMesh === true && mesh.skeleton !== undefined) {
      skinnedMeshes++;
      for (const bone of mesh.skeleton.bones) bones.add(bone);
    }
  });
  const clips = gltf.animations.map((clip) => clip.name);
  if (vrm === undefined) {
    return {
      metaVersion: null,
      meta: { name: null, authors: [], licenseUrl: null, thumbnail: null },
      humanoid,
      unresolved: humanoid,
      skinnedMeshes,
      tris,
      joints: bones.size,
      clips,
      vrmaMotion: 0,
      vrmaPlayed: false,
      clipMotion: 0,
    };
  }
  const unresolved = humanoid.filter((bone) => vrm.humanoid.getRawBoneNode(bone as never) === null);
  const meta = vrm.meta as unknown as {
    metaVersion: string;
    name?: string;
    authors?: string[];
    licenseUrl?: string;
    thumbnailImage?: HTMLImageElement;
  };
  const thumbnail =
    meta.thumbnailImage === undefined ? null : { width: meta.thumbnailImage.width, height: meta.thumbnailImage.height };

  // The VRMA idle on the normalized humanoid.
  const animation =
    opts?.vrma === undefined
      ? builtinIdle()
      : ((await newLoader().parseAsync(opts.vrma.slice().buffer, '')).userData['vrmAnimations'] as VRMAnimation[])[0];
  if (animation === undefined) throw new Error('The VRMA has no VRMC_vrm_animation');
  vrm.humanoid.resetNormalizedPose();
  const normalized = humanoid
    .map((bone) => vrm.humanoid.getNormalizedBoneNode(bone as never))
    .filter((node): node is NonNullable<typeof node> => node !== null);
  const mixer = new AnimationMixer(vrm.scene);
  mixer.clipAction(createVRMAnimationClip(animation, vrm)).play();
  const vrmaMotion = motion(mixer, () => vrm.update(0), normalized);
  mixer.stopAllAction();
  mixer.uncacheRoot(vrm.scene);
  vrm.humanoid.resetNormalizedPose();
  vrm.update(0);

  // The first embedded clip on the raw bones.
  let clipMotion = 0;
  const first = gltf.animations[0];
  if (first !== undefined) {
    const raw = new AnimationMixer(gltf.scene);
    raw.clipAction(first).play();
    clipMotion = motion(raw, () => gltf.scene.updateMatrixWorld(true), [...bones]);
    raw.stopAllAction();
  }
  return {
    metaVersion: meta.metaVersion === '0' ? '0' : '1',
    meta: {
      name: meta.name ?? null,
      authors: meta.authors ?? [],
      licenseUrl: meta.licenseUrl ?? null,
      thumbnail,
    },
    humanoid,
    unresolved,
    skinnedMeshes,
    tris,
    joints: bones.size,
    clips,
    vrmaMotion,
    vrmaPlayed: vrmaMotion > 1e-3,
    clipMotion,
  };
}

export function CharacterCheck(): JSX.Element {
  const [status, setStatus] = useState('Ready: pass a character to check.');
  useEffect(() => {
    const api: CharacterCheckApi = {
      async check(bytes, opts) {
        const result = await check(bytes, opts);
        setStatus(
          `Checked: ${result.humanoid.length} humanoid bones, ${result.unresolved.length} unresolved, VRMA ${
            result.vrmaPlayed ? 'played' : 'did not move'
          }.`,
        );
        return result;
      },
    };
    window.__EKZA_CHARACTER_CHECK__ = api;
    return () => {
      if (window.__EKZA_CHARACTER_CHECK__ === api) delete window.__EKZA_CHARACTER_CHECK__;
    };
  }, []);
  return (
    <main className="grid h-dvh w-dvw place-items-center bg-app text-sm text-fg-2">
      <output data-testid="character-check-status">{status}</output>
    </main>
  );
}
