// M6a acceptance fix round 2 (DECISIONS-OPEN §K): the defects of the second acceptance pass that show in the real
// build in real Chrome — the R handles of an extrude session, an edited skinned character drawn twice in Model,
// F on a group, Select › None in object mode and the Make editable report against Mesh Check.
import { expect, type Page, test } from '@playwright/test';
import { typeCb } from './helpers/m2a-a2';
import { clickComponent, createPrimitive, enterModel, MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { hoverPane, runMenuItem, showChannelBox, topFace } from './helpers/m6a-model-ops-ui';
import { dragFrom, keyOver, type Vec3 } from './helpers/m6a-model-topology-tools';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

/** The extent of a face's corners along each world axis. */
async function faceExtent(page: Page, mesh: string, face: number): Promise<Vec3> {
  const faces = await call(page, 'meshFaces', mesh);
  const positions = (await call(page, 'meshPositions', mesh)) as unknown as Vec3[];
  const corners = (faces[face] ?? []).map((v) => positions[v] as Vec3);
  const span = (k: 0 | 1 | 2): number => {
    const values = corners.map((p) => p[k]);
    return Math.max(...values) - Math.min(...values);
  };
  return [span(0), span(1), span(2)];
}

test('R in an extrude session: the X handle widens the cap along world X (M6A-INT-48)', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cube = await createPrimitive(page, 'cube');
  await hoverPane(page);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const top = await topFace(page, cube);
  await clickComponent(page, cube, 'face', top);
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyE`);
  await expect.poll(async () => (await call(page, 'state')).extrudeSession).toBe(true);
  await keyOver(page, 'KeyR');
  const centre = await call(page, 'screenOfManipulator', MODEL_PANE, 'suniform');
  const handle = await call(page, 'screenOfManipulator', MODEL_PANE, 'sx');
  if (centre === null || handle === null) throw new Error('no scale handles');
  // Outward along the handle's screen direction.
  const dx = handle.x - centre.x;
  const dy = handle.y - centre.y;
  const length = Math.hypot(dx, dy) || 1;
  await dragFrom(page, handle, { x: handle.x + (dx / length) * 40, y: handle.y + (dy / length) * 40 }, { steps: 8 });
  await expect.poll(async () => (await faceExtent(page, cube, top))[0]).toBeGreaterThan(1.1);
  const [x, , z] = await faceExtent(page, cube, top);
  expect(Math.abs(z - 1)).toBeLessThan(1e-6);
  expect(x).toBeGreaterThan(1.1);
  expect((await call(page, 'state')).extrudeSession).toBe(true);
});

test('Model hides the posed display of a character mesh made editable (M6A-INT-50)', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await expect.poll(async () => await call(page, 'displayModel', character), { timeout: 30_000 }).not.toBeNull();
  const animate = await call(page, 'displayModel', character);
  expect(animate?.drawn).toBe(animate?.meshes);
  await enterModel(page);
  expect((await call(page, 'displayModel', character))?.drawn).toBe(animate?.meshes);
  const rows = (await call(page, 'meshes')).filter((row) => row.owner === `char:${character}`);
  expect(rows.length).toBeGreaterThan(0);
  const { mesh } = await runOk<{ mesh: string }>(page, 'mesh.makeEditable', { character, meshIndex: 0 });
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === mesh)?.runtime, { timeout: 30_000 })
    .toBe('ready');
  // mesh-view draws the editable mesh at bind pose; the loaded display no longer draws it on top.
  await expect
    .poll(async () => (await call(page, 'displayModel', character))?.drawn ?? -1)
    .toBeLessThan(animate?.meshes ?? 0);
  // Animate draws the whole display again.
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  await expect
    .poll(async () => {
      const info = await call(page, 'displayModel', character);
      return info !== null && info.drawn === info.meshes;
    })
    .toBe(true);
});

test('F frames a selected group by its meshes (M6A-INT-53)', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const near = await createPrimitive(page, 'cube');
  const far = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [far], mode: 'replace' });
  await showChannelBox(page);
  await typeCb(page, 'cb-field-tx', '12');
  const { group } = await runOk<{ group: string }>(page, 'scene.group', { ids: [near] });
  const frame = async (ids: string[]): Promise<number[]> => {
    await runOk(page, 'select.objects', { ids, mode: 'replace' });
    await runOk(page, 'view.frame', { what: 'selection', paneId: MODEL_PANE });
    return (await call(page, 'cameraOf', MODEL_PANE)).position;
  };
  const byMesh = await frame([near]);
  const byGroup = await frame([group]);
  for (let k = 0; k < 3; k++) expect(byGroup[k]).toBeCloseTo(byMesh[k] as number, 4);
  await runOk(page, 'view.frame', { what: 'all', paneId: MODEL_PANE });
  const all = (await call(page, 'cameraOf', MODEL_PANE)).position;
  expect(Math.hypot(...all.map((v, k) => v - (byGroup[k] as number)))).toBeGreaterThan(1);
});

test('Select › None deselects objects in object mode (M6A-INT-54)', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  expect((await call(page, 'state')).mode).toBe('object');
  // The HUD's Object column counts the selected meshes in object mode.
  await expect.poll(async () => (await call(page, 'hud', MODEL_PANE))?.object['vertex'] ?? -1).toBe(8);
  await runMenuItem(page, 'select', 'builtin.model.select.noneObjects');
  await expect.poll(async () => (await call(page, 'hud', MODEL_PANE))?.object['vertex'] ?? -1).toBe(0);
});

test('the Make editable report shows what Mesh Check finds (M6A-INT-51)', async ({ page }) => {
  test.setTimeout(120_000);
  await openModel(page);
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const button = page.locator('[data-testid^="outliner-make-editable-"]').first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  const meshId = ((await button.getAttribute('data-testid')) ?? '').replace('outliner-make-editable-', '');
  await button.click();
  await expect(page.getByTestId('make-editable-report')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await call(page, 'meshes')).find((row) => row.id === meshId)?.runtime, { timeout: 30_000 })
    .toBe('ready');
  const rows = (await call(page, 'meshCheck', meshId)).filter((row) => row.code !== 'open-border');
  const expected = rows.length === 0 ? 'clean' : rows.map((row) => `${row.code} ${row.count}`).join(', ');
  await expect(page.getByTestId('make-editable-check')).toHaveText(expected);
});
