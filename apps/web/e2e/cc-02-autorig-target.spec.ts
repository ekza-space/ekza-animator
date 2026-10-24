// CHARACTER-CONTRACT-SPEC §8.5, §9 F1 (C1): Auto-Rig ④ in contract mode. The Polybot VRM at ④; nothing of the
// contract loads on entry; *For a game…* → Wildspark binds it (2 taps) and the slot checklist replaces the free clip
// list: "Wildspark: 0 yours · 9 game default", OMOBA's note becomes "Empty slots use OMOBA's own animations"; *Pick
// from library…* fills Run with one Use Clip step; *Game default ▶* previews the default where the starter pack has
// it; *Use default* empties the slot again; *Not for a game* returns to the free clip list. Set
// `EKZA_CC_SCREENSHOTS=<dir>` to save the step's picture there.
import { expect, test } from '@playwright/test';
import { animationsWithVrm, libraryPreview } from './helpers/ar-animations';
import { history } from './helpers/autorig';

test.describe.configure({ timeout: 120_000 });

test('E2E-CC-02: Auto-Rig ④ contract mode — bind, fill a slot from the library, preview a default', async ({
  page,
}) => {
  const contracts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/contracts/')) contracts.push(url.pathname);
  });
  await animationsWithVrm(page);
  await expect(page.getByTestId('ar-anim-character')).toContainText('On Polybot');
  await expect(page.getByTestId('ar-target-open')).toHaveText('For a game…');
  expect(contracts).toEqual([]);

  // For a game… → Wildspark
  await page.getByTestId('ar-target-open').click();
  await page.getByTestId('ar-target-character').selectOption('wildspark');
  await expect(page.getByTestId('ar-target-title')).toHaveText('For: OMOBA · Wildspark');
  await expect(page.getByTestId('ar-target-summary')).toHaveText('Wildspark: 0 yours · 9 game default');
  await expect(page.getByTestId('ar-target')).toContainText('Empty slots use OMOBA’s own animations.');
  await expect(page.getByTestId('ar-anim-character')).toHaveCount(0);
  await expect(page.getByTestId('ar-anim-panel')).not.toContainText('OMOBA uses its own motions');
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Set Target');
  await expect(page.locator('[data-testid^="ar-target-row-"]')).toHaveCount(9);

  // Pick from library… for Run: one Use Clip step
  await page.getByTestId('ar-target-pick-base.run').selectOption('run');
  await expect(page.getByTestId('ar-target-row-base.run')).toHaveAttribute('data-status', 'custom');
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Run');
  await expect(page.getByTestId('ar-target-summary')).toHaveText('Wildspark: 1 yours · 8 game default');

  // Game default ▶ on Idle previews the starter pack's idle on the character
  await page.getByTestId('ar-target-preview-base.idle').click();
  await expect.poll(async () => (await libraryPreview(page))?.clip).toBe('idle');

  if (process.env['EKZA_CC_SCREENSHOTS'] !== undefined) {
    await page.screenshot({ path: `${process.env['EKZA_CC_SCREENSHOTS']}/autorig-step4-contract.png` });
  }

  // Use default empties Run; Not for a game returns to the free list
  await page.getByTestId('ar-target-clear-base.run').click();
  await expect(page.getByTestId('ar-target-row-base.run')).toHaveAttribute('data-status', 'default');
  await page.getByTestId('ar-target-unbind').click();
  await expect(page.getByTestId('ar-target-open')).toHaveText('For a game…');
  await expect(page.getByTestId('ar-anim-character')).toBeVisible();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Clear Target');
  expect(new Set(contracts).size).toBe(2);
});
