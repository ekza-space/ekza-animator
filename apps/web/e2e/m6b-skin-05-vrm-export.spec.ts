import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setGltfValidator, validateGltf } from '@ekza-studio/io';
import { expect, test } from '@playwright/test';
import * as gltfValidator from 'gltf-validator';
import { sampleBytes } from './helpers/g4-export';
import { createPrimitive, enterModel } from './helpers/m6a-model';
import { checkCharacter, exportCharacterFile, glbJson } from './helpers/m6b-character-writer';
import { buildCubeLad } from './helpers/m6b-cube-lad';
import { enterRig } from './helpers/m6b-rig';
import { call, expectKernelStarted, loadFile, openEditor, runOk, waitForTestApi } from './helpers/test-api';

// E2E-SKIN-05 (M6B-SPEC §0.7, §10.1; owner C10): VRM 1.0 export. The bound Cube Lad with a Blinn torso, VRM meta
// (author, CC0), a rendered thumbnail and an idle slot clip exports through `ekza/space-avatar-v1` with every vrm.*
// lint clean and glTF-Validator 0 errors; three-vrm loads it, resolves every humanoid bone and plays a VRMA idle
// (`/e2e/character-check`); the meta holds the CC0 preset and the VRM licence URL, the thumbnail is 1024 × 1024, the
// Blinn swatch is in extensionsUsed only; three exports (twice, then after save and reopen) are byte-identical; the
// Export dialog shows the OMOBA/Space banner. Gates c2, c4, c7 (the bound Cube Lad needs the template and the bind;
// the dialog's Validation rows are C7's). Ungated now: the Character section, the VRM meta and the thumbnail through
// the UI on a model character, and the character check route on a VRM 1.0 sample.

const GATES = 'c2, c4, c7';
const BANNER = 'OMOBA plays its own motion library on your VRM; your clips play in Space.';

setGltfValidator(gltfValidator);

/** A character made from a cube in Rig & Skin (C1's `char.fromModel`): no skeleton yet. */
async function cubeCharacter(page: Parameters<typeof openEditor>[0]): Promise<string> {
  await enterModel(page);
  const mesh = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await enterRig(page);
  const { character } = await runOk<{ character: string }>(page, 'char.fromModel', {
    objects: [mesh],
    name: 'Box Lad',
  });
  return character;
}

test('E2E-SKIN-05 (MVP part): the Character section, VRM meta and thumbnail through the UI', async ({ page }) => {
  test.setTimeout(120_000);
  await openEditor(page);
  await expectKernelStarted(page);
  await cubeCharacter(page);
  await runOk(page, 'ui.open', { dialog: 'export' });
  const section = page.getByTestId('export-character');
  await expect(section).toBeVisible();
  await expect(page.getByTestId('export-char-banner')).toHaveText(BANNER);
  await expect(page.getByTestId('export-char-profile')).toHaveValue('ekza/space-avatar-v1');
  await expect(page.getByTestId('export-char-format')).toHaveValue('vrm');
  await expect(page.getByTestId('export-char-format')).toBeDisabled();
  // Without a skeleton the export is blocked with the next step.
  await expect(page.getByTestId('export-confirm')).toBeDisabled();
  await expect(page.getByTestId('export-char-blocked')).toHaveText(
    'Create the skeleton first (Rig & Skin › Quick Rig)',
  );
  // The VRM meta rows (§5.21) until a licence and an author are chosen.
  await expect(section).toContainText('vrm.licence-unset');
  await expect(section).toContainText('vrm.meta-required');
  const history = await call(page, 'history');
  await page.getByTestId('vrm-licence-cc0').click();
  await expect(page.getByTestId('export-char-row-vrm.licence-unset')).toHaveCount(0);
  const authors = page.getByTestId('vrm-meta-authors');
  await authors.fill('Tester');
  await authors.press('Enter');
  await expect(page.getByTestId('export-char-row-vrm.meta-required')).toHaveCount(0);
  expect((await call(page, 'history')).undo.length).toBe(history.undo.length + 2);
  // Render Thumbnail: one step, the warning row gone.
  await expect(page.getByTestId('export-char-row-vrm.thumbnail-square')).toBeVisible();
  await page.getByTestId('export-char-thumb-render').click();
  await expect(page.getByTestId('export-char-row-vrm.thumbnail-square')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('export-char-thumb-image')).toBeVisible();
  expect((await call(page, 'history')).undo.length).toBe(history.undo.length + 3);
});

test('E2E-SKIN-05 (MVP part): /e2e/character-check loads a VRM 1.0, resolves its bones and plays a VRMA idle', async ({
  browser,
}, testInfo) => {
  const check = await checkCharacter(browser, testInfo, sampleBytes('seed-san.vrm'));
  expect(check.metaVersion).toBe('1');
  expect(check.humanoid.length).toBeGreaterThanOrEqual(15);
  expect(check.unresolved).toEqual([]);
  expect(check.vrmaPlayed).toBe(true);
  expect(check.skinnedMeshes).toBeGreaterThan(0);
});

test.fixme(`E2E-SKIN-05: VRM 1.0 export of the bound Cube Lad (gates: ${GATES})`, async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  await openEditor(page);
  await expectKernelStarted(page);
  // The bound Cube Lad: Standard 33 from the template, one-click bind.
  const mesh = await buildCubeLad(page);
  await enterRig(page);
  const made = await runOk<{ character: string }>(page, 'skel.template.create', {
    preset: 'standard33',
    objects: [mesh],
  });
  const character = made.character;
  await runOk(page, 'skin.bind', {});
  const bound = (await call(page, 'characters')).find((c) => c.id === character)?.meshes[0] ?? '';
  // A Blinn swatch on the whole mesh (Assign New Material makes it lit).
  await runOk(page, 'palette.assignMaterial', { shader: 'blinn', meshes: [bound] });
  await runOk(page, 'char.setVrmMeta', { character, patch: { authors: ['Tester'], licensePreset: 'cc0' } });
  await runOk(page, 'char.renderThumbnail', { character });
  // Animate: an idle slot clip (1 s).
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', {
    character,
    name: 'Idle',
    range: { start: 0, end: 30 },
  });
  await runOk(page, 'clip.setSettings', { clip, slot: 'idle', loop: true });
  await runOk(page, 'key.set', { target: 'character' });

  // The banner and the clean Validation in the dialog.
  await runOk(page, 'workspace.set', { workspace: 'rig' });
  await runOk(page, 'ui.open', { dialog: 'export' });
  await expect(page.getByTestId('export-char-banner')).toHaveText(BANNER);
  await expect(page.getByTestId('export-char-clean')).toBeVisible();
  await expect(page.getByTestId('export-confirm')).toBeEnabled();
  await page.keyboard.press('Escape');

  const args = { character, format: 'vrm', profile: 'ekza/space-avatar-v1', clips: 'slots' };
  const first = await exportCharacterFile(page, args);
  expect(first.artifact.kind).toBe('character');
  expect(first.artifact.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
  expect(first.artifact.readBack).toMatchObject({
    ok: true,
    kind: 'character',
    humanoid: 33,
    humanoidEqual: true,
    fingerprintEqual: true,
  });
  const report = await validateGltf(first.bytes);
  expect(report.issues.filter((issue) => issue.severity === 0)).toEqual([]);
  const json = glbJson(first.bytes);
  expect(json['extensionsUsed']).toContain('KHR_materials_specular');
  expect(json['extensionsRequired'] ?? []).not.toContain('KHR_materials_specular');
  const vrmc = (json['extensions'] as Record<string, Record<string, unknown>>)['VRMC_vrm'] ?? {};
  expect(vrmc['specVersion']).toBe('1.0');
  expect(vrmc['meta']).toMatchObject({
    authors: ['Tester'],
    licenseUrl: 'https://vrm.dev/licenses/1.0/',
    avatarPermission: 'everyone',
    commercialUsage: 'corporation',
    modification: 'allowModificationRedistribution',
    allowRedistribution: true,
    creditNotation: 'unnecessary',
    otherLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  });
  const check = await checkCharacter(browser, testInfo, first.bytes);
  expect(check.unresolved).toEqual([]);
  expect(check.vrmaPlayed).toBe(true);
  expect(check.meta.thumbnail).toEqual({ width: 1024, height: 1024 });
  expect(check.clips).toEqual(['idle']);
  const readBack = first.artifact.readBack as { tris: number; joints: number };
  expect(check.tris).toBe(readBack.tris);
  expect(check.joints).toBe(readBack.joints);

  // Determinism (P-W2): again, then after save and reopen.
  const second = await exportCharacterFile(page, args);
  expect(second.artifact.sha256).toBe(first.artifact.sha256);
  const download = page.waitForEvent('download');
  const saved = await runOk<{ fileName: string }>(page, 'file.save');
  const project = new Uint8Array(readFileSync(await (await download).path()));
  expect(saved.fileName).toMatch(/\.ekzanim$/);
  await page.reload();
  await waitForTestApi(page);
  await loadFile(page, saved.fileName, project);
  const third = await exportCharacterFile(page, args);
  expect(third.artifact.sha256).toBe(first.artifact.sha256);
  expect(createHash('sha256').update(third.bytes).digest('hex')).toBe(first.artifact.sha256);
});
