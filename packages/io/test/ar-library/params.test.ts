// AUTORIG-SPEC §5.5.3 (D5): the clip parameters on a normalized humanoid clip and on VRMA bytes. Identity returns the
// input itself (same object, same bytes); speed and trim timing; trim boundaries interpolated as the track
// interpolates (CUBICSPLINE included); arm-space signs; mirror swaps sides and reflects; in place equals the bake's
// travel removal at every frame and is idempotent; derived bytes are deterministic, carry the source's provenance and
// rest positions, and read back as the parametrized clip.
import { readFileSync } from 'node:fs';
import {
  type Quat,
  quatAngle,
  quatFromAxisAngle,
  quatMultiply,
  quatRotateVec3,
  quatSlerp,
  type ReadonlyXf,
} from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES, type HumanoidClipData } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { bakeClip } from '../../src/bake/bake';
import { parseGlb } from '../../src/glb/parse';
import {
  applyClipParams,
  clipParamsProblem,
  deriveHumanoidVrma,
  type HumanoidClipParams,
  IDENTITY_HUMANOID_CLIP_PARAMS,
  isIdentityClipParams,
  mirrorBone,
} from '../../src/library/params';
import { createFkPoseSource } from '../../src/testing';
import type { BakedClip } from '../../src/types';
import { readVrma } from '../../src/vrma/read';
import { bakeOptions, syntheticSkeleton } from '../helpers/bake';

const LIBRARY = new URL('../../../../apps/web/public/library/animations/', import.meta.url);
const libraryBytes = (id: string): Uint8Array => new Uint8Array(readFileSync(new URL(`${id}.vrma`, LIBRARY)));

const params = (fields: Partial<HumanoidClipParams>): HumanoidClipParams => ({
  ...IDENTITY_HUMANOID_CLIP_PARAMS,
  ...fields,
});

type Track = { readonly times: Float32Array; readonly values: Float32Array };

function quatAt(track: Track | undefined, key: number): Quat {
  if (track === undefined) throw new Error('no track');
  return Array.from(track.values.subarray(key * 4, key * 4 + 4)) as Quat;
}

/** LINEAR sample of a rotation (slerp) or position (lerp) track at `t`. */
function sample(track: Track, components: number, t: number): number[] {
  const { times, values } = track;
  const n = times.length;
  const at = (k: number): number[] => Array.from(values.subarray(k * components, (k + 1) * components));
  if (t <= (times[0] as number)) return at(0);
  if (t >= (times[n - 1] as number)) return at(n - 1);
  let k = 0;
  while ((times[k + 1] as number) <= t) k++;
  const u = (t - (times[k] as number)) / ((times[k + 1] as number) - (times[k] as number));
  if (components === 4) return Array.from(quatSlerp(at(k) as Quat, at(k + 1) as Quat, u));
  return at(k).map((v, i) => v + ((at(k + 1)[i] as number) - v) * u);
}

const DEG = Math.PI / 180;

describe('applyClipParams (§5.5.3)', () => {
  it('returns the input itself for identity parameters (and a trim that covers the whole clip)', async () => {
    const data = readVrma(await parseGlb(libraryBytes('walk')));
    expect(applyClipParams(data, IDENTITY_HUMANOID_CLIP_PARAMS)).toBe(data);
    expect(applyClipParams(data, params({ trim: { start: 0, end: data.duration } }))).toBe(data);
    expect(isIdentityClipParams(params({ trim: { start: 0, end: data.duration } }), data.duration)).toBe(true);
    expect(isIdentityClipParams(params({ trim: { start: 0, end: data.duration } }))).toBe(false);
  });

  it('refuses parameters out of range and a trim past the clip', async () => {
    const data = readVrma(await parseGlb(libraryBytes('walk')));
    expect(clipParamsProblem(params({ speed: 0.2 }))).toMatch(/speed/);
    expect(clipParamsProblem(params({ speed: 3.5 }))).toMatch(/speed/);
    expect(clipParamsProblem(params({ armSpace: -11 }))).toMatch(/armSpace/);
    expect(clipParamsProblem(params({ trim: { start: 0.5, end: 0.5 } }))).toMatch(/trim/);
    expect(clipParamsProblem(params({ trim: { start: 0, end: 5 } }), data.duration)).toMatch(/past/);
    expect(clipParamsProblem({ speed: 1 })).not.toBeNull();
    expect(() => applyClipParams(data, params({ trim: { start: 0, end: 5 } }))).toThrow(/past the clip/);
  });

  it('speed divides every sample time and the duration', async () => {
    const data = readVrma(await parseGlb(libraryBytes('walk')));
    const fast = applyClipParams(data, params({ speed: 1.2 }));
    expect(fast.duration).toBeCloseTo(data.duration / 1.2, 12);
    for (const bone of HUMAN_BONE_NAMES) {
      const a = data.rotations[bone];
      const b = fast.rotations[bone];
      if (a === undefined) continue;
      expect(b?.values).toBe(a.values);
      expect(Array.from(b?.times ?? [])).toEqual(Array.from(a.times, (t) => Math.fround(t / 1.2)));
    }
    expect(Array.from(fast.hips?.times ?? [])).toEqual(Array.from(data.hips?.times ?? [], (t) => Math.fround(t / 1.2)));
  });

  it('trim keeps the window, re-zeroes time and interpolates the ends (keys on the ends kept as they are)', async () => {
    const data = readVrma(await parseGlb(libraryBytes('walk')));
    const start = 0.2;
    const end = 0.95; // between keys at 30 fps
    const trimmed = applyClipParams(data, params({ trim: { start, end } }));
    expect(trimmed.duration).toBeCloseTo(end - start, 12);
    const source = data.rotations.leftUpperArm as Track;
    const cut = trimmed.rotations.leftUpperArm as Track;
    expect(cut.times[0]).toBe(0);
    expect(cut.times[cut.times.length - 1]).toBeCloseTo(end - start, 6);
    // every sample of the cut equals the source at the same time + start
    for (let k = 0; k < cut.times.length; k++) {
      const t = (cut.times[k] as number) + start;
      expect(quatAngle(quatAt(cut, k), sample(source, 4, t) as Quat)).toBeLessThan(1e-5);
    }
    // 0.2 s is the key at frame 6: kept bit-equal
    expect(quatAt(cut, 0)).toEqual(quatAt(source, 6));
    const hips = trimmed.hips as Track;
    expect(Array.from(hips.values.subarray(0, 3))).toEqual(Array.from((data.hips as Track).values.subarray(18, 21)));
  });

  it('trims CUBICSPLINE tracks on their Hermite segments with matching end tangents', () => {
    // one bone, three keys, tangents chosen so the curve is not linear
    const times = Float32Array.from([0, 1, 2]);
    const q0 = quatFromAxisAngle([0, 0, 1], 0);
    const q1 = quatFromAxisAngle([0, 0, 1], 0.6);
    const q2 = quatFromAxisAngle([0, 0, 1], 0.2);
    const tangent = [0, 0, 0.1, 0];
    const values = Float32Array.from([
      ...tangent,
      ...q0,
      ...tangent,
      ...tangent,
      ...q1,
      ...tangent,
      ...tangent,
      ...q2,
      ...tangent,
    ]);
    const data: HumanoidClipData = {
      name: 'cubic',
      duration: 2,
      presentBones: ['hips', 'spine'],
      rotations: { spine: { times, values } },
      hips: null,
      restHipsPosition: [0, 1, 0],
      interpolation: { spine: 'CUBICSPLINE' },
    };
    const trimmed = applyClipParams(data, params({ trim: { start: 0.5, end: 1.5 } }));
    const cut = trimmed.rotations.spine as Track;
    expect(Array.from(cut.times)).toEqual([0, 0.5, 1]);
    expect(trimmed.interpolation.spine).toBe('CUBICSPLINE');
    // the middle key is the source's key 1, untouched (in, value, out)
    expect(Array.from(cut.values.subarray(12, 24))).toEqual(Array.from(values.subarray(12, 24)));
    // the first key's value is the Hermite value at u = 0.5 of segment 0 (normalized), and its tangents agree
    const u = 0.5;
    const h = [2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u, -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2];
    const raw = [0, 1, 2, 3].map(
      (c) =>
        (h[0] as number) * (q0[c] as number) +
        (h[1] as number) * (tangent[c] as number) +
        (h[2] as number) * (q1[c] as number) +
        (h[3] as number) * (tangent[c] as number),
    );
    const len = Math.hypot(...raw);
    const first = Array.from(cut.values.subarray(4, 8));
    raw.forEach((v, c) => expect(first[c]).toBeCloseTo(v / len, 6));
    expect(Array.from(cut.values.subarray(0, 4))).toEqual(Array.from(cut.values.subarray(8, 12)));
  });

  it('arm space abducts the upper arms, the left about +Z and the right about −Z', async () => {
    const data = readVrma(await parseGlb(libraryBytes('idle')));
    const wide = applyClipParams(data, params({ armSpace: 20 }));
    const narrow = applyClipParams(data, params({ armSpace: -10 }));
    const left = (clip: HumanoidClipData, key: number): number[] =>
      Array.from(quatRotateVec3(quatAt(clip.rotations.leftUpperArm, key), [1, 0, 0]));
    const right = (clip: HumanoidClipData, key: number): number[] =>
      Array.from(quatRotateVec3(quatAt(clip.rotations.rightUpperArm, key), [-1, 0, 0]));
    for (const key of [0, 10, 40]) {
      // Idle's arms hang down: wider arms raise the hands (y up) and move them out (left +x, right −x)
      expect(left(wide, key)[1] as number).toBeGreaterThan(left(data, key)[1] as number);
      expect(right(wide, key)[1] as number).toBeGreaterThan(right(data, key)[1] as number);
      expect(left(narrow, key)[1] as number).toBeLessThan(left(data, key)[1] as number);
      expect(right(narrow, key)[1] as number).toBeLessThan(right(data, key)[1] as number);
      const expected = quatMultiply(quatFromAxisAngle([0, 0, 1], 20 * DEG), quatAt(data.rotations.leftUpperArm, key));
      expect(quatAngle(quatAt(wide.rotations.leftUpperArm, key), expected)).toBeLessThan(1e-6);
      const expectedRight = quatMultiply(
        quatFromAxisAngle([0, 0, 1], -20 * DEG),
        quatAt(data.rotations.rightUpperArm, key),
      );
      expect(quatAngle(quatAt(wide.rotations.rightUpperArm, key), expectedRight)).toBeLessThan(1e-6);
    }
    // the other bones are the same arrays
    expect(wide.rotations.spine).toBe(data.rotations.spine);
  });

  it('mirror swaps left and right and reflects across the YZ plane; twice is the clip again', async () => {
    const data = readVrma(await parseGlb(libraryBytes('sword-attack')));
    const mirrored = applyClipParams(data, params({ mirror: true }));
    expect(mirrorBone('leftHand')).toBe('rightHand');
    expect(mirrorBone('rightThumbDistal')).toBe('leftThumbDistal');
    expect(mirrorBone('spine')).toBe('spine');
    for (const bone of HUMAN_BONE_NAMES) {
      const source = data.rotations[mirrorBone(bone)];
      const got = mirrored.rotations[bone];
      if (source === undefined) {
        expect(got).toBeUndefined();
        continue;
      }
      for (let k = 0; k < source.times.length; k += 7) {
        const [x, y, z, w] = quatAt(source, k);
        expect(quatAt(got, k)).toEqual([x, -(y as number), -(z as number), w]);
      }
    }
    const hips = data.hips as Track;
    expect((mirrored.hips as Track).values[3]).toBe(-(hips.values[3] as number));
    expect((mirrored.hips as Track).values[4]).toBe(hips.values[4]);
    const twice = applyClipParams(mirrored, params({ mirror: true }));
    for (const bone of HUMAN_BONE_NAMES) {
      expect(Array.from(twice.rotations[bone]?.values ?? [])).toEqual(Array.from(data.rotations[bone]?.values ?? []));
    }
    expect(Array.from(twice.hips?.values ?? [])).toEqual(Array.from(hips.values));
  });

  it("in place removes the hips' travel exactly as the bake's root motion 'in-place' does, and is idempotent", () => {
    const skeleton = syntheticSkeleton();
    const hipsNode = skeleton.nodes.findIndex((n) => n.name === 'hips');
    const rest = skeleton.nodes[hipsNode]?.restLocal as ReadonlyXf;
    // travels 0.3 m along x and 0.12 m along z over 30 frames, with a sideways sway on top
    const source = createFkPoseSource(skeleton, {
      pose: (node, frame) =>
        node === hipsNode
          ? {
              t: [
                rest.t[0] + frame * 0.01 + 0.015 * Math.sin((2 * Math.PI * frame) / 30),
                rest.t[1],
                rest.t[2] + frame * 0.004,
              ],
              q: rest.q,
              s: rest.s,
            }
          : null,
    });
    const hipsIndex = HUMAN_BONE_NAMES.indexOf('hips');
    const asClip = (baked: BakedClip): HumanoidClipData => {
      const translation = baked.tracks.find((t) => t.node === hipsIndex && t.path === 'translation');
      if (translation === undefined) throw new Error('no hips track');
      return {
        name: 'travel',
        duration: baked.duration,
        presentBones: ['hips'],
        rotations: {},
        hips: { times: translation.times, values: translation.values },
        restHipsPosition: [0, 1, 0],
        interpolation: { hipsPosition: 'LINEAR' },
      };
    };
    const travelling = asClip(bakeClip(source, bakeOptions({ target: 'humanoid' })));
    const inPlace = asClip(bakeClip(source, bakeOptions({ target: 'humanoid', rootMotion: 'in-place' })));
    const ours = applyClipParams(travelling, params({ inPlace: true }));
    for (let frame = 0; frame <= 30; frame++) {
      const t = frame / 30;
      const a = sample(ours.hips as Track, 3, t);
      const b = sample(inPlace.hips as Track, 3, t);
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, 6));
    }
    const again = applyClipParams(ours, params({ inPlace: true }));
    expect(again.hips?.values).toEqual(ours.hips?.values);
    expect(again).toBe(ours);
  });
});

describe('deriveHumanoidVrma (§5.5.3 step 1)', () => {
  it('returns the same bytes for identity parameters (no decode, no encode)', async () => {
    const bytes = libraryBytes('walk');
    expect(await deriveHumanoidVrma(bytes, IDENTITY_HUMANOID_CLIP_PARAMS)).toBe(bytes);
    // a trim over the whole clip is the identity too (the duration is read first)
    const full = await deriveHumanoidVrma(bytes, params({ trim: { start: 0, end: 4 / 3 } }));
    expect(full).toBe(bytes);
  });

  it('is byte-deterministic and reads back as the parametrized clip', async () => {
    const bytes = libraryBytes('walk');
    const p = params({ speed: 1.2, inPlace: true, mirror: true, armSpace: 10, trim: { start: 0.1, end: 1.2 } });
    const a = await deriveHumanoidVrma(bytes, p);
    const b = await deriveHumanoidVrma(bytes, p);
    expect(a).not.toBe(bytes);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const expected = applyClipParams(readVrma(await parseGlb(bytes)), p);
    const read = readVrma(await parseGlb(a));
    expect(read.name).toBe('Walk_Loop');
    expect(read.duration).toBeCloseTo(expected.duration, 5);
    expect(read.presentBones).toEqual(expected.presentBones);
    for (const bone of HUMAN_BONE_NAMES) {
      const want = expected.rotations[bone];
      const got = read.rotations[bone];
      if (want === undefined) continue;
      expect(Array.from(got?.times ?? [])).toEqual(Array.from(want.times));
      for (let k = 0; k < want.times.length; k++) {
        expect(quatAngle(quatAt(got, k), quatAt(want, k))).toBeLessThan(1e-5);
      }
    }
    const hips = expected.hips as Track;
    Array.from((read.hips as Track).values).forEach((v, i) => expect(v).toBeCloseTo(hips.values[i] as number, 5));
  });

  it("carries the source's provenance, generator and rest positions (mirrored with the clip)", async () => {
    const bytes = libraryBytes('walk');
    const json = (glb: Uint8Array) => {
      const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
      return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + view.getUint32(12, true)))) as {
        asset: { generator: string; extras: { ekza_animation_v1: { clips: { derivedFrom: unknown[] }[] } } };
        nodes: { name: string; translation?: number[]; children?: number[] }[];
      };
    };
    const source = json(bytes);
    const derived = json(await deriveHumanoidVrma(bytes, params({ speed: 0.5 })));
    expect(derived.asset.generator).toBe(source.asset.generator);
    expect(derived.asset.extras.ekza_animation_v1.clips[0]?.derivedFrom).toEqual(
      source.asset.extras.ekza_animation_v1.clips[0]?.derivedFrom,
    );
    const world = (doc: ReturnType<typeof json>, name: string): number[] => {
      const parent = new Map<number, number>();
      doc.nodes.forEach((node, i) => {
        for (const child of node.children ?? []) parent.set(child, i);
      });
      let i: number | undefined = doc.nodes.findIndex((node) => node.name === name);
      const p = [0, 0, 0];
      while (i !== undefined) {
        const t = doc.nodes[i]?.translation ?? [0, 0, 0];
        p[0] += t[0] as number;
        p[1] += t[1] as number;
        p[2] += t[2] as number;
        i = parent.get(i);
      }
      return p;
    };
    for (const bone of ['leftHand', 'rightFoot', 'head'] as HumanBoneName[]) {
      world(derived, bone).forEach((v, i) => expect(v).toBeCloseTo(world(source, bone)[i] as number, 6));
    }
    const mirrored = json(await deriveHumanoidVrma(bytes, params({ mirror: true })));
    const left = world(source, 'leftHand');
    world(mirrored, 'rightHand').forEach((v, i) =>
      expect(v).toBeCloseTo(i === 0 ? -(left[0] as number) : (left[i] as number), 6),
    );
  });
});
