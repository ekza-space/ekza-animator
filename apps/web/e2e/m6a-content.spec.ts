import { createHash } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import {
  glbJson,
  importReferenceImage,
  referenceImage,
  setAttributeField,
  zipEntry,
  zipNames,
} from './helpers/m6a-model-content';
import { createPrimitive, meshRuntime, modKey, openModel } from './helpers/m6a-model';
import { seedSample } from './helpers/seed';
import {
  call,
  expectKernelStarted,
  lastExport,
  loadFile,
  openEditor,
  run,
  runOk,
  waitForTestApi,
} from './helpers/test-api';

// B13 content checks (M6A-SPEC §9 B13, §8.8, §5.16, §5.19, §5.26; not an E2E-MOD id): the Model start card and
// Getting started, the Model Outliner (badges, Make editable, rename), the Palette tab and the Attributes sections,
// templates from the menus, reference images through Create › Reference Image with the fixture files (Attributes,
// drawn in their ortho pane only, saved under `images/` and reopened, never exported), the Export dialog's Static
// model section and the first-run question — real input in Chrome, assertions through the test API. The cases that
// need component selection (B10) or the registered paint operators (B11) are E2E-MOD-11/-27/-29 (gated).

async function dockTab(page: Page, title: string): Promise<void> {
  await page
    .locator('.dv-tab', { hasText: new RegExp(`^${title}$`) })
    .first()
    .click();
}

test('the empty Model scene shows the start card (not the drop zone); its buttons create primitives and templates', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  await expect(page.getByTestId('model-start')).toBeVisible();
  await expect(page.getByTestId('dropzone')).toHaveCount(0);
  // One card, in the maximized persp pane; key hints come from the keymap.
  await expect(page.getByTestId('model-start')).toHaveCount(1);
  await expect(page.getByTestId('model-start-hints')).toContainText('face mode');
  await expect(page.getByTestId('model-start-generate')).toBeDisabled();

  await page.getByTestId('model-start-cylinder').click();
  await expect.poll(async () => (await call(page, 'meshes')).length).toBe(1);
  await expect(page.getByTestId('model-start')).toHaveCount(0);
  const cylinder = (await call(page, 'meshes'))[0];
  expect(cylinder).toMatchObject({
    name: 'Cylinder',
    badge: 'prim',
    generator: 'cylinder',
    palette: expect.any(String),
  });
  // The default palette came with the first modeling action (§5.19).
  expect((await call(page, 'palettes')).map((p) => [p.name, p.swatches.length])).toEqual([['Ekza Default 16', 16]]);

  // Animate keeps its drop zone semantics: the scene has no character there either.
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  await expect(page.getByTestId('dropzone')).toBeVisible();
});

test('Getting started ticks its first step, is dismissible and stays dismissed after a reload', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const card = page.getByTestId('getting-started');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('getting-started-step-3')).toContainText(/⌘E|Ctrl\+E/);
  await expect(page.getByTestId('getting-started-step-1')).not.toHaveAttribute('data-done', 'true');
  await createPrimitive(page, 'cube');
  await expect(page.getByTestId('getting-started-step-1')).toHaveAttribute('data-done', 'true');
  await page.getByTestId('getting-started-dismiss').click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await waitForTestApi(page);
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('model');
  await expect(page.getByTestId('model-start')).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('Outliner (Model): scene rows with badges, inline rename, templates from the Create menu', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cube = await createPrimitive(page, 'cube');
  const row = page.getByTestId(`outliner-row-${cube}`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId(`outliner-badge-${cube}`)).toContainText('12 tris');
  await expect(page.getByTestId(`outliner-badge-${cube}`)).toContainText('prim');
  await row.dblclick();
  await page.getByTestId('outliner-rename').fill('Crate');
  await page.getByTestId('outliner-rename').press('Enter');
  await expect.poll(async () => (await call(page, 'meshes')).find((m) => m.id === cube)?.name).toBe('Crate');

  await page.getByTestId('menu-create').click();
  await page.getByTestId('menu-sub-create.templates').click();
  await page.getByTestId('menu-item-builtin.model.create.templates.humanoid').click();
  await expect(page.getByTestId('outliner-section-scene')).toContainText('Scene');
  await expect(page.locator('[data-testid^="outliner-row-grp_"]')).toHaveCount(1);
  await expect(page.locator('[data-testid^="outliner-row-grp_"]')).toContainText('Humanoid');
  // Undo removes the template group in one step.
  expect((await call(page, 'history')).undo.at(-1)).toBe('Humanoid Guides');
});

test('Outliner (Model): a sample avatar lists its glTF meshes as ⊘ asset; Make editable shows the report', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const button = page.locator('[data-testid^="outliner-make-editable-"]').first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  const meshId = ((await button.getAttribute('data-testid')) ?? '').replace('outliner-make-editable-', '');
  await expect(page.getByTestId(`outliner-badge-${meshId}`)).toContainText('⊘ asset');
  expect((await call(page, 'meshes')).find((row) => row.id === meshId)?.badge).toBe('asset');
  await button.click();
  await expect(page.getByTestId('make-editable-report')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('make-editable-triangles')).toHaveText(/\d+/);
  await page.getByTestId('make-editable-done').click();
  await expect.poll(async () => (await call(page, 'meshes')).find((row) => row.id === meshId)?.badge).toBe('edit');
  await expect(page.getByTestId(`outliner-make-editable-${meshId}`)).toHaveCount(0);
  await expect(page.getByTestId(`outliner-badge-${meshId}`)).toContainText('✎');
});

test('Palette tab: active swatch, hex edit recolours, add a slot, export colours; Attributes edits live parameters', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cube = await createPrimitive(page, 'cube');
  await dockTab(page, 'Palette');
  await expect(page.getByTestId('palette-swatch-15')).toBeVisible();
  await expect(page.getByTestId('palette-usage')).toContainText('Used on mesh: 1 of 16');
  await page.getByTestId('palette-swatch-4').click();
  const palette = (await call(page, 'palettes'))[0];
  const swatch4 = palette?.swatches.find((s) => s.slot === 4);
  await expect.poll(() => call(page, 'activeSwatch')).toBe(swatch4?.id);
  await page.getByTestId('palette-swatch-4').dblclick();
  await expect(page.getByTestId('palette-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('palette-hex').fill('#ff0000');
  await page.getByTestId('palette-hex').press('Enter');
  await expect
    .poll(async () => (await call(page, 'palettes'))[0]?.swatches.find((s) => s.slot === 4)?.srgb)
    .toEqual([255, 0, 0]);
  await page.getByTestId('palette-add').click();
  await expect(page.getByTestId('palette-swatch-16')).toBeVisible();
  await page.getByTestId('palette-output-vertex-colour').check();

  await dockTab(page, 'Attributes');
  await expect(page.getByTestId('attr-mesh-colourOutput')).toHaveValue('vertex-colour');
  await setAttributeField(page, 'attr-prim-subdivisionsWidth', '2');
  await expect.poll(async () => (await call(page, 'meshInfo', cube))?.counts.f).toBe(10);
  expect((await call(page, 'meshes')).find((m) => m.id === cube)).toMatchObject({ badge: 'prim', rev: 2 });
  await setAttributeField(page, 'attr-mesh-name', 'Box');
  await expect.poll(async () => (await call(page, 'meshes')).find((m) => m.id === cube)?.name).toBe('Box');
  expect((await call(page, 'meshes')).find((m) => m.id === cube)?.generator).toBe('cube');
});

/** Pixels of a 5 × 5 grid over a pane (page CSS px). */
async function paneGrid(page: Page, paneId: string): Promise<number[][]> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === paneId);
  if (pane === undefined) throw new Error(`no pane ${paneId}`);
  const out: number[][] = [];
  for (let i = 1; i <= 5; i++) {
    for (let j = 1; j <= 5; j++) {
      out.push(
        await call(page, 'pixel', paneId, pane.rect.x + (pane.rect.w * i) / 6, pane.rect.y + (pane.rect.h * j) / 6),
      );
    }
  }
  return out;
}

test('reference images: Create › Reference Image, Attributes, drawn in their view only, saved under images/, reopened, never exported', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  // Four views (top | persp / front | side): leave the maximized persp pane.
  await runOk(page, 'view.layout', { layout: 'split' });
  await runOk(page, 'view.layout', { layout: 'quad' });
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(4);
  const topBefore = await paneGrid(page, 'pane-top');
  const sideBefore = await paneGrid(page, 'pane-side');

  const front = await importReferenceImage(page, 'front', 'reference-front.png');
  const side = await importReferenceImage(page, 'side', 'reference-side.png');
  // The new plane is selected: its Attributes section.
  await dockTab(page, 'Attributes');
  await expect(page.getByTestId('attr-section-plane')).toBeVisible();
  await setAttributeField(page, 'attr-plane-offset', '0, 0.9');
  await setAttributeField(page, 'attr-plane-size', '1.8');
  await setAttributeField(page, 'attr-plane-opacity', '0.4');
  await page.getByTestId('attr-plane-locked').check();
  await expect
    .poll(async () => (await call(page, 'imagePlanes')).find((p) => p.id === side))
    .toMatchObject({ camera: 'side', offset: [0, 0.9], size: 1.8, opacity: 0.4, locked: true, depth: 'behind' });
  await expect(page.getByTestId('attr-plane-size')).toHaveAttribute('readonly');

  // Drawn in the side pane, never in the top pane.
  await expect.poll(async () => JSON.stringify(await paneGrid(page, 'pane-side'))).not.toBe(JSON.stringify(sideBefore));
  expect(await paneGrid(page, 'pane-top')).toEqual(topBefore);

  // Saved as images (not assets) and reopened identically.
  const cube = await createPrimitive(page, 'cube');
  const planes = await call(page, 'imagePlanes');
  const saved = await runOk<{ fileName: string }>(page, 'file.save');
  const archive = await lastExport(page);
  if (archive === null) throw new Error('no saved archive');
  const manifest = JSON.parse(zipEntry(archive.bytes, 'manifest.json')?.toString('utf8') ?? '{}') as {
    assets: { path: string }[];
    images?: { path: string; sha256: string }[];
  };
  expect(manifest.images?.map((image) => image.path).sort()).toEqual(
    planes.map((plane) => `images/${plane.asset}.png`).sort(),
  );
  expect(manifest.assets).toEqual([]);
  expect(zipNames(archive.bytes).filter((name) => name.startsWith('images/'))).toHaveLength(2);
  expect(planes.map((plane) => plane.asset).sort()).toEqual(
    [referenceImage('reference-front.png'), referenceImage('reference-side.png')]
      .map((bytes) => createHash('sha256').update(bytes).digest('hex'))
      .sort(),
  );
  await page.reload();
  await waitForTestApi(page);
  await loadFile(page, saved.fileName, new Uint8Array(archive.bytes));
  await expect.poll(() => call(page, 'imagePlanes')).toEqual(planes);
  expect([front, side].every((id) => planes.some((plane) => plane.id === id))).toBe(true);

  // A static export holds the palette image only, and no node for the planes.
  await expect.poll(() => meshRuntime(page, cube)).toBe('ready');
  await runOk(page, 'file.exportModel', { objects: [cube], fileName: 'cube.glb', profile: 'local/generic' });
  const glb = await lastExport(page);
  const json = glbJson(new Uint8Array(glb?.bytes ?? []));
  expect((json['images'] as unknown[] | undefined) ?? []).toHaveLength(1);
  expect(((json['nodes'] as { name?: string }[] | undefined) ?? []).map((node) => node.name)).toEqual(['Cube']);
});

test('Export dialog: the Static model section is the default in Model and exports with its profile', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  await page.getByTestId('model-start-template-handheld').click();
  await expect.poll(async () => (await call(page, 'meshes')).length).toBe(1);
  await page.mouse.move(400, 400);
  await page.keyboard.press(`${await modKey(page)}+Shift+KeyE`);
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByTestId('export-static')).toHaveAttribute('data-state', 'checked');
  // A handheld template root defaults to the OMOBA handheld profile (§5.16).
  await expect(page.getByTestId('export-static-profile')).toHaveValue('ekza/omoba-handheld-v1');
  await expect(page.getByTestId('export-static-drop-tangents')).toHaveCount(0);
  await page.getByTestId('export-static-profile').selectOption('local/generic');
  await page.getByTestId('export-static-colour').selectOption('vertex-colour');
  await page.getByTestId('export-static-confirm').click();
  await expect(page.getByTestId('export-static-size')).toBeVisible({ timeout: 30_000 });
  const glb = await lastExport(page);
  expect(glb?.fileName).toBe('Handheld.glb');
  const json = glbJson(new Uint8Array(glb?.bytes ?? []));
  expect((json['images'] as unknown[] | undefined) ?? []).toHaveLength(0);
  const attributes = (json['meshes'] as { primitives: { attributes: Record<string, number> }[] }[])[0]?.primitives[0]
    ?.attributes;
  expect(attributes?.['COLOR_0']).toBeDefined();
});

test('first run: "Model something new" starts in the Model workspace and remembers it', async ({ page }) => {
  await openEditor(page, '&firstRun=1');
  await expectKernelStarted(page);
  await expect(page.getByTestId('firstrun-dialog')).toBeVisible();
  await page.getByTestId('firstrun-start-model').click();
  await page.getByTestId('firstrun-done').click();
  await expect(page.getByTestId('firstrun-dialog')).toBeHidden();
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('model');
  await expect(page.getByTestId('model-start')).toBeVisible();
  const result = await run(page, 'workspace.set', { workspace: 'animate' });
  expect(result.status).toBe('finished');
});
