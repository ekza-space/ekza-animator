import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  extremeFace,
  glbJson,
  importReferenceImage,
  referenceImage,
  setAttributeField,
  zipEntry,
} from './helpers/m6a-model-content';
import { createPrimitive, openModel, screenOf } from './helpers/m6a-model';
import { call, expectKernelStarted, lastExport, loadFile, runOk, waitForTestApi } from './helpers/test-api';

// E2E-MOD-29 (M6A-SPEC §10.1, §5.26; owner B13, gate b10): reference images for the front and side views through
// Create › Reference Image with the fixture files; Attributes › Image plane; a click on a cube through the side plane
// selects the cube (planes are never picked); the project saves the images under `images/` (not `assets`) and
// reopens them; a static export holds no image but the palette and no node for the planes.

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

test('E2E-MOD-29 — reference image planes', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  await runOk(page, 'view.layout', { layout: 'split' });
  await runOk(page, 'view.layout', { layout: 'quad' });
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(4);

  await importReferenceImage(page, 'front', 'reference-front.png');
  const side = await importReferenceImage(page, 'side', 'reference-side.png');
  await page
    .locator('.dv-tab', { hasText: /^Attributes$/ })
    .first()
    .click();
  await setAttributeField(page, 'attr-plane-offset', '0, 0.9');
  await setAttributeField(page, 'attr-plane-size', '1.8');
  await setAttributeField(page, 'attr-plane-opacity', '0.4');
  await page.getByTestId('attr-plane-locked').check();
  await expect
    .poll(async () => (await call(page, 'imagePlanes')).find((plane) => plane.id === side))
    .toMatchObject({ offset: [0, 0.9], size: 1.8, opacity: 0.4, locked: true });

  // A cube in front of the side plane; a click on it in the side view selects it through the plane.
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [], mode: 'replace' });
  const facing = await extremeFace(page, cube, 0, 1);
  const point = await screenOf(page, cube, 'face', facing, 'pane-side');
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId(`outliner-row-${cube}`)).toHaveAttribute('aria-selected', 'true');

  // Save: both images under the manifest key `images`, none under `assets`; reopen gives the same planes.
  const planes = await call(page, 'imagePlanes');
  const saved = await runOk<{ fileName: string }>(page, 'file.save');
  const archive = await lastExport(page);
  if (archive === null) throw new Error('nothing saved');
  const manifest = JSON.parse(zipEntry(archive.bytes, 'manifest.json')?.toString('utf8') ?? '{}') as {
    assets: unknown[];
    images?: { path: string }[];
  };
  expect(manifest.assets).toEqual([]);
  expect((manifest.images ?? []).map((image) => image.path).sort()).toEqual(
    [referenceImage('reference-front.png'), referenceImage('reference-side.png')]
      .map((bytes) => `images/${sha256(bytes)}.png`)
      .sort(),
  );
  await page.reload();
  await waitForTestApi(page);
  await loadFile(page, saved.fileName, new Uint8Array(archive.bytes));
  await expect.poll(() => call(page, 'imagePlanes')).toEqual(planes);

  // The static export: the palette image only, no node for the planes.
  await runOk(page, 'file.exportModel', { objects: [], fileName: 'scene.glb', profile: 'local/generic' });
  const json = glbJson(new Uint8Array((await lastExport(page))?.bytes ?? []));
  expect((json['images'] as unknown[] | undefined) ?? []).toHaveLength(1);
  expect(((json['nodes'] as { name?: string }[] | undefined) ?? []).map((node) => node.name)).toEqual(['Cube']);
});
