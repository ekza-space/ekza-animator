import { expect, type Page, test } from '@playwright/test';
import { extremeFace, extremeVertices, glbJson } from './helpers/m6a-model-content';
import { createPrimitive, MODEL_PANE, openModel, screenOf, setMode } from './helpers/m6a-model';
import { call, expectKernelStarted, lastExport, runOk } from './helpers/test-api';

// SHADING-SPEC §6 (owner request "Basic shading without UVs"): a red sphere from the Palette tab, then Assign New
// Material › Blinn on the object (Palette "Blinn" button): the colours shading shows a highlight the Lambert sphere does
// not have. Then Assign New Material › Lambert on one selected face, and the GLB export has two materials: Lambert
// (metallic 0, roughness 1) and Blinn (metallic 0, roughness 1 − glossiness, KHR_materials_specular in extensionsUsed
// only).

async function hoverPersp(page: Page): Promise<void> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === MODEL_PANE);
  if (pane === undefined) throw new Error('no persp pane');
  await page.mouse.move(pane.rect.x + pane.rect.w / 2, pane.rect.y + pane.rect.h / 2);
}

type Material = {
  name: string;
  pbrMetallicRoughness?: { metallicFactor?: number; roughnessFactor?: number };
  extensions?: Record<string, unknown>;
};

test('SHADING-01 — Assign New Material: a Blinn highlight in the viewport, Lambert and Blinn factors in the GLB', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  const sphere = await createPrimitive(page, 'sphere');
  const faces = (await call(page, 'meshLayer', sphere, 'paint')).length;
  const slots = (): Promise<number[]> =>
    call(page, 'meshLayer', sphere, 'paint').then((rows) => rows.map((row) => row[0] ?? 0));

  // The sphere's screen box: a grid of probes around its front face, as tall as its centre-to-pole distance.
  await setMode(page, 'face');
  const front = await screenOf(page, sphere, 'face', await extremeFace(page, sphere, 2, 1));
  await setMode(page, 'vertex');
  const pole = await screenOf(page, sphere, 'vertex', (await extremeVertices(page, sphere, 1, 1))[0] ?? 0);
  await setMode(page, 'object');
  const half = Math.max(8, Math.hypot(pole.x - front.x, pole.y - front.y));
  /** The brightest green and blue over the probe grid (the red base keeps them low without a highlight). */
  const brightest = async (): Promise<[number, number]> => {
    let g = 0;
    let b = 0;
    for (let i = -6; i <= 6; i++) {
      for (let j = -6; j <= 6; j++) {
        const [, pg, pb] = await call(page, 'pixel', MODEL_PANE, front.x + (i * half) / 7, front.y + (j * half) / 7);
        g = Math.max(g, pg ?? 0);
        b = Math.max(b, pb ?? 0);
      }
    }
    return [g, b];
  };

  // Palette tab: swatch 4 (red), Apply on the object (every face): Lambert.
  await page
    .locator('.dv-tab', { hasText: /^Palette$/ })
    .first()
    .click();
  await page.getByTestId('palette-swatch-4').click();
  await page.getByTestId('palette-apply').click();
  await expect.poll(slots).toEqual(Array(faces).fill(4));
  await expect.poll(async () => (await brightest())[0]).toBeGreaterThan(0);
  const lambert = await brightest();
  expect(lambert[0]).toBeLessThan(140);

  // New material › Blinn on the object: a new red Blinn swatch on every face, active, the mesh lit.
  await page.getByTestId('palette-new-blinn').click();
  await expect.poll(slots).toEqual(Array(faces).fill(16));
  const swatchOf = async (slot: number) => (await call(page, 'palettes'))[0]?.swatches.find((s) => s.slot === slot);
  expect(await swatchOf(16)).toMatchObject({ name: 'Blinn 1', shader: 'blinn', srgb: [0xe0, 0x46, 0x46] });
  expect(await call(page, 'activeSwatch')).toBe((await swatchOf(16))?.id);
  await expect(page.getByTestId('palette-swatch-16')).toHaveAttribute('data-shader', 'blinn');
  await expect
    .poll(async () => {
      const blinn = await brightest();
      return blinn[0] - lambert[0] > 60 && blinn[1] - lambert[1] > 60;
    })
    .toBe(true);

  // Glossiness 0.7 in the shader section (one step on Enter).
  await page.getByTestId('palette-glossiness-value').fill('0.7');
  await page.getByTestId('palette-glossiness-value').press('Enter');
  await expect.poll(async () => (await swatchOf(16))?.glossiness).toBe(0.7);

  // Face mode, the front face selected, New material › Lambert on it.
  await hoverPersp(page);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const frontFace = await extremeFace(page, sphere, 2, 1);
  const point = await screenOf(page, sphere, 'face', frontFace);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await call(page, 'model')).selected[sphere]?.face).toEqual([frontFace]);
  await page.getByTestId('palette-new-lambert').click();
  await expect.poll(async () => (await slots())[frontFace]).toBe(17);
  expect((await slots()).filter((slot) => slot === 16)).toHaveLength(faces - 1);
  expect(await swatchOf(17)).toMatchObject({ name: 'Lambert 1', shader: 'lambert', srgb: [0xe0, 0x46, 0x46] });

  // Export: one Lambert and one Blinn material sharing the palette PNG.
  await runOk(page, 'file.exportModel', { objects: [sphere], fileName: 'sphere.glb', profile: 'local/generic' });
  const exported = await lastExport(page);
  const json = glbJson(new Uint8Array(exported?.bytes ?? []));
  expect(json['extensionsUsed']).toEqual(['KHR_materials_specular']);
  expect(json['extensionsRequired']).toBeUndefined();
  expect(json['images']).toHaveLength(1);
  const materials = json['materials'] as Material[];
  expect(materials.map((material) => material.name)).toEqual(['Ekza Default 16', 'Ekza Default 16 blinn g70']);
  const [plain, shiny] = materials;
  expect(plain?.pbrMetallicRoughness?.metallicFactor).toBe(0);
  expect(plain?.pbrMetallicRoughness?.roughnessFactor ?? 1).toBe(1);
  expect(plain?.extensions).toBeUndefined();
  expect(shiny?.pbrMetallicRoughness?.metallicFactor).toBe(0);
  expect(shiny?.pbrMetallicRoughness?.roughnessFactor).toBeCloseTo(0.3, 6);
  expect(shiny?.extensions).toHaveProperty('KHR_materials_specular');
});
