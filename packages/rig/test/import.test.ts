import {
  curveEngine,
  EkzaError,
  type Fps,
  type KeyData,
  mat4Decompose,
  quatFromAxisAngle,
  reduceKeys,
} from '@ekza-studio/anim-core';
import { type ControlId, controlId, type HumanBoneName } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import {
  autoRig,
  compileRig,
  DEFAULT_REDUCE,
  detectClipFps,
  HUMAN_BONE_NAMES,
  type HumanoidClipData,
  type ImportedClipKeys,
  importHumanoidClip,
  importRawClip,
  type RawChannel,
  type RawClip,
  type RigProgram,
  remapRawClipByName,
  type SkeletonDesc,
} from '../src';
import {
  genericSkeleton,
  IDS,
  maxAbsDiff,
  pendingStub,
  quatAngleBetween,
  quatAt,
  richHumanoid,
  syntheticSkeleton,
} from './helpers';
import { bakeHumanoid, bakeRaw, channelsAt, randomFrames } from './import-helpers';

const id = (key: string): ControlId => controlId(IDS.rig, key);
const FPS24: Fps = { num: 24, den: 1 };
const FPS30: Fps = { num: 30, den: 1 };
const opts = (fps: Fps, extra: Partial<Parameters<typeof importRawClip>[2]> = {}) => ({
  fps,
  keyMode: 'source-times' as const,
  eulerFilter: true,
  reduce: null,
  ...extra,
});

function rig(skeleton: SkeletonDesc): RigProgram {
  return compileRig(autoRig(skeleton, IDS), skeleton);
}

function clipOf(channels: RawChannel[], name = 'clip'): RawClip {
  let duration = 0;
  for (const c of channels) duration = Math.max(duration, c.times[c.times.length - 1] ?? 0);
  return { index: 0, name, duration, channels, skipped: [] };
}

function curve(clip: ImportedClipKeys, key: string, channel: string): readonly KeyData[] | undefined {
  return clip.curves.find((c) => c.control === id(key) && c.channel === channel)?.keys;
}

/** Max rotation / translation error of raw bone locals between two poses. */
function localError(program: RigProgram, a: Float64Array, b: Float64Array): { rotation: number; translation: number } {
  let rotation = 0;
  let translation = 0;
  for (let node = 0; node < program.nodeCount; node++) {
    rotation = Math.max(rotation, quatAngleBetween(quatAt(a, node * 10 + 3), quatAt(b, node * 10 + 3)));
    translation = Math.max(
      translation,
      maxAbsDiff(a.subarray(node * 10, node * 10 + 3), b.subarray(node * 10, node * 10 + 3)),
      maxAbsDiff(a.subarray(node * 10 + 7, node * 10 + 10), b.subarray(node * 10 + 7, node * 10 + 10)),
    );
  }
  return { rotation, translation };
}

describe('detectClipFps (MVP-SPEC §4.11.6 step 5)', () => {
  const raw = (times: number[]): RawClip =>
    clipOf([
      {
        node: 0,
        path: 'rotation',
        interpolation: 'LINEAR',
        times: Float32Array.from(times),
        values: new Float32Array(times.length * 4),
      },
    ]);

  it('returns the lowest standard rate on whose frames every time lies (1e-4 s)', () => {
    expect(detectClipFps(raw([0, 1 / 24, 2 / 24, 2.5]))).toEqual({ num: 24, den: 1 });
    expect(detectClipFps(raw([0, 1 / 30, 1]))).toEqual({ num: 30, den: 1 });
    expect(detectClipFps(raw([0, 1 / 60, 0.5]))).toEqual({ num: 60, den: 1 });
    expect(detectClipFps(raw([0, 0.04, 0.2]))).toEqual({ num: 25, den: 1 });
    expect(detectClipFps(raw([0, 0.5, 1]))).toEqual({ num: 24, den: 1 });
    expect(detectClipFps(raw([0, 1 / 24 + 5e-5]))).toEqual({ num: 24, den: 1 });
  });

  it('returns null for irregular or empty clips', () => {
    expect(detectClipFps(raw([0, 0.013]))).toBeNull();
    expect(detectClipFps(clipOf([]))).toBeNull();
  });

  it('reads humanoid clip tracks', () => {
    const data: HumanoidClipData = {
      name: 'h',
      duration: 1,
      presentBones: ['hips'],
      rotations: { hips: { times: Float32Array.from([0, 1 / 30, 2 / 30]), values: new Float32Array(12) } },
      hips: { times: Float32Array.from([0, 0.5]), values: new Float32Array(6) },
      restHipsPosition: [0, 1, 0],
      interpolation: {},
    };
    expect(detectClipFps(data)).toEqual({ num: 30, den: 1 });
  });
});

describe('importRawClip: interpolation mapping (MVP-SPEC §4.11.6 table)', () => {
  const skeleton = syntheticSkeleton();
  const program = rig(skeleton);
  const arm = skeleton.humanoid?.leftLowerArm as number;
  const restQ = skeleton.nodes[arm]?.restLocal.q as readonly number[];
  const rotated = (angle: number): number[] => {
    // Local rotation about the bone's local Z axis, composed on the rest rotation.
    const d = quatFromAxisAngle([0, 0, 1], angle);
    const [x, y, z, w] = restQ as [number, number, number, number];
    return [
      w * d[0] + x * d[3] + y * d[2] - z * d[1],
      w * d[1] - x * d[2] + y * d[3] + z * d[0],
      w * d[2] + x * d[1] - y * d[0] + z * d[3],
      w * d[3] - x * d[0] - y * d[1] - z * d[2],
    ];
  };
  const rotationTrack = (interpolation: RawChannel['interpolation']): RawChannel => {
    const keys = [rotated(0), rotated(0.6), rotated(-0.4)];
    const values =
      interpolation === 'CUBICSPLINE'
        ? Float32Array.from(keys.flatMap((q) => [0, 0, 0, 0, ...q, 0, 0, 0, 0]))
        : Float32Array.from(keys.flat());
    return { node: arm, path: 'rotation', interpolation, times: Float32Array.from([0, 0.5, 1]), values };
  };

  it('LINEAR → keys at source times with linear tangents, matching the source at those times', () => {
    const imported = importRawClip(clipOf([rotationTrack('LINEAR')]), program, opts(FPS24));
    expect(imported.fps).toEqual(FPS24);
    expect(imported.range).toEqual({ start: 0, end: 24 });
    const keys = curve(imported, 'fk.lowerArm.L', 'rz') ?? curve(imported, 'fk.lowerArm.L', 'ry') ?? [];
    expect(keys.map((k) => k.t)).toEqual([0, 12, 24]);
    expect(keys.every((k) => k.inType === 'linear' && k.outType === 'linear')).toBe(true);
    for (const [frame, angle] of [
      [0, 0],
      [12, 0.6],
      [24, -0.4],
    ] as const) {
      const pose = program.allocPose();
      program.evaluate(channelsAt(program, imported, frame), pose);
      expect(quatAngleBetween(quatAt(pose.boneLocal, arm * 10 + 3), rotated(angle) as never)).toBeLessThan(1e-6);
    }
    // Only the driven control got curves.
    expect(new Set(imported.curves.map((c) => c.control))).toEqual(new Set([id('fk.lowerArm.L')]));
  });

  it('STEP → flat in, step out', () => {
    const imported = importRawClip(clipOf([rotationTrack('STEP')]), program, opts(FPS24));
    const keys = imported.curves[0]?.keys ?? [];
    expect(keys.length).toBe(3);
    expect(keys.every((k) => k.inType === 'flat' && k.outType === 'step')).toBe(true);
  });

  it('CUBICSPLINE rotation → auto tangents at source times', () => {
    const imported = importRawClip(clipOf([rotationTrack('CUBICSPLINE')]), program, opts(FPS24));
    const keys = imported.curves[0]?.keys ?? [];
    expect(keys.map((k) => k.t)).toEqual([0, 12, 24]);
    expect(keys.every((k) => k.inType === 'auto' && k.outType === 'auto')).toBe(true);
  });

  it('CUBICSPLINE translation → fixed Hermite handles (slope = tangent · den / num, |dt| = span / 3)', () => {
    const generic = genericSkeleton();
    const gp = rig(generic);
    const node = generic.nodes.findIndex((n) => n.name === 'root');
    const rest = generic.nodes[node]?.restLocal.t as readonly number[];
    // Translation along the node's local X with tangents 0.3 / −0.6 / 0.9 m/s (in) and 0.6 / 0.3 / 0.9 (out).
    const values = Float32Array.from(
      [
        [0, 0, 0, rest[0] as number, rest[1] as number, rest[2] as number, 0.6, 0, 0],
        [-0.6, 0, 0, (rest[0] as number) + 0.1, rest[1] as number, rest[2] as number, 0.3, 0, 0],
        [0.9, 0, 0, (rest[0] as number) - 0.05, rest[1] as number, rest[2] as number, 0.9, 0, 0],
      ].flat(),
    );
    const imported = importRawClip(
      clipOf([
        { node, path: 'translation', interpolation: 'CUBICSPLINE', times: Float32Array.from([0, 0.5, 1]), values },
      ]),
      gp,
      opts(FPS24),
    );
    const keys = imported.curves.find((c) => c.channel === 'tx')?.keys ?? [];
    expect(keys.map((k) => k.t)).toEqual([0, 12, 24]);
    expect(keys.every((k) => k.inType === 'fixed' && k.outType === 'fixed')).toBe(true);
    // Bone-aligned control: tx is the bone-local X translation.
    const perFrame = 1 / 24;
    const key1 = keys[1] as KeyData;
    expect(key1.inHandle.dt).toBeCloseTo(-4, 9);
    expect(key1.outHandle.dt).toBeCloseTo(4, 9);
    expect(key1.inHandle.dv / key1.inHandle.dt).toBeCloseTo(-0.6 * perFrame, 6);
    expect(key1.outHandle.dv / key1.outHandle.dt).toBeCloseTo(0.3 * perFrame, 6);
    expect(key1.broken).toBe(true);
    // End keys are unified with their only meaningful side.
    expect((keys[0] as KeyData).inHandle.dv / (keys[0] as KeyData).inHandle.dt).toBeCloseTo(0.6 * perFrame, 6);
    expect((keys[2] as KeyData).broken).toBe(false);
  });

  it("keyMode 'resample' → auto keys on every integer frame of the range", () => {
    const imported = importRawClip(clipOf([rotationTrack('LINEAR')]), program, opts(FPS30, { keyMode: 'resample' }));
    const keys = imported.curves[0]?.keys ?? [];
    expect(imported.range).toEqual({ start: 0, end: 30 });
    expect(keys.map((k) => k.t)).toEqual(Array.from({ length: 31 }, (_, i) => i));
    expect(keys.every((k) => k.inType === 'auto' && k.outType === 'auto')).toBe(true);
  });

  it('snaps near-frame source times and warns when forced onto sub-frames', () => {
    const snapped = importRawClip(
      clipOf([{ ...rotationTrack('LINEAR'), times: Float32Array.from([0, 0.50003, 1]) }]),
      program,
      opts(FPS24),
    );
    expect(snapped.curves[0]?.keys.map((k) => k.t)).toEqual([0, 12, 24]);
    expect(snapped.warnings).toEqual([]);
    const irregular = importRawClip(
      clipOf([{ ...rotationTrack('LINEAR'), times: Float32Array.from([0, 0.013, 1]) }]),
      program,
      opts(FPS24),
    );
    expect(irregular.curves[0]?.keys[1]?.t).toBeCloseTo(0.013 * 24, 5);
    expect(irregular.warnings.some((w) => w.includes('sub-frame'))).toBe(true);
  });
});

describe('importRawClip: round trip import(bake(curves)) ≤ 1e-5 rad / 1e-6 m', () => {
  it.each([
    { label: 'synthetic humanoid', skeleton: syntheticSkeleton() },
    { label: 'rich humanoid (VRM 0.x facing, twist joints)', skeleton: richHumanoid({ vrm0: true }) },
    { label: 'generic', skeleton: genericSkeleton() },
  ])('$label', ({ skeleton }) => {
    const program = rig(skeleton);
    const frames = randomFrames(program, 12, 17);
    const { clip, poses } = bakeRaw(program, frames, FPS30);
    expect(detectClipFps(clip)).toEqual(FPS30);
    const imported = importRawClip(clip, program, opts(FPS30));
    expect(imported.range).toEqual({ start: 0, end: 11 });
    const pose = program.allocPose();
    const ch = program.allocChannels();
    poses.forEach((expected, frame) => {
      program.evaluate(channelsAt(program, imported, frame, ch), pose);
      const error = localError(program, pose.boneLocal, expected.boneLocal);
      expect(error.rotation).toBeLessThan(1e-5);
      expect(error.translation).toBeLessThan(1e-6);
    });
    // Every key on an integer frame; reduction off keeps every source key.
    for (const c of imported.curves) {
      expect(c.keys.every((k) => Number.isInteger(k.t))).toBe(true);
      expect(c.stats.sourceKeys).toBe(c.keys.length);
      expect(c.stats.maxReduceError).toBe(0);
    }
  });

  it('puts hips motion on cog and leaves fk.hips and root at rest (humanoid)', () => {
    const skeleton = syntheticSkeleton();
    const program = rig(skeleton);
    const imported = importRawClip(bakeRaw(program, randomFrames(program, 6, 5), FPS30).clip, program, opts(FPS30));
    const controls = new Set(imported.curves.map((c) => c.control));
    expect(controls.has(id('cog'))).toBe(true);
    expect(controls.has(id('fk.hips'))).toBe(false);
    expect(controls.has(id('root'))).toBe(false);
    expect(new Set(imported.curves.filter((c) => c.control === id('cog')).map((c) => c.channel))).toEqual(
      new Set(['tx', 'ty', 'tz', 'rx', 'ry', 'rz']),
    );
  });
});

describe('importRawClip: rotations, dropped curves and warnings', () => {
  const skeleton = richHumanoid();
  const program = rig(skeleton);

  it('keeps continuous rotations continuous beyond ±π (eulerNear + Euler filter)', () => {
    const node = skeleton.humanoid?.head as number;
    const rest = skeleton.nodes[node]?.restLocal.q as readonly number[];
    const frames = 31;
    const values = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
      // Spin about the character's Y axis by 3π over the clip (head rest rotation is identity in this rig).
      const q = quatFromAxisAngle([0, 1, 0], (3 * Math.PI * f) / (frames - 1));
      values.set([q[0], q[1], q[2], q[3]], f * 4);
    }
    expect(rest).toEqual([0, 0, 0, 1]);
    const times = Float32Array.from({ length: frames }, (_, f) => f / 30);
    const imported = importRawClip(
      clipOf([{ node, path: 'rotation', interpolation: 'LINEAR', times, values }]),
      program,
      opts(FPS30),
    );
    const ry = curve(imported, 'fk.head', 'ry') ?? [];
    expect(ry).toHaveLength(frames);
    for (let i = 1; i < ry.length; i++)
      expect(Math.abs((ry[i] as KeyData).v - (ry[i - 1] as KeyData).v)).toBeLessThan(0.5);
    expect((ry[ry.length - 1] as KeyData).v).toBeCloseTo(3 * Math.PI, 5);
    // rx and rz stay at their default and get no curves.
    expect(curve(imported, 'fk.head', 'rx')).toBeUndefined();
    expect(curve(imported, 'fk.head', 'rz')).toBeUndefined();
  });

  it('reports dropped channels: weights, springs, rotate-only translation, malformed and unknown nodes', () => {
    const ponytail = skeleton.nodes.findIndex((n) => n.name === 'ponytail');
    const arm = skeleton.humanoid?.leftUpperArm as number;
    const times = Float32Array.from([0, 1]);
    const moving = (q: number[]): Float32Array =>
      Float32Array.from([...q, ...(quatFromAxisAngle([1, 0, 0], 0.5) as number[])]);
    const clip: RawClip = {
      index: 3,
      name: 'mixed',
      duration: 1,
      channels: [
        { node: ponytail, path: 'rotation', interpolation: 'LINEAR', times, values: moving([0, 0, 0, 1]) },
        {
          node: arm,
          path: 'translation',
          interpolation: 'LINEAR',
          times,
          values: Float32Array.from([0, 0.1, 0, 0.5, 0.5, 0.5]),
        },
        { node: arm, path: 'weights', interpolation: 'LINEAR', times, values: Float32Array.from([0, 1]) },
        {
          node: arm,
          path: 'rotation',
          interpolation: 'LINEAR',
          times: Float32Array.from([1, 0]),
          values: new Float32Array(8),
        },
        { node: 9999, path: 'rotation', interpolation: 'LINEAR', times, values: new Float32Array(8) },
      ],
      skipped: [{ reason: 'pointer', channel: 7 }],
    };
    const imported = importRawClip(clip, program, opts(FPS30));
    const text = imported.warnings.join('\n');
    expect(text).toMatch(/ponytail.*spring-bone joint/);
    expect(text).toMatch(/translation animation of "leftUpperArm".*rotate-only/);
    expect(text).toMatch(/Morph target weights/);
    expect(text).toMatch(/Malformed rotation track of "leftUpperArm"/);
    expect(text).toMatch(/node 9999/);
    expect(text).toMatch(/skipped by the reader \(pointer\)/);
    expect(imported.curves).toEqual([]);
  });
});

/** Blocked by WP-1 (anim-core reduceKeys + curve engine) until it lands. */
const WP1_REDUCE_PENDING =
  pendingStub(() => reduceKeys({ keys: [], weighted: false, pre: 'constant', post: 'constant' }, { tolerance: 1 })) ||
  pendingStub(() => curveEngine.compile({ keys: [], weighted: false, pre: 'constant', post: 'constant' }));

describe.skipIf(WP1_REDUCE_PENDING)('importRawClip: reduction (needs WP-1 reduceKeys)', () => {
  const frames = 61;

  /** A dense 24 fps swing of the left lower arm about +Z, one key per frame. */
  function swing(skeleton: SkeletonDesc, angle: (frame: number) => number): RawClip {
    const node = skeleton.humanoid?.leftLowerArm as number;
    const values = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) values.set(quatFromAxisAngle([0, 0, 1], angle(f)), f * 4);
    const times = Float32Array.from({ length: frames }, (_, f) => f / 24);
    return clipOf([{ node, path: 'rotation', interpolation: 'LINEAR', times, values }]);
  }

  function toleranceOf(channel: string): number {
    if (channel.startsWith('r')) return DEFAULT_REDUCE.rotationRad;
    return channel.startsWith('t') ? DEFAULT_REDUCE.translationM : DEFAULT_REDUCE.scale;
  }

  /**
   * Worst error of each reduced curve against the unreduced import (both evaluated with the curve engine) at every
   * unreduced key time and every integer frame, as a multiple of the channel tolerance.
   */
  function worstRatio(reduced: ImportedClipKeys, dense: ImportedClipKeys): number {
    let worst = 0;
    const integerFrames = Array.from({ length: dense.range.end - dense.range.start + 1 }, (_, i) => i);
    for (const c of reduced.curves) {
      const original = dense.curves.find((d) => d.control === c.control && d.channel === c.channel);
      if (original === undefined) throw new Error(`${c.control}/${c.channel} missing from the dense import`);
      const tolerance = toleranceOf(c.channel);
      expect(c.stats.maxReduceError).toBeLessThanOrEqual(tolerance);
      const compiled = curveEngine.compile({ keys: c.keys, weighted: false, pre: 'constant', post: 'constant' });
      const reference = curveEngine.compile({
        keys: original.keys,
        weighted: false,
        pre: 'constant',
        post: 'constant',
      });
      for (const t of [...original.keys.map((key) => key.t), ...integerFrames]) {
        const error = Math.abs(curveEngine.evaluate(compiled, t) - curveEngine.evaluate(reference, t));
        worst = Math.max(worst, error / tolerance);
      }
    }
    return worst;
  }

  it('keeps LINEAR-sourced curves linear and within tolerance at every source key and frame', () => {
    // Linear tangents are kept through reduction (MVP-SPEC §4.11.4), so a sine sampled with LINEAR interpolation
    // only sheds keys where it is nearly straight; the promise is fewer keys within tolerance, not a ratio.
    const skeleton = syntheticSkeleton();
    const program = rig(skeleton);
    const raw = swing(skeleton, (f) => Math.sin(f / 10) * 0.8);
    const dense = importRawClip(raw, program, opts(FPS24));
    const reduced = importRawClip(raw, program, opts(FPS24, { reduce: DEFAULT_REDUCE }));
    expect(reduced.curves.length).toBeGreaterThan(0);
    expect(reduced.curves.map((c) => c.channel)).toEqual(dense.curves.map((c) => c.channel));
    for (const c of reduced.curves) {
      expect(c.stats.sourceKeys).toBe(frames);
      expect(c.keys.length).toBeLessThan(frames);
      for (const key of c.keys) expect([key.inType, key.outType]).toEqual(['linear', 'linear']);
    }
    expect(worstRatio(reduced, dense)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('reduces eased key-pose motion (auto tangents) back to its three poses', () => {
    // Resampling keys every frame with auto tangents (MVP-SPEC §4.11.6); a smoothstep ease 0 → 0.8 rad → 0 is the
    // Hermite segment between flat auto keys, so top-down insertion (§4.11.4) stops at the poses on 0, 30 and 60.
    const skeleton = syntheticSkeleton();
    const program = rig(skeleton);
    const raw = swing(skeleton, (f) => {
      const u = f <= 30 ? f / 30 : (60 - f) / 30;
      return 0.8 * u * u * (3 - 2 * u);
    });
    const dense = importRawClip(raw, program, opts(FPS24, { keyMode: 'resample' }));
    const reduced = importRawClip(raw, program, opts(FPS24, { keyMode: 'resample', reduce: DEFAULT_REDUCE }));
    expect(reduced.curves.map((c) => c.channel)).toEqual(['rz']);
    const rz = reduced.curves[0] as (typeof reduced.curves)[number];
    expect(rz.stats.sourceKeys).toBe(frames);
    expect(rz.keys.map((key) => key.t)).toEqual([0, 30, 60]);
    expect(rz.keys[1]?.v).toBeCloseTo(0.8, 6);
    for (const key of rz.keys) expect([key.inType, key.outType]).toEqual(['auto', 'auto']);
    expect(worstRatio(reduced, dense)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('importHumanoidClip (MVP-SPEC §4.11.7)', () => {
  it('round-trips a clip baked to N_b and the hips position (bake to N, ≤ 1e-5)', () => {
    const skeleton = richHumanoid();
    const program = rig(skeleton);
    const frames = randomFrames(program, 10, 41, 0.8);
    // Secondary controls are not part of normalized humanoid motion.
    for (const ch of frames) {
      program.controls.forEach((control, slot) => {
        if (control.group === 'secondary') ch.values.fill(0, slot * 9 + 3, slot * 9 + 6);
      });
    }
    const hips = skeleton.humanoid?.hips as number;
    const { data, poses } = bakeHumanoid(program, frames, FPS30, [0, 0.95, 0]);
    expect(hips).toBeGreaterThan(0);
    const imported = importHumanoidClip(data, program, { ...opts(FPS30), hipsScale: 'auto' });
    const pose = program.allocPose();
    poses.forEach((expected, frame) => {
      program.evaluate(channelsAt(program, imported, frame), pose);
      for (let h = 0; h < HUMAN_BONE_NAMES.length; h++) {
        expect(quatAngleBetween(quatAt(pose.humanLocal, h * 4), quatAt(expected.humanLocal, h * 4))).toBeLessThan(1e-5);
      }
      expect(maxAbsDiff(pose.hipsPosition, expected.hipsPosition)).toBeLessThan(1e-6);
    });
    expect(imported.curves.some((c) => c.control === id('fk.hips'))).toBe(false);
  });

  it('composes world deltas over missing and extra bones', () => {
    // Source: the rich humanoid posed, exported without `chest`; target: the same rig (has chest).
    const skeleton = richHumanoid();
    const program = rig(skeleton);
    const frames = randomFrames(program, 2, 77, 0.6);
    for (const ch of frames) {
      program.controls.forEach((control, slot) => {
        if (control.group === 'secondary') ch.values.fill(0, slot * 9 + 3, slot * 9 + 6);
      });
    }
    const { data, poses } = bakeHumanoid(program, frames, FPS30, [0, 0.95, 0]);
    // World deltas D_b of the source pose.
    const D = (pose: { boneWorld: Float64Array }, name: HumanBoneName): number[] => deltaOf(program, pose, name);
    // Drop chest: upperChest's N becomes relative to spine (N' = D_spine⁻¹ · D_upperChest).
    const rotations = { ...data.rotations };
    delete rotations.chest;
    const upper = rotations.upperChest;
    if (upper === undefined) throw new Error('missing upperChest');
    const values = new Float32Array(upper.values.length);
    poses.forEach((pose, f) => {
      const n = mul(inv(D(pose, 'spine')), D(pose, 'upperChest'));
      values.set(n, f * 4);
    });
    rotations.upperChest = { times: upper.times, values };
    const source: HumanoidClipData = {
      ...data,
      presentBones: data.presentBones.filter((b) => b !== 'chest'),
      rotations,
    };
    const imported = importHumanoidClip(source, program, { ...opts(FPS30), hipsScale: 'auto' });
    const pose = program.allocPose();
    poses.forEach((expected, frame) => {
      program.evaluate(channelsAt(program, imported, frame), pose);
      // chest takes the spine's delta (identity normalized rotation); everything else keeps its world delta.
      expect(quatAngleBetween(deltaOf(program, pose, 'chest') as never, D(expected, 'spine') as never)).toBeLessThan(
        1e-5,
      );
      for (const name of ['upperChest', 'neck', 'head', 'leftHand', 'rightFoot'] as const) {
        expect(quatAngleBetween(deltaOf(program, pose, name) as never, D(expected, name) as never)).toBeLessThan(1e-5);
      }
    });
  });

  it('drops source bones the target lacks, with a warning', () => {
    const rich = richHumanoid();
    const richProgram = rig(rich);
    const { data } = bakeHumanoid(richProgram, randomFrames(richProgram, 2, 3, 0.3), FPS30, [0, 0.95, 0]);
    const synthetic = syntheticSkeleton();
    const imported = importHumanoidClip(data, rig(synthetic), { ...opts(FPS30), hipsScale: 'auto' });
    expect(imported.warnings.some((w) => w.includes('leftThumbDistal'))).toBe(true);
    expect(imported.warnings.some((w) => w.includes('"leftUpperArm"'))).toBe(false);
    // One warning names them all (a VRMA lists every finger of the source).
    expect(imported.warnings.filter((w) => w.includes('no control on this character'))).toHaveLength(1);

    // Tracks that stay at rest (a VRMA written with constant tracks) lose nothing: no warning.
    const rotations = Object.fromEntries(
      Object.entries(data.rotations).map(([bone, track]) => {
        if (!/Thumb|Index|Middle|Ring|Little/.test(bone) || track === undefined) return [bone, track];
        const values = new Float32Array(track.values.length);
        for (let o = 0; o < values.length; o += 4) values[o + 3] = 1;
        return [bone, { times: track.times, values }];
      }),
    ) as typeof data.rotations;
    const atRest = importHumanoidClip({ ...data, rotations }, rig(synthetic), { ...opts(FPS30), hipsScale: 'auto' });
    expect(atRest.warnings.some((w) => /Thumb|Index|Middle|Ring|Little/.test(w))).toBe(false);
  });

  it("scales the hips position: 'auto' by the rest hips heights, or by a number", () => {
    const skeleton = syntheticSkeleton();
    const program = rig(skeleton);
    const times = Float32Array.from([0, 1]);
    const data: HumanoidClipData = {
      name: 'hop',
      duration: 1,
      presentBones: ['hips'],
      rotations: {},
      hips: { times, values: Float32Array.from([0.2, 1.9, 0.4, 0.2, 2.1, 0.4]) },
      restHipsPosition: [0, 1.9, 0],
      interpolation: { hipsPosition: 'LINEAR' },
    };
    const auto = importHumanoidClip(data, program, { ...opts(FPS30), hipsScale: 'auto' });
    const pose = program.allocPose();
    program.evaluate(channelsAt(program, auto, 0), pose);
    const scale = 0.95 / 1.9;
    expect(maxAbsDiff(pose.hipsPosition, [0.2 * scale, 1.9 * scale, 0.4 * scale])).toBeLessThan(1e-6);
    program.evaluate(channelsAt(program, auto, 30), pose);
    expect(maxAbsDiff(pose.hipsPosition, [0.2 * scale, 2.1 * scale, 0.4 * scale])).toBeLessThan(1e-6);
    const fixed = importHumanoidClip(data, program, { ...opts(FPS30), hipsScale: 1 });
    program.evaluate(channelsAt(program, fixed, 30), pose);
    expect(maxAbsDiff(pose.hipsPosition, [0.2, 2.1, 0.4])).toBeLessThan(1e-6);
    expect(fixed.curves.every((c) => c.control === id('cog'))).toBe(true);
    expect(fixed.curves.every((c) => c.keys.every((k) => k.inType === 'linear'))).toBe(true);
  });

  it('rejects non-humanoid rigs', () => {
    const generic = genericSkeleton();
    let error: unknown;
    try {
      importHumanoidClip(
        {
          name: 'x',
          duration: 0,
          presentBones: [],
          rotations: {},
          hips: null,
          restHipsPosition: [0, 1, 0],
          interpolation: {},
        },
        rig(generic),
        { ...opts(FPS30), hipsScale: 'auto' },
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EkzaError);
    expect((error as EkzaError).code).toBe('unsupported');
  });
});

describe('remapRawClipByName', () => {
  it('moves channels to the nodes with the same names and reports the rest', () => {
    const from = genericSkeleton();
    const to: SkeletonDesc = {
      ...from,
      nodes: [...from.nodes].reverse().map((n, i) => ({ ...n, index: i, parent: -1 })),
    };
    const times = Float32Array.from([0]);
    const raw = clipOf([
      {
        node: from.nodes.findIndex((n) => n.name === 'spine'),
        path: 'rotation',
        interpolation: 'LINEAR',
        times,
        values: new Float32Array(4),
      },
      { node: 9999, path: 'rotation', interpolation: 'LINEAR', times, values: new Float32Array(4) },
    ]);
    const target: SkeletonDesc = { ...to, nodes: to.nodes.filter((n) => n.name !== 'neck') };
    const { clip, unmatched } = remapRawClipByName(raw, from, target);
    expect(clip.channels).toHaveLength(1);
    expect(target.nodes[clip.channels[0]?.node as number]?.name).toBe('spine');
    expect(unmatched).toEqual(['#9999']);
    expect(clip.skipped).toEqual([{ reason: 'unmatched-node', channel: 1 }]);
  });
});

// ---------- quaternion helpers for the humanoid composition test ----------

function deltaOf(program: RigProgram, pose: { boneWorld: Float64Array }, name: HumanBoneName): number[] {
  const node = program.skeleton.humanoid?.[name] as number;
  const m = pose.boneWorld.subarray(node * 16, node * 16 + 16);
  const world = quatFromMatrix(m);
  const rest = program.allocPose();
  program.evaluate(program.allocChannels(), rest);
  const restQ = quatFromMatrix(rest.boneWorld.subarray(node * 16, node * 16 + 16));
  return mul(world, inv(restQ));
}

function quatFromMatrix(m: Float64Array): number[] {
  return [...mat4Decompose(m.slice()).q];
}

function mul(a: number[], b: number[]): number[] {
  const [ax, ay, az, aw] = a as [number, number, number, number];
  const [bx, by, bz, bw] = b as [number, number, number, number];
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function inv(q: number[]): number[] {
  return [-(q[0] as number), -(q[1] as number), -(q[2] as number), q[3] as number];
}
