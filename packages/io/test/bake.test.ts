import {
  quatAngle,
  quatDot,
  quatFromAxisAngle,
  quatMultiply,
  type Quat,
  type ReadonlyXf,
} from '@ekza-studio/anim-core';
import { HUMAN_BONE_NAMES, type TrackKey } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { bakeClip, clipFramesToSeconds, ekzaAnimationMeta } from '../src/bake/bake';
import { restWorlds } from '../src/skeleton/rest';
import { createFkPoseSource } from '../src/testing';
import type { BakedClip, BakedTrack } from '../src/types';
import { bakeOptions, clipMeta, rotated, syntheticSkeleton } from './helpers/bake';

const skeleton = syntheticSkeleton();
const nodeOf = (name: string): number => skeleton.nodes.findIndex((n) => n.name === name);
const LOWER_ARM = nodeOf('leftLowerArm');
const HIPS = nodeOf('hips');
const ROOT = nodeOf('Root');

function wave(frame: number): number {
  return (Math.sin((frame / 30) * Math.PI * 2) * Math.PI) / 6;
}

const waveSource = (extra?: (node: number, frame: number) => ReadonlyXf | null) =>
  createFkPoseSource(skeleton, {
    pose: (node, frame) => {
      const custom = extra?.(node, frame);
      if (custom !== undefined && custom !== null) return custom;
      const rest = skeleton.nodes[node]?.restLocal as ReadonlyXf;
      return node === LOWER_ARM ? rotated(rest, [0, 0, 1], wave(frame)) : null;
    },
  });

const track = (clip: BakedClip, node: number, path: BakedTrack['path']): BakedTrack | undefined =>
  clip.tracks.find((t) => t.node === node && t.path === path);

describe('bakeClip (raw target)', () => {
  it('samples integer frames into float32 times ending exactly at the clip end', () => {
    const clip = bakeClip(waveSource(), bakeOptions());
    expect(clip.frameCount).toBe(31);
    expect(clip.duration).toBe(1);
    const arm = track(clip, LOWER_ARM, 'rotation');
    expect(arm?.interpolation).toBe('LINEAR');
    expect(arm?.times).toHaveLength(31);
    expect(arm?.times[0]).toBe(0);
    expect(arm?.times[30]).toBe(1);
    for (let i = 1; i < 31; i++) expect(arm?.times[i]).toBe(Math.fround(i / 30));
    for (let f = 0; f <= 30; f++) {
      const expected = rotated(skeleton.nodes[LOWER_ARM]?.restLocal as ReadonlyXf, [0, 0, 1], wave(f)).q;
      const got = Array.from(arm?.values.subarray(f * 4, f * 4 + 4) ?? []) as Quat;
      expect(quatAngle(got, expected)).toBeLessThan(1e-6);
    }
  });

  it('writes rotation for every driven node, hips translation, and collapses constant tracks to 2 keys', () => {
    const clip = bakeClip(waveSource(), bakeOptions());
    const humanoidNodes = Object.values(skeleton.humanoid ?? {});
    expect(
      clip.tracks
        .filter((t) => t.path === 'rotation')
        .map((t) => t.node)
        .sort((a, b) => a - b),
    ).toEqual([...humanoidNodes].sort((a, b) => a - b));
    expect(clip.tracks.filter((t) => t.path === 'translation').map((t) => t.node)).toEqual([HIPS]);
    expect(clip.tracks.some((t) => t.path === 'scale')).toBe(false);
    const hips = track(clip, HIPS, 'rotation');
    expect(Array.from(hips?.times ?? [])).toEqual([0, 1]);
    expect(hips?.values).toHaveLength(8);
    // Tracks are sorted by node, then translation < rotation < scale.
    const keys = clip.tracks.map((t) => t.node * 3 + { translation: 0, rotation: 1, scale: 2 }[t.path]);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });

  it('keeps quaternions unit and hemisphere-continuous through a full turn', () => {
    const spin = (node: number, frame: number) =>
      node === LOWER_ARM
        ? rotated(skeleton.nodes[node]?.restLocal as ReadonlyXf, [0, 1, 0], (frame / 30) * 2 * Math.PI)
        : null;
    const clip = bakeClip(waveSource(spin), bakeOptions());
    const values = track(clip, LOWER_ARM, 'rotation')?.values ?? new Float32Array();
    let minDot = Infinity;
    for (let k = 0; k < values.length / 4; k++) {
      const q = Array.from(values.subarray(k * 4, k * 4 + 4)) as Quat;
      expect(Math.abs(Math.hypot(...q) - 1)).toBeLessThan(1e-6);
      if (k > 0) minDot = Math.min(minDot, quatDot(Array.from(values.subarray(k * 4 - 4, k * 4)) as Quat, q));
    }
    expect(minDot).toBeGreaterThan(0);
  });

  it('closes loops by writing the first pose at the last sample', () => {
    const drift = (node: number, frame: number) =>
      node === LOWER_ARM ? rotated(skeleton.nodes[node]?.restLocal as ReadonlyXf, [1, 0, 0], frame * 0.01) : null;
    const open = bakeClip(waveSource(drift), bakeOptions({ loop: true }));
    const closed = bakeClip(waveSource(drift), bakeOptions({ loop: true, closeLoop: true }));
    const a = track(open, LOWER_ARM, 'rotation')?.values ?? new Float32Array();
    const b = track(closed, LOWER_ARM, 'rotation')?.values ?? new Float32Array();
    expect(Array.from(b.subarray(120, 124))).toEqual(Array.from(b.subarray(0, 4)));
    expect(Array.from(a.subarray(120, 124))).not.toEqual(Array.from(a.subarray(0, 4)));
    expect(Array.from(b.subarray(4, 120))).toEqual(Array.from(a.subarray(4, 120)));
    // closeLoop alone does nothing for a clip that does not loop.
    const notLooping = bakeClip(waveSource(drift), bakeOptions({ closeLoop: true }));
    expect(Array.from(track(notLooping, LOWER_ARM, 'rotation')?.values ?? [])).toEqual(Array.from(a));
  });

  it('writes STEP samplers at the scheduled frames (sub-frame times evaluated on demand)', () => {
    const key: TrackKey = `${LOWER_ARM}/rotation`;
    const clip = bakeClip(waveSource(), bakeOptions({ stepSchedule: new Map([[key, [7.5, 15, 40, -2]]]) }));
    const arm = track(clip, LOWER_ARM, 'rotation');
    expect(arm?.interpolation).toBe('STEP');
    expect(Array.from(arm?.times ?? [])).toEqual([0, 0.25, 0.5, 1].map(Math.fround));
    const expected = rotated(skeleton.nodes[LOWER_ARM]?.restLocal as ReadonlyXf, [0, 0, 1], wave(7.5)).q;
    expect(quatAngle(Array.from(arm?.values.subarray(4, 8) ?? []) as Quat, expected)).toBeLessThan(1e-6);
  });

  it("removes the in-place node's canonical X/Z travel and keeps Y", () => {
    const rest = skeleton.nodes[HIPS]?.restLocal as ReadonlyXf;
    const walk = (node: number, frame: number): ReadonlyXf | null =>
      node === HIPS
        ? { t: [rest.t[0] + frame * 0.01, rest.t[1] - frame * 0.001, rest.t[2] + frame * 0.02], q: rest.q, s: rest.s }
        : null;
    const moving = bakeClip(waveSource(walk), bakeOptions());
    const inPlace = bakeClip(waveSource(walk), bakeOptions({ rootMotion: 'in-place', inPlaceNode: HIPS }));
    const m = track(moving, HIPS, 'translation')?.values ?? new Float32Array();
    const p = track(inPlace, HIPS, 'translation')?.values ?? new Float32Array();
    expect(m[30 * 3]).toBeCloseTo(rest.t[0] + 0.3, 6);
    for (let f = 0; f <= 30; f++) {
      expect(p[f * 3]).toBeCloseTo(rest.t[0], 6);
      expect(p[f * 3 + 1]).toBeCloseTo(rest.t[1] - f * 0.001, 6);
      expect(p[f * 3 + 2]).toBeCloseTo(rest.t[2], 6);
    }
    expect(inPlace.meta.rootMotion).toBe('in-place');
  });

  // Acceptance fix round 1, bug 1: 'in-place' locked X/Z to rest, which deleted the hips' sway relative to IK-planted
  // feet (the acceptance walk's feet slid 1.5 cm sideways in its file). It removes only the travel now.
  it("keeps the in-place node's sway: only the travel from the first to the last frame is removed", () => {
    const rest = skeleton.nodes[HIPS]?.restLocal as ReadonlyXf;
    const sway = (frame: number) => 0.015 * Math.sin((2 * Math.PI * frame) / 30);
    const swaying =
      (travel: number) =>
      (node: number, frame: number): ReadonlyXf | null =>
        node === HIPS
          ? { t: [rest.t[0] + sway(frame), rest.t[1], rest.t[2] + frame * travel], q: rest.q, s: rest.s }
          : null;
    // A clip that does not travel exports the same bytes under 'in-place' as under 'hips'.
    const still = bakeClip(waveSource(swaying(0)), bakeOptions());
    const stillInPlace = bakeClip(waveSource(swaying(0)), bakeOptions({ rootMotion: 'in-place', inPlaceNode: HIPS }));
    expect(track(stillInPlace, HIPS, 'translation')?.values).toEqual(track(still, HIPS, 'translation')?.values);
    // A travelling clip keeps its sway and loses its travel.
    const walking = bakeClip(waveSource(swaying(0.02)), bakeOptions({ rootMotion: 'in-place', inPlaceNode: HIPS }));
    const p = track(walking, HIPS, 'translation')?.values ?? new Float32Array();
    for (let f = 0; f <= 30; f++) {
      expect(p[f * 3]).toBeCloseTo(rest.t[0] + sway(f), 6);
      expect(p[f * 3 + 2]).toBeCloseTo(rest.t[2], 6);
    }
  });

  it('writes required tracks (constant ones as 2 keys) and translation/scale only where they leave rest', () => {
    const required = new Set<TrackKey>([`${ROOT}/translation`, `${LOWER_ARM}/scale`]);
    const clip = bakeClip(waveSource(), bakeOptions({ requiredTracks: required }));
    expect(Array.from(track(clip, ROOT, 'translation')?.times ?? [])).toEqual([0, 1]);
    expect(track(clip, LOWER_ARM, 'scale')?.values).toEqual(new Float32Array([1, 1, 1, 1, 1, 1]));

    const generic = createFkPoseSource(skeleton, {
      drivenNodes: [ROOT, LOWER_ARM],
      pose: (node, frame) => {
        const r = skeleton.nodes[node]?.restLocal as ReadonlyXf;
        return node === ROOT
          ? { t: [frame * 0.01, 0, 0], q: r.q, s: [1 + frame * 0.01, 1 + frame * 0.01, 1 + frame * 0.01] }
          : null;
      },
    });
    const g = bakeClip(generic, bakeOptions());
    expect(g.tracks.map((t) => `${t.node}/${t.path}`)).toEqual([
      `${ROOT}/translation`,
      `${ROOT}/rotation`,
      `${ROOT}/scale`,
      `${LOWER_ARM}/rotation`,
    ]);
  });

  it('lints rotations that turn more than 90° between samples', () => {
    const flip = (node: number, frame: number) =>
      node === LOWER_ARM
        ? rotated(skeleton.nodes[node]?.restLocal as ReadonlyXf, [0, 1, 0], frame >= 10 ? 2.5 : 0)
        : null;
    const clip = bakeClip(waveSource(flip), bakeOptions());
    expect(clip.warnings).toHaveLength(1);
    expect(clip.warnings[0]).toMatchObject({ code: 'bake.large-rotation-step', severity: 'warning' });
    expect(clip.warnings[0]?.message).toMatch(/frames 9 and 10/);
  });

  it('handles rational frame rates and offset ranges', () => {
    const clip = bakeClip(waveSource(), bakeOptions({ fps: { num: 30000, den: 1001 }, range: { start: 10, end: 40 } }));
    const arm = track(clip, LOWER_ARM, 'rotation');
    expect(arm?.times[0]).toBe(0);
    expect(arm?.times[30]).toBe(Math.fround((30 * 1001) / 30000));
    expect(clip.duration).toBeCloseTo((30 * 1001) / 30000, 12);
    expect(clip.meta.fps).toBeCloseTo(29.97, 2);
    const expected = rotated(skeleton.nodes[LOWER_ARM]?.restLocal as ReadonlyXf, [0, 0, 1], wave(10)).q;
    expect(quatAngle(Array.from(arm?.values.subarray(0, 4) ?? []) as Quat, expected)).toBeLessThan(1e-6);
  });

  it('rejects invalid options', () => {
    expect(() => bakeClip(waveSource(), bakeOptions({ range: { start: 5, end: 2 } }))).toThrow(/range/);
    expect(() => bakeClip(waveSource(), bakeOptions({ range: { start: 0.5, end: 2 } }))).toThrow(/integer/);
    expect(() => bakeClip(waveSource(), bakeOptions({ rootMotion: 'in-place' }))).toThrow(/inPlaceNode/);
    expect(() => bakeClip(waveSource(), bakeOptions({ fps: { num: 0, den: 1 } }))).toThrow(/fps/);
  });

  it('is deterministic', () => {
    const a = bakeClip(waveSource(), bakeOptions());
    const b = bakeClip(waveSource(), bakeOptions());
    expect(b).toEqual(a);
  });
});

describe('bakeClip (humanoid target)', () => {
  it('writes N_b for every present bone and the absolute hips position', () => {
    const rest = skeleton.nodes[HIPS]?.restLocal as ReadonlyXf;
    const source = waveSource((node, frame) =>
      node === HIPS ? { t: [rest.t[0] + frame * 0.01, rest.t[1], rest.t[2]], q: rest.q, s: rest.s } : null,
    );
    const clip = bakeClip(source, bakeOptions({ target: 'humanoid' }));
    const bones = Object.keys(skeleton.humanoid ?? {});
    expect(clip.tracks.filter((t) => t.path === 'rotation')).toHaveLength(bones.length);
    expect(clip.tracks.every((t) => bones.includes(HUMAN_BONE_NAMES[t.node] as string))).toBe(true);
    const hipsIndex = HUMAN_BONE_NAMES.indexOf('hips');
    const position = track(clip, hipsIndex, 'translation')?.values ?? new Float32Array();
    const restWorld = restWorlds(skeleton)[HIPS]?.t ?? [0, 0, 0];
    expect(clip.restHipsPosition).toEqual([...restWorld]);
    expect(position[30 * 3]).toBeCloseTo(restWorld[0] + 0.3, 6);
    // The lower arm's N_b is its world rotation delta relative to its humanoid parent's (the upper arm, at rest).
    const arm = track(clip, HUMAN_BONE_NAMES.indexOf('leftLowerArm'), 'rotation');
    const restQ = restWorlds(skeleton)[LOWER_ARM]?.q as Quat;
    const local = rotated(skeleton.nodes[LOWER_ARM]?.restLocal as ReadonlyXf, [0, 0, 1], wave(5)).q;
    const parentWorld = restWorlds(skeleton)[skeleton.nodes[LOWER_ARM]?.parent ?? 0]?.q as Quat;
    const world = quatMultiply(parentWorld, local);
    const expected = quatMultiply(world, [-restQ[0], -restQ[1], -restQ[2], restQ[3]]);
    expect(quatAngle(Array.from(arm?.values.subarray(20, 24) ?? []) as Quat, expected)).toBeLessThan(1e-6);

    const inPlace = bakeClip(source, bakeOptions({ target: 'humanoid', rootMotion: 'in-place' }));
    const locked = track(inPlace, hipsIndex, 'translation');
    expect(Array.from(locked?.times ?? [])).toEqual([0, 1]);
    expect(locked?.values[0]).toBeCloseTo(restWorld[0], 6);

    // Sway without travel: 'in-place' equals 'hips' (fix round 1, bug 1).
    const swaying = waveSource((node, frame) =>
      node === HIPS
        ? { t: [rest.t[0] + 0.015 * Math.sin((2 * Math.PI * frame) / 30), rest.t[1], rest.t[2]], q: rest.q, s: rest.s }
        : null,
    );
    const hips = bakeClip(swaying, bakeOptions({ target: 'humanoid' }));
    const swayInPlace = bakeClip(swaying, bakeOptions({ target: 'humanoid', rootMotion: 'in-place' }));
    expect(track(swayInPlace, hipsIndex, 'translation')?.values).toEqual(track(hips, hipsIndex, 'translation')?.values);
  });

  it('never writes eye tracks and refuses skeletons without hips', () => {
    const noHips = { ...skeleton, humanoid: {} };
    expect(() => bakeClip(createFkPoseSource(noHips), bakeOptions({ target: 'humanoid' }))).toThrow(/hips/);
    const withEyes = { ...skeleton, humanoid: { ...skeleton.humanoid, leftEye: nodeOf('head') + 1 } };
    const clip = bakeClip(createFkPoseSource(withEyes), bakeOptions({ target: 'humanoid' }));
    expect(clip.tracks.some((t) => HUMAN_BONE_NAMES[t.node] === 'leftEye')).toBe(false);
  });

  it('turns rotations of the whole body into hips N_b (character space)', () => {
    const turn = quatFromAxisAngle([0, 1, 0], 0.5);
    const source = waveSource((node) => {
      if (node !== HIPS) return null;
      const r = skeleton.nodes[HIPS]?.restLocal as ReadonlyXf;
      return { t: r.t, q: quatMultiply(turn, r.q), s: r.s };
    });
    const clip = bakeClip(source, bakeOptions({ target: 'humanoid' }));
    const hips = track(clip, HUMAN_BONE_NAMES.indexOf('hips'), 'rotation');
    expect(quatAngle(Array.from(hips?.values.subarray(0, 4) ?? []) as Quat, turn)).toBeLessThan(1e-6);
  });
});

describe('ekzaAnimationMeta and clipFramesToSeconds', () => {
  it('indexes clips by position, unions provenance and fixes the key order', () => {
    const source = { title: 'UAL', author: 'Quaternius', license: 'CC0-1.0', sourceSha256: 'ABCDEF' };
    const a = bakeClip(
      waveSource(),
      bakeOptions({ name: 'idle', meta: clipMeta('idle', { derivedFrom: [source], index: 7 }) }),
    );
    const b = bakeClip(
      waveSource(),
      bakeOptions({ name: 'walk', meta: clipMeta('walk', { derivedFrom: [source], tags: ['loco'] }) }),
    );
    const meta = ekzaAnimationMeta([a, b], 'vrm-humanoid', {
      toolVersion: '0.1.0',
      projectSha256: null,
      baseSha256: 'FF',
    });
    expect(meta.clips.map((c) => [c.index, c.name])).toEqual([
      [0, 'idle'],
      [1, 'walk'],
    ]);
    expect(meta.provenance).toEqual({
      tool: 'ekza-animator',
      toolVersion: '0.1.0',
      projectSha256: null,
      baseSha256: 'ff',
      derivedFrom: [{ ...source, sourceSha256: 'abcdef' }],
    });
    expect(Object.keys(meta.clips[0] ?? {})).toEqual([
      'index',
      'name',
      'slot',
      'loop',
      'fps',
      'durationSeconds',
      'rootMotion',
      'contactSeconds',
      'tags',
      'derivedFrom',
      'redistributable',
    ]);
    expect(meta.clips[1]?.durationSeconds).toBe(1);
  });

  it('converts clip frames to seconds with rational fps', () => {
    expect(clipFramesToSeconds(30, { num: 30, den: 1 })).toBe(1);
    expect(clipFramesToSeconds(30, { num: 30000, den: 1001 })).toBeCloseTo(1.001, 12);
    expect(clipFramesToSeconds(12, { num: 24, den: 1 })).toBe(0.5);
  });
});
