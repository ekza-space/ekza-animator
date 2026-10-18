import { expect, test } from '@playwright/test';
import { clickOutlinerRow } from './helpers/g3-input';
import { clickDopeKey, dopeRows, keysAt, seedArmKeys, selectedKeyIds, showDopeSheet } from './helpers/m2a-timing';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-12 (M2A-SPEC §5.10, FR-DS-01): the Dope Sheet shares the key selection with the Graph Editor: keys picked
// in one are selected (and deleted) in the other, across a dock-tab switch.

test('E2E-M2A-12: shared selection between the Dope Sheet and the Graph Editor', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { arm, clip } = await seedArmKeys(page);
  for (const [index, control] of arm.entries()) await clickOutlinerRow(page, control, index === 0 ? [] : ['Shift']);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual(arm);
  await showDopeSheet(page);

  await clickDopeKey(page, 'summary', 20);
  const at20 = await keysAt(page, clip, arm, 20);
  expect(at20).toHaveLength(9);
  await expect.poll(() => selectedKeyIds(page)).toEqual(at20);

  // The tab switch hides the Dope Sheet: its probe answers null; the Graph Editor draws the 9 selected keys.
  await runOk(page, 'workspace.showPanel', { panel: 'graph' });
  await expect.poll(() => call(page, 'dopeSheet')).toBeNull();
  await expect.poll(async () => (await call(page, 'graph'))?.canvasRect.w ?? 0).toBeGreaterThan(0);
  const graph = await call(page, 'graph');
  if (graph === null) throw new Error('the Graph Editor is hidden');
  const rect = graph.canvasRect;
  for (const key of at20) {
    await expect
      .poll(async () => {
        const point = await call(page, 'screenOfKey', key);
        return (
          point !== null &&
          point.x >= rect.x &&
          point.x <= rect.x + rect.w &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.h
        );
      })
      .toBe(true);
  }

  // Delete over the Graph Editor, switch back: the summary keys are [0, 10].
  await page.mouse.move(rect.x + rect.w - 30, rect.y + rect.h - 30);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await keysAt(page, clip, arm, 20)).length).toBe(0);
  await showDopeSheet(page);
  await expect.poll(async () => (await dopeRows(page))[0]?.keys).toEqual([0, 10]);
});
