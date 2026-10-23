// E2E-AR-09 (AUTORIG-SPEC §11 AS-AR-9; D7, in full — D3 owns the ① part): "Reload mid-wizard". After AS-AR-1 step 5
// through the UI (the Cube Lad dropped, *Next*, *Auto-rig*), a reload of the tab offers *Continue where you left off* on
// ① (never Studio's Recovery dialog); *Continue* returns to ③ with the same document — its records, the subject
// character and its skeleton — and the same step.
import { expect, test } from '@playwright/test';
import { onStep, rigThroughUi } from './helpers/ar-as';
import { openAutoRigReady } from './helpers/ar-host';
import { fixtureBytes } from './helpers/ar-model';
import { wizard } from './helpers/ar-markers';
import { subjectCharacter } from './helpers/ar-rig';
import { call, waitForTestApi } from './helpers/test-api';

test('AS-AR-9: a reload after Auto-rig continues on ③ with the same document', async ({ page }) => {
  test.setTimeout(240_000);
  // one storage namespace across the reload (an e2e page otherwise gets a fresh one per load)
  const ns = `as-ar-9-${test.info().workerIndex}-${Date.now().toString(36)}`;
  await openAutoRigReady(page, `&ns=${ns}`);
  await rigThroughUi(page, 'cube-lad.glb', new Uint8Array(fixtureBytes('cube-lad.glb')));
  const { character } = await subjectCharacter(page);
  const counts = await call(page, 'counts');
  const skeleton = await call(page, 'skeleton', character);
  const slices = (await wizard(page)).slices;
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());

  await page.reload();
  await waitForTestApi(page);
  const card = page.getByTestId('ar-continue');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Continue where you left off');
  // AR-D8-10, AR-D9-7: the slot is named after the model (the name the header shows), not "Untitled"
  await expect(card).toContainText('“Cube Lad”');
  expect((await wizard(page)).step).toBe('model');
  await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
  await card.getByRole('button', { name: 'Continue' }).click();
  await onStep(page, 'rig');
  expect(await call(page, 'counts')).toEqual(counts);
  expect((await wizard(page)).subject.character).toBe(character);
  expect(await call(page, 'skeleton', character)).toEqual(skeleton);
  expect((await wizard(page)).done['rig']).toBe(true);
  expect((await wizard(page)).slices['rig']).toMatchObject({ sub: (slices['rig'] as { sub: string }).sub });
  await expect(page.getByTestId('ar-rig-all-good')).toBeVisible();
});

test('AR-D9-10: after a reload the Continue card is the step’s primary (and Mod+Enter’s)', async ({ page }) => {
  test.setTimeout(240_000);
  const ns = `ar-d9-10-${test.info().workerIndex}-${Date.now().toString(36)}`;
  await openAutoRigReady(page, `&ns=${ns}&platform=mac`);
  await rigThroughUi(page, 'cube-lad.glb', new Uint8Array(fixtureBytes('cube-lad.glb')));
  const { character } = await subjectCharacter(page);
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());

  await page.reload();
  await waitForTestApi(page);
  await expect(page.getByTestId('ar-continue')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('ar-primary')).toHaveText(/^Continue/);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  await expect(page.getByTestId('ar-status')).toContainText('Continue');
  await page.keyboard.press('Meta+Enter');
  await onStep(page, 'rig');
  expect((await wizard(page)).subject.character).toBe(character);
});
