// CHARACTER-CONTRACT-SPEC §8.4, §9 F2, GAME-PROTOCOL-SPEC §6.1 (C1): the Pro Target panel. Polybot in Animate; the
// Windows › Target opens the lazy panel beside Clips; *For: OMOBA · Wildspark* binds the character from the
// bundled snapshot (two same-origin requests, nothing else); the checklist lists Wildspark's whole kit in the game's
// order — nine clip slots, all game defaults (OMOBA's C0 contract; its objects arrive with GP5);
// *From library* fills Run in one step with the contract's settings (C2: `target.slot.create`, in place, so no
// warning); Shockline from the library gets its contact at the game's time, and once that contact is cleared it shows
// ⚠ with the contract's reason and its one-tap fix; *Same as* lets Last Spark reuse it; *Use default* empties a slot;
// undo walks the steps back. Set `EKZA_CC_SCREENSHOTS=<dir>` to save the panel's picture there.
import { expect, test } from '@playwright/test';
import { history } from './helpers/autorig';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

test.describe.configure({ timeout: 120_000 });

const row = (slot: string) => `target-row-${slot}`;

test('E2E-CC-01: Target panel — bind, fill from the library, fix, reuse, default, undo', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  const contracts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/contracts/')) contracts.push(url.pathname);
  });

  // Windows › Target opens the lazy panel as a tab beside Clips
  await page.getByTestId('menu-windows').click();
  await page.getByTestId('menu-item-shell.windows.panel.target').click();
  const panel = page.getByTestId('target-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('target-unbound')).toContainText('Empty slots use the game’s own animations');

  // For: OMOBA · Wildspark
  await page.getByTestId('target-game-character').selectOption('wildspark');
  await page.getByTestId('target-bind').click();
  await expect(page.getByTestId('target-title')).toHaveText('OMOBA · Wildspark');
  await expect(page.getByTestId('target-summary')).toHaveText('0 yours · 9 game default');
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Set Target');
  const index = '/contracts/omoba/index.json';
  expect(contracts[0]).toBe(index);
  expect(contracts.slice(1).every((path) => /^\/contracts\/omoba\/sha256-[0-9a-f]{64}\.json$/.test(path))).toBe(true);
  expect(new Set(contracts).size).toBe(2);
  // OMOBA's C0 contract: Wildspark's nine clip slots, one offer (its gear slots and offer arrive with GP5)
  await expect(panel.locator('[data-testid^="target-row-"][data-status]')).toHaveCount(9);
  await expect(page.getByTestId('target-offer-character.wildspark')).toContainText('Character for Wildspark');
  await expect(page.getByTestId('target-deferred')).toHaveCount(0);
  await expect(page.getByTestId(row('base.run'))).toHaveAttribute('data-status', 'default');
  await expect(page.getByTestId('target-row-timing-base.run')).toHaveText('game default · ↻ 0.67 s');

  // Run from the library: one step with the contract's settings, in place for an in-place slot
  await page.getByTestId('target-row-library-base.run').selectOption('run');
  await expect(page.getByTestId(row('base.run'))).toHaveAttribute('data-status', 'custom');
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip for Run (all movement)');
  await expect(page.getByTestId('target-row-timing-base.run')).toContainText('in place');
  await expect(page.getByTestId('target-summary')).toHaveText('1 yours · 8 game default');

  // Shockline from the library: the contact at the game's time; without it → ⚠ with the reason and its fix
  await page.getByTestId('target-row-library-skill.wild_zap.release').selectOption('pistol-shoot');
  await expect(page.getByTestId(row('skill.wild_zap.release'))).toHaveAttribute('data-status', 'custom');
  const zap = (await call(page, 'clips', character)).find((clip) => clip.name === 'Shockline W - release');
  await runOk(page, 'clip.setSettings', { clip: zap?.id, contact: null });
  await expect(page.getByTestId(row('skill.wild_zap.release'))).toHaveAttribute('data-status', 'invalid');
  await expect(page.getByTestId('target-row-issues-skill.wild_zap.release')).toContainText('Needs a contact frame');
  await expect(page.getByTestId('target-row-fix-skill.wild_zap.release-clip.markers')).toHaveText('Set contact');
  await expect(page.getByTestId('target-summary')).toHaveText('1 yours · 7 game default · 1 to fix');

  // Last Spark reuses the Shockline clip (Same as…)
  await page.getByTestId('target-row-same-skill.wild_rocket.release').selectOption('skill.wild_zap.release');
  await expect(page.getByTestId('target-row-timing-skill.wild_rocket.release')).toHaveText(
    'same clip as Shockline (W) — release',
  );
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Same Clip for Last Spark (R) — release');

  // a row's name activates its clip (Use Clip left Pistol Shoot active)
  const run = (await call(page, 'clips', character)).find((clip) => clip.name === 'Run all movement');
  expect((await call(page, 'state')).activeClip).not.toBe(run?.id);
  await page.getByTestId('target-row-label-base.run').click();
  await expect.poll(async () => (await call(page, 'state')).activeClip).toBe(run?.id);

  if (process.env['EKZA_CC_SCREENSHOTS'] !== undefined) {
    await panel.screenshot({ path: `${process.env['EKZA_CC_SCREENSHOTS']}/target-panel.png` });
    await page.screenshot({ path: `${process.env['EKZA_CC_SCREENSHOTS']}/target-panel-editor.png` });
  }

  // Use default empties Shockline; Last Spark's reuse follows to the default
  await page.getByTestId('target-row-clear-skill.wild_zap.release').click();
  await expect(page.getByTestId(row('skill.wild_zap.release'))).toHaveAttribute('data-status', 'default');
  await expect(page.getByTestId(row('skill.wild_rocket.release'))).toHaveAttribute('data-status', 'default');
  await expect(page.getByTestId('target-extras')).toContainText('Shockline W - release');

  // undo: Shockline is filled again
  await runOk(page, 'edit.undo');
  await expect(page.getByTestId(row('skill.wild_zap.release'))).toHaveAttribute('data-status', 'invalid');

  // Clear target: the character is unbound, its clips stay
  await page.getByTestId('target-unbind').click();
  await expect(page.getByTestId('target-unbound')).toBeVisible();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Clear Target');
  expect(new Set(contracts).size).toBe(2);
});
