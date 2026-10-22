// AUTORIG-SPEC §11 AS-AR-6 (D7, in full; D3 and D6 own its parts): "Several meshes and textures". A textured two-mesh
// scene (Polybot and a box "Sword" on the floor) dropped on ①: the box is unticked by default and left out of the
// subject; the body is rigged through ② and ③; ⑤ writes a clean VRM of the body alone and the sword stays a scene mesh;
// the VRM keeps the body's image texture (C10's writer copies the adopted asset material, AR-D7-15).
import { expect, type Page, test } from '@playwright/test';
import { dropModel, exportMeta, nextToMarkers, onStep, primary } from './helpers/ar-as';
import { checkOf, download, keepExport } from './helpers/ar-export';
import { openAutoRigReady } from './helpers/ar-host';
import { polybotWithSword } from './helpers/ar-model';
import { wizard } from './helpers/ar-markers';
import { autoRig, subjectCharacter } from './helpers/ar-rig';
import { glbJson } from './helpers/g1-viewport';
import { validatorErrors } from './helpers/m6b-mvp-script';
import { call } from './helpers/test-api';

/** ① with the sword unticked, ② and ③ through the UI, ⑤'s VRM downloaded; returns the character, sword and file. */
async function rigBodyAndExport(page: Page): Promise<{ character: string; sword: string; bytes: Uint8Array }> {
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

  await nextToMarkers(page);
  await autoRig(page);
  const { character } = await subjectCharacter(page);
  expect((await wizard(page)).done['rig']).toBe(true);
  await primary(page, /Animations/);
  await onStep(page, 'animations');
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
});

test('AS-AR-6: the VRM keeps the body’s image texture', async ({ page }) => {
  test.setTimeout(300_000);
  const { bytes } = await rigBodyAndExport(page);
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
});
