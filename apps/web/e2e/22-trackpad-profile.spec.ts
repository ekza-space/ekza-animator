import { expect, type Page, test } from '@playwright/test';
import { cameraDelta, centreOf, paneRect, settle } from './helpers/g1-viewport';
import { seedSample } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor } from './helpers/test-api';

// E2E-22 (MVP-SPEC §6.2, US-20, §4.11.16): with the trackpad navigation profile a two-finger scroll (`wheel`)
// orbits the free camera and a pinch (`wheel` + Ctrl) dollies it; the locked shot camera ignores both.
async function scroll(page: Page, pane: 'pane-left' | 'pane-right', ctrl: boolean): Promise<void> {
  const centre = centreOf(await paneRect(page, pane));
  await page.mouse.move(centre.x, centre.y);
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120);
  if (ctrl) await page.keyboard.up('Control');
  await settle(page);
}

test('E2E-22: trackpad profile', async ({ page }) => {
  await openEditor(page, '&nav=trackpad');
  await fixmeIfKernelUnavailable(page);
  await seedSample(page, 'polybot');
  expect((await call(page, 'panes')).find((pane) => pane.id === 'pane-left')?.locked).toBe(true);

  // Scroll over the free pane orbits: the view direction turns.
  const before = await call(page, 'cameraOf', 'pane-right');
  await scroll(page, 'pane-right', false);
  await expect
    .poll(async () => cameraDelta(before, await call(page, 'cameraOf', 'pane-right')).rotation)
    .toBeGreaterThan(1e-3);
  const orbited = await call(page, 'cameraOf', 'pane-right');

  // Ctrl + scroll (a pinch) dollies: the camera moves along its view direction, which stays the same.
  await scroll(page, 'pane-right', true);
  await expect
    .poll(async () => cameraDelta(orbited, await call(page, 'cameraOf', 'pane-right')).position)
    .toBeGreaterThan(1e-3);
  const dollied = await call(page, 'cameraOf', 'pane-right');
  expect(cameraDelta(orbited, dollied).rotation).toBeLessThanOrEqual(1e-6);
  const travel = dollied.position.map((value, i) => value - (orbited.position[i] ?? 0));
  const length = Math.hypot(...travel);
  // The view direction of a camera is its −Z axis: q · (0, 0, −1).
  const [x, y, z, w] = dollied.quaternion;
  const forward = [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
  const along = Math.abs(travel.reduce((sum, value, i) => sum + value * (forward[i] ?? 0), 0)) / length;
  expect(along).toBeGreaterThan(0.999);

  // The locked shot camera ignores both.
  const locked = await call(page, 'cameraOf', 'pane-left');
  await scroll(page, 'pane-left', false);
  await scroll(page, 'pane-left', true);
  const after = cameraDelta(locked, await call(page, 'cameraOf', 'pane-left'));
  expect(Math.max(after.position, after.rotation)).toBeLessThanOrEqual(1e-9);
});
