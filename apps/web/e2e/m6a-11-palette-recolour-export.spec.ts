import { expect, type Page, test } from '@playwright/test';
import {
  decodePalettePng,
  extremeFace,
  glbBin,
  glbJson,
  readAccessor,
  srgbToLinear,
} from './helpers/m6a-model-content';
import { createPrimitive, MODEL_PANE, openModel, screenOf } from './helpers/m6a-model';
import { call, expectKernelStarted, lastExport, runOk } from './helpers/test-api';

// E2E-MOD-11 (M6A-SPEC §10.1, §5.19; owner B13, gate b10): paint the top face of a cube from the Palette tab, recolour
// its swatch, then export with the palette texture and with vertex colours.
// Gate note for INT: `palette-apply` runs `mesh.paint`, which B11 registers (§6; a stub before it), so the scenario
// also needs b11 although the §10.1 Gates column lists b10 only. The "re-import" check decodes the GLB's embedded
// palette PNG here and samples it at each corner's UV; INT may route it through the `/e2e/model-check` loader
// (three's GLTFLoader) once that lands.

async function hoverPersp(page: Page): Promise<void> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === MODEL_PANE);
  if (pane === undefined) throw new Error('no persp pane');
  await page.mouse.move(pane.rect.x + pane.rect.w / 2, pane.rect.y + pane.rect.h / 2);
}

interface Primitive {
  readonly attributes: Record<string, number>;
  readonly indices?: number;
  readonly material?: number;
}

/** Positions and an attribute of the exported cube's single primitive. */
function primitiveOf(bytes: Uint8Array): { json: Record<string, unknown>; primitive: Primitive } {
  const json = glbJson(bytes);
  const meshes = json['meshes'] as { primitives: Primitive[] }[];
  expect(meshes).toHaveLength(1);
  const primitive = meshes[0]?.primitives[0];
  if (primitive === undefined) throw new Error('no primitive');
  return { json, primitive };
}

test('E2E-MOD-11 — palette, recolour, export', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cube = await createPrimitive(page, 'cube');
  const top = await extremeFace(page, cube, 1, 1);

  // `3`, then a click on the top face.
  await hoverPersp(page);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const centre = await screenOf(page, cube, 'face', top);
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(async () => (await call(page, 'model')).selected[cube]?.face).toEqual([top]);

  // Palette tab: swatch 4, Apply; double-click swatch 4 and type red.
  await page
    .locator('.dv-tab', { hasText: /^Palette$/ })
    .first()
    .click();
  await page.getByTestId('palette-swatch-4').click();
  await page.getByTestId('palette-apply').click();
  const painted = (): Promise<number[]> =>
    call(page, 'meshLayer', cube, 'paint').then((rows) => rows.map((row) => row[0] ?? 0));
  await expect.poll(painted).toEqual(Array.from({ length: 6 }, (_, f) => (f === top ? 4 : 0)));
  await page.getByTestId('palette-swatch-4').dblclick();
  await page.keyboard.press('Escape');
  await page.getByTestId('palette-hex').fill('#ff0000');
  await page.getByTestId('palette-hex').press('Enter');
  await expect
    .poll(async () => (await call(page, 'palettes'))[0]?.swatches.find((s) => s.slot === 4)?.srgb)
    .toEqual([255, 0, 0]);
  // The swatch edit recolours without touching the faces' slots.
  expect(await painted()).toEqual(Array.from({ length: 6 }, (_, f) => (f === top ? 4 : 0)));

  // F8: object mode (no face tint or dot over the sample point); the colours shading shows the swatch.
  await hoverPersp(page);
  await page.keyboard.press('F8');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('object');
  await expect
    .poll(async () => {
      const [r, g, b] = await call(page, 'pixel', MODEL_PANE, centre.x, centre.y);
      return (r ?? 0) >= 180 && (g ?? 255) <= 40 && (b ?? 255) <= 40;
    })
    .toBe(true);

  // Palette texture export: one material, one 64 × 64 PNG, the top face's corners at the cell of slot 4.
  await runOk(page, 'file.exportModel', { objects: [cube], fileName: 'cube.glb', profile: 'local/generic' });
  const paletteGlb = await lastExport(page);
  const bytes = new Uint8Array(paletteGlb?.bytes ?? []);
  const { json, primitive } = primitiveOf(bytes);
  expect(json['materials']).toHaveLength(1);
  const images = json['images'] as { bufferView: number; mimeType: string }[];
  expect(images).toHaveLength(1);
  const view = (json['bufferViews'] as { byteOffset?: number; byteLength: number }[])[images[0]?.bufferView ?? -1];
  const bin = glbBin(bytes);
  const png = decodePalettePng(bin.subarray(view?.byteOffset ?? 0, (view?.byteOffset ?? 0) + (view?.byteLength ?? 0)));
  expect([png.width, png.height]).toEqual([64, 64]);
  const positions = readAccessor(bytes, primitive.attributes['POSITION'] as number);
  const uvs = readAccessor(bytes, primitive.attributes['TEXCOORD_0'] as number);
  const cell = (slot: number): readonly [number, number] => [((slot % 8) + 0.5) / 8, (Math.floor(slot / 8) + 0.5) / 8];
  const at = (uv: number[] | undefined, target: readonly [number, number]): boolean =>
    uv !== undefined &&
    Math.abs((uv[0] as number) - target[0]) < 1e-6 &&
    Math.abs((uv[1] as number) - target[1]) < 1e-6;
  let redCorners = 0;
  positions.forEach((position, i) => {
    const uv = uvs[i];
    const red = at(uv, cell(4));
    // Every corner sits at a cell centre: slot 4's on the top face only, slot 0's everywhere else.
    expect(red || at(uv, cell(0))).toBe(true);
    if (red) {
      redCorners += 1;
      expect(Math.abs((position[1] as number) - 0.5)).toBeLessThan(1e-6);
    }
    // Re-import: the colour sampled at the corner's UV is its swatch within 1/255.
    const sample = png.rgb(Math.floor((uv?.[0] ?? 0) * 64), Math.floor((uv?.[1] ?? 0) * 64));
    const expected = red ? [255, 0, 0] : [244, 244, 244];
    for (let c = 0; c < 3; c++)
      expect(Math.abs((sample[c] as number) - (expected[c] as number))).toBeLessThanOrEqual(1);
  });
  expect(redCorners).toBe(4);

  // Vertex colours: COLOR_0 float32 VEC3, linear = EOTF(sRGB), no image.
  await runOk(page, 'mesh.setAttributes', { mesh: cube, patch: { colourOutput: 'vertex-colour' } });
  await runOk(page, 'file.exportModel', { objects: [cube], fileName: 'cube.glb', profile: 'local/generic' });
  const vertexGlb = new Uint8Array((await lastExport(page))?.bytes ?? []);
  const vertex = primitiveOf(vertexGlb);
  expect(vertex.json['images'] ?? []).toHaveLength(0);
  const accessor = (vertex.json['accessors'] as { componentType: number; type: string }[])[
    vertex.primitive.attributes['COLOR_0'] as number
  ];
  expect(accessor).toMatchObject({ componentType: 5126, type: 'VEC3' });
  const colours = readAccessor(vertexGlb, vertex.primitive.attributes['COLOR_0'] as number);
  const vertexPositions = readAccessor(vertexGlb, vertex.primitive.attributes['POSITION'] as number);
  const redLinear = [srgbToLinear(255), srgbToLinear(0), srgbToLinear(0)];
  const whiteLinear = [244, 244, 244].map(srgbToLinear);
  let redVertexCorners = 0;
  colours.forEach((colour) => {
    const target =
      Math.abs((colour[0] as number) - (redLinear[0] as number)) < 1e-6 && (colour[1] as number) < 1e-6
        ? redLinear
        : whiteLinear;
    if (target === redLinear) redVertexCorners += 1;
    for (let c = 0; c < 3; c++)
      expect(Math.abs((colour[c] as number) - (target[c] as number))).toBeLessThanOrEqual(1e-6);
  });
  expect(redVertexCorners).toBe(4);
  expect(vertexPositions).toHaveLength(colours.length);
});
