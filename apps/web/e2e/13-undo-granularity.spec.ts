import { expect, test } from '@playwright/test';
import { breakAndPenDrag, hoverGraph, readRz } from './helpers/g2-graph';
import { seedWaveClip } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor } from './helpers/test-api';

// E2E-13 (MVP-SPEC §6.2, §4.11.0 history): E2E-09's pen-handle drag (many pointer moves) is one history step labelled
// "Edit Tangent": one Mod+Z restores the curve exactly, Shift+Z redoes it.
test('E2E-13: undo granularity', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await fixmeIfKernelUnavailable(page);
  const seed = await seedWaveClip(page);

  const { broken, dragged } = await breakAndPenDrag(page, seed);
  expect(dragged).not.toEqual(broken);
  expect((await call(page, 'state')).history.undoLabel).toBe('Edit Tangent');

  await hoverGraph(page);
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => readRz(page, seed)).toEqual(broken);
  expect((await call(page, 'state')).history.canRedo).toBe(true);

  await page.keyboard.press('Shift+KeyZ');
  await expect.poll(async () => readRz(page, seed)).toEqual(dragged);
  expect((await call(page, 'state')).history.undoLabel).toBe('Edit Tangent');
});
