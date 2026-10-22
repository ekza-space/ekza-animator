// AR-D8-6 (Auto-Rig acceptance fix round 1, D8): Studio's first-run dialog never covers a hand-over from Auto-Rig. On a
// fresh profile (`firstRun=1`), *Open in Studio* (a same-page switch) and a `from=autorig` page (the new-tab flow's
// arrival) open Rig & Skin with the character and no dialog; Studio opened directly still greets a fresh profile.
import { expect, test } from '@playwright/test';
import { expectStudioShown, openAutoRigReady } from './helpers/ar-host';
import { toMarkers, wizard } from './helpers/ar-markers';
import { autoRig } from './helpers/ar-rig';
import { call, openEditor } from './helpers/test-api';

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
