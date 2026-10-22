import { expect, test } from '@playwright/test';
import { history } from './helpers/autorig';
import { autosaveRows, expectStudioShown, navigate, openAutoRigReady } from './helpers/ar-host';
import { seedSample, seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk, waitForTestApi } from './helpers/test-api';

// E2E-AR-01, handoff record (AUTORIG-SPEC §4.4, D1): the explicit new-tab flow writes a one-shot record from the live
// document — here a clean one, with autosave paused — and the new tab opens it silently: its own fresh autosave slot,
// no Recovery dialog although an orphaned recovery point waits in the same storage, the parameter dropped, the
// source tab's slot untouched and no record left behind. A missing record says so and leaves an empty document.

const AUTOSAVE_OFF = { autosave: { enabled: false, delayMs: 2000, maxIntervalMs: 30000 } };

test('a new-tab handoff opens a clean document with autosave paused, without the Recovery dialog', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const ns = `ar01h-${test.info().workerIndex}-${Date.now().toString(36)}`;

  // An orphaned recovery point in this storage namespace: a page with unsaved work that went away.
  const orphan = await context.newPage();
  await openEditor(orphan, `&ns=${ns}`);
  await expectKernelStarted(orphan);
  await seedWaveClip(orphan);
  await orphan.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());
  await orphan.close();

  // The source: Auto-Rig (it never prompts for recovery) with a clean document and autosave paused.
  await openAutoRigReady(page, `&ns=${ns}`);
  await seedSample(page, 'polybot');
  await runOk(page, 'file.save');
  expect((await call(page, 'state')).dirty).toBe(false);
  expect(
    (await page.evaluate(async (patch) => await window.__EKZA_STUDIO_TEST__?.run('prefs.set', { patch }), AUTOSAVE_OFF))
      ?.status,
  ).toBe('finished');
  const source = await call(page, 'autosave');
  expect(source.enabled).toBe(false);
  const counts = await call(page, 'counts');
  const rowsBefore = await autosaveRows(page, ns);
  expect(rowsBefore.filter((row) => row.handoff)).toEqual([]);

  // Open in Studio (new tab) → the Animate workspace.
  const [studio] = await Promise.all([
    context.waitForEvent('page'),
    navigate(page, { to: 'studio', workspace: 'animate', from: 'autorig', newTab: true }),
  ]);
  await studio.waitForURL(/\/editor\?/);
  await waitForTestApi(studio);
  await expectStudioShown(studio);
  await expect.poll(() => call(studio, 'counts')).toEqual(counts);
  await expect(studio.locator('[data-testid="toast"][data-kind="success"]')).toHaveText(
    'Opened in Studio; undo history starts here',
  );
  expect(studio.url()).not.toContain('handoff=');
  expect(studio.url()).toContain(`ns=${ns}`);
  expect(await history(studio)).toEqual({ undo: [], redo: [] });
  await expect.poll(async () => (await call(studio, 'state')).workspace).toBe('animate');
  // Its own fresh slot; no Recovery dialog, although the orphan is listed (after the recheck window, too).
  const received = await call(studio, 'autosave');
  expect(received.slot).not.toBeNull();
  expect(received.slot).not.toBe(source.slot);
  await expect.poll(async () => (await call(studio, 'state')).recovery.length).toBeGreaterThan(0);
  await studio.waitForTimeout(3500);
  await expect(studio.getByTestId('recovery-dialog')).toHaveCount(0);
  expect((await call(studio, 'state')).dialog).toBeNull();

  // The source tab: still Auto-Rig, same document, its slot never written, no record left behind.
  expect(page.url()).toMatch(/\/autorig\?/);
  expect(await call(page, 'counts')).toEqual(counts);
  expect((await call(page, 'autosave')).slot).toBe(source.slot);
  const rowsAfter = await autosaveRows(page, ns);
  expect(rowsAfter.find((row) => row.id === source.slot)?.snapshot ?? false).toBe(false);
  expect(rowsAfter.filter((row) => row.handoff)).toEqual([]);
});

test('a missing handoff record says so and leaves an empty document', async ({ page }) => {
  await openEditor(page, '&handoff=00000000-0000-4000-8000-000000000000');
  await expect(page.locator('[data-testid="toast"][data-kind="warning"]')).toHaveText(
    'This hand-over has expired — open the file from the source tab',
  );
  expect(page.url()).not.toContain('handoff=');
  expect((await call(page, 'counts'))['characters'] ?? 0).toBe(0);
  expect(await history(page)).toEqual({ undo: [], redo: [] });
});
