// rig.setRotateOrder (M1-stretch, MVP-SPEC §4.11.5): the control's curves in every clip, its static values and its
// pose override are converted so the control's world rotation is unchanged; undoable as one step.
import { mat4Decompose, type Quat, quatAngle } from '@ekza-studio/anim-core';
import type { ControlId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { expectUndoRedoExact, opsApp, opsAppWith, READY, runOk, runResult, setSceneFrame, WAVE } from './support';

type App = ReturnType<typeof opsApp>;
const DEG = Math.PI / 180;

/** World rotation of a control at a clip frame of the wave clip (curves ⊕ overrides). */
function worldRotation(app: App, control: ControlId, frame: number): Quat {
  const runtime = app.characters.get(WAVE.character);
  if (runtime === undefined) throw new Error('no runtime');
  const pose = runtime.program.allocPose();
  app.evaluation.evaluateAt(WAVE.character, WAVE.clip, frame, pose, { withOverrides: true });
  const slot = runtime.program.controlIndex.get(control) as number;
  return mat4Decompose(pose.controlWorld.slice(slot * 16, slot * 16 + 16)).q;
}

describe.skipIf(!(READY.wp1 && READY.wp3))('rig.setRotateOrder [needs WP-1, WP-3 convertRotateOrderKeys]', () => {
  it('converts keyed rotations so the pose is unchanged at every key', async () => {
    const app = opsApp();
    const arm = WAVE.lowerArmL;
    for (const [frame, rx, ry] of [
      [0, 20, -35],
      [15, -50, 10],
      [30, 70, 40],
    ] as const) {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', {
        edits: [
          { control: arm, channel: 'rx', value: rx * DEG },
          { control: arm, channel: 'ry', value: ry * DEG },
        ],
        key: 'force',
      });
    }
    const before = [0, 15, 30].map((frame) => worldRotation(app, arm, frame));
    expect(app.store.get('controls', arm)?.rotateOrder).toBe('xzy');
    await expectUndoRedoExact(app, 'rig.setRotateOrder', { control: arm, order: 'zyx' });
    expect(app.store.get('controls', arm)?.rotateOrder).toBe('zyx');
    expect(app.history.peekUndo()?.label).toBe('Rotate Order');
    [0, 15, 30].forEach((frame, i) => {
      expect(quatAngle(worldRotation(app, arm, frame), before[i] as Quat)).toBeLessThan(1e-9);
    });
  });

  it('says the conversion is exact at keys only when the control moves between keys (acceptance round 2)', async () => {
    const { app, services } = opsAppWith();
    const head = `${WAVE.rig}:fk.head` as ControlId;
    await runOk(app, 'channel.setValues', { edits: [{ control: head, channel: 'rx', value: 0.4 }] });
    await runOk(app, 'rig.setRotateOrder', { control: head, order: 'yxz' }); // a static value: exact everywhere
    expect(services.toasts).toEqual([]);
    // The wave clip keys fk.lowerArm.L rz at 0/15/30.
    await runOk(app, 'rig.setRotateOrder', { control: WAVE.lowerArmL, order: 'zyx' });
    expect(services.toasts.map((toast) => [toast.kind, toast.text.slice(0, 48)])).toEqual([
      ['info', 'Rotate order zyx: the pose is kept at every key;'],
    ]);
  });

  it('converts static values and the pose override', async () => {
    const app = opsApp();
    const head = `${WAVE.rig}:fk.head` as ControlId;
    await runOk(app, 'channel.setValues', {
      edits: [
        { control: head, channel: 'rx', value: 0.4 },
        { control: head, channel: 'ry', value: -0.7 },
        { control: head, channel: 'rz', value: 0.2 },
      ],
    });
    setSceneFrame(app, 5);
    await runOk(app, 'channel.setValues', { edits: [{ control: WAVE.lowerArmL, channel: 'rz', value: 1.1 }] });
    const headBefore = worldRotation(app, head, 5);
    const armBefore = worldRotation(app, WAVE.lowerArmL, 5);
    await runOk(app, 'rig.setRotateOrder', { control: head, order: 'yxz' });
    await runOk(app, 'rig.setRotateOrder', { control: WAVE.lowerArmL, order: 'xyz' });
    expect(quatAngle(worldRotation(app, head, 5), headBefore)).toBeLessThan(1e-9);
    expect(quatAngle(worldRotation(app, WAVE.lowerArmL, 5), armBefore)).toBeLessThan(1e-9);
    const override = app.session.getState().overrides.get(WAVE.lowerArmL);
    expect([override?.rx, override?.ry, override?.rz].every((v) => typeof v === 'number')).toBe(true);
  });

  it('on a loop clip, converts cyclic curves keyed at different times with the editor engine (M2A-SPEC §5.23)', async () => {
    const app = opsApp();
    expect(app.store.get('clips', WAVE.clip)?.loop).toBe(true);
    const head = `${WAVE.rig}:fk.head` as ControlId;
    const key = async (frame: number, channel: 'rx' | 'rz', value: number) => {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', { edits: [{ control: head, channel, value }], key: 'force' });
    };
    // rx keyed every 6 frames (a wave), rz between them: the converter samples each curve between its keys.
    for (const [frame, value] of [
      [0, 0],
      [6, 0.6],
      [12, 0],
      [18, -0.6],
      [24, 0],
    ] as const) {
      await key(frame, 'rx', value);
    }
    await key(3, 'rz', 0.8);
    await key(21, 'rz', 0.8);
    const base = app.store.query.baseLayer(WAVE.clip)?.id;
    if (base === undefined) throw new Error('no base layer');
    const curveOf = (channel: 'rx' | 'ry' | 'rz') => app.store.query.curveFor(WAVE.clip, base, head, channel);
    expect([curveOf('rx')?.pre, curveOf('rx')?.post, curveOf('rz')?.pre, curveOf('rz')?.post]).toEqual([
      'cycle',
      'cycle',
      'cycle',
      'cycle',
    ]);
    const union = [0, 3, 6, 12, 18, 21, 24];
    const before = union.map((frame) => worldRotation(app, head, frame));
    await runOk(app, 'rig.setRotateOrder', { control: head, order: 'zyx' });
    union.forEach((frame, i) => {
      expect([frame, quatAngle(worldRotation(app, head, frame), before[i] as Quat) < 1e-9]).toEqual([frame, true]);
    });
    // The created ry curve extrapolates like its siblings.
    expect([curveOf('ry')?.pre, curveOf('ry')?.post]).toEqual(['cycle', 'cycle']);
  });

  it('a curve the conversion creates takes its siblings’ infinities, not the loop rule (M2A-A0-11)', async () => {
    const app = opsApp();
    const head = `${WAVE.rig}:fk.head` as ControlId;
    app.store.transact({ label: 'Loop off' }, (tx) => tx.patch('clips', WAVE.clip, { loop: false }));
    for (const frame of [0, 10]) {
      setSceneFrame(app, frame);
      await runOk(app, 'channel.setValues', {
        edits: [
          { control: head, channel: 'rx', value: frame === 0 ? 0.2 : 0.7 },
          { control: head, channel: 'rz', value: frame === 0 ? -0.3 : 0.5 },
        ],
        key: 'force',
      });
    }
    app.store.transact({ label: 'Loop on' }, (tx) => tx.patch('clips', WAVE.clip, { loop: true }));
    const base = app.store.query.baseLayer(WAVE.clip)?.id;
    if (base === undefined) throw new Error('no base layer');
    expect(app.store.query.curveFor(WAVE.clip, base, head, 'ry')).toBeUndefined();
    const before = [0, 10, 20].map((frame) => worldRotation(app, head, frame));
    await runOk(app, 'rig.setRotateOrder', { control: head, order: 'zyx' });
    const ry = app.store.query.curveFor(WAVE.clip, base, head, 'ry');
    expect([ry?.pre, ry?.post]).toEqual(['constant', 'constant']);
    // Past the last key every curve holds, so the pose at 20 is the converted pose at 10.
    [0, 10, 20].forEach((frame, i) => {
      expect([frame, quatAngle(worldRotation(app, head, frame), before[i] as Quat) < 1e-9]).toEqual([frame, true]);
    });
  });

  it('refuses unknown orders and controls; the same order changes nothing', async () => {
    const app = opsApp();
    expect((await runResult(app, 'rig.setRotateOrder', { control: WAVE.lowerArmL, order: 'abc' })).status).toBe(
      'cancelled',
    );
    expect((await runResult(app, 'rig.setRotateOrder', { control: `${WAVE.rig}:nope`, order: 'xyz' })).status).toBe(
      'cancelled',
    );
    const steps = app.history.peekUndo();
    await runOk(app, 'rig.setRotateOrder', { control: WAVE.lowerArmL, order: 'xzy' });
    expect(app.history.peekUndo()).toBe(steps);
  });
});
