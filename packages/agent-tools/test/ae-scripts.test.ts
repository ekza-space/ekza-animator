// MCP-SPEC §8 P2 DoD, §9.3.3: P2's own copies of evaluation reference scripts until P9 merges — each a scripted agent
// that solves the task with the core tools through the runtime (headless, P1's operators real or doubled), graded on
// raw bone worlds from `evaluateAt` (never the tools' own outputs). AE-01 wave, AE-02 nod by pose_set blocking,
// AE-06 1.5× slower, AE-12 relaxed arms and a head turn, AE-18 "25 % bigger", AE-25 key the user's shown pose.
// Tasks that need P4's analysis or P5's capture, scope-migrated operators (P1) or the UAL walk fixtures are P9's.
import {
  mat4Decompose,
  quatInvert,
  quatMultiply,
  quatRotateVec3,
  type Vec3,
  xfIdentity,
} from '@ekza-studio/anim-core';
import type { CharacterId, ClipId, ControlId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, controlOf, dataOf, keysOf, liveHost, type P2Fixture, p2Fixture, runtimeOf } from './p2-support';
import { READY } from './ready';

const DEG = Math.PI / 180;

// ---------- grader helpers (independent of the tools) ----------
interface World {
  readonly position: Vec3;
  readonly rotation: readonly [number, number, number, number];
}
function boneWorld(app: EditorApp, character: CharacterId, clip: ClipId, bone: string, frame: number): World {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const node = runtime.skeleton.humanoid?.[bone as 'hips'] ?? -1;
  const pose = runtime.program.allocPose();
  app.evaluation.evaluateAt(character, clip, frame, pose);
  const xf = mat4Decompose(pose.boneWorld.subarray(node * 16, node * 16 + 16), xfIdentity());
  return { position: [xf.t[0], xf.t[1], xf.t[2]], rotation: [xf.q[0], xf.q[1], xf.q[2], xf.q[3]] };
}
function restWorld(app: EditorApp, character: CharacterId, bone: string): World {
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new Error('no runtime');
  const node = runtime.skeleton.humanoid?.[bone as 'hips'] ?? -1;
  const pose = runtime.program.allocPose();
  runtime.program.evaluate(runtime.program.allocChannels(), pose);
  const xf = mat4Decompose(pose.boneWorld.subarray(node * 16, node * 16 + 16), xfIdentity());
  return { position: [xf.t[0], xf.t[1], xf.t[2]], rotation: [xf.q[0], xf.q[1], xf.q[2], xf.q[3]] };
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** First principal component of points (power iteration on the covariance). */
function principal(points: readonly Vec3[]): { axis: Vec3; values: number[] } {
  const mean: Vec3 = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) mean[i] = (mean[i] as number) + (p[i] as number) / points.length;
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = sub(p, mean);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) c[i * 3 + j] = (c[i * 3 + j] as number) + (d[i] as number) * (d[j] as number);
  }
  let v: Vec3 = [1, 0.5, 0.25];
  for (let k = 0; k < 64; k++) {
    v = norm([
      (c[0] as number) * v[0] + (c[1] as number) * v[1] + (c[2] as number) * v[2],
      (c[3] as number) * v[0] + (c[4] as number) * v[1] + (c[5] as number) * v[2],
      (c[6] as number) * v[0] + (c[7] as number) * v[1] + (c[8] as number) * v[2],
    ]);
  }
  return { axis: v, values: points.map((p) => dot(sub(p, mean), v)) };
}

/** Oscillation cycles of a signal: zero crossings of the detrended signal with 10 % hysteresis, halved. */
function cycles(values: readonly number[]): number {
  const n = values.length;
  const slope = ((values[n - 1] as number) - (values[0] as number)) / (n - 1);
  const detrended = values.map((v, i) => v - (values[0] as number) - slope * i);
  const mean = detrended.reduce((s, v) => s + v, 0) / n;
  const centred = detrended.map((v) => v - mean);
  const band = 0.1 * (Math.max(...centred) - Math.min(...centred));
  let state = 0;
  let crossings = 0;
  for (const v of centred) {
    const next = v > band ? 1 : v < -band ? -1 : state;
    if (state !== 0 && next !== state) crossings++;
    state = next;
  }
  return Math.floor(crossings / 2);
}

const range = (start: number, end: number): number[] => Array.from({ length: end - start + 1 }, (_, i) => start + i);

let fx: P2Fixture;
beforeEach(async () => {
  fx = await p2Fixture(111);
});

/** The wave script of E2E-AI-01/02 (MCP-SPEC §9.1): a checkpoint, a 2 s clip, seven pose_aim calls. */
async function waveScript(runtime: ReturnType<typeof runtimeOf>): Promise<void> {
  expect(dataOf(await call(runtime, 'history_checkpoint', { label: 'Wave left hand ×3' }))).toBeTruthy();
  expect(dataOf(await call(runtime, 'clip_create', { name: 'wave', fps: 30, durationSeconds: 2 }))).toMatchObject({
    clip: { rangeFrames: [0, 60] },
  });
  for (let i = 0; i <= 6; i++) {
    const result = await call(runtime, 'pose_aim', {
      clip: 'wave',
      frame: 10 * i,
      aims: [
        { bone: 'leftUpperArm', direction: [0.8, 0.6, 0] },
        { bone: 'leftLowerArm', direction: i % 2 === 0 ? [0.55, 0.83, 0.1] : [-0.25, 0.97, 0.1] },
      ],
    });
    expect(result.ok).toBe(true);
  }
}

function clipNamed(name: string): ClipId {
  const clip = fx.app.store.query.clipsOfCharacter(fx.character).find((c) => c.name === name);
  if (clip === undefined) throw new Error(`no clip ${name}`);
  return clip.id;
}

function waveGrade(clip: ClipId): { cycles: number; peakToPeakM: number; aboveShoulder: number } {
  const frames = range(0, 60);
  const chest = 'upperChest';
  const hands = frames.map((f) =>
    sub(
      boneWorld(fx.app, fx.character, clip, 'leftHand', f).position,
      boneWorld(fx.app, fx.character, clip, chest, f).position,
    ),
  );
  const { values } = principal(hands);
  const above = frames.filter(
    (f) =>
      boneWorld(fx.app, fx.character, clip, 'leftHand', f).position[1] >
      boneWorld(fx.app, fx.character, clip, 'leftUpperArm', f).position[1],
  ).length;
  return {
    cycles: cycles(values),
    peakToPeakM: Math.max(...values) - Math.min(...values),
    aboveShoulder: above / frames.length,
  };
}

describe('AE scripts (P2 copies of §9.3.3 references)', () => {
  it('AE-01: waves the left hand three times above the shoulder in a new 2 s clip', async () => {
    const runtime = runtimeOf(fx);
    await waveScript(runtime);
    const clip = clipNamed('wave');
    const k = (fx.app.characters.get(fx.character)?.skeleton.height ?? 1.7) / 1.7;
    const grade = waveGrade(clip);
    expect(grade.cycles).toBe(3);
    expect(grade.peakToPeakM).toBeGreaterThanOrEqual(0.05 * k);
    expect(grade.aboveShoulder).toBeGreaterThanOrEqual(0.8);
    // the other arm did not move
    const right = (f: number) => boneWorld(fx.app, fx.character, clip, 'rightLowerArm', f).position;
    expect(Math.hypot(...sub(right(30), right(0)))).toBeLessThan(1e-6);
    // one AI step per edit call, after the checkpoint
    const steps = fx.app.history.entries().undo.filter((step) => step.label.startsWith('AI: '));
    expect(steps).toHaveLength(8);
  });

  it('AE-18: makes the wave 25 % bigger about its mean, period and key frames unchanged', async () => {
    const runtime = runtimeOf(fx);
    await waveScript(runtime);
    const clip = clipNamed('wave');
    const before = waveGrade(clip);
    const forearm = controlOf(fx.app, fx.character, 'fk.lowerArm.L');
    const keyFrames = keysOf(fx.app, clip, forearm, 'rz').map(([t]) => t);
    const result = await call(runtime, 'keys_adjust', {
      clip: 'wave',
      targets: { controls: ['fk.lowerArm.L'] },
      scalePercent: 125,
      pivot: 'mean',
      intent: 'Push the wave',
    });
    expect(result.ok).toBe(true);
    const after = waveGrade(clip);
    expect(after.cycles).toBe(before.cycles);
    expect(after.peakToPeakM / before.peakToPeakM).toBeGreaterThan(1.25 * 0.95);
    expect(after.peakToPeakM / before.peakToPeakM).toBeLessThan(1.25 * 1.05);
    expect(keysOf(fx.app, clip, forearm, 'rz').map(([t]) => t)).toEqual(keyFrames);
  });

  it('AE-02: nods yes twice within 1.5 s by pose_set blocking, ending in the starting pose', async () => {
    const runtime = runtimeOf(fx);
    await call(runtime, 'history_checkpoint', { label: 'Nod yes twice' });
    expect((await call(runtime, 'clip_create', { name: 'nod', fps: 30, durationFrames: 45 })).ok).toBe(true);
    // the axis that tips the head down, from the rig's axis hints (what an agent reads)
    const rig = dataOf<{ controls: { key: string; axisHints?: Record<string, string> }[] }>(
      await call(runtime, 'rig_describe', { bodyParts: ['head'], detail: 'detailed' }),
    );
    const hints = rig.controls.find((c) => c.key === 'fk.head')?.axisHints ?? {};
    const [axis, hint] = Object.entries(hints).find(([, text]) => /^tip (down|up)/.test(text)) ?? ['rx', 'tip down'];
    const down = hint.startsWith('tip down') ? 20 : -20;
    const channel = axis.slice(1) as 'x' | 'y' | 'z';
    for (const [frame, value] of [
      [0, 0],
      [8, down],
      [16, 0],
      [24, down],
      [32, 0],
      [45, 0],
    ] as const) {
      const result = await call(runtime, 'pose_set', {
        clip: 'nod',
        frame,
        set: [{ control: 'fk.head', rotateDeg: { [channel]: value } }],
      });
      expect(result.ok).toBe(true);
    }
    const clip = clipNamed('nod');
    const restHead = restWorld(fx.app, fx.character, 'head');
    const pitch = (f: number) => {
      const head = boneWorld(fx.app, fx.character, clip, 'head', f);
      const delta = quatMultiply(head.rotation, quatInvert(restHead.rotation));
      const forward = quatRotateVec3(delta, [0, 0, 1]);
      return Math.asin(-forward[1]) / DEG; // + = face down
    };
    const pitches = range(0, 45).map(pitch);
    const peaks = pitches.filter(
      (p, i) =>
        i > 0 && i < pitches.length - 1 && p > (pitches[i - 1] as number) && p >= (pitches[i + 1] as number) && p > 5,
    );
    expect(peaks).toHaveLength(2);
    for (const peak of peaks) {
      expect(peak).toBeGreaterThanOrEqual(10);
      expect(peak).toBeLessThanOrEqual(30);
    }
    expect(Math.abs(pitch(45) - pitch(0))).toBeLessThan(1);
    expect(fx.app.store.get('clips', clip)?.range).toEqual({ start: 0, end: 45 });
  });

  it('AE-06: makes a clip 1.5× slower with the same poses and no subframe keys', async () => {
    const runtime = runtimeOf(fx);
    const attack = fx.agentClip; // keys on fk.lowerArm.L at 0, 15, 30
    const original = (f: number) => boneWorld(fx.app, fx.character, attack, 'leftHand', f).position;
    const before = range(0, 30).map(original);
    await call(runtime, 'history_checkpoint', { label: 'Slow 1.5×' });
    expect((await call(runtime, 'clip_update', { clip: 'agent', rangeFrames: [0, 45] })).ok).toBe(true);
    const retime = await call(runtime, 'keys_retime', {
      clip: 'agent',
      targets: { bodyParts: ['all'] },
      mode: 'scale',
      factor: 1.5,
      pivotFrame: 0,
    });
    expect(dataOf<{ moved: number }>(retime).moved).toBeGreaterThan(0);
    const forearm = controlOf(fx.app, fx.character, 'fk.lowerArm.L');
    expect(keysOf(fx.app, attack, forearm, 'rz').map(([t]) => t)).toEqual([0, 23, 45]);
    // pose at 1.5·t equals the original at t (within snapping: keys move by ≤ ½ frame)
    for (const t of [0, 10, 20, 30]) {
      const now = boneWorld(fx.app, fx.character, attack, 'leftHand', Math.round(1.5 * t)).position;
      expect(Math.hypot(...sub(now, before[t] as Vec3))).toBeLessThan(0.02);
    }
    const summary = dataOf<{ subframeKeys: number }>(await call(runtime, 'curves_summary', { clip: 'agent' }));
    expect(summary.subframeKeys).toBe(0);
  });

  it('AE-12: relaxed arms at the sides with a slight bend, the head turned 30° to her left', async () => {
    const runtime = runtimeOf(fx);
    await call(runtime, 'history_checkpoint', { label: 'Relaxed pose' });
    expect((await call(runtime, 'clip_create', { name: 'pose', durationFrames: 10 })).ok).toBe(true);
    const out = 15 * DEG;
    const aims = (side: 1 | -1) => [
      { bone: side === 1 ? 'leftUpperArm' : 'rightUpperArm', direction: [side * Math.sin(out), -Math.cos(out), 0] },
      {
        bone: side === 1 ? 'leftLowerArm' : 'rightLowerArm',
        direction: [side * Math.sin(out), -Math.cos(out) * 0.97, 0.25],
      },
    ];
    expect((await call(runtime, 'pose_aim', { clip: 'pose', frame: 0, aims: [...aims(1), ...aims(-1)] })).ok).toBe(
      true,
    );
    // the head turn is a twist of the head bone: the channel whose axis hint says so, its sign checked with a read
    const rig = dataOf<{ controls: { key: string; axisHints?: Record<string, string> }[] }>(
      await call(runtime, 'rig_describe', { bodyParts: ['head'], detail: 'detailed' }),
    );
    const hints = rig.controls.find((c) => c.key === 'fk.head')?.axisHints ?? {};
    const twist = (Object.entries(hints).find(([, text]) => text.startsWith('twist')) ?? ['ry'])[0].slice(1) as
      | 'x'
      | 'y'
      | 'z';
    const turn = async (value: number) =>
      expect(
        (
          await call(runtime, 'pose_set', {
            clip: 'pose',
            frame: 0,
            set: [{ control: 'fk.head', rotateDeg: { [twist]: value } }],
          })
        ).ok,
      ).toBe(true);
    await turn(30);
    const yawOf = async () =>
      dataOf<{ frames: { bones: Record<string, { orientDeg: { yawDeg: number } }> }[] }>(
        await call(runtime, 'pose_read', { clip: 'pose', frames: [0], space: 'world', bones: ['head'] }),
      ).frames[0]?.bones['head']?.orientDeg.yawDeg ?? 0;
    if ((await yawOf()) < 0) await turn(-30);
    const clip = clipNamed('pose');
    const at = (bone: string) => boneWorld(fx.app, fx.character, clip, bone, 0).position;
    const upper = (side: 'left' | 'right') => norm(sub(at(`${side}LowerArm`), at(`${side}UpperArm`)));
    const lower = (side: 'left' | 'right') => norm(sub(at(`${side}Hand`), at(`${side}LowerArm`)));
    for (const side of ['left', 'right'] as const) {
      const fromDown = Math.acos(-upper(side)[1]) / DEG;
      expect(fromDown).toBeLessThan(25);
      expect(fromDown).toBeGreaterThan(5);
      const flexion = Math.acos(Math.min(1, dot(upper(side), lower(side)))) / DEG;
      expect(flexion).toBeGreaterThan(5);
      expect(flexion).toBeLessThan(30);
    }
    expect(Math.abs(Math.acos(-upper('left')[1]) - Math.acos(-upper('right')[1])) / DEG).toBeLessThan(5);
    const restHead = restWorld(fx.app, fx.character, 'head');
    const head = boneWorld(fx.app, fx.character, clip, 'head', 0);
    const forward = quatRotateVec3(quatMultiply(head.rotation, quatInvert(restHead.rotation)), [0, 0, 1]);
    const yaw = Math.atan2(forward[0], forward[2]) / DEG;
    expect(yaw).toBeGreaterThan(25);
    expect(yaw).toBeLessThan(35);
    // feet unchanged
    expect(Math.hypot(...sub(at('leftFoot'), restWorld(fx.app, fx.character, 'leftFoot').position))).toBeLessThan(1e-6);
  });

  it('AE-25: keys the pose the user shows with unkeyed edits, on exactly those channels, leaving the edits', async () => {
    const forearm = controlOf(fx.app, fx.character, 'fk.lowerArm.R');
    const upperArm = controlOf(fx.app, fx.character, 'fk.upperArm.L');
    // the simulated user: the clip `user` at frame 18 with two unkeyed edits
    const state = fx.app.session.getState();
    fx.app.session.setState({ time: { ...state.time, sceneFrame: 18 } });
    const overrides = new Map<ControlId, Record<string, number>>([
      [forearm, { rz: 35 * DEG }],
      [upperArm, { rx: -12 * DEG }],
    ]);
    fx.app.session.setState({ overrides });
    const runtime = runtimeOf(fx, liveHost());
    const summary = dataOf<{ user: { activeClip: string; frame: number; overrides: number } }>(
      await call(runtime, 'scene_summary', {}),
    );
    expect(summary.user).toMatchObject({ activeClip: 'user', frame: 18, overrides: 2 });
    const read = (withUserOverrides: boolean) =>
      call(runtime, 'pose_read', {
        clip: 'user',
        frames: [18],
        targets: { bodyParts: ['arm.L', 'arm.R'] },
        withUserOverrides,
      });
    type Rows = { frames: { controls: { control: string; rotateDeg?: Record<string, number> }[] }[] };
    const shown = dataOf<Rows>(await read(true)).frames[0]?.controls ?? [];
    const keyed = dataOf<Rows>(await read(false)).frames[0]?.controls ?? [];
    // set exactly what differs
    const set = shown.flatMap((row) => {
      const base = keyed.find((other) => other.control === row.control);
      const changed = Object.fromEntries(
        Object.entries(row.rotateDeg ?? {}).filter(([axis, value]) => value !== base?.rotateDeg?.[axis]),
      );
      return Object.keys(changed).length === 0 ? [] : [{ control: row.control, rotateDeg: changed }];
    });
    expect(set).toHaveLength(2);
    const result = await call(runtime, 'pose_set', { clip: 'user', frame: 18, set, syncRotation: false });
    expect(dataOf(result)).toMatchObject({ keyed: 2, synced: 0 });
    const userClip = clipNamed('user');
    expect(keysOf(fx.app, userClip, forearm, 'rz')).toEqual([[18, expect.closeTo(35 * DEG, 6)]]);
    expect(keysOf(fx.app, userClip, upperArm, 'rx')).toEqual([[18, expect.closeTo(-12 * DEG, 6)]]);
    expect(keysOf(fx.app, userClip, forearm, 'rx')).toEqual([]);
    expect(fx.app.session.getState().overrides).toBe(overrides);
    void READY;
  });
});
