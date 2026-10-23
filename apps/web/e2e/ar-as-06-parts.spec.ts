// AUTORIG-SPEC §11 AS-AR-6 (D7, in full; D3 and D6 own its parts): "Several meshes and textures". A textured two-mesh
// scene (Polybot and a box "Sword" on the floor) dropped on ①: the box is unticked by default and left out of the
// subject; the body is rigged through ② and ③; ⑤ writes a clean VRM of the body alone and the sword stays a scene mesh;
// the VRM keeps the body's image texture (C10's writer copies the adopted asset material, AR-D7-15), and ②–⑤ and
// the thumbnail show it (AR-D8-1).
import { expect, type Page, test } from '@playwright/test';
import { dropModel, exportMeta, nextToMarkers, onStep, primary } from './helpers/ar-as';
import { checkOf, download, keepExport } from './helpers/ar-export';
import { openAutoRigReady } from './helpers/ar-host';
import { polybotFlatColour, polybotWithSword } from './helpers/ar-model';
import { FRONT, markerAt, sampleAtMarkers, wizard } from './helpers/ar-markers';
import { autoRig, subjectCharacter } from './helpers/ar-rig';
import { glbJson } from './helpers/g1-viewport';
import { decodePalettePng } from './helpers/m6a-model-content';
import { validatorErrors } from './helpers/m6b-mvp-script';
import { call } from './helpers/test-api';

/** The bytes of image `index` of a GLB (its buffer view in the BIN chunk). */
function imageBytes(glb: Uint8Array, index: number): Uint8Array {
  const json = glbJson(glb) as unknown as {
    images: { bufferView: number }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  const view = json.bufferViews[json.images[index]?.bufferView ?? -1];
  if (view === undefined) throw new Error(`no image ${index}`);
  const data = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = data.getUint32(12, true);
  const bin = 20 + jsonLength + 8;
  const start = bin + (view.byteOffset ?? 0);
  return glb.subarray(start, start + view.byteLength);
}

/** ① with the sword unticked, ② and ③ through the UI, ⑤'s VRM downloaded; returns the character, sword and file. */
async function rigBodyAndExport(
  page: Page,
  onAnimations: (character: string) => Promise<void> = async () => {},
): Promise<{ character: string; sword: string; bytes: Uint8Array }> {
  await openAutoRigReady(page);
  await dropModel(page, 'polybot-sword.glb', new Uint8Array(polybotWithSword()));
  const state = await wizard(page);
  const found = (state.intake as { meshes: string[]; textured: boolean }).meshes;
  expect(found).toHaveLength(2);
  expect((state.intake as { textured: boolean }).textured).toBe(true);
  const names = (await call(page, 'meshes')).filter((mesh) => found.includes(mesh.id));
  const sword = names.find((mesh) => mesh.name === 'Sword')?.id as string;
  const body = found.find((id) => id !== sword) as string;
  const parts = page.getByTestId('ar-parts');
  await expect(parts.locator(`[data-part="${sword}"]`)).toContainText('Looks separate');
  await expect(parts.locator(`[data-part="${sword}"] input`)).not.toBeChecked();
  await expect(parts.locator(`[data-part="${body}"] input`)).toBeChecked();
  expect((await wizard(page)).subject.meshes).toEqual([body]);

  // the unticked sword is hidden while Auto-Rig shows the model, and ②'s panes frame the body without it (AR-D10-1)
  await expect.poll(async () => (await call(page, 'model')).hiddenObjects).toEqual([sword]);
  await nextToMarkers(page);
  await expect
    .poll(async () => Math.abs((await call(page, 'cameraOf', FRONT)).position[0] ?? 1), { timeout: 10_000 })
    .toBeLessThan(0.05);
  await autoRig(page);
  const { character } = await subjectCharacter(page);
  expect((await wizard(page)).done['rig']).toBe(true);
  await primary(page, /Animations/);
  await onStep(page, 'animations');
  await onAnimations(character);
  await primary(page, /Export|Skip/);
  await onStep(page, 'export');
  await exportMeta(page);
  const file = await download(page);
  expect(file.name).toBe('polybot.vrm');
  return { character, sword, bytes: file.bytes };
}

test('AS-AR-6: the sword is unticked, the body alone becomes a clean VRM, the sword stays a scene mesh', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const { character, sword, bytes } = await rigBodyAndExport(page);
  keepExport('as-ar-6-polybot-body.vrm', bytes);
  for (const id of ['humanoid', 'tpose', 'skinned', 'size', 'read-back']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
  }
  expect(await validatorErrors(bytes)).toEqual({ gltf: [], vrm: [] });
  const json = glbJson(bytes) as unknown as { meshes: unknown[]; extensions: Record<string, { specVersion?: string }> };
  expect(json.extensions['VRMC_vrm']?.specVersion).toBe('1.0');
  expect(json.meshes).toHaveLength(1);
  const swordMesh = (await call(page, 'meshes')).find((mesh) => mesh.id === sword);
  expect(swordMesh).toBeDefined();
  expect(swordMesh?.owner ?? []).not.toContain(character);
  // still hidden on ⑤, as the VRM leaves it out (AR-D10-1)
  expect((await call(page, 'model')).hiddenObjects).toEqual([sword]);
});

test('AS-AR-6: the VRM keeps the body’s image texture; ④ and the thumbnail show it (AR-D8-1)', async ({ page }) => {
  test.setTimeout(300_000);
  const { bytes } = await rigBodyAndExport(page, async (character) => {
    // ④'s display (Animate) samples the body's image, not a flat colour.
    await expect
      .poll(async () => await call(page, 'displayTextures', character), { timeout: 20_000 })
      .toEqual({ images: 1, textured: 1 });
  });
  keepExport('as-ar-6-polybot-textured.vrm', bytes);
  const json = glbJson(bytes) as unknown as {
    images?: { name?: string; mimeType?: string }[];
    textures?: { source?: number }[];
    materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
  };
  const images = (json.images ?? []).filter((image) => image.name !== 'thumbnail');
  expect(images.length).toBeGreaterThanOrEqual(1);
  expect(images[0]?.mimeType).toBe('image/png');
  const textured = (json.materials ?? []).filter((m) => m.pbrMetallicRoughness?.baseColorTexture !== undefined);
  expect(textured.length).toBeGreaterThanOrEqual(1);
  // the material samples the body's image (not the thumbnail) through the body's UVs
  const texture = json.textures?.[textured[0]?.pbrMetallicRoughness?.baseColorTexture?.index ?? -1];
  expect(json.images?.[texture?.source ?? -1]?.name).not.toBe('thumbnail');
  expect(Object.keys(json.meshes[0]?.primitives[0]?.attributes ?? {})).toContain('TEXCOORD_0');
  expect(await validatorErrors(bytes)).toEqual({ gltf: [], vrm: [] });
  // The VRM thumbnail is textured: Polybot's green, not the no-palette grey (AR-D8-1).
  const thumb = json.images?.findIndex((image) => image.name === 'thumbnail') ?? -1;
  const png = imageBytes(bytes, thumb);
  const pixels = decodePalettePng(png);
  let green = 0;
  for (let y = 0; y < pixels.height; y += 8) {
    for (let x = 0; x < pixels.width; x += 8) {
      const [r, g, b] = pixels.rgb(x, y) as [number, number, number];
      if (g > r + 20 && g > b + 20) green++;
    }
  }
  expect(green).toBeGreaterThan(200);
});

type Rgb = readonly [number, number, number];
const isGreen = ([r, g, b]: Rgb): boolean => g > r + 30 && g > b + 30;
const isOrange = ([r, g, b]: Rgb): boolean => r > g + 30 && g > b + 15;

/** The share of pixels of a colour (Polybot's green texture by default) in a square around a page point of a pane. */
async function greenShare(
  page: Page,
  paneId: string,
  at: { x: number; y: number },
  half = 12,
  colour: (rgb: Rgb) => boolean = isGreen,
): Promise<number> {
  const read = await call(page, 'pixels', paneId, Math.round(at.x - half), Math.round(at.y - half), 2 * half, 2 * half);
  if (read === null) return 0;
  let hits = 0;
  for (let i = 0; i < read.data.length; i += 4) {
    if (colour([read.data[i] as number, read.data[i + 1] as number, read.data[i + 2] as number])) hits++;
  }
  return hits / (read.data.length / 4);
}

/** FRONT's chest on ②: halfway between the chin and the pelvis markers. */
async function chestOnMarkers(page: Page): Promise<{ x: number; y: number }> {
  const chin = await markerAt(page, 'chin', 'R', FRONT);
  const pelvis = await markerAt(page, 'pelvis', 'R', FRONT);
  return { x: (chin.x + pelvis.x) / 2 + 6, y: (chin.y + pelvis.y) / 2 };
}

test('AR-D8-1: the textured Polybot shows its texture on ② and in ③ Adjust joints (mesh-view draws the image)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await sampleAtMarkers(page, 'polybot-tpose');
  await expect
    .poll(async () => greenShare(page, FRONT, await chestOnMarkers(page)), { timeout: 15_000 })
    .toBeGreaterThan(0.3);
  await autoRig(page);
  const { character } = await subjectCharacter(page);
  await page.getByTestId('ar-rig-adjust').click();
  // the chest again, from the joints: the hips → spine bone, beside the bone line
  const joints = (await call(page, 'skeleton', character))?.joints ?? [];
  const bone = (name: string) => joints.find((joint) => joint.humanBone === name)?.id as string;
  const torso = async (): Promise<{ x: number; y: number }> => {
    const p = await call(page, 'screenOfBone', bone('spine'), bone('chest'), FRONT, 0.5);
    return p === null ? { x: -100, y: -100 } : { x: p.x + 10, y: p.y };
  };
  await expect.poll(async () => greenShare(page, FRONT, await torso()), { timeout: 15_000 }).toBeGreaterThan(0.3);
});

test('AR-D9-1: a flat-colour model keeps its colour on ② and in the VRM and its thumbnail', async ({ page }) => {
  test.setTimeout(300_000);
  await openAutoRigReady(page);
  await dropModel(page, 'polybot-flat.glb', new Uint8Array(polybotFlatColour()));
  await nextToMarkers(page);
  // mesh-view draws the material's base colour factor (no image), not the clay
  await expect
    .poll(async () => greenShare(page, FRONT, await chestOnMarkers(page), 12, isOrange), { timeout: 15_000 })
    .toBeGreaterThan(0.3);
  await autoRig(page);
  await primary(page, /Animations/);
  await onStep(page, 'animations');
  await primary(page, /Export|Skip/);
  await onStep(page, 'export');
  await exportMeta(page);
  const file = await download(page);
  keepExport('ar-d9-1-polybot-flat.vrm', file.bytes);
  expect(await validatorErrors(file.bytes)).toEqual({ gltf: [], vrm: [] });
  const json = glbJson(file.bytes) as unknown as {
    images?: { name?: string }[];
    materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }[];
  };
  // the asset's material, its factor and no image (the thumbnail is the only image)
  const material = json.materials?.find((m) => m.name === 'M_Main');
  expect(material?.pbrMetallicRoughness?.baseColorTexture).toBeUndefined();
  expect(material?.pbrMetallicRoughness?.baseColorFactor?.map((c) => Math.round(c * 100) / 100)).toEqual([
    0.8, 0.4, 0.04, 1,
  ]);
  expect((json.images ?? []).map((image) => image.name)).toEqual(['thumbnail']);
  // the thumbnail is orange, not the no-material grey
  const pixels = decodePalettePng(imageBytes(file.bytes, 0));
  let orange = 0;
  for (let y = 0; y < pixels.height; y += 8) {
    for (let x = 0; x < pixels.width; x += 8) {
      const [r, g, b] = pixels.rgb(x, y) as [number, number, number];
      if (isOrange([r, g, b])) orange++;
    }
  }
  expect(orange).toBeGreaterThan(200);
});
