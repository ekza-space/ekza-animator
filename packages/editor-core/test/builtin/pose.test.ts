// Pose operators (MVP-SPEC §4.9 `pose.*`, §4.11.19, §4.11.20) on the synthetic humanoid: reset, copy/paste (session
// and system clipboard, mirrored), mirror flip and one-sided modes with scope expansion, pin/plant feet; every pose
// change goes through the §4.11.2 rules (static values here, the controls have no keys).
import { mat4Decompose, quatAngle } from '@ekza-studio/anim-core';
import type { ChannelValues, ControlId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import type { FakeEditorApp } from '../../src/testing';
import { expectUndoRedoExact, opsApp, opsAppWith, READY, runOk, runResult, setSceneFrame, WAVE } from './support';

const R = (key: string) => `${WAVE.rig}:${key}` as ControlId;

function select(app: FakeEditorApp, ids: readonly ControlId[]): void {
  app.session.setState({ selection: { ...app.session.getState().selection, controls: ids } });
}

/** Sets static channel values (test setup). */
async function pose(app: FakeEditorApp, values: Readonly<Record<string, ChannelValues>>): Promise<void> {
  const edits = Object.entries(values).flatMap(([control, channels]) =>
    Object.entries(channels).map(([channel, value]) => ({ control: control as ControlId, channel, value })),
  );
  await runOk(app, 'channel.setValues', { edits, key: 'auto' });
}

function rot(app: FakeEditorApp, control: ControlId): [number, number, number] {
  const v = app.evaluation.channelValues(control);
  return [v.rx, v.ry, v.rz];
}

describe('pose.resetToRest', () => {
  it("resets the selected (or given) controls' keyable channels", async () => {
    const app = opsApp();
    await pose(app, { [WAVE.cog]: { tx: 0.2, ry: 0.3 }, [WAVE.hips]: { rx: 0.1 } });
    select(app, [WAVE.cog]);
    await expectUndoRedoExact(app, 'pose.resetToRest');
    expect(app.evaluation.channelValues(WAVE.cog)).toMatchObject({ tx: 0, ry: 0 });
    expect(app.evaluation.channelValues(WAVE.hips).rx).toBeCloseTo(0.1, 12);
    await runOk(app, 'pose.resetToRest', { controls: [WAVE.hips] });
    expect(app.evaluation.channelValues(WAVE.hips).rx).toBe(0);
    expect(app.history.peekUndo()?.label).toBe('Reset Pose');
  });

  it('needs a selection or controls', async () => {
    const app = opsApp();
    expect(await runResult(app, 'pose.resetToRest')).toEqual({ status: 'cancelled', reason: 'nothing selected' });
    expect((await runResult(app, 'pose.resetToRest', { controls: [R('nope')] })).status).toBe('cancelled');
  });
});

describe.skipIf(!READY.wp3)('pose.copy / pose.paste [needs WP-3 pose clipboard]', () => {
  it('copies the selection at the current frame and pastes it elsewhere', async () => {
    const { app, services } = opsAppWith();
    select(app, [R('fk.upperArm.L'), WAVE.lowerArmL]);
    await pose(app, { [R('fk.upperArm.L')]: { rx: 0.2, rz: 0.5 } });
    setSceneFrame(app, 15);
    const at15 = [rot(app, R('fk.upperArm.L')), rot(app, WAVE.lowerArmL)];
    await runOk(app, 'pose.copy');
    const clipboard = app.session.getState().clipboard.pose;
    expect(Object.keys(clipboard?.controls ?? {})).toEqual(['fk.upperArm.L', 'fk.lowerArm.L']);
    expect(JSON.parse((await services.clipboard.readText()) ?? 'null')).toEqual(clipboard);
    await runOk(app, 'pose.resetToRest');
    setSceneFrame(app, 25);
    await runOk(app, 'pose.paste');
    expect(app.history.peekUndo()?.label).toBe('Paste Pose');
    const after = [rot(app, R('fk.upperArm.L')), rot(app, WAVE.lowerArmL)];
    after.flat().forEach((v, i) => expect(v).toBeCloseTo(at15.flat()[i] as number, 12));
  });

  it('pastes mirrored onto the counterparts', async () => {
    const app = opsApp();
    select(app, [R('fk.upperArm.L')]);
    await pose(app, { [R('fk.upperArm.L')]: { rx: 0.2, ry: 0.3, rz: 0.5 } });
    await runOk(app, 'pose.copy');
    select(app, []);
    await runOk(app, 'pose.paste', { mirrored: true });
    const r = rot(app, R('fk.upperArm.R'));
    expect(r[0]).toBeCloseTo(0.2, 12);
    expect(r[1]).toBeCloseTo(-0.3, 12);
    expect(r[2]).toBeCloseTo(-0.5, 12);
  });

  it('reads the system clipboard when the session has no pose', async () => {
    const source = opsApp();
    select(source, [WAVE.cog]);
    await pose(source, { [WAVE.cog]: { ty: -0.05 } });
    await runOk(source, 'pose.copy');
    const text = JSON.stringify(source.session.getState().clipboard.pose);
    const { app, services } = opsAppWith();
    await services.clipboard.writeText(text);
    await runOk(app, 'pose.paste');
    expect(app.evaluation.channelValues(WAVE.cog).ty).toBeCloseTo(-0.05, 12);
    await services.clipboard.writeText('not a pose');
    const fresh = opsAppWith({ services });
    expect((await runResult(fresh.app, 'pose.paste')).status).toBe('failed');
  });

  it('pastes onto the selected controls only when the selection overlaps the pose', async () => {
    const app = opsApp();
    select(app, [R('fk.upperArm.L'), WAVE.lowerArmL]);
    await pose(app, { [R('fk.upperArm.L')]: { rx: 0.4 }, [WAVE.lowerArmL]: { rx: 0.4 } });
    await runOk(app, 'pose.copy');
    await runOk(app, 'pose.resetToRest');
    select(app, [WAVE.lowerArmL]);
    await runOk(app, 'pose.paste');
    expect(rot(app, WAVE.lowerArmL)[0]).toBeCloseTo(0.4, 12);
    expect(rot(app, R('fk.upperArm.L'))[0]).toBe(0);
  });
});

describe.skipIf(!READY.wp3)('pose.mirror [needs WP-3 mirrorPose]', () => {
  it('flips the selection expanded to mirror pairs (R = mirror(L before), L = mirror(R before))', async () => {
    const app = opsApp();
    await pose(app, {
      [R('fk.upperArm.L')]: { rx: 0.1, ry: 0.2, rz: 0.3 },
      [R('fk.upperArm.R')]: { rx: -0.4, ry: 0.5, rz: 0.6 },
      [R('fk.hand.L')]: { rz: 0.7 },
    });
    select(app, [R('fk.upperArm.L')]);
    await expectUndoRedoExact(app, 'pose.mirror', { mode: 'flip' });
    const l = rot(app, R('fk.upperArm.L'));
    const r = rot(app, R('fk.upperArm.R'));
    [-0.4, -0.5, -0.6].forEach((v, i) => expect(l[i]).toBeCloseTo(v, 12));
    [0.1, -0.2, -0.3].forEach((v, i) => expect(r[i]).toBeCloseTo(v, 12));
    // Outside the scope: unchanged.
    expect(rot(app, R('fk.hand.L'))[2]).toBeCloseTo(0.7, 12);
    expect(rot(app, R('fk.hand.R'))[2]).toBe(0);
    expect(app.history.peekUndo()?.label).toBe('Flip Pose');
  });

  it('is an involution on the whole character', async () => {
    const app = opsApp();
    await pose(app, {
      [R('fk.upperArm.L')]: { rx: 0.1, ry: 0.2, rz: 0.3 },
      [R('fk.lowerLeg.R')]: { rx: 0.25 },
      [WAVE.cog]: { tx: 0.1, ry: 0.4 },
      [R('fk.head')]: { ry: 0.3, rz: -0.2 },
    });
    const controls = app.store.query.controlsOfRig(WAVE.rig).map((c) => c.id);
    const before = controls.map((id) => app.evaluation.channelValues(id));
    await runOk(app, 'pose.mirror', { mode: 'flip' });
    expect(app.evaluation.channelValues(WAVE.cog).tx).toBeCloseTo(-0.1, 12);
    await runOk(app, 'pose.mirror', { mode: 'flip' });
    controls.forEach((id, i) => {
      const now = app.evaluation.channelValues(id);
      for (const [channel, value] of Object.entries(before[i] ?? {})) {
        expect(now[channel as 'tx'], `${id}.${channel}`).toBeCloseTo(value, 12);
      }
    });
  });

  it('copies one side onto the other', async () => {
    const app = opsApp();
    await pose(app, { [R('fk.upperArm.L')]: { ry: 0.2 }, [R('fk.upperArm.R')]: { ry: 0.9 } });
    await runOk(app, 'pose.mirror', { mode: 'leftToRight' });
    expect(rot(app, R('fk.upperArm.R'))[1]).toBeCloseTo(-0.2, 12);
    expect(rot(app, R('fk.upperArm.L'))[1]).toBeCloseTo(0.2, 12);
    expect(app.history.peekUndo()?.label).toBe('Mirror Pose L→R');
    // The sides already mirror each other: copying back changes nothing and adds no undo step.
    const step = app.history.peekUndo()?.id;
    await runOk(app, 'pose.mirror', { mode: 'rightToLeft' });
    expect(rot(app, R('fk.upperArm.L'))[1]).toBeCloseTo(0.2, 12);
    expect(app.history.peekUndo()?.id).toBe(step);
    await pose(app, { [R('fk.upperArm.R')]: { ry: -0.7 } });
    await runOk(app, 'pose.mirror', { mode: 'rightToLeft' });
    expect(rot(app, R('fk.upperArm.L'))[1]).toBeCloseTo(0.7, 12);
    expect(app.history.peekUndo()?.label).toBe('Mirror Pose R→L');
    expect((await runResult(app, 'pose.mirror', { mode: 'diagonal' })).status).toBe('cancelled');
  });
});

describe.skipIf(!READY.wp3)('pose.pinFeet / pose.plantFeet / pose.unpinFeet [needs WP-3 plantFeetChannels]', () => {
  it('pins the feet and plants them back after the hips moved (US-25 on the synthetic humanoid)', async () => {
    const app = opsApp();
    const foot = app.characters.get(WAVE.character)?.skeleton.humanoid?.leftFoot as number;
    expect((await runResult(app, 'pose.plantFeet')).status).toBe('cancelled');
    await runOk(app, 'pose.pinFeet');
    const pins = app.session.getState().feetPins;
    expect(pins?.character).toBe(WAVE.character);
    expect(pins?.pins.map((p) => p.side)).toEqual(['L', 'R']);
    expect(app.history.canUndo()).toBe(false);

    setSceneFrame(app, 10);
    await pose(app, { [WAVE.cog]: { ty: -0.05 } });
    app.evaluation.tick();
    const runtime = app.characters.get(WAVE.character);
    const sunk = mat4Decompose(runtime?.pose.boneWorld.slice(foot * 16, foot * 16 + 16) as Float64Array).t;
    const pinned = mat4Decompose((pins?.pins[0]?.footWorld ?? new Float64Array(16)).slice()).t;
    expect(Math.abs(sunk[1] - pinned[1])).toBeGreaterThan(0.04);

    await expectUndoRedoExact(app, 'pose.plantFeet');
    expect(app.history.peekUndo()?.label).toBe('Plant Feet');
    app.evaluation.tick();
    const planted = mat4Decompose(runtime?.pose.boneWorld.slice(foot * 16, foot * 16 + 16) as Float64Array);
    const pin = mat4Decompose((pins?.pins[0]?.footWorld ?? new Float64Array(16)).slice());
    planted.t.forEach((v, i) => expect(Math.abs(v - (pin.t[i] as number))).toBeLessThan(1e-4));
    expect(quatAngle(planted.q, pin.q)).toBeLessThan(1e-4);

    await runOk(app, 'pose.unpinFeet');
    expect(app.session.getState().feetPins).toBeNull();
    expect((await runResult(app, 'pose.unpinFeet')).status).toBe('cancelled');
  });

  it('pins one side only', async () => {
    const app = opsApp();
    await runOk(app, 'pose.pinFeet', { sides: ['R'] });
    expect(app.session.getState().feetPins?.pins.map((p) => p.side)).toEqual(['R']);
    expect((await runResult(app, 'pose.plantFeet', { sides: ['L'] })).status).toBe('cancelled');
    expect((await runResult(app, 'pose.pinFeet', { sides: ['X'] })).status).toBe('cancelled');
  });
});
