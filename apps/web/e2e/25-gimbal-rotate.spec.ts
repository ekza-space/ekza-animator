import { expect, test } from '@playwright/test';
import { centreOf, drag, paneRect, pointOf } from './helpers/g1-viewport';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-25 (MVP-SPEC §6.2, §4.11.16): in gimbal space a ring drag adds to its own Euler channel only. The left upper
// arm rotates in order yxz, so its middle ring is X; dragging it and keying with S changes rx and leaves ry and rz
// bit-for-bit alone (no quaternion → Euler step).
test('E2E-25: gimbal rotate', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const arm = await controlId(page, 'fk.upperArm.L');

  const at = await pointOf(page, () => call(page, 'screenOfControl', arm, 'pane-right'), 'fk.upperArm.L');
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([arm]);
  await page.getByRole('tab', { name: 'Attributes' }).click();
  await expect(page.getByTestId('attr-rotate-order')).toHaveValue('yxz');

  // The rotate tool (E over the viewport) in gimbal space (status line).
  const right = centreOf(await paneRect(page, 'pane-right'));
  await page.mouse.move(right.x, right.y);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('rotate');
  await page.getByTestId('status-rotate-space-gimbal').click();
  await expect.poll(async () => (await call(page, 'state')).rotateSpace).toBe('gimbal');

  const before = await call(page, 'channelValues', arm);
  const ring = await pointOf(page, () => call(page, 'screenOfManipulator', 'pane-right', 'rx'), 'middle (rx) ring');
  await drag(page, ring, { dx: 40, dy: 0 });
  await page.keyboard.press('KeyS');

  const clip = (await call(page, 'state')).activeClip ?? '';
  await expect.poll(async () => (await call(page, 'curves', clip, arm)).length).toBeGreaterThan(0);
  const after = await call(page, 'channelValues', arm);
  expect(Math.abs((after.rx ?? 0) - (before.rx ?? 0))).toBeGreaterThan(1e-3);
  expect(Math.abs((after.ry ?? Number.NaN) - (before.ry ?? Number.NaN))).toBeLessThanOrEqual(1e-12);
  expect(Math.abs((after.rz ?? Number.NaN) - (before.rz ?? Number.NaN))).toBeLessThanOrEqual(1e-12);
  // The keys hold the same values.
  const keyed = Object.fromEntries(
    (await call(page, 'curves', clip, arm)).map((curve) => [curve.channel, curve.keys[0]?.v ?? Number.NaN]),
  );
  expect(keyed['rx']).toBe(after.rx);
  expect(Math.abs((keyed['ry'] ?? Number.NaN) - (before.ry ?? Number.NaN))).toBeLessThanOrEqual(1e-12);
  expect(Math.abs((keyed['rz'] ?? Number.NaN) - (before.rz ?? Number.NaN))).toBeLessThanOrEqual(1e-12);
});

// The same drag on an arm already turned in Y and Z: object space would now spread the turn over all three channels
// (its X axis is no longer the gimbal's middle axis), gimbal space still changes rx alone.
test('E2E-25: gimbal rotate on a posed arm changes rx only', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const arm = await controlId(page, 'fk.upperArm.L');
  await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
  await runOk(page, 'channel.setValues', {
    edits: [
      { control: arm, channel: 'ry', value: 0.4 },
      { control: arm, channel: 'rz', value: -0.6 },
    ],
  });
  await runOk(page, 'view.tool', { panel: 'viewport', tool: 'rotate' });
  await page.getByTestId('status-rotate-space-gimbal').click();
  await expect.poll(async () => (await call(page, 'state')).rotateSpace).toBe('gimbal');

  const before = await call(page, 'channelValues', arm);
  const ring = await pointOf(page, () => call(page, 'screenOfManipulator', 'pane-right', 'rx'), 'middle (rx) ring');
  await drag(page, ring, { dx: 40, dy: 0 });
  await page.keyboard.press('KeyS');
  const clip = (await call(page, 'state')).activeClip ?? '';
  await expect.poll(async () => (await call(page, 'curves', clip, arm)).length).toBeGreaterThan(0);
  const keyed = Object.fromEntries(
    (await call(page, 'curves', clip, arm)).map((curve) => [curve.channel, curve.keys[0]?.v ?? Number.NaN]),
  );
  expect(Math.abs((keyed['rx'] ?? 0) - (before.rx ?? 0))).toBeGreaterThan(1e-3);
  expect(Math.abs((keyed['ry'] ?? Number.NaN) - 0.4)).toBeLessThanOrEqual(1e-12);
  expect(Math.abs((keyed['rz'] ?? Number.NaN) + 0.6)).toBeLessThanOrEqual(1e-12);
});
