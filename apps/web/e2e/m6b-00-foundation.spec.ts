import { expect, type Page, test } from '@playwright/test';
import { cubeLadGlbPoints, cubeLadPoints, buildCubeLad } from './helpers/m6b-cube-lad';
import { enterRig, expectRefused } from './helpers/m6b-rig';
import { call, expectKernelStarted, openEditor, run } from './helpers/test-api';

// E2E-M6B-00 (M6B-SPEC §0.7, §9.0 C0): the Rig & Skin tab is enabled, the rig-workspace and clip-library chunks load
// on demand (never with the route), the MVP operators are listed in the palette and deferred ids are absent from the
// palette and the menus; the Cube Lad helper agrees with its fixture.

/** §0.6: a sample of the MVP operators (every one is checked in editor-core's foundation test). */
const MVP = [
  'skel.quickRig.start',
  'skel.quickRig.guess',
  'skel.quickRig.clear',
  'skel.template.create',
  'skel.joint.orient',
  'skel.joint.mirror',
  'skin.bind',
  'skin.unbind',
  'skin.weights.mirror',
  'char.setVrmMeta',
  'file.exportCharacter',
  'library.open',
];
/** MVP operators their owners have landed: the poll reason in an empty project (nothing is selected here). */
const LANDED: Readonly<Record<string, string>> = {
  // C2 (skeleton kernel)
  'skel.template.create': 'Select the meshes to rig',
  'skel.joint.orient': 'Select joints first',
  'skel.joint.mirror': 'Select joints first',
  // C4 (auto-skin)
  'skin.bind': 'Select a character with a skeleton (Quick Rig creates one)',
  'skin.unbind': 'No bound mesh to unbind',
};

/** §0.3: deferred ids (registered, "Arrives after the MVP", listed nowhere). */
const DEFERRED = [
  'skel.joint.create',
  'skel.joint.insert',
  'skel.socket.create',
  'char.attachProp',
  'skin.weights.transfer',
  'skin.test.rom',
  'rig.constraint.create',
  'rig.constraint.bake',
  'rig.shape.replace',
  'rig.shape.cvMode',
];

/** Every JavaScript response's text, so a spec can tell which chunk markers the page has loaded. */
function scriptsOf(page: Page): { readonly texts: string[] } {
  const texts: string[] = [];
  page.on('response', (response) => {
    if (!response.url().endsWith('.js')) return;
    void response
      .text()
      .then((text) => texts.push(text))
      .catch(() => {});
  });
  return { texts };
}
const loaded = (scripts: { readonly texts: string[] }, marker: string): boolean =>
  scripts.texts.some((text) => text.includes(marker));

test('Rig & Skin is enabled; the rig-workspace and clip-library chunks load on demand', async ({ page }) => {
  const scripts = scriptsOf(page);
  await openEditor(page);
  await expectKernelStarted(page);
  const tab = page.getByTestId('ws-tab-rig');
  await expect(tab).toBeVisible();
  await expect(tab).not.toHaveAttribute('aria-disabled', 'true');
  expect((await call(page, 'workspaces')).find((workspace) => workspace.id === 'rig')).toMatchObject({
    label: 'Rig & Skin',
    enabled: true,
    active: false,
  });
  // The route never carries the lazy chunks.
  expect(loaded(scripts, 'ekza-rig-workspace')).toBe(false);
  expect(loaded(scripts, 'ekza-clip-library')).toBe(false);
  const before = await call(page, 'counts');

  await tab.click();
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('rig');
  await expect.poll(() => loaded(scripts, 'ekza-rig-workspace')).toBe(true);
  for (const op of MVP.filter((id) => !id.startsWith('library.'))) {
    await expectRefused(page, op, LANDED[op] ?? 'not available yet');
  }
  for (const op of DEFERRED) await expectRefused(page, op, 'Arrives after the MVP');

  // A library id runs after its chunk has loaded (§2.1: the runner loads the chunk first).
  expect(loaded(scripts, 'ekza-clip-library')).toBe(false);
  // (C12 landed the library: `library.stop` without a preview refuses with its own reason.)
  await expectRefused(page, 'library.stop', 'No clip preview is playing');
  await expect.poll(() => loaded(scripts, 'ekza-clip-library')).toBe(true);

  // Nothing touched the document or the history.
  expect(await call(page, 'counts')).toEqual(before);
  expect(await call(page, 'history')).toEqual({ undo: [], redo: [] });
});

test('the palette lists the MVP operators in Rig & Skin; deferred ids are in no palette entry and no menu', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await enterRig(page);
  await expectRefused(page, 'library.stop', 'No clip preview is playing'); // the clip-library chunk too (C12)
  expect((await run(page, 'ui.commandPalette')).status).toBe('finished');
  await expect(page.getByTestId('cmdk')).toBeVisible();
  const palette = await call(page, 'commandPalette');
  const ops = new Set(palette?.items.map((item) => item.op) ?? []);
  expect(MVP.filter((op) => !ops.has(op))).toEqual([]);
  expect(DEFERRED.filter((op) => ops.has(op))).toEqual([]);
  // A stub is listed disabled with its reason (menus and the palette read the same poll).
  expect(palette?.items.find((item) => item.op === 'skin.bind')).toMatchObject({ label: 'Bind Skin', enabled: false });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cmdk')).toBeHidden();
  // The menu bar's labels never show a deferred operator; C7's Skeleton and Skin menus are there (§0.4.5).
  await expect(page.getByRole('menubar')).toContainText('Skeleton');
  const menubar = (await page.getByRole('menubar').textContent()) ?? '';
  for (const label of ['File', 'Skeleton', 'Skin', 'Windows']) expect(menubar).toContain(label);
  for (const label of ['Constrain', 'Control']) expect(menubar).not.toContain(label);
});

test('the Clip Library is a Windows item of Animate and opens its panel; no badge shows without a provider', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  expect((await call(page, 'state')).workspace).toBe('animate');
  // Windows › Clip Library (derived from the ANIMATE_SLOTS entry) opens the panel.
  await page.getByTestId('menu-windows').click();
  const item = page.getByTestId('menu-item-shell.windows.panel.clipLibrary');
  await expect(item).toHaveText(/Clip Library/);
  await item.click();
  await expect(page.getByTestId('clip-library-panel')).toBeVisible();
  await expect(page.locator('[data-testid^="hud-badge-"]')).toHaveCount(0);
});

test('the Cube Lad helper builds exactly the points of fixtures/models/cube-lad.glb (1e-6 m)', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const mesh = await buildCubeLad(page);
  const built = await cubeLadPoints(page, mesh);
  const fixture = cubeLadGlbPoints();
  expect(built).toHaveLength(fixture.length);
  const worst = built.reduce(
    (max, p, i) => Math.max(max, ...p.map((value, c) => Math.abs(value - (fixture[i]?.[c] ?? Number.NaN)))),
    0,
  );
  expect(worst).toBeLessThanOrEqual(1e-6);
  expect((await call(page, 'meshInfo', mesh))?.counts.tris).toBe(16 * 12);
});
