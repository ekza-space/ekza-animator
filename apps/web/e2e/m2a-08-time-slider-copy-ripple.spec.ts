import { expect, test } from '@playwright/test';
import { clickOutlinerRow, pointOf, pressOverPane } from './helpers/g3-input';
import { curvesOf, drag, keyRotation, keyTimes, seedArmKeys, shiftClickTick, sliderPoint } from './helpers/m2a-timing';
import { controlId } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-M2A-08 (M2A-SPEC §5.9, §5.11): Mod+drag on the time-slider band copies its keys; with ripple on, a band move
// shifts the later keys and a band scale shifts every key after the band by one amount (one global region).

test('E2E-M2A-08: time-slider copy and ripple', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { arm, clip } = await seedArmKeys(page);
  for (const [index, control] of arm.entries()) await clickOutlinerRow(page, control, index === 0 ? [] : ['Shift']);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual(arm);
  const initial = await curvesOf(page, clip);
  const rotation = initial.filter((curve) => arm.includes(curve.control));
  expect(rotation).toHaveLength(9);
  for (const curve of rotation) expect(curve.keys.map((key) => key.t)).toEqual([0, 10, 20]);

  // Mod+drag the band at 10 to 14: copies at 14 with the values of 10; the originals stay.
  await shiftClickTick(page, 10);
  await page.keyboard.down('Meta');
  await drag(page, await sliderPoint(page, 10), await sliderPoint(page, 14));
  await page.keyboard.up('Meta');
  await expect
    .poll(async () =>
      (await curvesOf(page, clip)).filter((curve) => arm.includes(curve.control)).map((c) => c.keys.length),
    )
    .toEqual(Array(9).fill(4));
  for (const curve of (await curvesOf(page, clip)).filter((candidate) => arm.includes(candidate.control))) {
    const before = initial.find((candidate) => candidate.id === curve.id);
    expect(curve.keys.map((key) => key.t)).toEqual([0, 10, 14, 20]);
    expect(curve.keys[1]).toEqual(before?.keys[1]);
    expect(curve.keys[2]?.v).toBe(before?.keys[1]?.v);
  }
  expect((await call(page, 'state')).history.undoLabel).toBe('Copy Keys');
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(() => curvesOf(page, clip)).toEqual(initial);

  // RMB → Ripple Edit; a ripple band move 10 → 12 shifts 20 → 22 too; 0 stays.
  const menuAt = await sliderPoint(page, 30);
  await page.mouse.click(menuAt.x, menuAt.y, { button: 'right' });
  await page.getByTestId('timeline-menu-ripple').click();
  await expect.poll(async () => (await call(page, 'state')).ripple).toBe(true);
  await shiftClickTick(page, 10);
  await drag(page, await sliderPoint(page, 10), await sliderPoint(page, 12));
  await expect
    .poll(() => keyTimes(page, clip, arm))
    .toEqual(Object.fromEntries(arm.map((control) => [control, [0, 12, 22]])));
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(() => curvesOf(page, clip)).toEqual(initial);

  // fk.shoulder.L keyed 0/6/16: its last key inside the coming band 0…10 is at 6.
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
  const beforeScale = await curvesOf(page, clip);

  // Shift-drag 0…10, then drag the band's end to 15: one global region, every later key +5 (not +3).
  const from = await sliderPoint(page, 0);
  const to = await sliderPoint(page, 10);
  await page.keyboard.down('Shift');
  await drag(page, from, to);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await call(page, 'state')).band).toEqual({ start: 0, end: 10 });
  const end = await pointOf(page, () => call(page, 'screenOfBand', 'end'), 'band end handle');
  await drag(page, end, await sliderPoint(page, 15));
  await expect
    .poll(() => keyTimes(page, clip, four))
    .toEqual({
      [shoulder]: [0, 9, 21],
      ...Object.fromEntries(arm.map((control) => [control, [0, 15, 25]])),
    });
  expect((await call(page, 'state')).history.undoLabel).toBe('Scale Keys');
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(() => curvesOf(page, clip)).toEqual(beforeScale);
});
