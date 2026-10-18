// E2E-M2A-20 (FR-PROJ-05, M2A-SPEC §5.20): autosave to IndexedDB and crash recovery. A page with the wave clip
// writes its recovery point and reloads (same URL, same storage namespace): the new page offers the orphaned slot in
// the Recovery dialog, and Recover brings the document back unsaved. With storage blocked autosave is off: no dialog,
// one info toast, and the editor works.
import { expect, test } from '@playwright/test';
import { seedSample, seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, waitForTestApi } from './helpers/test-api';

test('E2E-M2A-20: autosave and recovery', async ({ page }) => {
  test.setTimeout(120_000);
  // A namespace of its own: a reload of the same URL sees the same IndexedDB database.
  const ns = `r1-${test.info().workerIndex}-${Date.now().toString(36)}`;
  await openEditor(page, `&ns=${ns}`);
  await expectKernelStarted(page);
  const seed = await seedWaveClip(page);
  const autosave = await call(page, 'autosave');
  expect(autosave).toMatchObject({ enabled: true, pending: true });
  const slot = autosave.slot ?? '';
  expect(slot).toMatch(/^as_[0-9A-Za-z]{16}$/);
  await page.evaluate(() => window.__EKZA_ANIMATOR_TEST__?.flushAutosave());
  expect(await call(page, 'autosave')).toMatchObject({ enabled: true, slot, pending: false });
  expect((await call(page, 'autosave')).lastSavedAt).not.toBeNull();
  const counts = await call(page, 'counts');
  const curves = await call(page, 'curves', seed.clip);
  expect((await call(page, 'state')).dirty).toBe(true);

  await page.reload();
  await waitForTestApi(page);
  // The reloaded page lists the closed page's slot and offers it (its lock is gone).
  await expect(page.getByTestId('recovery-dialog')).toBeVisible({ timeout: 15_000 });
  expect((await call(page, 'state')).recovery).toEqual([slot]);
  await expect(page.getByTestId(`recovery-row-${slot}`)).toContainText(`${counts['clips']} clip`);
  expect((await call(page, 'autosave')).slot).not.toBe(slot);
  expect((await call(page, 'counts'))['characters']).toBe(0);

  await page.getByTestId(`recovery-recover-${slot}`).click();
  await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
  await expect.poll(() => call(page, 'counts')).toEqual(counts);
  expect(await call(page, 'curves', seed.clip)).toEqual(curves);
  const state = await call(page, 'state');
  expect(state.dialog).toBeNull();
  expect(state.dirty).toBe(true);
  expect(state.history.canUndo).toBe(false);
  expect(state.recovery).toEqual([]);
  await expect(page.locator('[data-testid="toast"][data-kind="success"]')).toContainText(
    /^Recovered '.+' from .+\. Save it to keep it\.$/,
  );
  // The recovered model is back too: the character's controls are on screen.
  await expect.poll(async () => (await call(page, 'controls')).length).toBeGreaterThan(0);

  // Storage blocked (private mode, blocked site data): autosave off, no dialog, one info toast, editing works.
  await openEditor(page, `&ns=r2-${ns}&storage=blocked`);
  await expectKernelStarted(page);
  await expect(page.locator('[data-testid="toast"][data-kind="info"]')).toHaveText(
    'Autosave is off: this browser blocks storage.',
  );
  await expect(page.locator('[data-testid="toast"][data-kind="info"]')).toHaveCount(1);
  expect(await call(page, 'autosave')).toMatchObject({ enabled: false, slot: null });
  expect((await call(page, 'state')).dialog).toBeNull();
  await seedSample(page, 'polybot');
  expect((await call(page, 'counts'))['characters']).toBe(1);
  await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
});
