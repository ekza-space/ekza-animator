import { expect, type Page, test } from '@playwright/test';
import {
  buildAnimatedCubeLad,
  documentState,
  expectStudioShown,
  glKept,
  importStatic,
  markPage,
  pageMark,
  tagGl,
} from './helpers/ar-host';
import { history, loaded, SHELL_MARKERS, scriptsOf } from './helpers/autorig';
import { call, expectKernelStarted, runOk, waitForTestApi } from './helpers/test-api';

// ha-12 skeleton (STUDIO-TOUCH-SPEC §16.1, §20.7, AS-ST-6; T2 exit test): an empty Halo shell mounts at `/app` under
// the shared `(studio)` layout — the host's test API answers, the Studio and Auto-Rig shells and the curve editor are
// never loaded — and Halo → Pro → Halo on one page keeps the document, its undo history and the WebGL context. Pro
// arrives on the asked workspace with the arrival action applied and opens no first-run dialog for `from=halo`. T7
// and T12 extend this file (pane display memory, Rec override, Pro zooms and scrolls as before).

const HALO_MARKER = 'ekza-halo-shell';
/** Strings only the curve editor's code contains (check:size's `curve-editor` boundary). */
const CURVE_EDITOR = ['Absolute, normalized or stacked curves', 'DopeSheetController: the canvas'];

async function openHalo(page: Page, query = ''): Promise<void> {
  await page.goto(`/app?e2e=1${query}`);
  await waitForTestApi(page);
  await expectKernelStarted(page);
}

async function expectHaloShown(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/app(\?|$)/);
  await expect(page.locator(`[data-shell="${HALO_MARKER}"]`)).toBeVisible();
  await expect(page.getByTestId('editor-shell')).toHaveCount(0);
  await expect.poll(() => call(page, 'mountedShell')).toBe('halo');
}

/** Switches shells through the host's navigation port, as a UI control does. */
function navigate(page: Page, request: Parameters<NonNullable<Window['__EKZA_STUDIO_TEST__']>['navigate']>[0]) {
  return page.evaluate(async (r) => await window.__EKZA_STUDIO_TEST__?.navigate(r), request);
}

test('an empty Halo shell mounts at /app over the shared host', async ({ page }) => {
  const scripts = scriptsOf(page);
  await openHalo(page, '&firstRun=1');
  await expectHaloShown(page);
  await expect(page).toHaveTitle('Ekza Studio');
  expect(await history(page)).toEqual({ undo: [], redo: [] });
  expect(await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.webgl.ok)).toBe(true);
  // The host's dialogs answer on /app; Halo never opens Studio's first-run dialog (prefs untouched).
  await page.waitForTimeout(300);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
  expect((await call(page, 'state')).dialog).toBeNull();
  // T6a: the shell registers its `halo()` provider; an empty document shows Home (§17)
  expect(await call(page, 'halo')).toMatchObject({ stage: expect.any(String), sheet: null, petals: [] });
  expect((await call(page, 'halo'))?.slices['grammar']).toMatchObject({ home: true });
  await expect(page.getByTestId('halo-pro-layout')).toBeVisible();
  // the route's boundaries: neither of the other shells, nor the curve editor, is fetched
  expect(loaded(scripts, HALO_MARKER)).toBe(true);
  expect(loaded(scripts, SHELL_MARKERS.studio)).toBe(false);
  expect(loaded(scripts, SHELL_MARKERS.autorig)).toBe(false);
  expect(CURVE_EDITOR.some((marker) => loaded(scripts, marker))).toBe(false);
});

test('Halo → Pro → Halo on one page keeps the document, its undo history and the GL context', async ({ page }) => {
  await openHalo(page, '&platform=mac');
  await expectHaloShown(page);
  await buildAnimatedCubeLad(page);
  const before = await documentState(page);
  expect(before.history.undo.slice(-3)).toEqual(['Create Skeleton', 'Bind Skin', 'Use Clip Walk']);
  await markPage(page);
  await tagGl(page);

  // Halo → Pro's Animate workspace (a client navigation: the layout and its host stay).
  await navigate(page, { to: 'studio', from: 'halo', workspace: 'animate' });
  await expectStudioShown(page);
  await expect(page).toHaveURL(/\/editor\?e2e=1&platform=mac&ws=animate&from=halo$/);
  expect(await call(page, 'mountedShell')).toBe('studio');
  expect(await pageMark(page)).toBe('kept');
  expect(await documentState(page)).toEqual(before);
  expect(await glKept(page)).toEqual({ canvas: true, context: true, lost: false });
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('animate');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);

  // Pro → Halo (Pro's switch is T3's; the port is the same).
  await navigate(page, { to: 'halo', from: 'studio' });
  await expectHaloShown(page);
  await expect(page).toHaveURL(/\/app\?e2e=1&platform=mac&from=studio$/);
  expect(await pageMark(page)).toBe('kept');
  expect(await documentState(page)).toEqual(before);
  expect(await glKept(page)).toEqual({ canvas: true, context: true, lost: false });

  // The history crossed both switches: undo in Halo takes back "Use Clip Walk".
  await runOk(page, 'edit.undo');
  await expect.poll(async () => (await history(page)).redo).toEqual(['Use Clip Walk']);
  expect((await history(page)).undo).toEqual(before.history.undo.slice(0, -1));
});

test("Halo's Pro layout button switches on the same page; Pro applies the arrival action", async ({ page }) => {
  await openHalo(page, '&firstRun=1');
  await expectHaloShown(page);
  await importStatic(page, 'cube-lad.glb');
  const made = await documentState(page);
  expect(made.history.undo).toEqual(['Import Static Model']);
  await markPage(page);

  // The shell's own button (a tap handler calling the port): same page, Pro keeps the session's workspace.
  const workspace = (await call(page, 'state')).workspace;
  await page.getByTestId('halo-pro-layout').click();
  // §16.1: on a touch-only device one line first says Pro is laid out for a mouse and keyboard
  if (await page.getByTestId('halo-pro-line').isVisible()) await page.getByTestId('halo-pro-open').click();
  await expectStudioShown(page);
  // §16.1: the switch names the workspace Pro arrives at (T6a's controller sends it)
  await expect(page).toHaveURL(new RegExp(`/editor\\?e2e=1&firstRun=1&ws=${workspace}&from=halo$`));
  expect(await pageMark(page)).toBe('kept');
  expect(await documentState(page)).toEqual(made);
  expect((await call(page, 'state')).workspace).toBe(workspace);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);

  // Back to Halo, then to Pro with Share's arrival action: the Export dialog opens on arrival (§16.1).
  await navigate(page, { to: 'halo', from: 'studio' });
  await expectHaloShown(page);
  await navigate(page, { to: 'studio', from: 'halo', arrival: { kind: 'dialog', dialog: 'export' } });
  await expectStudioShown(page);
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  expect((await call(page, 'state')).dialog).toBe('export');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  expect(await documentState(page)).toEqual(made);
});

test('Pro opened with from=halo shows no first-run dialog; opened directly it does', async ({ page }) => {
  await page.goto('/editor?e2e=1&firstRun=1&from=halo');
  await waitForTestApi(page);
  await expectStudioShown(page);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
  await page.goto('/editor?e2e=1&firstRun=1');
  await waitForTestApi(page);
  await expect(page.getByTestId('firstrun-dialog')).toBeVisible();
});
