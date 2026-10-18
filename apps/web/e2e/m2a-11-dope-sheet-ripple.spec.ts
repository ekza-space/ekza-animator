import { expect, test } from '@playwright/test';
import { clickOutlinerRow, pointOf, pressOverPane } from './helpers/g3-input';
import {
  clickDopeKey,
  curvesOf,
  dopeKey,
  dopeX,
  drag,
  keyRotation,
  keyTimes,
  seedArmKeys,
  showDopeSheet,
} from './helpers/m2a-timing';
import { controlId } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-M2A-11 (M2A-SPEC §5.11, FR-DS-02): ripple in the Dope Sheet uses one global region over the controls it shows:
// a move shifts every later key by the same Δ, a scale shifts every key after the region by the same amount.

test('E2E-M2A-11: Dope Sheet ripple', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { arm, clip } = await seedArmKeys(page);
  const shoulder = await controlId(page, 'fk.shoulder.L');
  for (const [frame, degrees] of [
    [0, 0],
    [6, 10],
    [16, 0],
  ] as const) {
    await keyRotation(page, shoulder, frame, { rz: degrees });
  }
  const four = [shoulder, ...arm];
  for (const [index, control] of four.entries()) await clickOutlinerRow(page, control, index === 0 ? [] : ['Shift']);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual(four);
  await showDopeSheet(page);
  await page.getByTestId('ds-ripple').click();
  await expect.poll(async () => (await call(page, 'state')).ripple).toBe(true);
  const before = await curvesOf(page, clip);

  // Move the summary glyph at 10 to 15: 10 → 15, 20 → 25 on the arm; the shoulder's 16 → 21, its 6 stays.
  await clickDopeKey(page, 'summary', 10);
  const at10 = await dopeKey(page, 'summary', 10);
  await drag(page, at10, { x: await dopeX(page, 15), y: at10.y });
  await expect
    .poll(() => keyTimes(page, clip, four))
    .toEqual({ [shoulder]: [0, 6, 21], ...Object.fromEntries(arm.map((control) => [control, [0, 15, 25]])) });
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(() => curvesOf(page, clip)).toEqual(before);

  // Select the summary glyphs at 0, 6 and 10 and scale the region 0…10 by 2 around 0: every later key +10.
  await clickDopeKey(page, 'summary', 0);
  await clickDopeKey(page, 'summary', 6, true);
  await clickDopeKey(page, 'summary', 10, true);
  const end = await pointOf(page, () => call(page, 'screenOfDopeRegion', 'end'), 'region end');
  expect(Math.abs(end.x - (await dopeX(page, 10)))).toBeLessThanOrEqual(1);
  await drag(page, end, { x: await dopeX(page, 20), y: end.y });
  await expect
    .poll(() => keyTimes(page, clip, four))
    .toEqual({ [shoulder]: [0, 12, 26], ...Object.fromEntries(arm.map((control) => [control, [0, 20, 30]])) });
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(() => curvesOf(page, clip)).toEqual(before);
});
