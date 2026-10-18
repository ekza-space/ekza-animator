import { expect, test } from '@playwright/test';
import { clickFrame, dragManipulator, pressOverPane } from './helpers/g3-input';
import { seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-24 (MVP-SPEC §6.2; §4.11.2, ADR 0013): with auto-key off a manipulator drag on a keyed control leaves an
// unkeyed (pink) override; one Mod+Z removes it, so the pose, the overrides and the curves are as before the drag.

test('E2E-24: undo an unkeyed edit', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seed = await seedWaveClip(page);
  expect((await call(page, 'state')).autoKey).toBe(false);

  await clickFrame(page, 5);
  expect((await call(page, 'state')).selection.controls).toEqual([seed.control]);
  const curves = await call(page, 'curves', seed.clip);
  const values = await call(page, 'channelValues', seed.control);
  expect(values).toEqual(await call(page, 'channelValues', seed.control, 5));
  expect(await call(page, 'overrides', seed.control)).toEqual({});
  const undoLabel = (await call(page, 'state')).history.undoLabel;

  // Rotate fk.lowerArm.L with the manipulator: an override, no key.
  await pressOverPane(page, 'KeyE');
  expect((await call(page, 'state')).tool).toBe('rotate');
  await dragManipulator(page, 'rz', { dx: 60, dy: 0 });
  await expect.poll(async () => Object.keys(await call(page, 'overrides', seed.control)).length).toBeGreaterThan(0);
  const dragged = await call(page, 'channelValues', seed.control);
  expect(Math.abs((dragged.rz ?? 0) - (values.rz ?? 0)), 'the drag rotated the elbow').toBeGreaterThan(0.02);
  expect(await call(page, 'curves', seed.clip)).toEqual(curves);
  expect((await call(page, 'state')).history.undoLabel).not.toBe(undoLabel);

  // Mod+Z over the viewport.
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(async () => call(page, 'overrides', seed.control)).toEqual({});
  expect((await call(page, 'state')).clipFrame).toBe(5);
  expect(await call(page, 'channelValues', seed.control)).toEqual(values);
  expect(await call(page, 'channelValues', seed.control, 5)).toEqual(values);
  expect(await call(page, 'curves', seed.clip)).toEqual(curves);
  // The undo took the drag's step only: the seed's keying is the next step back.
  expect((await call(page, 'state')).history.undoLabel).toBe(undoLabel);
  expect((await call(page, 'state')).history.canRedo).toBe(true);
});
