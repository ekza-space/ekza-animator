// M2a acceptance fix round 1 (DECISIONS-OPEN §F, M2A-INT-20…): regressions of the UI defects the round found, each
// through real input in real Chrome. Engine-level fixes (foot roll, root motion, reduction bytes, −0, recovery,
// mirror) have their own Node and headless tests and assertions in E2E-M2A-03, -04, -21, -23 and the walkthrough.
import { expect, test } from '@playwright/test';
import { controlIdOf, selectIds } from './helpers/m2a-a2';
import { keyTimes, seedArmKeys, shiftClickTick, showDopeSheet, sliderPoint } from './helpers/m2a-timing';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

test('fix round 1: closing a toast leaves no focus ring over the Dope Sheet', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  await runOk(page, 'clip.new', { name: 'w' });
  const leg = await controlIdOf(page, 'ik.leg.L');
  await selectIds(page, [leg]);
  for (const [frame, tz] of [
    [0, 0.1],
    [12, -0.1],
    [24, 0.1],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', { edits: [{ control: leg, channel: 'tz', value: tz }], key: 'force' });
  }
  // A whole-character flip raises a warning toast (Polybot's unpaired controls), closed with its ×: Radix moves the
  // focus into the toast viewport.
  await runOk(page, 'select.controls', { ids: [], mode: 'replace' });
  await page.getByTestId('menu-pose').click();
  await page.getByTestId('menu-sub-pose.mirror-animation').click();
  await page.getByTestId('menu-item-builtin.pose.mirror-animation.flip').click();
  const toast = page.locator('[data-testid="toast"][data-kind="warning"]').first();
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('toast')).toHaveCount(0);

  await showDopeSheet(page);
  const sheet = await call(page, 'dopeSheet');
  if (sheet === null) throw new Error('no Dope Sheet');
  await page.mouse.move(sheet.canvasRect.x + sheet.canvasRect.w - 30, sheet.canvasRect.y + sheet.canvasRect.h - 10);
  await page.keyboard.press('KeyA');
  // Before the fix the focused, empty viewport drew the 2 px accent focus ring: a purple box over the Dope Sheet.
  const ring = await page.evaluate(() => {
    const viewport = document.querySelector('[data-testid="toasts"]');
    const active = document.activeElement;
    return {
      found: viewport !== null,
      focusInside: viewport !== null && active !== null && viewport.contains(active),
      outline: viewport === null ? 'none' : getComputedStyle(viewport).outlineStyle,
    };
  });
  expect(ring).toEqual({ found: true, focusInside: false, outline: 'none' });
});

test('fix round 1: the arrow nudge on the time slider moves the band with the keys', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { arm, clip } = await seedArmKeys(page);
  await runOk(page, 'select.controls', { ids: arm, mode: 'replace' });
  await shiftClickTick(page, 10);
  // Over the slider (it has the keyboard focus after the click): two nudges to the right.
  const over = await sliderPoint(page, 5);
  await page.mouse.move(over.x, over.y);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await keyTimes(page, clip, arm))[arm[0] as string]).toEqual([0, 12, 20]);
  expect((await call(page, 'state')).history.undoLabel).toBe('Move Keys');
  // The band followed (it stayed at 10 before the fix, so a later band drag or scale found no keys there).
  await expect.poll(async () => (await call(page, 'state')).band).toEqual({ start: 12, end: 12 });
});

test('fix round 1: the Channels panel shows whole channel names with the IK/FK row', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  await selectIds(page, [await controlIdOf(page, 'ik.leg.L')]);
  await expect(page.getByTestId('cb-ikfk-row')).toBeVisible();
  // The switch button's cell had no column of its own: the fixed table split the free width between it and the
  // names on every row, and 'Translate X/Y/Z' all read 'Translat...' in the default layout at 1440 px.
  for (const channel of ['tx', 'ty', 'tz', 'rx', '@heelTwist']) {
    const name = page.getByTestId(`cb-name-${channel}`);
    const fit = await name.evaluate((element) => ({
      text: element.textContent,
      clipped: element.scrollWidth > element.clientWidth,
    }));
    expect(fit, channel).toEqual({ text: fit.text, clipped: false });
  }
  const switchCell = await page.getByTestId('cb-ikfk-switch').evaluate((b) => b.closest('td')?.getBoundingClientRect());
  expect(switchCell?.width ?? 0).toBeLessThanOrEqual(32);
});
