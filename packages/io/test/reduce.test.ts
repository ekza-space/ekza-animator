// M2A-SPEC §5.16 export-side key reduction (FR-EXP-12): tolerance bound at every sample, keep set, determinism, STEP
// and constant tracks untouched, stats, the bake option, the writers and their read-back against the reduced clip.
import { quatFromAxisAngle, type Quat, quatSlerp, type ReadonlyXf } from '@ekza-animator/anim-core';
import { type LicensedFixture, readFixture } from '@ekza-animator/doc/testing';
import { HUMAN_BONE_NAMES, type SkeletonDesc, type TrackKey } from '@ekza-animator/rig';
import { describe, expect, it } from 'vitest';
import { bakeClip, ekzaAnimationMeta } from '../src/bake/bake';
import {
  positionTolerance,
  REFERENCE_HEIGHT_M,
  reduceBakedClip,
  trackLeverArms,
  trackTolerance,
} from '../src/bake/reduce';
import { parseGlb } from '../src/glb/parse';
import { bakeIntoModel } from '../src/surgeon/bakeIntoModel';
import { skeletonFromGltf } from '../src/skeleton/read';
import { humanoidRestPositions, restWorlds } from '../src/skeleton/rest';
import { createFkPoseSource } from '../src/testing';
import { type BakedClip, type BakedTrack, DEFAULT_EXPORT_REDUCE, type ExportReduceSpec } from '../src/types';
import { validateGltf } from '../src/validate/validate';
import { writeAnimationGlb, writeVrma } from '../src/writers/write';
import { bakeOptions, clipMeta, rotated, syntheticSkeleton } from './helpers/bake';

const SPEC = DEFAULT_EXPORT_REDUCE;
const NO_KEEP: ReadonlyMap<TrackKey, readonly number[]> = new Map();

function clipOf(tracks: readonly BakedTrack[], fields: Partial<BakedClip> = {}): BakedClip {
  const frames = Math.max(...tracks.map((t) => t.times.length));
  return {
    name: 'test',
    target: 'raw',
    fps: { num: 30, den: 1 },
    frameCount: frames,
    duration: (frames - 1) / 30,
    tracks,
    restHipsPosition: null,
    meta: clipMeta('test'),
    warnings: [],
    ...fields,
  };
}

const times = (n: number): Float32Array => Float32Array.from({ length: n }, (_, i) => Math.fround(i / 30));

function rotationTrack(node: number, angles: readonly number[], axis: readonly [number, number, number] = [0, 0, 1]) {
  const values = new Float32Array(angles.length * 4);
  angles.forEach((angle, i) => values.set(quatFromAxisAngle(axis, angle), i * 4));
  return { node, path: 'rotation', interpolation: 'LINEAR', times: times(angles.length), values } as const;
}

function vectorTrack(node: number, path: 'translation' | 'scale', points: readonly (readonly number[])[]): BakedTrack {
  const values = new Float32Array(points.length * 3);
  points.forEach((p, i) => values.set(p, i * 3));
  return { node, path, interpolation: 'LINEAR', times: times(points.length), values };
}

/** Value of a (reduced) track at an original sample time, interpolated the way a player does. */
function sampleTrack(track: BakedTrack, t: number): number[] {
  const n = track.times.length;
  const width = track.path === 'rotation' ? 4 : 3;
  let j = 0;
  while (j < n - 1 && (track.times[j + 1] as number) < t) j++;
  const i = Math.min(j, n - 1);
  const k = Math.min(i + 1, n - 1);
  const t0 = track.times[i] as number;
  const t1 = track.times[k] as number;
  const a = Array.from(track.values.subarray(i * width, i * width + width));
  const b = Array.from(track.values.subarray(k * width, k * width + width));
  const alpha = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  if (track.interpolation === 'STEP') return alpha >= 1 ? b : a;
  if (width === 4) return quatSlerp(a as unknown as Quat, b as unknown as Quat, alpha);
  return a.map((v, c) => v + ((b[c] as number) - v) * alpha);
}

function trackError(path: BakedTrack['path'], hat: readonly number[], q: readonly number[]): number {
  if (path === 'rotation') {
    const dot = Math.abs(hat.reduce((sum, v, c) => sum + v * (q[c] as number), 0));
    return 2 * Math.acos(Math.min(1, dot / Math.hypot(...q)));
  }
  if (path === 'translation') return Math.hypot(...hat.map((v, c) => v - (q[c] as number)));
  return Math.max(...hat.map((v, c) => Math.abs(v - (q[c] as number)) / Math.max(Math.abs(q[c] as number), 1e-6)));
}

/** Largest error of `reduced` against every original sample of `original` (same node and path). */
function maxError(original: BakedTrack, reduced: BakedTrack): number {
  const width = original.path === 'rotation' ? 4 : 3;
  let worst = 0;
  for (let k = 0; k < original.times.length; k++) {
    const q = Array.from(original.values.subarray(k * width, k * width + width));
    worst = Math.max(worst, trackError(original.path, sampleTrack(reduced, original.times[k] as number), q));
  }
  return worst;
}

const isSubsetOf = (reduced: BakedTrack, original: BakedTrack): boolean => {
  const width = original.path === 'rotation' ? 4 : 3;
  const index = new Map(Array.from(original.times).map((t, i) => [t, i]));
  return Array.from(reduced.times).every((t, r) => {
    const o = index.get(t);
    if (o === undefined) return false;
    for (let c = 0; c < width; c++) {
      if (reduced.values[r * width + c] !== original.values[o * width + c]) return false;
    }
    return true;
  });
};

describe('tolerances (R02 §6.4)', () => {
  it('scales ε_pos with the character height and caps rotations at θ_cap', () => {
    expect(positionTolerance(SPEC, REFERENCE_HEIGHT_M)).toBeCloseTo(0.0002, 15);
    expect(positionTolerance(SPEC, 0.85)).toBeCloseTo(0.0001, 15);
    expect(positionTolerance(SPEC, Number.NaN)).toBeCloseTo(0.0002, 15);
    const lever = new Map([
      [1, 0.9],
      [2, 0.001],
    ]);
    // the hips, ~0.9 m to the fingertips: θ ≈ 0.013°
    expect(trackTolerance({ node: 1, path: 'rotation' }, SPEC, 1.7, lever)).toBeCloseTo(0.0002 / 0.9, 12);
    // a short lever is clamped to L_min, then capped at 0.25°
    expect(trackTolerance({ node: 2, path: 'rotation' }, SPEC, 1.7, lever)).toBeCloseTo(SPEC.rotationCapRad, 15);
    expect(trackTolerance({ node: 3, path: 'rotation' }, SPEC, 1.7, lever)).toBeCloseTo(SPEC.rotationCapRad, 15);
    expect(trackTolerance({ node: 1, path: 'translation' }, SPEC, 3.4, lever)).toBeCloseTo(0.0004, 15);
    expect(trackTolerance({ node: 1, path: 'scale' }, SPEC, 1.7, lever)).toBe(1e-4);
  });

  it('L_j is the longest rest distance to a descendant joint × 1.1 (raw and humanoid)', () => {
    const skeleton = syntheticSkeleton();
    const worlds = restWorlds(skeleton);
    const raw = trackLeverArms(skeleton, 'raw');
    const descendants = (node: number): number[] =>
      skeleton.nodes
        .filter((n) => {
          for (let a = n.parent; a !== -1; a = skeleton.nodes[a]?.parent ?? -1) if (a === node) return true;
          return false;
        })
        .map((n) => n.index);
    for (const node of skeleton.nodes) {
      const p = worlds[node.index]?.t ?? [0, 0, 0];
      const expected = Math.max(
        0,
        ...descendants(node.index)
          .filter((d) => skeleton.nodes[d]?.isJoint === true)
          .map((d) => {
            const q = worlds[d]?.t ?? [0, 0, 0];
            return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
          }),
      );
      expect(raw.get(node.index)).toBeCloseTo(expected * 1.1, 12);
    }
    const humanoid = trackLeverArms(skeleton, 'humanoid');
    const hips = HUMAN_BONE_NAMES.indexOf('hips');
    expect(humanoid.get(hips)).toBeCloseTo(raw.get(skeleton.humanoid?.hips ?? -1) ?? Number.NaN, 12);
    // the hips reach the fingertips or the toes: the longest lever of the body
    expect(humanoid.get(hips)).toBeGreaterThan(0.5);
    for (const bone of ['leftLowerArm', 'leftHand', 'head'] as const) {
      expect(humanoid.get(HUMAN_BONE_NAMES.indexOf(bone))).toBeLessThan(humanoid.get(hips) as number);
    }
  });
});

describe('reduceBakedClip', () => {
  it('reduces a linear motion to its two ends and leaves the samples exact', () => {
    const track = rotationTrack(
      0,
      Array.from({ length: 31 }, (_, i) => i * 0.01),
    );
    const move = vectorTrack(
      1,
      'translation',
      Array.from({ length: 31 }, (_, i) => [i * 0.01, 0.5, -i * 0.002]),
    );
    const { clip, stats } = reduceBakedClip(clipOf([track, move]), {
      spec: SPEC,
      height: 1.7,
      leverArm: new Map([[0, 0.05]]),
      keep: NO_KEEP,
    });
    expect(clip.tracks.map((t) => t.times.length)).toEqual([2, 2]);
    expect(stats.samplesBefore).toBe(62);
    expect(stats.samplesAfter).toBe(4);
    expect(stats.maxRotationErrorRad).toBeLessThan(1e-6);
    expect(stats.maxTranslationErrorM).toBeLessThan(1e-6);
    expect(clip.reduction).toEqual(stats);
  });

  it('keeps every sample within its node tolerance (150 seeded random clips: smooth, noisy and jumpy tracks)', () => {
    // io has no fast-check (no new dependency in M2a): a seeded generator gives the same 150 cases on every run.
    let state = 20261018;
    const rnd = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    const paths = ['rotation', 'translation', 'scale'] as const;
    for (let run = 0; run < 150; run++) {
      const height = 0.5 + rnd() * 2;
      const specs = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({
        n: 3 + Math.floor(rnd() * 78),
        amp: rnd() * 2,
        freq: rnd() * 0.6,
        noise: rnd() < 0.5 ? 0 : rnd() * 0.01,
        jump: rnd() < 0.3 ? Math.floor(rnd() * 80) : -1,
        lever: rnd() * 1.5,
        path: paths[Math.floor(rnd() * 3)] as BakedTrack['path'],
      }));
      const tracks = specs.map((s, node) => {
        const f = (i: number) =>
          s.amp * Math.sin(i * s.freq) + s.noise * (rnd() - 0.5) + (s.jump !== -1 && i >= s.jump ? 0.3 : 0);
        if (s.path === 'rotation') {
          return rotationTrack(
            node,
            Array.from({ length: s.n }, (_, i) => f(i)),
            [0.3, 1, 0.2],
          );
        }
        return vectorTrack(
          node,
          s.path,
          Array.from({ length: s.n }, (_, i) => {
            const v = f(i);
            return s.path === 'scale' ? [1 + v, 1, 1 - v / 2] : [v, v * 0.5 + 0.1, 0];
          }),
        );
      });
      const leverArm = new Map(specs.map((s, node) => [node, s.lever]));
      const { clip, stats } = reduceBakedClip(clipOf(tracks), { spec: SPEC, height, leverArm, keep: NO_KEEP });
      let worstRot = 0;
      let worstLin = 0;
      clip.tracks.forEach((reduced, i) => {
        const original = tracks[i] as BakedTrack;
        const tol = trackTolerance(original, SPEC, height, leverArm);
        const error = maxError(original, reduced);
        // the comparison re-runs slerp/lerp in this file: allow its rounding on top of the tolerance
        expect(error).toBeLessThanOrEqual(tol * (1 + 1e-6) + 2e-7);
        expect(isSubsetOf(reduced, original)).toBe(true);
        expect(reduced.times[0]).toBe(original.times[0]);
        expect(reduced.times.at(-1)).toBe(original.times.at(-1));
        if (original.path === 'rotation') worstRot = Math.max(worstRot, error);
        if (original.path === 'translation') worstLin = Math.max(worstLin, error);
      });
      expect(stats.maxRotationErrorRad).toBeCloseTo(worstRot, 6);
      expect(stats.maxTranslationErrorM).toBeCloseTo(worstLin, 9);
      expect(stats.samplesBefore).toBe(tracks.reduce((sum, t) => sum + t.times.length, 0));
      expect(stats.samplesAfter).toBe(clip.tracks.reduce((sum, t) => sum + t.times.length, 0));
    }
  });

  it('honours the keep set: ends, the contact sample, per-track frames and both sides of a step', () => {
    const flat = rotationTrack(
      2,
      Array.from({ length: 41 }, (_, i) => (i < 20 ? 0.1 : 0.6)),
    );
    const line = vectorTrack(
      3,
      'translation',
      Array.from({ length: 41 }, (_, i) => [i * 0.01, 0, 0]),
    );
    const keep = new Map<TrackKey, readonly number[]>([['3/translation', [7, 33.4, -5, 99]]]);
    const { clip } = reduceBakedClip(clipOf([flat, line], { meta: clipMeta('test', { contactSeconds: 12 / 30 }) }), {
      spec: SPEC,
      height: 1.7,
      leverArm: new Map(),
      keep,
    });
    const frames = (track: BakedTrack | undefined) => Array.from(track?.times ?? []).map((t) => Math.round(t * 30));
    // the step at 19 → 20 between two holds keeps both samples; the contact frame 12 is kept on every track
    expect(frames(clip.tracks[0])).toEqual([0, 12, 19, 20, 40]);
    // keep frames 7 and 33 (33.4 is within half a frame), out-of-range frames ignored
    expect(frames(clip.tracks[1])).toEqual([0, 7, 12, 33, 40]);
  });

  it('copies STEP tracks, two-sample tracks and single samples unchanged', () => {
    const step: BakedTrack = { ...rotationTrack(0, [0, 0.5, 0.5, 1, 0]), interpolation: 'STEP' };
    const constant = rotationTrack(1, [0.2, 0.2]);
    const single = vectorTrack(2, 'translation', [[1, 2, 3]]);
    const { clip, stats } = reduceBakedClip(clipOf([step, constant, single]), {
      spec: SPEC,
      height: 1.7,
      leverArm: new Map(),
      keep: NO_KEEP,
    });
    expect(clip.tracks[0]).toBe(step);
    expect(clip.tracks[1]).toBe(constant);
    expect(clip.tracks[2]).toBe(single);
    expect(stats).toEqual({ samplesBefore: 8, samplesAfter: 8, maxRotationErrorRad: 0, maxTranslationErrorM: 0 });
  });

  it('is deterministic: the same input gives identical arrays', () => {
    const tracks = [
      rotationTrack(
        0,
        Array.from({ length: 90 }, (_, i) => Math.sin(i / 9) * 0.7 + Math.sin(i / 2.3) * 0.002),
      ),
      vectorTrack(
        1,
        'translation',
        Array.from({ length: 90 }, (_, i) => [Math.sin(i / 11) * 0.1, 0.9, i * 0.004]),
      ),
      // A slow track whose reduction pays for its own time accessor (the two above keep too many samples to, so the
      // bytes rule gives them back every sample).
      vectorTrack(
        2,
        'translation',
        Array.from({ length: 90 }, (_, i) => [Math.sin(i / 40) * 0.05, 0.9, 0]),
      ),
    ];
    const input = { spec: SPEC, height: 1.6, leverArm: new Map([[0, 0.4]]), keep: NO_KEEP };
    const a = reduceBakedClip(clipOf(tracks), input);
    const b = reduceBakedClip(clipOf(tracks), input);
    expect(b.stats).toEqual(a.stats);
    a.clip.tracks.forEach((track, i) => {
      expect(Array.from(b.clip.tracks[i]?.times ?? [])).toEqual(Array.from(track.times));
      expect(Array.from(b.clip.tracks[i]?.values ?? [])).toEqual(Array.from(track.values));
    });
    expect(a.stats.samplesAfter).toBeLessThan(a.stats.samplesBefore);
  });

  it('is pure: the input clip and its arrays are not modified', () => {
    const track = rotationTrack(
      0,
      Array.from({ length: 30 }, (_, i) => i * 0.02),
    );
    const before = Array.from(track.values);
    const clip = clipOf([track]);
    reduceBakedClip(clip, { spec: SPEC, height: 1.7, leverArm: new Map(), keep: NO_KEEP });
    expect(clip.tracks[0]).toBe(track);
    expect(Array.from(track.values)).toEqual(before);
    expect(clip.reduction).toBeUndefined();
  });

  it('a zero tolerance keeps every sample of a curved track', () => {
    const track = rotationTrack(
      0,
      Array.from({ length: 20 }, (_, i) => Math.sin(i / 3)),
    );
    const zero: ExportReduceSpec = { positionM: 0, rotationCapRad: 0, minLeverM: 0.01, scaleRel: 0 };
    const { clip } = reduceBakedClip(clipOf([track]), { spec: zero, height: 1.7, leverArm: new Map(), keep: NO_KEEP });
    expect(clip.tracks[0]?.times.length).toBe(20);
  });
});

describe('bakeClip with reduce (BakeOptions.reduce)', () => {
  const skeleton = syntheticSkeleton();
  const arm = skeleton.nodes.findIndex((n) => n.name === 'leftLowerArm');
  const source = createFkPoseSource(skeleton, {
    pose: (node, frame) =>
      node === arm
        ? rotated(skeleton.nodes[node]?.restLocal as ReadonlyXf, [0, 0, 1], (Math.sin(frame / 20) * Math.PI) / 8)
        : null,
  });
  const leverArm = trackLeverArms(skeleton, 'raw');

  it('equals reduceBakedClip of the M1 bake, keep frames shifted to the clip start', () => {
    const range = { start: 10, end: 70 };
    const keep = new Map<TrackKey, readonly number[]>([[`${arm}/rotation`, [5, 40, 71]]]);
    const plain = bakeClip(source, bakeOptions({ range }));
    const reduced = bakeClip(
      source,
      bakeOptions({ range, reduce: { spec: SPEC, height: skeleton.height, leverArm, keep } }),
    );
    const expected = reduceBakedClip(plain, {
      spec: SPEC,
      height: skeleton.height,
      leverArm,
      keep: new Map<TrackKey, readonly number[]>([[`${arm}/rotation`, [30]]]),
    });
    expect(reduced.reduction).toEqual(expected.stats);
    expect(reduced.tracks.map((t) => Array.from(t.times))).toEqual(
      expected.clip.tracks.map((t) => Array.from(t.times)),
    );
    const armTrack = reduced.tracks.find((t) => t.node === arm && t.path === 'rotation');
    expect(Array.from(armTrack?.times ?? []).map((t) => Math.round(t * 30))).toContain(30);
    expect(reduced.reduction?.samplesAfter).toBeLessThan(plain.tracks.reduce((s, t) => s + t.times.length, 0));
  });

  it('reduce: null is the M1 bake', () => {
    const plain = bakeClip(source, bakeOptions());
    const none = bakeClip(source, bakeOptions({ reduce: null }));
    expect(none).toEqual(plain);
    expect(none.reduction).toBeUndefined();
  });
});

async function fixtureSkeleton(name: LicensedFixture): Promise<SkeletonDesc> {
  return skeletonFromGltf(await parseGlb(readFixture(name)));
}

describe('writers with reduced clips', () => {
  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm'])(
    '%s: VRMA and animation GLB validate, read back against the reduced clip and report the stats',
    async (name) => {
      const skeleton = await fixtureSkeleton(name);
      const humanoid = skeleton.humanoid ?? {};
      const animated = new Set([humanoid.leftUpperArm, humanoid.leftLowerArm, humanoid.spine, humanoid.hips]);
      const source = createFkPoseSource(skeleton, {
        pose: (node, frame) => {
          if (!animated.has(node)) return null;
          const rest = skeleton.nodes[node]?.restLocal as ReadonlyXf;
          const r = rotated(rest, [0.3, 0.2, 1], Math.sin(frame / 25) * 0.5);
          return node === humanoid.hips ? { ...r, t: [rest.t[0] + frame * 0.002, rest.t[1], rest.t[2]] } : r;
        },
      });
      const range = { start: 0, end: 120 };
      for (const target of ['humanoid', 'raw'] as const) {
        const reduce = {
          spec: SPEC,
          height: skeleton.height,
          leverArm: trackLeverArms(skeleton, target),
          keep: NO_KEEP,
        };
        const plain = bakeClip(source, bakeOptions({ range, target }));
        const clip = bakeClip(source, bakeOptions({ range, target, reduce }));
        const meta = ekzaAnimationMeta([clip], target === 'humanoid' ? 'vrm-humanoid' : 'gltf-nodes', {
          toolVersion: '0.2.0',
          projectSha256: null,
          baseSha256: null,
        });
        const artifact =
          target === 'humanoid'
            ? await writeVrma(skeleton, clip, {
                meta,
                fileName: 'x.vrma',
                profile: null,
                humanoidRestWorld: humanoidRestPositions(skeleton),
              })
            : await writeAnimationGlb(skeleton, [clip], { meta, fileName: 'x.glb', profile: null });
        expect((await validateGltf(artifact.bytes)).errors).toBe(0);
        expect(artifact.readBack?.ok).toBe(true);
        expect(artifact.stats.reduction).toEqual(clip.reduction);
        expect(artifact.stats.keys).toBe(clip.reduction?.samplesAfter);
        const before = plain.tracks.reduce((sum, t) => sum + t.times.length, 0);
        expect(clip.reduction?.samplesBefore).toBe(before);
        expect(clip.reduction?.samplesAfter).toBeLessThan(before);
        // every original sample is within its node tolerance of the reduced track
        for (const original of plain.tracks) {
          const reduced = clip.tracks.find((t) => t.node === original.node && t.path === original.path);
          if (reduced === undefined) throw new Error('track lost');
          const tol = trackTolerance(original, SPEC, skeleton.height, reduce.leverArm);
          expect(maxError(original, reduced)).toBeLessThanOrEqual(tol * (1 + 1e-6) + 2e-7);
        }
      }
    },
  );

  // Acceptance fix round 1, bug 3: a smooth 24-frame walk keeps nearly every sample at R02's tolerances, and each
  // reduced track wrote its own time accessor, so "Reduce keys" made every file larger (walk VRMA 16,384 → 16,996 B).
  // A reduction is taken only where it saves bytes, time accessor included: never larger, smaller on blocking.
  it.each<LicensedFixture>(['seed-san.vrm', 'polybot.vrm'])(
    '%s: a reduced file is never larger than the unreduced one (VRMA, animation GLB, bake into the model)',
    async (name) => {
      const bytes = readFixture(name);
      const container = await parseGlb(bytes);
      const skeleton = skeletonFromGltf(container);
      const humanoid = skeleton.humanoid ?? {};
      const animated = [
        humanoid.hips,
        humanoid.spine,
        humanoid.leftUpperLeg,
        humanoid.leftLowerLeg,
        humanoid.rightUpperLeg,
        humanoid.rightLowerLeg,
        humanoid.leftUpperArm,
        humanoid.rightUpperArm,
      ].filter((node): node is number => node !== undefined);
      const walk = (node: number, frame: number): ReadonlyXf | null => {
        const index = animated.indexOf(node);
        if (index === -1) return null;
        const rest = skeleton.nodes[node]?.restLocal as ReadonlyXf;
        const r = rotated(rest, [1, 0.2 * index, 0.1], 0.4 * Math.sin((2 * Math.PI * (frame + 3 * index)) / 24));
        return node === humanoid.hips
          ? { ...r, t: [rest.t[0] + 0.015 * Math.sin((2 * Math.PI * frame) / 24), rest.t[1], rest.t[2]] }
          : r;
      };
      // Blocking: linear between keys every 6 frames (the reduction keeps the keys).
      const blocking = (node: number, frame: number): ReadonlyXf | null => {
        const index = animated.indexOf(node);
        if (index === -1) return null;
        const rest = skeleton.nodes[node]?.restLocal as ReadonlyXf;
        const key = (k: number) => 0.3 * (((k + index) % 3) - 1);
        const k = Math.floor(frame / 6);
        const angle = key(k) + (key(k + 1) - key(k)) * ((frame % 6) / 6);
        return rotated(rest, [1, 0, 0.2 * index], angle);
      };
      const range = { start: 0, end: 24 };
      for (const [motion, pose, shrinks] of [
        ['walk', walk, false],
        ['blocking', blocking, true],
      ] as const) {
        const source = createFkPoseSource(skeleton, { pose });
        for (const target of ['humanoid', 'raw'] as const) {
          const reduce = {
            spec: SPEC,
            height: skeleton.height,
            leverArm: trackLeverArms(skeleton, target),
            keep: NO_KEEP,
          };
          const plain = bakeClip(source, bakeOptions({ range, target, loop: true, closeLoop: true }));
          const reduced = bakeClip(source, bakeOptions({ range, target, loop: true, closeLoop: true, reduce }));
          const write = async (clip: BakedClip): Promise<Uint8Array[]> => {
            const meta = ekzaAnimationMeta([clip], target === 'humanoid' ? 'vrm-humanoid' : 'gltf-nodes', {
              toolVersion: '0.2.0',
              projectSha256: null,
              baseSha256: null,
            });
            if (target === 'humanoid') {
              const vrma = await writeVrma(skeleton, clip, {
                meta,
                fileName: 'x.vrma',
                profile: null,
                humanoidRestWorld: humanoidRestPositions(skeleton),
              });
              return [vrma.bytes];
            }
            const glb = await writeAnimationGlb(skeleton, [clip], { meta, fileName: 'x.glb', profile: null });
            const bake = await bakeIntoModel(container, skeleton, [clip], { meta, fileName: 'x.vrm', profile: null });
            return [glb.bytes, bake.bytes];
          };
          const [plainFiles, reducedFiles] = [await write(plain), await write(reduced)];
          plainFiles.forEach((file, i) => {
            const smaller = (reducedFiles[i] as Uint8Array).byteLength;
            expect(smaller, `${motion} ${target} file ${i}`).toBeLessThanOrEqual(file.byteLength);
            if (shrinks) expect(smaller, `${motion} ${target} file ${i} shrinks`).toBeLessThan(file.byteLength);
          });
          expect(reduced.reduction?.samplesAfter).toBeLessThanOrEqual(reduced.reduction?.samplesBefore ?? 0);
        }
      }
    },
  );

  it('the stats of an unreduced export carry no reduction field (M1 shape)', async () => {
    const skeleton = await fixtureSkeleton('polybot.vrm');
    const clip = bakeClip(createFkPoseSource(skeleton, { pose: () => null }), bakeOptions({ target: 'humanoid' }));
    const artifact = await writeVrma(skeleton, clip, {
      meta: ekzaAnimationMeta([clip], 'vrm-humanoid', { toolVersion: '0.2.0', projectSha256: null, baseSha256: null }),
      fileName: 'x.vrma',
      profile: null,
      humanoidRestWorld: humanoidRestPositions(skeleton),
    });
    expect('reduction' in artifact.stats).toBe(false);
  });
});
