import {
  type AnimCurve,
  eulerToQuat,
  type KeyData,
  mat4Decompose,
  quatAngle,
  quatFromAxisAngle,
  type ReadonlyQuat,
} from '@ekza-studio/anim-core';
import type { ClipRecord, ControlId } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES } from '@ekza-studio/rig';
import { describe, expect, it } from 'vitest';
import { createFakeEditorApp, naiveCurveEngine } from '../../src/testing';
import { naiveSceneToClipFrame, naiveWrapClipFrame } from '../../src/testing/naive';
import { DEG, humanoidSkeleton, restPose, WAVE, waveDoc } from './fixtures';

const clipFrameAt = (scene: { num: number; den: number }, clip: ClipRecord, sceneFrame: number): number =>
  naiveWrapClipFrame(clip, naiveSceneToClipFrame(scene, clip, sceneFrame));

function waveApp() {
  return createFakeEditorApp({ snapshot: waveDoc(), skeleton: humanoidSkeleton() });
}

function setFrame(app: ReturnType<typeof waveApp>, sceneFrame: number): void {
  app.session.setState({ time: { ...app.session.getState().time, sceneFrame } });
}

const boneIndex = (name: string): number => humanoidSkeleton().nodes.findIndex((node) => node.name === name);

describe('naive FK evaluation (test kit)', () => {
  it('reproduces rest-pose.json at default channels', () => {
    const app = waveApp();
    const runtime = app.characters.get(WAVE.character);
    expect(runtime).toBeDefined();
    if (runtime === undefined) return;
    expect(runtime.program.warnings).toEqual([]);
    const pose = runtime.program.allocPose();
    runtime.program.evaluate(runtime.program.allocChannels(), pose);
    for (const bone of restPose().bones) {
      bone.world.forEach((value, i) => expect(pose.boneWorld[bone.node * 16 + i]).toBeCloseTo(value, 12));
    }
    // Raw bone locals at rest are the file's rest locals; normalized rotations are identity.
    humanoidSkeleton().nodes.forEach((node) => {
      node.restLocal.t.forEach((v, i) => expect(pose.boneLocal[node.index * 10 + i]).toBeCloseTo(v, 12));
      const q = Array.from(
        pose.boneLocal.subarray(node.index * 10 + 3, node.index * 10 + 7),
      ) as unknown as ReadonlyQuat;
      expect(quatAngle(q, node.restLocal.q)).toBeLessThan(1e-9);
    });
    for (let h = 0; h < HUMAN_BONE_NAMES.length; h++) {
      const n = Array.from(pose.humanLocal.subarray(h * 4, h * 4 + 4)) as unknown as ReadonlyQuat;
      expect(quatAngle(n, [0, 0, 0, 1])).toBeLessThan(1e-12);
    }
    expect(Array.from(pose.hipsPosition)).toEqual([0, 0.95, 0]);
  });

  it('evaluates the wave clip: fk.lowerArm.L rz is 30° / −30° / 30° at frames 0 / 15 / 30', () => {
    const app = waveApp();
    const rz = (frame: number): number => {
      setFrame(app, frame);
      return app.evaluation.channelValues(WAVE.lowerArmL).rz / DEG;
    };
    expect(rz(0)).toBeCloseTo(30, 12);
    expect(rz(15)).toBeCloseTo(-30, 12);
    expect(rz(30)).toBeCloseTo(30, 12);
    // Auto tangents are flat at the extremes, so the curve passes zero halfway between the keys.
    expect(rz(7.5)).toBeCloseTo(0, 12);
    expect(rz(22.5)).toBeCloseTo(0, 12);
    expect(Math.abs(rz(3))).toBeLessThan(30);
    expect(app.evaluation.channelValues(WAVE.upperArmL)).toEqual({
      tx: 0,
      ty: 0,
      tz: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 1,
      sy: 1,
      sz: 1,
    });
  });

  it('poses the arm: the elbow rotates the hand about +Z, the normalized lower-arm rotation is Rz(30°)', () => {
    const app = waveApp();
    expect(app.evaluation.tick()).toBe(true);
    expect(app.evaluation.tick()).toBe(false);
    const runtime = app.characters.get(WAVE.character);
    if (runtime === undefined) throw new Error('no runtime');
    const pose = runtime.pose;
    const hand = boneIndex('leftHand');
    const elbow = boneIndex('leftLowerArm');
    // Rest: hand 0.24 m along +X from the elbow; at 30° about +Z it swings up.
    const elbowT = mat4Decompose(pose.boneWorld.subarray(elbow * 16, elbow * 16 + 16)).t;
    const handT = mat4Decompose(pose.boneWorld.subarray(hand * 16, hand * 16 + 16)).t;
    expect(handT[0] - elbowT[0]).toBeCloseTo(0.24 * Math.cos(30 * DEG), 12);
    expect(handT[1] - elbowT[1]).toBeCloseTo(0.24 * Math.sin(30 * DEG), 12);
    expect(handT[2] - elbowT[2]).toBeCloseTo(0, 12);
    const lowerArm = HUMAN_BONE_NAMES.indexOf('leftLowerArm');
    const n = Array.from(pose.humanLocal.subarray(lowerArm * 4, lowerArm * 4 + 4)) as unknown as ReadonlyQuat;
    expect(quatAngle(n, quatFromAxisAngle([0, 0, 1], 30 * DEG))).toBeLessThan(1e-9);
    const upperArm = HUMAN_BONE_NAMES.indexOf('leftUpperArm');
    const nUpper = Array.from(pose.humanLocal.subarray(upperArm * 4, upperArm * 4 + 4)) as unknown as ReadonlyQuat;
    expect(quatAngle(nUpper, [0, 0, 0, 1])).toBeLessThan(1e-12);

    // Moving the scene frame invalidates the pose; the next tick evaluates frame 15 (−30°).
    setFrame(app, 15);
    expect(app.evaluation.tick()).toBe(true);
    const handAt15 = mat4Decompose(pose.boneWorld.subarray(hand * 16, hand * 16 + 16)).t;
    expect(handAt15[1] - elbowT[1]).toBeCloseTo(-0.24 * Math.sin(30 * DEG), 12);
  });

  it('composes cog and hips: moving cog carries the whole body, fk.hips translateRotate binding follows', () => {
    const app = waveApp();
    const runtime = app.characters.get(WAVE.character);
    if (runtime === undefined) throw new Error('no runtime');
    const ch = runtime.program.allocChannels();
    const cog = runtime.program.controlIndex.get(WAVE.cog) as number;
    ch.values[cog * 9 + 0] = 0.5; // tx
    ch.values[cog * 9 + 4] = 90 * DEG; // ry
    const pose = runtime.program.allocPose();
    runtime.program.evaluate(ch, pose);
    const hips = boneIndex('hips');
    const hipsXf = mat4Decompose(pose.boneWorld.subarray(hips * 16, hips * 16 + 16));
    expect(hipsXf.t[0]).toBeCloseTo(0.5, 12);
    expect(hipsXf.t[1]).toBeCloseTo(0.95, 12);
    expect(quatAngle(hipsXf.q, eulerToQuat([0, 90 * DEG, 0], 'zxy'))).toBeLessThan(1e-9);
    // The left hand (rest +X) now sits on −Z relative to the hips after a +90° yaw.
    const handXf = mat4Decompose(pose.boneWorld.subarray(boneIndex('leftHand') * 16, boneIndex('leftHand') * 16 + 16));
    expect(handXf.t[2]).toBeCloseTo(-0.64, 9);
    expect(Array.from(pose.hipsPosition)[0]).toBeCloseTo(0.5, 12);
  });

  it('applies session overrides on top of curves and reports channel states', () => {
    const app = waveApp();
    const state = (channel: 'rz' | 'rx' | 'tx', control: ControlId = WAVE.lowerArmL) =>
      app.evaluation.channelState(control, channel);
    expect(state('rz')).toBe('keyed-on-frame');
    expect(state('rx')).toBe('static');
    expect(state('tx')).toBe('non-keyable');
    expect(state('tx', WAVE.cog)).toBe('static');
    setFrame(app, 5);
    expect(state('rz')).toBe('keyed');
    app.session.setState({ overrides: new Map([[WAVE.lowerArmL, { rz: 0.5 }]]) });
    expect(state('rz')).toBe('changed');
    expect(app.evaluation.channelValues(WAVE.lowerArmL).rz).toBe(0.5);
    app.store.transact({ label: 'Lock' }, (tx) =>
      tx.patch('controls', WAVE.lowerArmL, {
        locked: { t: [false, false, false], r: [false, false, true], s: [false, false, false] },
      }),
    );
    expect(state('rz')).toBe('locked');
  });

  it('maps scene frames to clip frames per clip fps and scene start (§4.11.8)', () => {
    const clip = waveDoc().tables.clips[WAVE.clip] as ClipRecord;
    const scene = { num: 30, den: 1 };
    const at24 = { ...clip, fps: { num: 24, den: 1 }, range: { start: 0, end: 48 } };
    const late30 = { ...clip, sceneStart: 6, range: { start: 0, end: 48 } };
    expect(clipFrameAt(scene, at24, 30)).toBe(24);
    expect(clipFrameAt(scene, late30, 30)).toBe(24);
    expect(clipFrameAt(scene, clip, 45)).toBe(15); // loop wraps into [0, 30)
    expect(clipFrameAt(scene, { ...clip, loop: false }, 45)).toBe(30); // once holds the end pose
    expect(clipFrameAt(scene, { ...clip, loop: false }, -5)).toBe(0);
  });
});

describe('naive curve engine (test kit)', () => {
  const key = (t: number, v: number, type: KeyData['inType'] = 'auto'): KeyData => ({
    t,
    v,
    inType: type,
    outType: type,
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
  });
  const curve = (
    keys: KeyData[],
    pre: AnimCurve['pre'] = 'constant',
    post: AnimCurve['post'] = 'constant',
  ): AnimCurve => ({
    keys,
    weighted: false,
    pre,
    post,
  });
  const value = (c: AnimCurve, frame: number): number => naiveCurveEngine.evaluate(naiveCurveEngine.compile(c), frame);

  it('interpolates linear and stepped segments', () => {
    const linear = curve([key(0, 0, 'linear'), key(10, 10, 'linear')]);
    expect(value(linear, 2.5)).toBeCloseTo(2.5, 12);
    const stepped = curve([key(0, 1, 'step'), key(10, 5, 'step')]);
    expect(value(stepped, 9.99)).toBe(1);
    expect(value(stepped, 10)).toBe(5);
  });

  it('never overshoots with auto tangents on monotonic data', () => {
    const c = curve([key(0, 0), key(1, 10), key(10, 11)]);
    for (let f = 0; f <= 10; f += 0.25) {
      const v = value(c, f);
      expect(v).toBeGreaterThanOrEqual(-1e-12);
      expect(v).toBeLessThanOrEqual(11 + 1e-12);
    }
  });

  it('implements the infinity modes', () => {
    const keys = [key(0, 0, 'linear'), key(10, 10, 'linear')];
    expect(value(curve(keys), -5)).toBe(0);
    expect(value(curve(keys, 'linear', 'linear'), 15)).toBeCloseTo(15, 12);
    expect(value(curve(keys, 'cycle', 'cycle'), 13)).toBeCloseTo(3, 12);
    expect(value(curve(keys, 'cycleOffset', 'cycleOffset'), 13)).toBeCloseTo(13, 12);
    expect(value(curve(keys, 'oscillate', 'oscillate'), 13)).toBeCloseTo(7, 12);
    expect(value(curve(keys, 'oscillate', 'oscillate'), -3)).toBeCloseTo(3, 12);
  });
});
