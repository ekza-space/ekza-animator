// ops.* (WP-7b): pose operators on the real rig (MVP-SPEC §4.11.19, §4.11.20): Plant Feet on Polybot (US-25), mirror
// scope and Polybot's unpaired toes, and pose copy/paste across humanoid characters (by template key).
import { mat4Decompose, quatAngle } from '@ekza-studio/anim-core';
import type { CharacterId, ControlId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { describe, expect, it } from 'vitest';
import { BLOCKED, importFixture, realApp, runOk, SIBLINGS_READY, setSceneFrame } from './ops.support';

function controlOf(app: EditorApp, character: CharacterId, key: string): ControlId {
  const rig = app.store.query.rigOfCharacter(character);
  const control = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
  if (control === undefined) throw new Error(`no control ${key}`);
  return control.id;
}

function select(app: EditorApp, ids: readonly ControlId[]): void {
  app.session.setState({ selection: { ...app.session.getState().selection, controls: ids } });
}

describe.skipIf(!SIBLINGS_READY)(`pose operators on the fixtures ${BLOCKED}`, { timeout: 60_000 }, () => {
  it('plants Polybot’s feet back on their pins after lowering the hips (US-25)', async () => {
    const { app } = realApp();
    // FK legs (an M1 rig): lowering the hips sinks the feet. IK legs hold them already (A2: ops.ik.test.ts).
    app.prefs.setState({ autoRigIk: { legs: false, arms: false } });
    const bot = await importFixture(app, 'polybot.vrm');
    await runOk(app, 'pose.pinFeet');
    const pins = app.session.getState().feetPins?.pins ?? [];
    expect(pins.map((p) => p.side)).toEqual(['L', 'R']);
    setSceneFrame(app, 10);
    await runOk(app, 'channel.setValues', {
      edits: [{ control: controlOf(app, bot.character, 'cog'), channel: 'ty', value: -0.05 }],
      key: 'force',
    });
    await runOk(app, 'pose.plantFeet');
    expect(app.history.peekUndo()?.label).toBe('Plant Feet');
    const humanoid = bot.runtime.skeleton.humanoid ?? {};
    const pose = bot.runtime.program.allocPose();
    const clip = app.session.getState().activeClip[bot.character];
    app.evaluation.evaluateAt(bot.character, clip as never, 10, pose, { withOverrides: false });
    for (const pin of pins) {
      const node = humanoid[pin.side === 'L' ? 'leftFoot' : 'rightFoot'] as number;
      const now = mat4Decompose(pose.boneWorld.slice(node * 16, node * 16 + 16));
      const target = mat4Decompose(pin.footWorld.slice());
      now.t.forEach((v, i) => expect(Math.abs(v - (target.t[i] as number))).toBeLessThan(1e-4));
      expect(quatAngle(now.q, target.q)).toBeLessThan(1e-4);
    }
    // The leg channels had no keys, so (auto key off) the solve wrote static values: one undo step removes them.
    await runOk(app, 'edit.undo');
    app.evaluation.evaluateAt(bot.character, clip as never, 10, pose, { withOverrides: false });
    const left = humanoid.leftFoot as number;
    const sunk = mat4Decompose(pose.boneWorld.slice(left * 16, left * 16 + 16));
    const pinned = mat4Decompose((pins[0]?.footWorld ?? new Float64Array(16)).slice());
    expect(Math.abs(sunk.t[1] - pinned.t[1])).toBeGreaterThan(0.04);
  });

  it('flips the whole pose; Polybot’s right toes have no counterpart and stay unchanged', async () => {
    const { app, services } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const toes = controlOf(app, bot.character, 'fk.toes.R');
    const upperL = controlOf(app, bot.character, 'fk.upperArm.L');
    const upperR = controlOf(app, bot.character, 'fk.upperArm.R');
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: toes, channel: 'rx', value: 0.3 },
        { control: upperL, channel: 'rz', value: 0.5 },
        { control: upperL, channel: 'ry', value: 0.2 },
      ],
    });
    await runOk(app, 'pose.mirror', { mode: 'flip' });
    expect(app.evaluation.channelValues(toes).rx).toBeCloseTo(0.3, 12);
    expect(app.evaluation.channelValues(upperR).rz).toBeCloseTo(-0.5, 9);
    expect(app.evaluation.channelValues(upperR).ry).toBeCloseTo(-0.2, 9);
    expect(app.evaluation.channelValues(upperL).rz).toBeCloseTo(0, 9);
    expect(services.toasts.some((t) => t.text.includes('no mirror counterpart'))).toBe(true);
    // Selected left arm: the scope expands to the right arm only.
    select(app, [upperL]);
    await runOk(app, 'pose.mirror', { mode: 'flip' });
    expect(app.evaluation.channelValues(upperL).rz).toBeCloseTo(0.5, 9);
    expect(app.evaluation.channelValues(toes).rx).toBeCloseTo(0.3, 12);
  });

  it('pastes a pose copied on Polybot onto Seed-san by template key', async () => {
    const { app } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    const seed = await importFixture(app, 'seed-san.vrm');
    await runOk(app, 'select.controls', { ids: [controlOf(app, bot.character, 'fk.lowerArm.L')], mode: 'replace' });
    await runOk(app, 'channel.setValues', {
      edits: [{ control: controlOf(app, bot.character, 'fk.lowerArm.L'), channel: 'rz', value: 0.7 }],
    });
    await runOk(app, 'pose.copy');
    await runOk(app, 'select.controls', { ids: [controlOf(app, seed.character, 'fk.head')], mode: 'replace' });
    expect(app.session.getState().activeCharacter).toBe(seed.character);
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [] } });
    await runOk(app, 'pose.paste');
    expect(app.evaluation.channelValues(controlOf(app, seed.character, 'fk.lowerArm.L')).rz).toBeCloseTo(0.7, 9);
  });
});
