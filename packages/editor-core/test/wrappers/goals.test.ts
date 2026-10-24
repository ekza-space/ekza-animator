// The goal wrappers on a headless Polybot (STUDIO-TOUCH-SPEC §10.1, §6.4, §20.3 item 7; T5a): Reach is one undo step,
// keyed at the playhead with auto key (the touch shell's Rec) and unkeyed edits without it, and its preview solve
// equals what it keys; Place Goal switches an FK limb to IK only over the time band; Look At aims the head (shared
// with the neck) at a point. Agents, Rig & Skin and missing targets are refused in plain words.
import type { Vec3 } from '@ekza-studio/anim-core';
import type { ChannelId, ClipRecord, ControlId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { ANIMATE_ONLY_REASON } from '../../src';
import { keyedChannels } from '../../src/operators/builtin/agentPoseChecks';
import { AGENT_REFUSAL, solveReach } from '../../src/operators/builtin/uiWrappers';
import type { EditorApp } from '../../src/types';
import { boneNode } from '../../src/workflows/goalTargets';
import { controlOf, docJson, expectOneStep, type Polybot, polybot, refusal, runOk, select } from './support';

const AGENT = { source: 'api', actor: { kind: 'agent', id: 'agt_T5aWrapperTest', name: 'T5a' }, access: 'edit' };

/** World position (character space) of a node in the keyed pose of the clip at `frame`. */
function nodeAt(app: EditorApp, clip: ClipRecord, node: number, frame: number): Vec3 {
  const runtime = app.characters.get(clip.character);
  if (runtime === undefined) throw new Error('no runtime');
  const pose = runtime.program.allocPose();
  runtime.program.evaluate(keyedChannels(runtime, clip, frame), pose);
  return [0, 1, 2].map((i) => pose.boneWorld[node * 16 + 12 + i] as number) as unknown as Vec3;
}

function footGoal(p: Polybot, side: 'L' | 'R', offset: Vec3): Vec3 {
  const clip = p.app.store.get('clips', p.clip) as ClipRecord;
  const limb = p.app.characters.get(p.character)?.program.limbs.find((l) => l.id === `leg.${side}`);
  if (limb === undefined) throw new Error('no leg');
  const at = nodeAt(p.app, clip, limb.nodes.end, 10);
  return [at[0] + offset[0], at[1] + offset[1], at[2] + offset[2]];
}

/** Keyed values at a frame per channel of a control (base layer of the clip). */
function keyedAt(app: EditorApp, clip: string, control: ControlId, frame: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const curve of app.store.query.curvesOfControl(clip as never, control)) {
    const key = app.store.query.keysOfCurve(curve.id).find((k) => Math.abs(k.t - frame) < 1e-9);
    if (key !== undefined) out[curve.channel] = key.v;
  }
  return out;
}

describe('pose.reach', () => {
  it('keys the solved leg at the playhead (auto key on): one step, exact undo, preview = keys', async () => {
    const p = await polybot();
    const { app } = p;
    const ik = controlOf(app, p.character, 'ik.leg.L');
    select(app, [ik]);
    const position = footGoal(p, 'L', [0.02, 0.06, 0.04]);
    const clip = app.store.get('clips', p.clip) as ClipRecord;
    const preview = solveReach(app, clip, 'leg.L', 10, { position });
    expect(preview.reached).toBe(true);
    app.prefs.setState({ autoKey: true });
    const { value } = await expectOneStep(app, 'pose.reach', { position }, 'Reach (L Leg)');
    expect(value).toMatchObject({ proposed: 0, reached: true });
    expect((value as { keyed: number }).keyed).toBeGreaterThan(0);
    const keyed = keyedAt(app, p.clip, ik, 10);
    for (const [channel, v] of Object.entries(preview.values.get(ik) ?? {})) {
      expect([channel, keyed[channel]]).toEqual([channel, expect.closeTo(v as number, 9)]);
    }
    expect(app.evaluation.clipFrame(p.character)).toBe(10);
  });

  it('leaves unkeyed edits without auto key: the document is unchanged, one undo removes them', async () => {
    const p = await polybot();
    const { app } = p;
    const ik = controlOf(app, p.character, 'ik.leg.L');
    select(app, [ik]);
    const before = docJson(app);
    const steps = app.history.entries().undo.length;
    const value = await runOk(app, 'pose.reach', { position: footGoal(p, 'L', [0, 0.08, 0]) });
    expect(value).toMatchObject({ keyed: 0, reached: true });
    expect((value as { proposed: number }).proposed).toBeGreaterThan(0);
    expect(docJson(app)).toEqual(before);
    expect(app.session.getState().overrides.get(ik)).toBeDefined();
    expect(app.history.entries().undo.length).toBe(steps + 1);
    expect(app.history.peekUndo()?.label).toBe('Reach (L Leg)');
    await runOk(app, 'edit.undo');
    expect(app.session.getState().overrides.get(ik)).toBeUndefined();
  });

  it('refuses an FK arm outside a time band, agents, Rig & Skin and a missing selection', async () => {
    const p = await polybot();
    const { app } = p;
    const position: Vec3 = [0.3, 1.2, 0.1];
    expect(await refusal(app, 'pose.reach', { position })).toBe('Select a hand or a foot first');
    select(app, [controlOf(app, p.character, 'fk.hand.L')]);
    expect(await refusal(app, 'pose.reach', { position, key: true })).toBe(
      'The L Arm is FK here: switch it to IK first, or pick a time range around the frame',
    );
    expect(await refusal(app, 'pose.reach', { position })).toBe('The L Arm is FK here: switch it to IK first');
    expect(await refusal(app, 'pose.reach', { position: [0, 1] })).toBe('position must be [x, y, z]');
    expect(await refusal(app, 'pose.reach', { position, limb: 'tail' })).toBe(
      'limb is one of leg.L, leg.R, arm.L, arm.R',
    );
    expect(await refusal(app, 'pose.reach', { position, key: true }, AGENT)).toBe(AGENT_REFUSAL);
    app.session.setState({ workspace: 'rig' });
    expect(await refusal(app, 'pose.reach', { position, key: true })).toBe(ANIMATE_ONLY_REASON);
  });
});

describe('pose.placeGoal', () => {
  it('places an IK foot goal, keyed at the frame (one step)', async () => {
    const p = await polybot();
    const position = footGoal(p, 'R', [0, 0.05, 0.05]);
    const { value } = await expectOneStep(p.app, 'pose.placeGoal', { position, limb: 'leg.R' }, 'Place Goal (R Leg)');
    expect(value).toMatchObject({ reached: true });
    expect(Object.keys(keyedAt(p.app, p.clip, controlOf(p.app, p.character, 'ik.leg.R'), 10)).length).toBeGreaterThan(
      0,
    );
  });

  it('switches an FK arm to IK over the time band only', async () => {
    const p = await polybot();
    const { app } = p;
    select(app, [controlOf(app, p.character, 'fk.hand.L')]);
    app.session.setState({ time: { ...app.session.getState().time, band: { start: 5, end: 15 } } });
    const clip = app.store.get('clips', p.clip) as ClipRecord;
    const limb = app.characters.get(p.character)?.program.limbs.find((l) => l.id === 'arm.L');
    const at = nodeAt(app, clip, limb?.nodes.end ?? -1, 10);
    await expectOneStep(app, 'pose.placeGoal', { position: [at[0], at[1] + 0.05, at[2] + 0.05] }, 'Place Goal (L Arm)');
    const ikFk = keyedAt(app, p.clip, controlOf(app, p.character, 'ik.arm.L'), 5)['@ikFk' as ChannelId];
    expect(ikFk).toBe(1);
  });
});

describe('pose.lookAt', () => {
  it('aims the head (with the neck) at a point in front of it (one step)', async () => {
    const p = await polybot();
    const { app } = p;
    const clip = app.store.get('clips', p.clip) as ClipRecord;
    const runtime = app.characters.get(p.character);
    if (runtime === undefined) throw new Error('no runtime');
    const head = nodeAt(app, clip, boneNode(runtime, 'head'), 10);
    const target: Vec3 = [head[0] + 0.5, head[1] + 0.2, head[2] + 1];
    expect(await refusal(app, 'pose.lookAt', { target: head })).toBe('The point is where the head is');
    expect(await refusal(app, 'pose.lookAt', { target, bone: 'tailTip' })).toBe('The character has no tailTip');
    expect(await refusal(app, 'pose.lookAt', { target, weight: 2 })).toBe('weight must lie in 0…1');
    const { value } = await expectOneStep(app, 'pose.lookAt', { target }, 'Look At');
    expect((value as { keyed: number }).keyed).toBeGreaterThan(0);
    expect(Object.keys(keyedAt(app, p.clip, controlOf(app, p.character, 'fk.head'), 10)).length).toBeGreaterThan(0);
    expect(Object.keys(keyedAt(app, p.clip, controlOf(app, p.character, 'fk.neck'), 10)).length).toBeGreaterThan(0);
  });
});
