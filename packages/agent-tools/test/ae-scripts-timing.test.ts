// MCP-SPEC §8 P2 DoD, §9.3.3: P2's copies of the reference scripts AE-03 (breathing idle loop), AE-11 (overshoot that
// settles), AE-20 (moving hold) and AE-22 (two turns: a wave, then "too fast") on Polybot — scripted agents over the
// core tools through the runtime (headless, P1's operators real or doubled), graded on raw bone worlds and raw curve
// keys by test/ae-graders.ts. Each grader also rejects the unedited setup (grader integrity, §9.3.4).
import type { Vec3 } from '@ekza-animator/anim-core';
import type { ClipId } from '@ekza-animator/doc';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  allBones,
  angleDeg,
  bonesAt,
  boneWorld,
  channelSeam,
  cycles,
  DEG,
  deadHolds,
  length,
  period,
  pops,
  principal,
  range,
  restWorld,
  sub,
  type World,
} from './ae-graders';
import { userClip, userKeys } from './ae-tasks';
import { call, dataOf, type P2Fixture, p2Fixture, runtimeOf } from './p2-support';

let fx: P2Fixture;
beforeEach(async () => {
  fx = await p2Fixture(131);
});

function clipNamed(name: string): ClipId {
  const clip = fx.app.store.query.clipsOfCharacter(fx.character).find((c) => c.name === name);
  if (clip === undefined) throw new Error(`no clip ${name}`);
  return clip.id;
}

type Rows = { controls: { key: string; label?: string }[] };
/** The channel and sign of a labelled action (`bend forward = rx+`) from rig_describe, as an agent reads it. */
async function actionOf(
  runtime: ReturnType<typeof runtimeOf>,
  control: string,
  action: string,
): Promise<{ axis: 'x' | 'y' | 'z'; sign: 1 | -1 }> {
  const rig = dataOf<Rows>(await call(runtime, 'rig_describe', { detail: 'detailed' }));
  const label = rig.controls.find((c) => c.key === control)?.label ?? '';
  const match = new RegExp(`${action} = r([xyz])([+−])`).exec(label);
  if (match === null) throw new Error(`no "${action}" in the label of ${control}: ${label}`);
  return { axis: match[1] as 'x' | 'y' | 'z', sign: match[2] === '+' ? 1 : -1 };
}

// ---------- AE-03 ----------
function pitchDeg(world: World, rest: World): number {
  const forward = [0, 0, 1] as Vec3;
  const q = world.rotation;
  const r = rest.rotation;
  // the bone's rotation relative to rest, applied to the character's forward axis: + = leaning forward (down)
  const rel = angleDeg(q, r) === 0 ? forward : rotate(mul(q, inv(r)), forward);
  return Math.asin(Math.max(-1, Math.min(1, -rel[1]))) / DEG;
}
const inv = (q: readonly number[]) => [-(q[0] as number), -(q[1] as number), -(q[2] as number), q[3] as number];
function mul(a: readonly number[], b: readonly number[]): number[] {
  const [ax, ay, az, aw] = a as [number, number, number, number];
  const [bx, by, bz, bw] = b as [number, number, number, number];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
function rotate(q: readonly number[], v: Vec3): Vec3 {
  const p = mul(mul(q, [v[0], v[1], v[2], 0]), inv(q));
  return [p[0] as number, p[1] as number, p[2] as number];
}

/** AE-03's grader: a 4 s loop, one chest breath of 0.5–4°, a seamless seam, still limbs. */
function gradeBreath(clip: ClipId): Record<string, boolean | number> {
  const record = fx.app.store.get('clips', clip);
  if (record === undefined) throw new Error('no clip');
  const fps = record.fps.num / record.fps.den;
  const frames = range(record.range.start, record.range.end);
  const rest = restWorld(fx.app, fx.character, 'chest');
  const pitch = frames.map((f) => pitchDeg(boneWorld(fx.app, fx.character, clip, 'chest', f), rest));
  const seam = channelSeam(fx.app, clip);
  const limbs = ['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerArm', 'rightLowerArm'];
  const first = bonesAt(fx.app, fx.character, clip, limbs, frames[0] as number);
  let limbDeg = 0;
  for (const f of frames) {
    bonesAt(fx.app, fx.character, clip, limbs, f).forEach((bone, i) => {
      limbDeg = Math.max(limbDeg, angleDeg(bone.rotation, (first[i] as World).rotation));
    });
  }
  const peakToPeak = Math.max(...pitch) - Math.min(...pitch);
  return {
    loop: record.loop,
    seconds: Math.abs((record.range.end - record.range.start) / fps - 4) <= 1 / fps,
    cycles: cycles(pitch),
    peakToPeak: peakToPeak >= 0.5 && peakToPeak <= 4,
    seamC0: seam.maxC0 <= 1e-6,
    seamC1: seam.maxC1 <= 1e-3,
    limbs: limbDeg <= 2,
  };
}

const passes = (grade: Record<string, boolean | number>, expected: Record<string, boolean | number>) =>
  expect(grade).toEqual(expected);

describe('AE scripts on timing and loops (P2 copies of §9.3.3 references)', () => {
  it('AE-03: creates a 4-second seamless breathing idle', async () => {
    const runtime = runtimeOf(fx);
    await call(runtime, 'history_checkpoint', { label: 'Breathing idle' });
    expect((await call(runtime, 'clip_create', { name: 'breathe', fps: 30, durationSeconds: 4 })).ok).toBe(true);
    const clip = clipNamed('breathe');
    // a clip without the breath fails the grader (the "loop flag only" adversarial)
    expect(gradeBreath(clip)).toMatchObject({ cycles: 0, peakToPeak: false });
    // inhale: the chest leans back a little, from the label of the chest (bend forward = rx±)
    const lean = await actionOf(runtime, 'fk.chest', 'bend forward');
    for (const [frame, degrees] of [
      [0, 0],
      [60, -1.5],
      [120, 0],
    ] as const) {
      const result = await call(runtime, 'pose_set', {
        clip: 'breathe',
        frame,
        set: [{ control: 'fk.chest', rotateDeg: { [lean.axis]: lean.sign * degrees } }],
        tangent: frame === 60 ? 'auto' : 'flat',
      });
      expect(result.ok).toBe(true);
    }
    const loop = await call(runtime, 'clip_make_loop', { clip: 'breathe', method: 'match_ends' });
    expect(dataOf<{ after: { verdict: string } }>(loop).after.verdict).toBe('seamless');
    passes(gradeBreath(clip), {
      loop: true,
      seconds: true,
      cycles: 1,
      peakToPeak: true,
      seamC0: true,
      seamC1: true,
      limbs: true,
    });
  });

  it('AE-11: adds an overshoot that settles when the right arm stops at frame 20', async () => {
    // the user's arm move: 0 → 20, then a hold to 60 (the arm raised with rz, per Polybot's label "raise = rz−")
    const clip = await userClip(fx.app, fx.character, 'reach', { start: 0, end: 60 });
    userKeys(fx.app, fx.character, clip, [
      { control: 'fk.upperArm.R', channel: 'rz', frame: 0, value: 0, tangent: 'flat' },
      { control: 'fk.upperArm.R', channel: 'rz', frame: 20, value: -50 * DEG, tangent: 'flat' },
      { control: 'fk.upperArm.R', channel: 'rz', frame: 60, value: -50 * DEG, tangent: 'flat' },
    ]);
    const arm = (f: number) => boneWorld(fx.app, fx.character, clip, 'rightUpperArm', f).rotation;
    const start = arm(0);
    const target = arm(20);
    const amplitude = angleDeg(target, start);
    const grade = () => {
      const after = range(20, 60).map((f) => angleDeg(arm(f), start));
      const overshoot = (Math.max(...after) - amplitude) / amplitude;
      return {
        overshoot: overshoot >= 0.05 && overshoot <= 0.2,
        settled: range(32, 60).every((f) => angleDeg(arm(f), target) <= 1),
        final: angleDeg(arm(60), target) <= 0.5,
      };
    };
    expect(grade()).toEqual({ overshoot: false, settled: true, final: true });
    // the agent: read the move, overshoot by 12 % four frames after the stop, settle flat by frame 30
    const runtime = runtimeOf(fx);
    const keys = dataOf<{ curves: { channel: string; keys: [number, number][] }[] }>(
      await call(runtime, 'keys_read', { clip: 'reach', targets: { controls: ['fk.upperArm.R'] } }),
    ).curves.find((curve) => curve.channel === 'rz')?.keys;
    const [, from] = keys?.[0] ?? [0, 0];
    const [stop, to] = keys?.[1] ?? [0, 0];
    const result = await call(runtime, 'keys_set', {
      clip: 'reach',
      keys: [
        { control: 'fk.upperArm.R', channel: 'rz', frame: stop + 4, value: to + 0.12 * (to - from) },
        { control: 'fk.upperArm.R', channel: 'rz', frame: stop + 10, value: to, tangent: 'flat' },
      ],
      intent: 'Overshoot and settle',
    });
    expect(result.ok).toBe(true);
    expect(grade()).toEqual({ overshoot: true, settled: true, final: true });
  });

  it('AE-20: gives a dead hold from frame 30 to 40 a moving hold, frames outside 25–45 unchanged', async () => {
    const clip = await userClip(fx.app, fx.character, 'idle', { start: 0, end: 70 });
    const curve = (control: string, channel: string, values: readonly number[]) =>
      [0, 15, 30, 40, 55, 70].map((frame, i) => ({
        control,
        channel,
        frame,
        value: (values[i] as number) * DEG,
        ...(frame === 30 || frame === 40 ? { tangent: 'flat' as const } : {}),
      }));
    userKeys(fx.app, fx.character, clip, [
      ...curve('fk.chest', 'rx', [0, 3, 2, 2, 4, 0]),
      ...curve('fk.head', 'rx', [0, -2, 1, 1, -1, 0]),
      ...curve('fk.upperArm.L', 'rz', [10, 14, 12, 12, 16, 10]),
      ...curve('fk.upperArm.R', 'rz', [-10, -14, -12, -12, -16, -10]),
    ]);
    const bones = allBones(fx.app, fx.character);
    const posesOf = (frames: readonly number[]) => frames.map((f) => bonesAt(fx.app, fx.character, clip, bones, f));
    const outside = [...range(0, 24), ...range(46, 70)];
    const before = posesOf(outside);
    const k = (fx.app.characters.get(fx.character)?.skeleton.height ?? 1.7) / 1.7;
    const grade = () => {
      const hold = posesOf(range(30, 40));
      const at30 = hold[0] as World[];
      let maxM = 0;
      let maxDeg = 0;
      let torsoDeg = 0;
      const torso = new Set(['spine', 'chest', 'upperChest', 'neck', 'head'].map((b) => bonesOf(b)));
      for (const pose of hold) {
        pose.forEach((bone, i) => {
          const ref = at30[i] as World;
          maxM = Math.max(maxM, length(sub(bone.position, ref.position)));
          const deg = angleDeg(bone.rotation, ref.rotation);
          maxDeg = Math.max(maxDeg, deg);
          if (torso.has(bones[i] as string)) torsoDeg = Math.max(torsoDeg, deg);
        });
      }
      const after = posesOf(outside);
      // unchanged up to float noise: 0.001° and 1 µm
      const unchanged = after.every((pose, p) =>
        pose.every((bone, i) => {
          const was = (before[p] as World[])[i] as World;
          return angleDeg(bone.rotation, was.rotation) < 1e-3 && length(sub(bone.position, was.position)) < 1e-6;
        }),
      );
      return {
        dead: deadHolds(hold, range(30, 40)).length === 0 ? 'none' : 'dead',
        stillAHold: maxM <= 0.02 * k && maxDeg <= 3,
        torsoMoves: torsoDeg >= 0.3,
        outsideUnchanged: unchanged,
      };
    };
    function bonesOf(humanoid: string): string {
      const runtime = fx.app.characters.get(fx.character);
      const node = runtime?.skeleton.humanoid?.[humanoid as 'hips'];
      return node === undefined ? '' : (runtime?.skeleton.nodes[node]?.name ?? '');
    }
    expect(grade()).toEqual({ dead: 'dead', stillAHold: true, torsoMoves: false, outsideUnchanged: true });
    // the agent: drift the chest, then the head, inside the hold (keys between the held keys, read first)
    const runtime = runtimeOf(fx);
    const read = dataOf<{ curves: { control: string; channel: string; keys: [number, number][] }[] }>(
      await call(runtime, 'keys_read', {
        clip: 'idle',
        targets: { controls: ['fk.chest', 'fk.head'], channels: ['rx'] },
        rangeFrames: [30, 40],
      }),
    );
    const held = (control: string) => read.curves.find((c) => c.control === control)?.keys[0]?.[1] ?? 0;
    const result = await call(runtime, 'keys_set', {
      clip: 'idle',
      keys: [
        { control: 'fk.chest', channel: 'rx', frame: 33, value: held('fk.chest') + 0.9 },
        { control: 'fk.head', channel: 'rx', frame: 37, value: held('fk.head') + 0.9 },
      ],
      intent: 'Moving hold',
    });
    expect(result.ok).toBe(true);
    expect(grade()).toEqual({ dead: 'none', stillAHold: true, torsoMoves: true, outsideUnchanged: true });
  });

  it('AE-22: waves the right hand, then (turn 2) slows the wave without rebuilding it', async () => {
    const runtime = runtimeOf(fx);
    // turn 1: "Make Polybot wave its right hand."
    await call(runtime, 'history_checkpoint', { label: 'Wave right hand' });
    expect((await call(runtime, 'clip_create', { name: 'wave', fps: 30, durationSeconds: 2 })).ok).toBe(true);
    for (let i = 0; i <= 6; i++) {
      const result = await call(runtime, 'pose_aim', {
        clip: 'wave',
        frame: 10 * i,
        aims: [
          { bone: 'rightUpperArm', direction: [-0.8, 0.6, 0] },
          { bone: 'rightLowerArm', direction: i % 2 === 0 ? [-0.55, 0.83, 0.1] : [0.25, 0.97, 0.1] },
        ],
      });
      expect(result.ok).toBe(true);
    }
    const clip = clipNamed('wave');
    const signal = () => {
      const record = fx.app.store.get('clips', clip);
      const frames = range(record?.range.start ?? 0, record?.range.end ?? 0);
      const hand = frames.map((f) => {
        const [h, c] = bonesAt(fx.app, fx.character, clip, ['rightHand', 'upperChest'], f) as [World, World];
        return sub(h.position, c.position);
      });
      return { frames, values: principal(hand).values };
    };
    const turn1 = signal();
    const period1 = period(turn1.values) ?? 0;
    const range1 =
      (fx.app.store.get('clips', clip)?.range.end ?? 0) - (fx.app.store.get('clips', clip)?.range.start ?? 0);
    expect(cycles(turn1.values)).toBe(3);
    // turn 2: "Too fast, and the elbow pops at frame 14." — 1.5× slower: the range first, then the arm's keys
    await call(runtime, 'history_checkpoint', { label: 'Slower wave' });
    expect((await call(runtime, 'clip_update', { clip: 'wave', rangeFrames: [0, 90] })).ok).toBe(true);
    const retime = await call(runtime, 'keys_retime', {
      clip: 'wave',
      targets: { bodyParts: ['arm.R'] },
      mode: 'scale',
      factor: 1.5,
      pivotFrame: 0,
    });
    expect(dataOf<{ moved: number }>(retime).moved).toBeGreaterThan(0);
    const turn2 = signal();
    const record = fx.app.store.get('clips', clip);
    const elbow = turn2.frames.map((f) => boneWorld(fx.app, fx.character, clip, 'rightLowerArm', f).rotation);
    const span = (record?.range.end ?? 0) - (record?.range.start ?? 0);
    expect({
      cycles: cycles(turn2.values) >= 2,
      slower: (period(turn2.values) ?? 0) >= 1.3 * period1,
      pops: pops(elbow, 30),
      kept: record?.name === 'wave' && span >= 0.5 * range1 && span <= 1.5 * range1,
    }).toEqual({ cycles: true, slower: true, pops: [], kept: true });
  });
});
