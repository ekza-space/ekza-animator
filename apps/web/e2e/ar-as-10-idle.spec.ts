// E2E-AR-10 (AUTORIG-SPEC §11 AS-AR-10, §7.3 gate; D7): "Idle". In every step with no preview playing the page draws
// no WebGL frame over 2 s, after M6B-INT-5's settling rule: ① with a model, ② with its markers, ③ with the motion test
// off, ④ with the preview stopped, ⑤ after its thumbnail.
import { expect, test } from '@playwright/test';
import { idleFrames, onStep, primary, rigThroughUi, toAnimations } from './helpers/ar-as';
import { thumbnailRendered } from './helpers/ar-export';
import { openAutoRigReady } from './helpers/ar-host';
import { fixtureBytes } from './helpers/ar-model';
import { call } from './helpers/test-api';

test('AS-AR-10: 0 WebGL frames over 2 s in every step with no preview', async ({ page }) => {
  test.setTimeout(300_000);
  const frames: Record<string, number> = {};
  await openAutoRigReady(page);
  frames['① empty'] = await idleFrames(page);
  await rigThroughUi(page, 'cube-lad.glb', new Uint8Array(fixtureBytes('cube-lad.glb')));

  // ③ with the motion test off (it is the step's preview)
  await page.getByTestId('ar-rig-motion-toggle').click();
  await expect.poll(async () => (await call(page, 'library'))?.preview ?? null).toBeNull();
  frames['③ review'] = await idleFrames(page);

  // ① and ② through the stepper (jumping never undoes anything)
  await page.locator('[data-step="model"] button').click();
  await onStep(page, 'model');
  frames['① model'] = await idleFrames(page);
  await page.locator('[data-step="markers"] button').click();
  await onStep(page, 'markers');
  await expect.poll(async () => (await call(page, 'quickRig'))?.preview?.length ?? 0).toBeGreaterThan(0);
  frames['② markers'] = await idleFrames(page);
  await page.locator('[data-step="rig"] button').click();
  await onStep(page, 'rig');
  await expect.poll(async () => (await call(page, 'library'))?.preview ?? null).toBeNull();

  // ④ with the preview stopped
  await toAnimations(page);
  await page.getByTestId('ar-clip-card-walk').click();
  await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('walk');
  await page.getByTestId('ar-status').click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await call(page, 'library'))?.preview ?? null).toBeNull();
  frames['④ animations'] = await idleFrames(page);

  // ⑤ after the thumbnail
  await primary(page, /Export|Skip/);
  await onStep(page, 'export');
  await thumbnailRendered(page);
  frames['⑤ export'] = await idleFrames(page);

  test.info().annotations.push({ type: 'idle frames', description: JSON.stringify(frames) });
  expect(frames).toEqual({
    '① empty': 0,
    '③ review': 0,
    '① model': 0,
    '② markers': 0,
    '④ animations': 0,
    '⑤ export': 0,
  });
});
