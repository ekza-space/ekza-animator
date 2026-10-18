import { expect, test } from '@playwright/test';
import { clickFrame, clickOutlinerRow, pointOf, pressOverPane } from './helpers/g3-input';
import {
  clickDopeKey,
  curvesOf,
  drag,
  dopeKey,
  dopeRows,
  dopeX,
  keysAt,
  keyTimes,
  seedArmKeys,
  selectedKeyIds,
  showDopeSheet,
} from './helpers/m2a-timing';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-M2A-10 (M2A-SPEC §5.10): the Dope Sheet's rows, the summary glyph click and drag (one history step), Mod+A and
// the region scale, and the aggregate hold rule (a hold key on one child holds its row, not the summary).

async function selectArm(page: Parameters<typeof clickOutlinerRow>[0], arm: readonly string[]): Promise<void> {
  for (const [index, control] of arm.entries()) await clickOutlinerRow(page, control, index === 0 ? [] : ['Shift']);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual(arm);
}

test('E2E-M2A-10: Dope Sheet basics', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { arm, clip } = await seedArmKeys(page);
  const character = (await call(page, 'state')).activeCharacter ?? '';
  await selectArm(page, arm);
  await showDopeSheet(page);

  const rows = await dopeRows(page);
  expect(rows.map((row) => [row.kind, row.label])).toEqual([
    ['summary', 'Summary'],
    ['character', expect.any(String)],
    ['group', 'Arm L'],
    ['control', expect.any(String)],
    ['control', expect.any(String)],
    ['control', expect.any(String)],
  ]);
  expect(rows.slice(3).map((row) => row.id)).toEqual(arm);
  expect(rows[1]?.id).toBe(`chr:${character}`);
  expect(rows[0]?.keys).toEqual([0, 10, 20]);

  // The summary glyph at 10 selects the 9 rotation keys there.
  await clickDopeKey(page, 'summary', 10);
  const at10 = await keysAt(page, clip, arm, 10);
  expect(at10).toHaveLength(9);
  await expect.poll(() => selectedKeyIds(page)).toEqual(at10);

  // Dragging it to 13 moves them; one Mod+Z restores.
  const before = await curvesOf(page, clip);
  const glyph = await dopeKey(page, 'summary', 10);
  await drag(page, glyph, { x: await dopeX(page, 13), y: glyph.y });
  await expect
    .poll(() => keyTimes(page, clip, arm))
    .toEqual(Object.fromEntries(arm.map((control) => [control, [0, 13, 20]])));
  expect((await call(page, 'state')).history.undoLabel).toBe('Move Keys');
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(() => curvesOf(page, clip)).toEqual(before);

  // Mod+A over the Dope Sheet, then the region's end from 20 to 40: times 0, 20, 40.
  const sheet = await call(page, 'dopeSheet');
  if (sheet === null) throw new Error('the Dope Sheet is hidden');
  await page.mouse.move(sheet.canvasRect.x + sheet.canvasRect.w - 20, sheet.canvasRect.y + sheet.canvasRect.h - 20);
  await page.keyboard.press('Meta+KeyA');
  await expect.poll(async () => (await selectedKeyIds(page)).length).toBe(27);
  const end = await pointOf(page, () => call(page, 'screenOfDopeRegion', 'end'), 'region end');
  await drag(page, end, { x: await dopeX(page, 40), y: end.y });
  await expect
    .poll(() => keyTimes(page, clip, arm))
    .toEqual(Object.fromEntries(arm.map((control) => [control, [0, 20, 40]])));
  expect((await call(page, 'state')).history.undoLabel).toBe('Scale Keys');

  // A hold key on the hand at 50 (same values as at 40).
  const hand = arm[2] ?? '';
  await clickOutlinerRow(page, hand);
  await clickFrame(page, 50);
  await pressOverPane(page, 'KeyS');
  await expect.poll(async () => (await keyTimes(page, clip, [hand]))[hand]).toEqual([0, 20, 40, 50]);
  await selectArm(page, arm);
  await expect.poll(async () => (await dopeRows(page)).length).toBe(6);
  const after = await dopeRows(page);
  expect(after.find((row) => row.id === hand)?.holds).toContainEqual([40, 50]);
  // fk.upperArm.L and fk.lowerArm.L are keyed at 40 but not at 50 (§5.10 aggregate rule 2).
  expect(after[0]?.holds).not.toContainEqual([40, 50]);
});

// §5.10: a control hidden by the IK/FK rule (§5.5 rule 2) is listed dimmed. Legs are IK by default once A1 and A2
// land, which hides the FK leg controls (M2A-SPEC §8: `test.fixme('A2')` until A2 merges).
test.fixme('E2E-M2A-10b (A2): a control hidden by the IK/FK rule is listed dimmed', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const upperLeg = await controlId(page, 'fk.upperLeg.L');
  const ikLeg = await controlId(page, 'ik.leg.L');
  await clickOutlinerRow(page, upperLeg);
  await pressOverPane(page, 'KeyS');
  await clickOutlinerRow(page, ikLeg);
  await pressOverPane(page, 'KeyS');
  await showDopeSheet(page);
  const select = page.getByTestId('ds-show');
  await select.selectOption('character');
  const rows = await dopeRows(page);
  expect(rows.find((row) => row.id === upperLeg)?.dimmed).toBe(true);
  expect(rows.find((row) => row.id === ikLeg)?.dimmed).toBe(false);
});
