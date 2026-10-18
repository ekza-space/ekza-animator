import { expect, test } from '@playwright/test';
import { DEG, keysOf, pressOverPane } from './helpers/g3-input';
import { drag, keyRotation, sliderPoint } from './helpers/m2a-timing';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-09 (M2A-SPEC §5.9, FR-TIME-10): an MMB drag on the time slider scrubs and carries the pose; `S` keys the
// carried pose at the new frame; the next frame change ends the carry like any override.

test('E2E-M2A-09: MMB carry', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const lowerArm = await controlId(page, 'fk.lowerArm.L');
  await keyRotation(page, lowerArm, 0, { rz: 30 });
  await keyRotation(page, lowerArm, 20, { rz: -30 });
  await runOk(page, 'time.setFrame', { frame: 0 });
  await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(0);

  await drag(page, await sliderPoint(page, 0), await sliderPoint(page, 10), { button: 'middle' });
  await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(10);
  await expect
    .poll(async () => Math.abs((await call(page, 'channelValues', lowerArm)).rz! - 30 * DEG))
    .toBeLessThanOrEqual(1e-9);
  expect(Object.keys(await call(page, 'overrides', lowerArm)).length).toBeGreaterThan(0);

  // S over the viewport keys the carried pose at 10.
  await pressOverPane(page, 'KeyS');
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz')).map((key) => key.t)).toEqual([0, 10, 20]);
  const key10 = (await keysOf(page, lowerArm, 'rz')).find((key) => key.t === 10);
  expect(Math.abs((key10?.v ?? Number.NaN) - 30 * DEG)).toBeLessThanOrEqual(1e-9);

  await runOk(page, 'time.setFrame', { frame: 11 });
  await runOk(page, 'time.setFrame', { frame: 10 });
  expect(await call(page, 'overrides', lowerArm)).toEqual({});
  expect(Math.abs((await call(page, 'channelValues', lowerArm)).rz! - 30 * DEG)).toBeLessThanOrEqual(1e-9);
});
