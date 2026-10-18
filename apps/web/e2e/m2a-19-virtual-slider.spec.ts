import { expect, test } from '@playwright/test';
import { pointOf } from './helpers/g1-viewport';
import { centreOfTestId, controlIdOf, DEG, horizontalDrag, selectIds } from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-M2A-19 (M2A-SPEC §9.1, §5.18; FR-CB-05): the Channel Box virtual slider. `pointerLock=off` makes it use pointer
// capture (CDP-synthesised moves cannot drive Pointer Lock); both modes integrate `movementX`. An MMB drag on a channel
// name scrubs 0.5° per pixel (Shift ×0.1) as one history step; with the channel name selected, a plain MMB drag in a
// viewport pane does the same.
test('E2E-M2A-19: virtual slider on a Channel Box row and through MMB in the viewport', async ({ page }) => {
  await openEditor(page, '&platform=mac&pointerLock=off');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const elbow = await controlIdOf(page, 'fk.lowerArm.L');
  await selectIds(page, [elbow]);
  await expect(page.getByTestId('cb-name-rz')).toBeVisible();
  const rz = async () => (await call(page, 'channelValues', elbow)).rz ?? Number.NaN;
  const start = await rz();
  const others = await call(page, 'channelValues', elbow);

  // MMB drag on the name: 40 px → +20°, one history step.
  await horizontalDrag(page, await centreOfTestId(page, 'cb-name-rz'), 40, { button: 'middle' });
  await expect.poll(async () => Math.abs((await rz()) - (start + 20 * DEG))).toBeLessThan(1e-9);
  expect((await call(page, 'state')).history.undoLabel).toBe('Drag Rotate Z');
  await page.getByTestId('cb-name-rx').hover();
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(rz).toBe(start);
  expect((await call(page, 'state')).history.canUndo).toBe(false);

  // Shift ×0.1: +2°.
  await horizontalDrag(page, await centreOfTestId(page, 'cb-name-rz'), 40, { button: 'middle', modifiers: ['Shift'] });
  await expect.poll(async () => Math.abs((await rz()) - (start + 2 * DEG))).toBeLessThan(1e-9);
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(rz).toBe(start);

  // Select the channel name, then a plain MMB drag in the viewport, away from every manipulator handle.
  await page.getByTestId('cb-name-rz').click();
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([elbow]);
  const at = await pointOf(page, () => call(page, 'screenOfControl', elbow, 'pane-right'), 'fk.lowerArm.L');
  await horizontalDrag(page, { x: at.x - 80, y: at.y }, 40, { button: 'middle' });
  await expect.poll(async () => Math.abs((await rz()) - (start + 20 * DEG))).toBeLessThan(1e-9);
  expect((await call(page, 'state')).history.undoLabel).toBe('Drag Rotate Z');
  const after = await call(page, 'channelValues', elbow);
  for (const channel of ['tx', 'ty', 'tz', 'rx', 'ry', 'sx', 'sy', 'sz']) {
    expect([channel, after[channel]]).toEqual([channel, others[channel]]);
  }
  // One step: a single undo restores the value and empties the history.
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(rz).toBe(start);
  expect((await call(page, 'state')).history.canUndo).toBe(false);
});
