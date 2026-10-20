import { expect, type Page, test } from '@playwright/test';
import { validatorErrors } from './helpers/g4-export';
import { createPrimitive, setMode } from './helpers/m6a-model';
import { buildSword, glbJson, placeObjects, selectObjects } from './helpers/m6a-model-content';
import { call, expectKernelStarted, lastExport, loadFile, openEditor, runOk, waitForTestApi } from './helpers/test-api';

// AS-LP-S, part B "Prop" (M6A-SPEC §10.3; owner INT): the scripted twin of AS-LP-B. The Handheld template, a cube
// blade with its tip merged to the centre, a cross-guard and a 6-sided handle combined into the hilt (`buildSword`),
// a pommel, the default palette painted on every part, all hard, exported with `ekza/omoba-handheld-v1`: 80–400
// triangles, static, ≤ 16 meshes, the grip block in bounds, no lint, < 100 KB, valid; exported twice and again after
// the project is saved and reopened, the bytes are identical.

const PROFILE = 'ekza/omoba-handheld-v1';

interface Exported {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly lints: unknown[];
}

async function exportSword(page: Page, group: string): Promise<Exported> {
  await runOk(page, 'select.mode', { mode: 'object' });
  await runOk(page, 'file.exportModel', { objects: [group], fileName: 'sword.glb', profile: PROFILE });
  const last = await lastExport(page);
  const lints = await page.evaluate(() => window.__EKZA_ANIMATOR_TEST__?.lastExport()?.lints ?? null);
  if (last === null || lints === null) throw new Error('nothing exported');
  return { bytes: last.bytes, sha256: last.sha256, lints };
}

/** Paints every face of a mesh with a palette slot (face mode, all faces, Assign Colour). */
async function paintAll(page: Page, mesh: string, slot: number): Promise<void> {
  // Entering a component mode hilites the selected objects (§5.6).
  await runOk(page, 'select.mode', { mode: 'object' });
  await selectObjects(page, [mesh]);
  await setMode(page, 'face');
  const faces = (await call(page, 'meshInfo', mesh))?.counts.f ?? 0;
  await runOk(page, 'select.components', {
    mesh,
    kind: 'face',
    indices: Array.from({ length: faces }, (_, f) => f),
    mode: 'replace',
  });
  await expect.poll(async () => (await call(page, 'model')).selected[mesh]?.face?.length ?? 0).toBe(faces);
  await runOk(page, 'mesh.paint', { kind: 'face', slot });
  await setMode(page, 'object');
}

test('AS-LP-S part B — the handheld prop: budget, profile, lints and deterministic bytes', async ({ page }) => {
  test.setTimeout(180_000);
  await openEditor(page, '&ws=model');
  await expectKernelStarted(page);
  const sword = await buildSword(page);

  // The pommel: a small cube under the handle, in the Handheld group.
  await selectObjects(page, [sword.group]);
  const pommel = await createPrimitive(page, 'cube', { width: 0.035, height: 0.03, depth: 0.035 });
  await placeObjects(page, { [pommel]: [0, -0.095, 0] });
  const parts = [sword.blade, sword.hilt, pommel];
  for (const id of parts) {
    expect((await call(page, 'meshes')).find((row) => row.id === id)?.parent).toBe(sword.group);
  }

  // One palette (the default one), every part painted, all hard (new meshes are faceted, §5.3).
  await paintAll(page, sword.blade, 7);
  await paintAll(page, sword.hilt, 4);
  await paintAll(page, pommel, 11);
  const rows = (await call(page, 'meshes')).filter((row) => parts.includes(row.id));
  expect(new Set(rows.map((row) => row.palette)).size).toBe(1);
  expect(rows.every((row) => row.faceted)).toBe(true);

  // Export twice: identical bytes; then the checks of AS-LP-B.
  const first = await exportSword(page, sword.group);
  const second = await exportSword(page, sword.group);
  expect(second.sha256).toBe(first.sha256);
  expect(first.lints).toEqual([]);
  expect(first.bytes.byteLength).toBeLessThan(100 * 1024);
  expect(await validatorErrors(new Uint8Array(first.bytes))).toEqual([]);
  const json = glbJson(new Uint8Array(first.bytes)) as {
    asset: { extras?: Record<string, unknown> };
    skins?: unknown[];
    animations?: unknown[];
    meshes: { primitives: { indices?: number; attributes: Record<string, number> }[] }[];
    accessors: { count: number }[];
    materials?: unknown[];
  };
  expect(json.skins ?? []).toHaveLength(0);
  expect(json.animations ?? []).toHaveLength(0);
  expect(json.meshes.length).toBeLessThanOrEqual(16);
  let triangles = 0;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      triangles += (json.accessors[primitive.indices ?? primitive.attributes['POSITION'] ?? -1]?.count ?? 0) / 3;
    }
  }
  test.info().annotations.push({ type: 'prop triangles', description: String(triangles) });
  expect(triangles).toBeGreaterThanOrEqual(80);
  expect(triangles).toBeLessThanOrEqual(400);
  const grip = json.asset.extras?.['ekza_handheld_v1'] as
    | { bone: string; offset: number[]; rotation_degrees: number[]; scale: number }
    | undefined;
  expect(['rightHand', 'leftHand']).toContain(grip?.bone);
  for (const c of grip?.offset ?? [Number.NaN]) expect(Math.abs(c)).toBeLessThanOrEqual(0.3);
  for (const c of grip?.rotation_degrees ?? [Number.NaN]) expect(Math.abs(c)).toBeLessThanOrEqual(360);
  expect(grip?.scale).toBeGreaterThanOrEqual(0.25);
  expect(grip?.scale).toBeLessThanOrEqual(2);

  // Save, reopen the project in a fresh page state, export again: the same bytes.
  const saved = await runOk<{ fileName: string }>(page, 'file.save');
  const project = await lastExport(page);
  if (project === null) throw new Error('nothing saved');
  await page.reload();
  await waitForTestApi(page);
  await loadFile(page, saved.fileName, new Uint8Array(project.bytes));
  await expect
    .poll(async () => (await call(page, 'meshes')).filter((row) => parts.includes(row.id)).map((row) => row.runtime))
    .toEqual(['ready', 'ready', 'ready']);
  const reopened = await exportSword(page, sword.group);
  expect(reopened.sha256).toBe(first.sha256);
});
