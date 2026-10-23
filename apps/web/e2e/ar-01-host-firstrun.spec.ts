// AR-D8-6 (Auto-Rig acceptance fix round 1, D8): Studio's first-run dialog never covers a hand-over from Auto-Rig. On a
// fresh profile (`firstRun=1`), *Open in Studio* (a same-page switch) and a `from=autorig` page (the new-tab flow's
// arrival) open Rig & Skin with the character and no dialog; Studio opened directly still greets a fresh profile.
import { expect, test } from '@playwright/test';
import { expectStudioShown, openAutoRigReady } from './helpers/ar-host';
import { toMarkers, wizard } from './helpers/ar-markers';
import { autoRig } from './helpers/ar-rig';
import { call, openEditor, waitForTestApi } from './helpers/test-api';

test('a fresh profile: Open in Studio from Auto-Rig lands in Rig & Skin without the first-run dialog', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openAutoRigReady(page, '&firstRun=1');
  await page.locator('[data-sample="polybot-tpose"]').click();
  await expect.poll(async () => (await wizard(page)).done.model, { timeout: 30_000 }).toBe(true);
  await toMarkers(page);
  await autoRig(page);
  await page.getByTestId('ar-open-studio').click();
  await expectStudioShown(page);
  await expect(page).toHaveURL(/from=autorig/);
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  // the dialog would open on the shell's mount: give it the chance, then check it stayed closed
  await page.waitForTimeout(500);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
  const state = await call(page, 'state');
  expect(state.dialog).toBeNull();
  expect(state.workspace).toBe('rig');
});

test('a fresh profile: /editor?from=autorig shows no first-run dialog; /editor alone still does', async ({ page }) => {
  await openEditor(page, '&firstRun=1&from=autorig&ws=rig');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
  expect((await call(page, 'state')).workspace).toBe('rig');
  await openEditor(page, '&firstRun=1');
  await expect(page.getByTestId('firstrun-dialog')).toBeVisible();
});

test('AR-D9-2: a reload of Studio after the hand-over offers the autosave (Recovery), still without the first-run dialog', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // one storage namespace across the reload (AR-D7-12)
  const ns = `ar-d9-2-${test.info().workerIndex}-${Date.now().toString(36)}`;
  await openAutoRigReady(page, `&firstRun=1&ns=${ns}`);
  await page.locator('[data-sample="polybot-tpose"]').click();
  await expect.poll(async () => (await wizard(page)).done.model, { timeout: 30_000 }).toBe(true);
  await toMarkers(page);
  await autoRig(page);
  await page.getByTestId('ar-open-studio').click();
  await expectStudioShown(page);
  await expect(page).toHaveURL(/from=autorig/);
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());

  await page.reload();
  await waitForTestApi(page);
  const dialog = page.getByTestId('recovery-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  // the slot carries the model's name (AR-D9-7), the name Auto-Rig's header showed
  await expect(dialog).toContainText('Polybot');
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
});
