import {
  BUILTIN_EXPORT_PROFILES,
  lintExport,
  lintVrmBytes,
  ruleSeverity,
  setGltfValidator,
  validateGltf,
} from '@ekza-studio/io';
import { expect, test } from '@playwright/test';
import * as gltfValidator from 'gltf-validator';
import { sampleBytes } from './helpers/g4-export';
import { createPrimitive, enterModel } from './helpers/m6a-model';
import { exportCharacterFile, glbJson, runExportCharacter, withGlbJson } from './helpers/m6b-character-writer';
import { buildCubeLad } from './helpers/m6b-cube-lad';
import { enterRig } from './helpers/m6b-rig';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-SKIN-06 (M6B-SPEC §0.7; owner C10): a plain GLB is local only. For a character made from a model the Export
// dialog offers `ekza/space-avatar-v1` (VRM 1.0 only) and `local/generic` (VRM or GLB) — never the OMOBA five-clip
// GLB profile; the bound Cube Lad through `local/generic` + GLB writes no VRMC_vrm and passes its lints; a fixture VRM
// with `extensionsRequired: ['KHR_draco_mesh_compression']` read through the vrm.* lints gives
// `vrm.extensions-required` (OMOBA's rule). Gates c2, c4, c7 for the bound Cube Lad; the dialog's profile list and
// the lint fixture run now.

const GATES = 'c2, c4, c7';
const SPACE = BUILTIN_EXPORT_PROFILES.find((profile) => profile.id === 'ekza/space-avatar-v1') ?? null;
const LOCAL = BUILTIN_EXPORT_PROFILES.find((profile) => profile.id === 'local/generic') ?? null;

setGltfValidator(gltfValidator);

test('E2E-SKIN-06 (MVP part): a VRM with a required Draco extension fails vrm.extensions-required', async () => {
  const bytes = withGlbJson(sampleBytes('polybot.vrm'), (json) => {
    json['extensionsRequired'] = ['KHR_draco_mesh_compression'];
    json['extensionsUsed'] = [
      ...((json['extensionsUsed'] as string[] | undefined) ?? []),
      'KHR_draco_mesh_compression',
    ];
  });
  // The untouched Polybot (VRM 0.x) passes every OMOBA rule; the Draco one fails exactly that rule.
  expect(lintVrmBytes(sampleBytes('polybot.vrm'), (code) => ruleSeverity(code, SPACE))).toEqual([]);
  const issues = lintVrmBytes(bytes, (code) => ruleSeverity(code, SPACE));
  expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([['vrm.extensions-required', 'error']]);
  expect(issues[0]?.message).toMatch(/^Required extension KHR_draco_mesh_compression is unsupported/);
  // Through the export lints: an error for the Space profile, a warning locally.
  const space = (await lintExport('bake-into-model', bytes, SPACE)).filter((lint) => lint.code.startsWith('vrm.'));
  expect(space.map((lint) => `${lint.code}:${lint.severity}`)).toEqual(['vrm.extensions-required:error']);
  const local = (await lintExport('bake-into-model', bytes, LOCAL)).filter((lint) => lint.code.startsWith('vrm.'));
  expect(local.map((lint) => `${lint.code}:${lint.severity}`)).toEqual(['vrm.extensions-required:warning']);
});

test('E2E-SKIN-06 (MVP part): the Export dialog offers the Space profile and local/generic only', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await enterModel(page);
  const mesh = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await enterRig(page);
  const { character } = await runOk<{ character: string }>(page, 'char.fromModel', { objects: [mesh] });
  await runOk(page, 'ui.open', { dialog: 'export' });
  const profile = page.getByTestId('export-char-profile');
  await expect(profile.locator('option')).toHaveText([
    'Ekza avatar — Space and OMOBA (VRM 1.0)',
    'Local file (generic checks)',
  ]);
  await expect(page.getByTestId('export-char-format').locator('option')).toHaveText(['VRM 1.0']);
  await profile.selectOption('local/generic');
  const format = page.getByTestId('export-char-format');
  await expect(format).toBeEnabled();
  await expect(format.locator('option')).toHaveText(['VRM 1.0', 'Plain GLB (no VRM)']);
  await format.selectOption('glb');
  // The VRM meta rows belong to VRM exports through the Space profile: none here.
  await expect(page.getByTestId('vrm-meta-fields')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The operator refuses the OMOBA five-clip profile and a plain GLB through the Space profile.
  const omoba = await runExportCharacter(page, { character, profile: 'ekza/omoba-humanoid-v1' });
  expect(omoba.result.reason).toMatch(/^OMOBA plays its own motion library on a VRM/);
  const plainSpace = await runExportCharacter(page, { character, profile: 'ekza/space-avatar-v1', format: 'glb' });
  expect(plainSpace.result.reason).toMatch(/a plain GLB goes through "Local file \(generic checks\)"/);
});

test.fixme(`E2E-SKIN-06: the bound Cube Lad as a plain GLB through local/generic (gates: ${GATES})`, async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openEditor(page);
  await expectKernelStarted(page);
  const mesh = await buildCubeLad(page);
  await enterRig(page);
  const { character } = await runOk<{ character: string }>(page, 'skel.template.create', {
    preset: 'standard33',
    objects: [mesh],
  });
  await runOk(page, 'skin.bind', {});
  const { artifact, bytes } = await exportCharacterFile(page, { character, profile: 'local/generic', format: 'glb' });
  expect(artifact.fileName).toMatch(/\.glb$/);
  const json = glbJson(bytes);
  expect(json['extensions']).toBeUndefined();
  expect(JSON.stringify(json['extensionsUsed'] ?? [])).not.toContain('VRMC_vrm');
  expect(artifact.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
  expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
  const report = await validateGltf(bytes);
  expect(report.issues.filter((issue) => issue.severity === 0)).toEqual([]);
  expect(artifact.readBack).toMatchObject({ ok: true, jointsEqual: true, fingerprintEqual: true, humanoidEqual: null });
  expect((await call(page, 'characters')).find((c) => c.id === character)?.source).toBe('model');
});
