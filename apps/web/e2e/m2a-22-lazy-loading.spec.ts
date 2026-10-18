// E2E-M2A-22 (M2A-SPEC §5.21.2, M-2): the editor route loads no lazy chunk until it is needed. A fresh page records
// every script response until the test API is ready and the empty state shows: none carries the model loader
// (three-vrm, GLTFLoader), the export path (glTF Transform), the project archive (fflate) or a dialog. Then the
// Polybot sample button loads the model loader and the sample. The size gate itself runs in CI (`check:size`).
import { expect, type Page, test } from '@playwright/test';
import { controlId } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

/** Strings only each lazy chunk's code contains (the markers `scripts/check-size.mjs` uses). */
const MARKERS = {
  modelLoader: ['VRMC_materials_mtoon', 'THREE.GLTFLoader'],
  exportPath: ['glTF-Transform'],
  projectArchive: ['invalid zip data'],
  dialogs: ['export-dialog', 'import-dialog', 'recovery-dialog', 'about-dialog', 'preferences-dialog'],
  dopeSheet: ['ds-canvas'],
} as const;

/** Bodies of the page's script responses, in arrival order. */
function recordScripts(page: Page): { readonly bodies: string[]; readonly urls: string[] } {
  const record = { bodies: [] as string[], urls: [] as string[] };
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'script') return;
    try {
      record.urls.push(response.url());
      record.bodies.push((await response.body()).toString('utf8'));
    } catch {
      // A redirect or an aborted request has no body.
    }
  });
  return record;
}

const loaded = (bodies: readonly string[], markers: readonly string[]) =>
  bodies.some((body) => markers.some((marker) => body.includes(marker)));

test('E2E-M2A-22: lazy loading of the editor route', async ({ page }) => {
  test.setTimeout(120_000);
  const scripts = recordScripts(page);
  await openEditor(page);
  await expectKernelStarted(page);
  await expect(page.getByTestId('dropzone')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const initial = scripts.bodies.length;
  expect(initial).toBeGreaterThan(0);
  expect(loaded(scripts.bodies, MARKERS.modelLoader), 'model loader on the initial route').toBe(false);
  expect(loaded(scripts.bodies, MARKERS.exportPath), 'export path on the initial route').toBe(false);
  expect(loaded(scripts.bodies, MARKERS.projectArchive), 'project archive on the initial route').toBe(false);
  expect(loaded(scripts.bodies, MARKERS.dialogs), 'a dialog on the initial route').toBe(false);
  expect(loaded(scripts.bodies, MARKERS.dopeSheet), 'the Dope Sheet panel on the initial route').toBe(false);

  await page.getByTestId('sample-polybot').click();
  await expect.poll(async () => (await call(page, 'controls')).length, { timeout: 60_000 }).toBeGreaterThan(0);
  expect(loaded(scripts.bodies.slice(initial), MARKERS.modelLoader), 'the model loader arrived with the sample').toBe(
    true,
  );
  // The display model is on screen: the rig's head control projects into the right pane.
  const head = await controlId(page, 'fk.head');
  await expect.poll(() => call(page, 'screenOfControl', head, 'pane-right'), { timeout: 30_000 }).not.toBeNull();
  expect(loaded(scripts.bodies, MARKERS.exportPath)).toBe(false);

  // Opening the Export dialog loads its chunk and starts loading the export path (intent prefetch).
  await runOk(page, 'ui.open', { dialog: 'export' });
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect.poll(() => loaded(scripts.bodies, MARKERS.exportPath)).toBe(true);
});

test('E2E-M2A-22b: the Dope Sheet panel loads its chunk when its tab is first shown (A3 boundary)', async ({
  page,
}) => {
  const scripts = recordScripts(page);
  await openEditor(page);
  await expectKernelStarted(page);
  await page.waitForLoadState('networkidle');
  await runOk(page, 'workspace.showPanel', { panel: 'dopeSheet' });
  // A3 replaces the A0 placeholder with the panel and its React.lazy boundary (M2A-SPEC §8.1, §5.21.2).
  const placeholder = (await page.getByTestId('ds-placeholder').count()) > 0;
  test.fixme(placeholder, 'A3: the Dope Sheet panel has not landed (placeholder shown)');
  await expect(page.getByTestId('ds-canvas')).toBeVisible();
  expect(loaded(scripts.bodies, MARKERS.dopeSheet)).toBe(true);
});
