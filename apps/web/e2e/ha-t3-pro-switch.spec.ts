import { expect, type Page, test } from '@playwright/test';
import { documentState, expectStudioShown, importStatic, markPage, pageMark } from './helpers/ar-host';
import { call, expectKernelStarted, openEditor, runOk, waitForTestApi } from './helpers/test-api';

// STUDIO-TOUCH-SPEC §16.1, §20.3 item 12, J9 (T3): Pro's switch to Ekza Studio's Simple layout — the status line's
// *▤ Simple layout* and Help › Switch to the Simple Layout — is a same-page switch that keeps the document and its
// undo history and carries the workspace; with Pro unmounted the host's registrations (the view operators, Rig &
// Skin's settings) still run. Chrome only: the touch projects add nothing to a desktop switch.

const HALO_MARKER = 'ekza-halo-shell';

async function expectHaloShown(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.locator(`[data-shell="${HALO_MARKER}"]`)).toBeVisible();
  await expect(page.getByTestId('editor-shell')).toHaveCount(0);
  await expect.poll(() => call(page, 'mountedShell')).toBe('halo');
}

/** The run status of `op` once the host's lazy registration has it (a chunk: not there on the first frame). */
function registeredRun(page: Page, op: string, args: unknown): Promise<string> {
  return page.evaluate(
    async ([id, runArgs]) => {
      const result = await window.__EKZA_STUDIO_TEST__?.run(id, runArgs);
      if (result === undefined) return 'no test API';
      return result.status === 'cancelled' && (result.reason ?? '').startsWith('unknown operator')
        ? 'unregistered'
        : result.status;
    },
    [op, args] as const,
  );
}

test('▤ Simple layout switches Pro to Halo on the same page; the host registrations work with Pro unmounted', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome', 'Pro is the desktop layout (Chrome only)');
  await openEditor(page);
  await expectKernelStarted(page);
  await importStatic(page, 'cube-lad.glb');
  await runOk(page, 'workspace.set', { workspace: 'rig' });
  await expect.poll(() => registeredRun(page, 'rig.jointSize.set', { size: 2 }), { timeout: 30_000 }).toBe('finished');
  const made = await documentState(page);
  await markPage(page);

  await page.getByTestId('status-halo').click();
  await expectHaloShown(page);
  await expect(page).toHaveURL(/\/app\?e2e=1&ws=rig&from=studio$/);
  expect(await pageMark(page)).toBe('kept');
  expect(await documentState(page)).toEqual(made);

  // Pro is gone; what Halo needs from the host is still registered.
  expect(await registeredRun(page, 'view.selectionMask', { mask: { joints: true } })).toBe('finished');
  expect((await call(page, 'state')).workspace).toBe('rig');
  expect(await registeredRun(page, 'rig.jointSize.set', { size: 1.5 })).toBe('finished');
  expect(await registeredRun(page, 'rig.snap.projectedCenter', { on: true })).toBe('finished');
  await runOk(page, 'edit.undo');
  await expect.poll(async () => (await documentState(page)).history.redo).toEqual(['Import Static Model']);
});

test('Help › Switch to the Simple Layout runs the same switch', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chrome', 'Pro is the desktop layout (Chrome only)');
  await openEditor(page);
  await expectKernelStarted(page);
  await expectStudioShown(page);
  await page.getByTestId('menu-help').click();
  await expect(page.getByTestId('menu-item-shell.help.halo')).toHaveText('Switch to the Simple Layout');
  await page.getByTestId('menu-item-shell.help.halo').click();
  await expectHaloShown(page);
  await waitForTestApi(page);
  await expect(page).toHaveURL(/\/app\?e2e=1&ws=animate&from=studio$/);
});
