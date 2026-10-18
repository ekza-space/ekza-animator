import { expect, test } from '@playwright/test';
import { clickFrame, dragManipulator, keysOf, pointOf, pressOverPane } from './helpers/g3-input';
import { controlId, seedWaveClip } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor, runOk } from './helpers/test-api';

// E2E-21 (MVP-SPEC §6.2; §4.11.2 auto-key column): with auto-key on, a manipulator drag at frame 20 keys the
// animated control's rotation curves there; a control without keys gets static values (mode `keyed-only`).

const ROTATION = ['rx', 'ry', 'rz'] as const;

test('E2E-21: auto-key', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await fixmeIfKernelUnavailable(page);
  const seed = await seedWaveClip(page);
  expect((await call(page, 'state')).autoKey).toBe(false);
  await runOk(page, 'key.toggleAutoKey');
  expect((await call(page, 'state')).autoKey).toBe(true);
  await expect(page.getByTestId('timeline-autokey')).toHaveAttribute('aria-pressed', 'true');

  // Frame 20; rotate fk.lowerArm.L (selected by the seed) with the rotate manipulator.
  await clickFrame(page, 20);
  expect((await call(page, 'state')).selection.controls).toEqual([seed.control]);
  await pressOverPane(page, 'KeyE');
  expect((await call(page, 'state')).tool).toBe('rotate');
  const before = await call(page, 'channelValues', seed.control);
  await dragManipulator(page, 'rz', { dx: 60, dy: 0 });
  await expect.poll(async () => (await keysOf(page, seed.control, 'rz')).map((key) => key.t)).toContain(20);
  const after = await call(page, 'channelValues', seed.control);
  expect(Math.abs((after.rz ?? 0) - (before.rz ?? 0)), 'the drag rotated the elbow').toBeGreaterThan(0.02);

  // A key at 20 on every rotation curve, holding the dragged value; no override is left.
  for (const channel of ROTATION) {
    const keys = await keysOf(page, seed.control, channel);
    expect(
      keys.map((key) => key.t),
      channel,
    ).toEqual([0, 15, 20, 30]);
    expect(keys.find((key) => key.t === 20)?.v, channel).toBe(after[channel]);
  }
  expect(await call(page, 'overrides', seed.control)).toEqual({});
  expect(await call(page, 'screenOfTick', 20)).not.toBeNull();

  // Then an unkeyed control (fk.upperArm.R, no curves in `wave`): picked in the viewport and rotated.
  const upperArmR = await controlId(page, 'fk.upperArm.R');
  expect(await call(page, 'curves', seed.clip, upperArmR)).toEqual([]);
  const pick = await pointOf(page, () => call(page, 'screenOfControl', upperArmR, 'pane-right'), 'fk.upperArm.R');
  await page.mouse.click(pick.x, pick.y);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([upperArmR]);
  const rest = await call(page, 'channelValues', upperArmR);
  await dragManipulator(page, 'rz', { dx: 60, dy: 0 });
  await expect
    .poll(async () => Math.abs(((await call(page, 'channelValues', upperArmR)).rz ?? 0) - (rest.rz ?? 0)))
    .toBeGreaterThan(0.02);
  const posed = await call(page, 'channelValues', upperArmR);

  // Mode keyed-only: the rotation curves exist without keys; their static value is the pose at every frame.
  const curves = await call(page, 'curves', seed.clip, upperArmR);
  expect(curves.map((curve) => curve.channel).sort()).toEqual([...ROTATION]);
  expect(curves.every((curve) => curve.keys.length === 0)).toBe(true);
  expect(await call(page, 'overrides', upperArmR)).toEqual({});
  for (const frame of [0, 7, 30])
    expect(await call(page, 'channelValues', upperArmR, frame), `frame ${frame}`).toEqual(posed);
  // The animated control kept its keys.
  expect((await keysOf(page, seed.control, 'rz')).map((key) => key.t)).toEqual([0, 15, 20, 30]);
});
