import { expect, test } from '@playwright/test';
import {
  call,
  expectKernelStarted,
  expectPanelRegistered,
  openEditor,
  requireOperator,
  waitForCount,
} from './helpers/test-api';

// E2E-01 (MVP-SPEC §6.2): first run, then the Seed-san sample (VRM 1.0) from the empty viewport.
const REQUIRED_KEYS = ['root', 'cog', 'fk.hips', 'fk.head', 'fk.upperArm.L', 'fk.upperArm.R'];

test('E2E-01: first run + sample VRM 1.0', async ({ page }) => {
  await openEditor(page, '&firstRun=1');
  await expectKernelStarted(page);

  const dialog = page.getByTestId('firstrun-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('firstrun-nav-dcc').click();
  await page.getByTestId('firstrun-space-maximize').click();
  await page.getByTestId('firstrun-done').click();
  await expect(dialog).toBeHidden();
  expect((await call(page, 'state')).dialog).toBeNull();

  await expectPanelRegistered(page, 'viewport');
  await requireOperator(page, 'file.loadSample', { sample: 'not-a-sample' });
  await page.getByTestId('sample-seed-san').click();
  await waitForCount(page, 'characters', 1);

  const controls = await call(page, 'controls');
  const visible = controls.filter((control) => control.visible);
  expect(visible.length).toBeGreaterThanOrEqual(50);
  for (const key of REQUIRED_KEYS) {
    expect(
      visible.some((control) => control.key === key),
      `visible control ${key}`,
    ).toBe(true);
  }
  const secondary = controls.filter((control) => control.key.startsWith('sec.'));
  expect(secondary.filter((control) => control.visible)).toEqual([]);

  await expect.poll(async () => (await call(page, 'panes')).length).toBe(2);
  const panes = [...(await call(page, 'panes'))].sort((a, b) => a.rect.x - b.rect.x);
  expect(panes[0]?.camera).toBe('shot');
  expect(panes[0]?.locked).toBe(true);
});
