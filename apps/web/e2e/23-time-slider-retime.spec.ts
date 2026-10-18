import { expect, test } from '@playwright/test';
import { clickOutlinerRow, DEG, pointOf, pressOverPane } from './helpers/g3-input';
import { controlId, seedSample } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor, runOk } from './helpers/test-api';

// E2E-23 (MVP-SPEC §6.2; §4.11.3, §4.11.17): Shift+click a key tick selects a 1-frame band with the selected
// controls' keys; dragging the band moves them in time (one history step) and Mod+Z restores every curve.

const ARM = ['fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L'] as const;
/** A keyed control that is not selected: the band must leave its keys alone. */
const OTHER = 'fk.upperArm.R';

test('E2E-23: time-slider retime', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await fixmeIfKernelUnavailable(page);
  await seedSample(page, 'polybot');
  const ids = await Promise.all([...ARM, OTHER].map((key) => controlId(page, key)));
  const arm = ids.slice(0, 3);

  // Key the three arm controls (and one more) at 0/10/20 with distinct rotations.
  await runOk(page, 'select.controls', { ids, mode: 'replace' });
  for (const [frame, degrees] of [
    [0, 0],
    [10, 35],
    [20, -15],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', {
      edits: ids.flatMap((control, index) => [
        { control, channel: 'rx', value: (degrees + index) * DEG },
        { control, channel: 'rz', value: (degrees - 2 * index) * DEG },
      ]),
    });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  await runOk(page, 'time.setFrame', { frame: 0 });
  const clip = (await call(page, 'state')).activeClip ?? '';
  const before = await call(page, 'curves', clip);
  expect(before.length).toBe(12);
  for (const curve of before) expect(curve.keys.map((key) => key.t)).toEqual([0, 10, 20]);

  // Select the three in the Outliner.
  await clickOutlinerRow(page, arm[0] ?? '');
  await clickOutlinerRow(page, arm[1] ?? '', ['Shift']);
  await clickOutlinerRow(page, arm[2] ?? '', ['Shift']);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual(arm);

  // Shift+click the key tick at 10: a 1-frame band with the three controls' keys at 10.
  const tick = await pointOf(page, () => call(page, 'screenOfTick', 10), 'key tick at 10');
  await page.keyboard.down('Shift');
  await page.mouse.click(tick.x, tick.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await call(page, 'state')).band).toEqual({ start: 10, end: 10 });
  const armAt10 = before.filter((curve) => arm.includes(curve.control)).map((curve) => curve.keys[1]?.id ?? '');
  expect((await call(page, 'state')).selection.keys.sort()).toEqual([...armAt10].sort());

  // Drag the band from frame 10 to frame 14.
  const from = await pointOf(page, () => call(page, 'screenOfFrame', 10), 'frame 10');
  const to = await pointOf(page, () => call(page, 'screenOfFrame', 14), 'frame 14');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(from.x + (step / 8) * (to.x - from.x), from.y);
  await page.mouse.up();

  // The arm's keys at 10 moved to 14 with their values and tangents; everything else is unchanged.
  await expect
    .poll(async () =>
      (await call(page, 'curves', clip))
        .filter((curve) => arm.includes(curve.control))
        .map((curve) => curve.keys.map((key) => key.t).join(' ')),
    )
    .toEqual(Array(9).fill('0 14 20'));
  const after = await call(page, 'curves', clip);
  expect(after.map((curve) => curve.id)).toEqual(before.map((curve) => curve.id));
  for (const [index, curve] of after.entries()) {
    const old = before[index];
    if (old === undefined) throw new Error('curve list changed');
    const expected = arm.includes(curve.control)
      ? old.keys.map((key) => (key.t === 10 ? { ...key, t: 14 } : key))
      : old.keys;
    expect(curve.keys, `${curve.control} ${curve.channel}`).toEqual(expected);
  }
  const state = await call(page, 'state');
  expect(state.band).toEqual({ start: 14, end: 14 });
  expect(state.history.undoLabel).toBe('Move Keys');

  // One Mod+Z restores every curve.
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(async () => call(page, 'curves', clip)).toEqual(before);
});
