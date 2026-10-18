import { expect, test } from '@playwright/test';
import { drag, pointOf } from './helpers/g1-viewport';
import { controlId, seedSample } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor } from './helpers/test-api';

// E2E-06 (MVP-SPEC §6.2, §4.11.16, §4.11.1): pick the left elbow in the free pane, rotate it with the manipulator's
// Z ring, key it with S: one key per rotation curve at frame 0 and a tick on the time slider.
test('E2E-06: pick and key', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await fixmeIfKernelUnavailable(page);
  await seedSample(page, 'polybot');
  const elbow = await controlId(page, 'fk.lowerArm.L');

  const at = await pointOf(page, () => call(page, 'screenOfControl', 'fk.lowerArm.L', 'pane-right'), 'fk.lowerArm.L');
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([elbow]);

  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('rotate');
  const ring = await pointOf(page, () => call(page, 'screenOfManipulator', 'pane-right', 'rz'), 'rz ring');
  await drag(page, ring, { dx: 60, dy: 0 });
  await expect.poll(async () => Math.abs((await call(page, 'channelValues', elbow)).rz ?? 0)).toBeGreaterThan(0);

  await page.keyboard.press('KeyS');
  const clip = (await call(page, 'state')).activeClip ?? '';
  const rotationKeys = async () =>
    (await call(page, 'curves', clip, elbow))
      .filter((curve) => curve.channel.startsWith('r'))
      .map((curve) => [curve.channel, curve.keys.map((key) => key.t)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
  await expect.poll(rotationKeys).toEqual([
    ['rx', [0]],
    ['ry', [0]],
    ['rz', [0]],
  ]);
  expect((await call(page, 'state')).selection.controls).toEqual([elbow]);
  await pointOf(page, () => call(page, 'screenOfTick', 0), 'key tick at frame 0');
});
