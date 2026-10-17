// rig.setRotateOrder (M1-stretch, MVP-SPEC §4.11.5): the control's curves in every clip, its static values and its
// pose override are converted so the control's world rotation is unchanged; undoable as one step.
import { mat4Decompose, type Quat, quatAngle } from '@ekza-animator/anim-core';
import type { ControlId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import { expectUndoRedoExact, opsApp, READY, runOk, runResult, setSceneFrame, WAVE } from './support';

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
