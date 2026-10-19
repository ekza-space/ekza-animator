import { expect, test } from '@playwright/test';
import { buildSword, glbJson } from './helpers/m6a-model-content';
import { modKey, openModel } from './helpers/m6a-model';
import { expectKernelStarted, lastExport } from './helpers/test-api';
import { validatorErrors } from './helpers/g4-export';

// E2E-MOD-13 (M6A-SPEC §10.1, §5.16, §5.22; owner B13, gates b3, b4, b12a): the Handheld template and a scripted
// sword (`buildSword`), exported from the Export dialog's Static model section with the `ekza/omoba-handheld-v1`
// profile: no lint, only the unlit and texture-transform extensions, the handheld extras in bounds, static, < 100 KB,
// valid, 80–400 triangles.

const ALLOWED_EXTENSIONS = new Set(['KHR_materials_unlit', 'KHR_texture_transform']);

/** Every `extensions` key anywhere in a glTF JSON. */
function extensionKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value as unknown[]) extensionKeys(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'extensions' && child !== null && typeof child === 'object') {
        for (const name of Object.keys(child)) out.add(name);
      }
      extensionKeys(child, out);
    }
  }
  return out;
}

test.fixme('b3, b4, b12a: E2E-MOD-13 — handheld sword', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const sword = await buildSword(page);

  await page.mouse.move(400, 400);
  await page.keyboard.press(`${await modKey(page)}+Shift+KeyE`);
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-static').click();
  await expect(page.getByTestId('export-static-profile')).toHaveValue('ekza/omoba-handheld-v1');
  await page.getByTestId('export-static-confirm').click();
  await expect(page.getByTestId('export-static-size')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('export-static-lints')).toHaveCount(0);

  const exported = await lastExport(page);
  if (exported === null) throw new Error('nothing exported');
  const bytes = new Uint8Array(exported.bytes);
  expect(bytes.byteLength).toBeLessThan(100 * 1024);
  const json = glbJson(bytes) as {
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    asset: { extras?: Record<string, unknown> };
    skins?: unknown[];
    animations?: unknown[];
    meshes: { primitives: { indices?: number; attributes: Record<string, number> }[] }[];
    accessors: { count: number }[];
  };
  for (const name of [...extensionKeys(json), ...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]) {
    expect(ALLOWED_EXTENSIONS.has(name), name).toBe(true);
  }
  const grip = json.asset.extras?.['ekza_handheld_v1'] as
    | { bone: string; offset: number[]; rotationDegrees: number[]; scale: number }
    | undefined;
  expect(grip).toBeDefined();
  expect(['rightHand', 'leftHand']).toContain(grip?.bone);
  for (const c of grip?.offset ?? []) expect(Math.abs(c)).toBeLessThanOrEqual(0.3);
  for (const c of grip?.rotationDegrees ?? []) expect(Math.abs(c)).toBeLessThanOrEqual(360);
  expect(grip?.scale).toBeGreaterThanOrEqual(0.25);
  expect(grip?.scale).toBeLessThanOrEqual(2);
  expect(json.skins ?? []).toHaveLength(0);
  expect(json.animations ?? []).toHaveLength(0);
  let triangles = 0;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      const count = json.accessors[primitive.indices ?? primitive.attributes['POSITION'] ?? -1]?.count ?? 0;
      triangles += count / 3;
    }
  }
  expect(triangles).toBeGreaterThanOrEqual(80);
  expect(triangles).toBeLessThanOrEqual(400);
  expect(await validatorErrors(bytes)).toEqual([]);
  expect(sword.group).toMatch(/^grp_/);
});
