// C12 (M6B-SPEC §0.4.7): the UAL → VRM retarget. Sanity (bone map coverage, the reference frame is identity), read-back
// (the written VRMA reads back to the same data; three-vrm-animation plays the same rotations on a VRM 1.0 avatar) and
// the semantic tests against the UAL source that catch left/right and yaw mistakes: (a) Walk's forward left foot is
// at +X and ahead, (b) each hand's segment points where the source's does after the same ΔW and A, (c) Death ends
// with the hips lower than the reference.
import {
  type Quat,
  quatAngle,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  type ReadonlyQuat,
  type Vec3,
} from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { HUMAN_BONE_PARENT, type HumanoidClipData } from '@ekza-studio/rig';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../src/glb/parse';
import { UAL_BONE_MAP } from '../../src/library/boneMap';
import { retargetUalClip, UAL_REFERENCE_CLIP, ualRestWorld, ualSampling, ualSource } from '../../src/library/retarget';
import { writeHumanoidVrma } from '../../src/library/vrma';
import { lintExport } from '../../src/lint/lintExport';
import type { GlbContainer } from '../../src/types';
import { inspectVrma } from '../../src/vrma/read';

/** Walk_Loop at one frame: retargeted locals of a few bones and the hips (pins the maths; within 1e-4 rad). */
const GOLDEN = JSON.parse(readFileSync(new URL('./walk-frame-golden.json', import.meta.url), 'utf8')) as {
  readonly frame: number;
  readonly rotations: Readonly<Record<string, readonly number[]>>;
  readonly hips: readonly number[];
};

let ual: GlbContainer;
beforeAll(async () => {
  ual = await parseGlb(readFixture('quaternius-ual.glb'));
});

const META = { generator: 'test', license: 'CC0-1.0', credit: 'Quaternius', source: 'Walk_Loop' } as const;

/** The key of a track at index k (a constant track has one key). */
function keyOf(track: { readonly values: Float32Array }, stride: number, k: number): number[] {
  const count = track.values.length / stride;
  const i = Math.min(k, count - 1);
  return Array.from(track.values.subarray(i * stride, i * stride + stride));
}

/** Normalized world rotations N_b and positions on the T-pose rig (`ualRestWorld`) at key k of a retargeted clip. */
function retargetedWorld(
  data: HumanoidClipData,
  rest: Partial<Record<HumanBoneName, readonly [number, number, number]>>,
  k: number,
): { readonly n: Map<HumanBoneName, Quat>; readonly p: Map<HumanBoneName, Vec3> } {
  const present = new Set(data.presentBones);
  const parentOf = (bone: HumanBoneName): HumanBoneName | null => {
    let parent = HUMAN_BONE_PARENT[bone];
    while (parent !== null && !present.has(parent)) parent = HUMAN_BONE_PARENT[parent];
    return parent;
  };
  const n = new Map<HumanBoneName, Quat>();
  const p = new Map<HumanBoneName, Vec3>();
  for (const bone of data.presentBones) {
    const local = keyOf(data.rotations[bone] as { values: Float32Array }, 4, k) as unknown as Quat;
    const parent = parentOf(bone);
    if (parent === null) {
      n.set(bone, quatNormalize(local));
      p.set(bone, keyOf(data.hips as { values: Float32Array }, 3, k) as unknown as Vec3);
      continue;
    }
    const np = n.get(parent) as Quat;
    n.set(bone, quatNormalize(quatMultiply(np, local)));
    const r = rest[bone] as Vec3;
    const rp = rest[parent] as Vec3;
    const offset = quatRotateVec3(np, [r[0] - rp[0], r[1] - rp[1], r[2] - rp[2]]);
    const pp = p.get(parent) as Vec3;
    p.set(bone, [pp[0] + offset[0], pp[1] + offset[1], pp[2] + offset[2]]);
  }
  return { n, p };
}

/** A · (source world position of a UAL node) at a time of a clip. */
function sourcePosition(clip: string, node: string, time: number): Vec3 {
  const source = ualSource(ual);
  const world = source.worldAt(source.channels(clip), time);
  const i = source.node(node);
  return quatRotateVec3(source.align, [
    world.t[i * 3] as number,
    world.t[i * 3 + 1] as number,
    world.t[i * 3 + 2] as number,
  ]);
}

function direction(a: Vec3, b: Vec3): Vec3 {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / length, d[1] / length, d[2] / length];
}

function angleBetween(a: Vec3, b: Vec3): number {
  // atan2 of |a × b| and a · b: accurate for tiny angles.
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(
    Math.hypot(cross[0] as number, cross[1] as number, cross[2] as number),
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  );
}

describe('UAL_BONE_MAP and the reference', () => {
  it('maps every DEF-* deformer of the fixture (all but the root) to a distinct humanoid bone', () => {
    const names = ualSource(ual).names;
    const deformers = names.filter((name) => name.startsWith('DEF-'));
    expect(deformers.length).toBe(52);
    expect(deformers.filter((name) => UAL_BONE_MAP[name] === undefined)).toEqual([]);
    expect(names.filter((name) => !name.startsWith('DEF-'))).toEqual(['root', 'Mannequin', 'Rig']);
  });

  it('faces +Z with left = +X: the yaw alignment is the identity and the left hand is at +X', () => {
    expect(ualSource(ual).align).toEqual([0, 0, 0, 1]);
    const rest = ualRestWorld(ual);
    expect(rest.leftHand?.[0]).toBeGreaterThan(0.5);
    expect(rest.rightHand?.[0]).toBeLessThan(-0.5);
    expect(rest.head?.[1]).toBeGreaterThan(rest.hips?.[1] ?? Number.POSITIVE_INFINITY);
  });

  it('the reference clip retargets to identity normalized rotations at its first key (within 1e-6)', () => {
    const data = retargetUalClip(ual, UAL_REFERENCE_CLIP);
    expect(data.presentBones.length).toBe(52);
    for (const bone of data.presentBones) {
      const q = keyOf(data.rotations[bone] as { values: Float32Array }, 4, 0) as unknown as ReadonlyQuat;
      expect(quatAngle(q, [0, 0, 0, 1])).toBeLessThan(1e-6);
    }
    expect(keyOf(data.hips as { values: Float32Array }, 3, 0)).toEqual(
      Array.from(Float32Array.from(data.restHipsPosition)),
    );
  });

  it('is deterministic, samples at the source key times (30 fps) and keeps quaternions hemisphere-continuous', () => {
    const a = retargetUalClip(ual, 'Walk_Loop');
    const b = retargetUalClip(ual, 'Walk_Loop');
    expect(a).toEqual(b);
    expect(a.name).toBe('Walk_Loop');
    // UAL keys sit at 24 fps (33 keys over 4/3 s); the pack is 30 fps: 40 frames, 41 keys.
    expect(ualSource(ual).keyTimes('Walk_Loop').length).toBe(33);
    expect(a.duration).toBe(40 / 30);
    const hips = a.rotations.hips as { times: Float32Array; values: Float32Array };
    expect(hips.times.length).toBe(41);
    expect(hips.times[1]).toBeCloseTo(1 / 30, 6);
    expect(hips.values[3]).toBeGreaterThanOrEqual(0);
    for (const bone of a.presentBones) {
      const v = (a.rotations[bone] as { values: Float32Array }).values;
      for (let i = 4; i < v.length; i += 4) {
        const dot =
          (v[i] as number) * (v[i - 4] as number) +
          (v[i + 1] as number) * (v[i - 3] as number) +
          (v[i + 2] as number) * (v[i - 2] as number) +
          (v[i + 3] as number) * (v[i - 1] as number);
        expect(dot).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('semantic tests against the UAL source (§0.4.7)', () => {
  it('(a) at the Walk frame where DEF-foot.L is furthest forward, leftFoot is at +X and ahead of rightFoot', () => {
    const data = retargetUalClip(ual, 'Walk_Loop');
    const times = ualSampling(ualSource(ual), 'Walk_Loop').source;
    let best = 0;
    let bestZ = Number.NEGATIVE_INFINITY;
    times.forEach((time, k) => {
      const z = sourcePosition('Walk_Loop', 'DEF-foot.L', time)[2];
      if (z > bestZ) {
        bestZ = z;
        best = k;
      }
    });
    const { p } = retargetedWorld(data, ualRestWorld(ual), best);
    const left = p.get('leftFoot') as Vec3;
    const right = p.get('rightFoot') as Vec3;
    expect(left[0]).toBeGreaterThan(0);
    expect(right[0]).toBeLessThan(0);
    expect(left[2]).toBeGreaterThan(right[2]);
  });

  it.each(['Walk_Loop', 'Sword_Attack'])(
    '(b) %s: each hand segment points where the source segment does (within 1e-4 rad) at three frames',
    (clip) => {
      const data = retargetUalClip(ual, clip);
      const rest = ualRestWorld(ual);
      const times = ualSampling(ualSource(ual), clip).source;
      const frames = [0, Math.floor(times.length / 2), times.length - 1];
      for (const k of frames) {
        const { p } = retargetedWorld(data, rest, k);
        for (const [side, suffix] of [
          ['left', 'L'],
          ['right', 'R'],
        ] as const) {
          const retargeted = direction(
            p.get(`${side}LowerArm` as HumanBoneName) as Vec3,
            p.get(`${side}Hand` as HumanBoneName) as Vec3,
          );
          const time = times[k] as number;
          const source = direction(
            sourcePosition(clip, `DEF-forearm.${suffix}`, time),
            sourcePosition(clip, `DEF-hand.${suffix}`, time),
          );
          expect(angleBetween(retargeted, source)).toBeLessThan(1e-4);
        }
      }
    },
  );

  it('(c) Death01 ends with the hips lower than the reference', () => {
    const data = retargetUalClip(ual, 'Death01');
    const hips = data.hips as { values: Float32Array };
    const lastY = hips.values[hips.values.length - 2] as number;
    expect(lastY).toBeLessThan(data.restHipsPosition[1] - 0.3);
  });
});

describe('writeHumanoidVrma (§0.4.7, §0.5)', () => {
  it('writes VRMA 1.0 named after the UAL clip that reads back to the same data, bytes deterministic, lint-clean', async () => {
    const data = retargetUalClip(ual, 'Walk_Loop');
    const rest = ualRestWorld(ual);
    const bytes = await writeHumanoidVrma(data, { ...META, sourceSha256: ual.sha256 }, rest);
    expect(await writeHumanoidVrma(data, { ...META, sourceSha256: ual.sha256 }, rest)).toEqual(bytes);
    const container = await parseGlb(bytes);
    const { data: back, warnings } = inspectVrma(container);
    expect(warnings).toEqual([]);
    expect(back.name).toBe('Walk_Loop');
    expect(back.presentBones).toEqual(data.presentBones);
    expect(back.duration).toBeCloseTo(data.duration, 6);
    for (const bone of data.presentBones) {
      const expected = data.rotations[bone] as { times: Float32Array; values: Float32Array };
      const got = back.rotations[bone] as { times: Float32Array; values: Float32Array };
      expect(got.times).toEqual(expected.times);
      for (let i = 0; i < expected.values.length; i++) {
        expect(Math.abs((got.values[i] as number) - (expected.values[i] as number))).toBeLessThan(1e-6);
      }
    }
    expect(back.hips?.values).toEqual(data.hips?.values);
    expect(back.restHipsPosition.map((v) => Math.fround(v))).toEqual(data.restHipsPosition.map((v) => Math.fround(v)));
    const extras = container.json.asset.extras as {
      ekza_animation_v1: { clips: { loop: boolean; derivedFrom: unknown[] }[] };
    };
    expect(container.json.asset.generator).toBe('test');
    expect(extras.ekza_animation_v1.clips[0]?.loop).toBe(true);
    expect(extras.ekza_animation_v1.clips[0]?.derivedFrom).toEqual([
      { title: 'Walk_Loop', author: 'Quaternius', license: 'CC0-1.0', sourceSha256: ual.sha256 },
    ]);
    const lints = await lintExport('vrma', bytes, null);
    expect(lints.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('refuses a clip without hips', async () => {
    const data = retargetUalClip(ual, 'Walk_Loop');
    await expect(writeHumanoidVrma({ ...data, presentBones: ['spine'] }, META)).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('three-vrm-animation plays the written Walk on a VRM 1.0 avatar with the retargeted rotations (golden frame)', async () => {
    const { createVRMAnimationClip, VRMAnimationLoaderPlugin } = await import('@pixiv/three-vrm-animation');
    const { AnimationMixer, LoopOnce } = await import('three');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { loadGltfInNode } = await import('../../src/testing');
    const data = retargetUalClip(ual, 'Walk_Loop');
    const bytes = await writeHumanoidVrma(data, META, ualRestWorld(ual));
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    const gltf = await loader.parseAsync(bytes.slice().buffer, '');
    const animation = (gltf.userData['vrmAnimations'] as Parameters<typeof createVRMAnimationClip>[0][])[0];
    if (animation === undefined) throw new Error('no VRM animation');
    const { vrm } = await loadGltfInNode(readFixture('seed-san.vrm'));
    if (vrm === null) throw new Error('seed-san.vrm is not a VRM');
    const mixer = new AnimationMixer(vrm.scene);
    const action = mixer.clipAction(createVRMAnimationClip(animation, vrm)).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const frame = GOLDEN.frame;
    mixer.setTime(frame / 30);
    const present = new Set<HumanBoneName>(data.presentBones);
    const targetHas = (bone: HumanBoneName): boolean => vrm.humanoid.getNormalizedBoneNode(bone) !== null;
    const sameParent = (bone: HumanBoneName): boolean => {
      // Compare bones whose nearest present parent is the same bone on both rigs (else the target re-parents).
      let a = HUMAN_BONE_PARENT[bone];
      while (a !== null && !present.has(a)) a = HUMAN_BONE_PARENT[a];
      let b = HUMAN_BONE_PARENT[bone];
      while (b !== null && !targetHas(b)) b = HUMAN_BONE_PARENT[b];
      return a === b;
    };
    let compared = 0;
    for (const [bone, golden] of Object.entries(GOLDEN.rotations) as [HumanBoneName, number[]][]) {
      const expected = keyOf(data.rotations[bone] as { values: Float32Array }, 4, frame) as unknown as Quat;
      // The committed golden pins the retarget itself (a regression in the maths changes it) …
      expect(quatAngle(expected, golden as unknown as Quat)).toBeLessThan(1e-4);
      // … and three-vrm-animation's playback of the written file reproduces it on the normalized rig.
      if (!targetHas(bone) || !sameParent(bone)) continue;
      const q = (
        vrm.humanoid.getNormalizedBoneNode(bone) as { quaternion: { x: number; y: number; z: number; w: number } }
      ).quaternion;
      expect(quatAngle([q.x, q.y, q.z, q.w], expected)).toBeLessThan(1e-4);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(15);
    const hips = keyOf(data.hips as { values: Float32Array }, 3, frame);
    hips.forEach((value, i) => expect(value).toBeCloseTo(GOLDEN.hips[i] as number, 5));
  });
});
