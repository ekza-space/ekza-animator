import { parseGlb, setGltfValidator, validateGltf } from '@ekza-studio/io';
import { expect, test } from '@playwright/test';
import * as gltfValidator from 'gltf-validator';
import {
  characterRequest,
  checkOf,
  download,
  gotoExport,
  keepExport,
  riggedCubeLad,
  setAuthorAndLicence,
  studioExport,
  thumbnailRendered,
  useClips,
} from './helpers/ar-export';
import { expectStudioShown } from './helpers/ar-host';
import { autorig, history } from './helpers/autorig';
import { call, run, runOk } from './helpers/test-api';

// E2E-AR-07 (AUTORIG-SPEC §10 D6, §5.6; AS-AR-1 step 9): ⑤ through the UI on the rigged Cube Lad with two library
// clips. The thumbnail renders on the first entry; the checklist names the missing author and licence as errors and
// Download stays disabled; C10's fields fix them (one undo step each); Download writes `cube-lad.vrm` with every
// `vrm.*` lint clean and 0 glTF-Validator errors, the column then shows the file's measures; the same request run by
// `file.exportCharacter` from Studio on the same page gives the same SHA-256 (FR-AR-12). An error saves nothing and
// says why; *Continue in Studio* opens Animate on the same document.

setGltfValidator(gltfValidator);

test('AS-AR-1 step 9: the Ekza avatar VRM of the Cube Lad, byte-equal to Studio’s export', async ({ page }) => {
  test.setTimeout(240_000);
  const character = await riggedCubeLad(page);
  await useClips(page, character, ['walk', 'idle']);
  await gotoExport(page);
  await thumbnailRendered(page);

  // the recommended target; the checklist before a download
  await expect(page.getByTestId('ar-export-target-ekza-vrm')).toHaveAttribute('data-state', 'checked');
  await expect(page.getByTestId('ar-export-target-ekza-vrm')).toContainText('Ekza avatar · VRM 1.0');
  await expect(page.getByTestId('ar-export-target-omoba-kit')).toHaveCount(0); // under For developers
  await expect(page.getByTestId('ar-export-hub-note')).toHaveText(
    'Upload this file to Ekza Hub to use it in OMOBA online.',
  );
  await expect(page.getByTestId('ar-export-omoba-note')).toHaveText(
    'OMOBA plays its own motion library on your VRM; your clips play in Space.',
  );
  await expect(page.getByText(/Publish to Ekza Hub/)).toHaveCount(0);
  await expect(checkOf(page, 'meta')).toHaveAttribute('data-state', 'error');
  await expect(checkOf(page, 'licence')).toHaveAttribute('data-state', 'error');
  await expect(checkOf(page, 'thumbnail')).toHaveAttribute('data-state', 'ok');
  for (const id of ['humanoid', 'required-bones', 'parents', 'tpose', 'skinned', 'transforms']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
  }
  await expect(checkOf(page, 'tpose')).toContainText('T-pose rest');
  for (const id of ['size', 'nodes', 'bones', 'extensions', 'read-back']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'pending');
  }
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  await expect(page.getByTestId('ar-status')).toHaveText('Fix first: Name and author set');

  // the meta rows' Fix focuses the field beside the checklist (no Studio dialog); the thumbnail is already rendered
  await expect(page.getByTestId('ar-export-fix-meta')).toHaveText('Add author');
  await expect(page.getByTestId('ar-export-fix-licence')).toHaveText('Choose licence');
  await expect(page.getByTestId('ar-export-fix-thumbnail')).toHaveCount(0);
  await page.getByTestId('ar-export-fix-meta').click();
  await expect(page.getByTestId('vrm-meta-authors')).toBeFocused();
  // C10's fields: one undo step per committed edit
  const before = (await history(page)).undo.length;
  await setAuthorAndLicence(page);
  expect((await history(page)).undo.length).toBe(before + 2);
  await expect(page.getByTestId('ar-status')).toHaveText('cube-lad.vrm · ready');
  const steps = await history(page);

  const file = await download(page);
  expect(file.name).toBe('cube-lad.vrm');
  expect(await history(page)).toEqual(steps); // a download is no undo step
  keepExport('ar-07-cube-lad.vrm', file.bytes);
  const report = await validateGltf(file.bytes);
  expect(report.issues.filter((issue) => issue.severity === 0)).toEqual([]);
  const json = (await parseGlb(file.bytes)).json as Record<string, unknown>;
  const vrmc = (json['extensions'] as Record<string, Record<string, unknown>>)['VRMC_vrm'] ?? {};
  expect(vrmc['specVersion']).toBe('1.0');
  expect(vrmc['meta']).toMatchObject({ name: 'Cube Lad', authors: ['Tester'] });
  expect((json['animations'] as { name: string }[]).map((a) => a.name).sort()).toEqual(['idle', 'walk']);

  // after the download: the byte checks with their measures, the result line, the slice
  for (const id of ['size', 'nodes', 'bones', 'extensions', 'read-back', 'meta', 'licence', 'tpose']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
  }
  await expect(checkOf(page, 'size')).toContainText(/^.*File \d+(\.\d)? (MiB|KiB) \/ 50 MiB · JSON \d+ KiB/);
  await expect(checkOf(page, 'nodes')).toContainText(/\d+ \/ 4,096 nodes/);
  await expect(checkOf(page, 'bones')).toContainText('33 of 64 humanoid bones');
  await expect(page.getByTestId('ar-export-result')).toContainText('Saved cube-lad.vrm');
  await expect(page.getByTestId('ar-status')).toHaveText(/^cube-lad\.vrm · \d/);
  expect((await autorig(page))?.slices['export']).toEqual({ target: 'ekza-vrm', downloaded: true });
  expect(await page.evaluate(() => localStorage.getItem('ekza-studio:autorig:author:v1'))).toBe('Tester');

  // FR-AR-12: Studio's file.exportCharacter with the same request, on the same page and document
  await runOk(page, 'autorig.navigate', { to: 'studio', workspace: 'rig' });
  await expectStudioShown(page);
  const [studio] = await studioExport(
    page,
    'file.exportCharacter',
    characterRequest(character, 'ekza-vrm', 'cube-lad'),
  );
  expect(studio?.fileName).toBe('cube-lad.vrm');
  expect(studio?.sha256).toBe(file.sha);
});

test('an error saves nothing: Download stays disabled, a scripted export toasts why and downloads no file', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const character = await riggedCubeLad(page);
  await gotoExport(page);
  await thumbnailRendered(page);
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  let downloads = 0;
  page.on('download', () => {
    downloads += 1;
  });
  // the same composition from a script or the palette: it writes, lints and refuses the save
  const result = await run(page, 'autorig.export', { character, target: 'ekza-vrm', fileName: '' });
  expect(result.status).toBe('finished');
  const value = result.value as { fileName: string; lints: { code: string; severity: string }[] };
  expect(value.fileName).toBe('cube-lad.vrm');
  expect(value.lints.filter((lint) => lint.severity === 'error').map((lint) => lint.code)).toEqual([
    'vrm.meta-required',
    'vrm.licence-unset',
  ]);
  await expect(page.getByTestId('toast').getByText(/cube-lad\.vrm was not saved: Set the VRM meta/)).toBeVisible();
  // the kit is blocked with the VRM
  const kit = await run(page, 'autorig.export', { character, target: 'omoba-kit', fileName: '' });
  expect((kit.value as { fileName: string }).fileName).toBe('cube-lad-omoba-kit.zip');
  await expect(page.getByTestId('toast').getByText(/cube-lad-omoba-kit\.zip was not saved/)).toBeVisible();
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  expect(await call(page, 'lastExport')).toBeNull();
});

test('Continue in Studio opens Animate on the same document and history', async ({ page }) => {
  test.setTimeout(120_000);
  await riggedCubeLad(page);
  await gotoExport(page);
  await thumbnailRendered(page);
  const steps = await history(page);
  const link = page.getByTestId('ar-export-continue-studio');
  await expect(link).toHaveAttribute('href', '/editor?ws=animate');
  await link.click();
  await expectStudioShown(page);
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('animate');
  expect(await history(page)).toEqual(steps);
});
