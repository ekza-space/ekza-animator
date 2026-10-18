import { expect, type Page, test } from '@playwright/test';
import { type CameraSnapshot, cameraDelta, centreOf, drag, paneRect, settle } from './helpers/g1-viewport';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-05 (MVP-SPEC §6.2, §4.11.16): Maya navigation (Alt+LMB tumble) is swallowed by the locked shot camera and
// moves the free one; an unlocked shot camera moves and persists outside undo (Mod+Z undoes the unlock, not the
// move); the quad layout has four panes; Space over a pane maximizes and restores it.
const alt = { modifiers: ['Alt'] } as const;

async function tumble(page: Page, pane: 'pane-left' | 'pane-right'): Promise<void> {
  const centre = centreOf(await paneRect(page, pane));
  await drag(page, centre, { dx: 100, dy: 0 }, alt);
  await settle(page);
}

const moved = (a: CameraSnapshot, b: CameraSnapshot): number => {
  const delta = cameraDelta(a, b);
  return Math.max(delta.position, delta.rotation);
};

test('E2E-05: layouts and cameras', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const locked = async () => (await call(page, 'panes')).find((pane) => pane.id === 'pane-left')?.locked;
  expect(await locked()).toBe(true);

  // The locked shot camera swallows the tumble; the free camera tumbles.
  const left0 = await call(page, 'cameraOf', 'pane-left');
  await tumble(page, 'pane-left');
  expect(moved(left0, await call(page, 'cameraOf', 'pane-left'))).toBeLessThanOrEqual(1e-9);
  const right0 = await call(page, 'cameraOf', 'pane-right');
  await tumble(page, 'pane-right');
  expect(moved(right0, await call(page, 'cameraOf', 'pane-right'))).toBeGreaterThan(1e-3);

  // Unlock, tumble the shot camera: it moves, and the move is no history step.
  await page.getByTestId('pane-lock-pane-left').click();
  await expect.poll(locked).toBe(false);
  const unlockLabel = (await call(page, 'state')).history.undoLabel;
  expect(unlockLabel).not.toBeNull();
  const left1 = await call(page, 'cameraOf', 'pane-left');
  await tumble(page, 'pane-left');
  const left2 = await call(page, 'cameraOf', 'pane-left');
  expect(moved(left1, left2)).toBeGreaterThan(1e-3);
  expect((await call(page, 'state')).history.undoLabel).toBe(unlockLabel);

  // Mod+Z undoes the unlock: the camera stays where the drag left it and is locked again.
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(locked).toBe(true);
  expect(moved(left2, await call(page, 'cameraOf', 'pane-left'))).toBeLessThanOrEqual(1e-9);

  // Quad layout: four panes.
  await runOk(page, 'view.layout', { layout: 'quad' });
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(4);
  expect((await call(page, 'state')).layout).toBe('quad');

  // Space over a pane maximizes it; Space again restores the layout.
  const panes = await call(page, 'panes');
  const hovered = panes[2] ?? panes[0];
  if (hovered === undefined) throw new Error('no pane');
  const at = centreOf(hovered.rect);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await call(page, 'state')).maximizedPane).toBe(hovered.id);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await call(page, 'state')).maximizedPane).toBeNull();
});
