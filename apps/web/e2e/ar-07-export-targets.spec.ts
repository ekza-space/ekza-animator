import { parseGlb, pngSize, stageVrmForOmoba, unzipFiles } from '@ekza-studio/io';
import { expect, type Page, test } from '@playwright/test';
import {
  characterRequest,
  checkOf,
  chooseTarget,
  clipIds,
  download,
  fileExportRequest,
  gotoExport,
  keepExport,
  riggedCubeLad,
  setAuthorAndLicence,
  sha256,
  studioExport,
  thumbnailRendered,
  useClips,
} from './helpers/ar-export';
import { openAutoRigReady } from './helpers/ar-host';
import { chooseFile, fixtureBytes, polybotWithSword, waitForReport } from './helpers/ar-model';
import { autorig } from './helpers/autorig';
import { expectOmobaEntry, readKit } from './helpers/omoba-kit';
import { call, runOk } from './helpers/test-api';

// E2E-AR-07 (AUTORIG-SPEC §10 D6, §5.6.1, §5.6.4; AS-AR-4 and AS-AR-6 ⑤ parts): the other targets through the UI.
// The GLB equals `file.exportCharacter` through local/generic with every clip; the VRMA target saves one .vrma per
// clip (zipped when several), each equal to `file.export` kind vrma; the OMOBA kit (under *For developers*) holds the
// VRM target's bytes as OMOBA's local import stages them (VRM 1.0 turned to rest facing −Z, CHARACTER-CONTRACT-SPEC
// P-4), the 1024 px thumbnail and a manifest entry in OMOBA's field names; an imported VRM
// offers the Space bake, VRMA and the kit once it has a clip (never a plain GLB), byte-equal to `file.export`'s bake;
// a textured body rigged without the sword next to it keeps its texture in the VRM.

const DEG = Math.PI / 180;

test('GLB with animations and the VRMA clips, byte-equal to Studio’s exports', async ({ page }) => {
  test.setTimeout(240_000);
  const character = await riggedCubeLad(page);
  await useClips(page, character, ['walk', 'idle']);
  await gotoExport(page);
  await thumbnailRendered(page);
  const clips = (await clipIds(page, character)).filter((clip) => clip.name === 'Walk' || clip.name === 'Idle');
  expect(clips.map((clip) => clip.name)).toEqual(['Walk', 'Idle']);

  // GLB: local/generic, no VRM meta needed, every clip in order
  await chooseTarget(page, 'glb');
  await expect(page.getByTestId('ar-export-meta')).toHaveCount(0);
  await expect(checkOf(page, 'meta')).toHaveCount(0);
  await expect(page.getByTestId('ar-status')).toHaveText('cube-lad.glb · ready');
  const glb = await download(page);
  expect(glb.name).toBe('cube-lad.glb');
  const json = (await parseGlb(glb.bytes)).json as Record<string, unknown>;
  expect(json['extensions']).toBeUndefined();
  expect((json['animations'] as unknown[]).length).toBe(2);
  const [studioGlb] = await studioExport(
    page,
    'file.exportCharacter',
    characterRequest(
      character,
      'glb',
      'cube-lad',
      clips.map((clip) => clip.id),
    ),
  );
  expect(studioGlb?.sha256).toBe(glb.sha);

  // VRMA: two clips → one zip of two .vrma files
  await chooseTarget(page, 'vrma');
  await expect(page.getByTestId('ar-export-target-vrma')).toContainText('2 clips → cube-lad-animations.zip');
  await expect(page.getByTestId('ar-export-vrma-clips')).toHaveText('2 clips, one .vrma file each');
  const vrma = await download(page);
  expect(vrma.name).toBe('cube-lad-animations.zip');
  const files = unzipFiles(vrma.bytes);
  expect(Object.keys(files)).toEqual(['cube-lad-walk.vrma', 'cube-lad-idle.vrma']);
  const studioVrma = await studioExport(
    page,
    'file.export',
    fileExportRequest(
      character,
      'vrma',
      'cube-lad',
      clips.map((clip) => clip.id),
      clips.every((clip) => clip.loop),
      null,
    ),
  );
  expect(studioVrma.map((a) => [a.fileName, a.sha256])).toEqual(
    Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)]),
  );
  expect((await autorig(page))?.slices['export']).toEqual({ target: 'vrma', downloaded: true });
});

test('the OMOBA local test kit: the VRM staged for OMOBA, the thumbnail, OMOBA’s manifest fields', async ({ page }) => {
  test.setTimeout(240_000);
  const character = await riggedCubeLad(page);
  await useClips(page, character, ['idle']);
  await gotoExport(page);
  await thumbnailRendered(page);
  await setAuthorAndLicence(page);
  const vrm = await download(page);
  expect(vrm.name).toBe('cube-lad.vrm');

  await chooseTarget(page, 'omoba-kit');
  await expect(page.getByTestId('ar-export-developers')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('ar-export-meta')).toBeVisible();
  await expect(page.getByTestId('ar-status')).toHaveText('cube-lad-omoba-kit.zip · ready');
  const kitFile = await download(page);
  expect(kitFile.name).toBe('cube-lad-omoba-kit.zip');
  keepExport('ar-07-cube-lad-omoba-kit.zip', kitFile.bytes);
  const kit = readKit(kitFile.bytes);
  expect(kit.files).toEqual(['cube-lad.glb', 'cube-lad.png', 'manifest-entry.json', 'README.txt']);
  // P-4: the VRM 1.0 rests facing +Z; the kit holds it turned to −Z as OMOBA's convert_vrm_to_glb.py stages it
  const staged = stageVrmForOmoba(vrm.bytes);
  expect(staged.turned).toBe(true);
  expect(sha256(kit.bytes['cube-lad.glb'] as Uint8Array)).toBe(sha256(staged.bytes));
  expect((await parseGlb(kit.bytes['cube-lad.glb'] as Uint8Array)).json.asset.extras?.['omoba_rest_yaw180']).toBe(true);
  expect(pngSize(kit.bytes['cube-lad.png'] as Uint8Array)).toEqual({ width: 1024, height: 1024 });
  expectOmobaEntry(kit, 'cube-lad');
  expect(kit.entry).toEqual({
    author: 'Tester',
    collection: 'Ekza Studio',
    display_name: 'Cube Lad',
    license: 'CC0',
    slug: 'cube-lad',
    source_url: '',
    thumbnail: 'cube-lad.png',
  });
  // the same bytes as Studio's VRM export
  const [studio] = await studioExport(
    page,
    'file.exportCharacter',
    characterRequest(character, 'ekza-vrm', 'cube-lad'),
  );
  expect(studio?.sha256).toBe(vrm.sha);

  // an "Ekza …" avatar: never OMOBA's protected ekza- slug (its roster skips such an entry without a passport)
  await runOk(page, 'char.setVrmMeta', { character, patch: { name: 'Ekza Bot' } });
  await expect(page.getByTestId('ar-status')).toHaveText('studio-ekza-bot-omoba-kit.zip · ready');
  const ekzaFile = await download(page);
  expect(ekzaFile.name).toBe('studio-ekza-bot-omoba-kit.zip');
  const ekzaKit = readKit(ekzaFile.bytes);
  expect(ekzaKit.files).toEqual(['studio-ekza-bot.glb', 'studio-ekza-bot.png', 'manifest-entry.json', 'README.txt']);
  expectOmobaEntry(ekzaKit, 'studio-ekza-bot');
  expect(ekzaKit.entry['display_name']).toBe('Ekza Bot');
});

test('AS-AR-4 (⑤ part): an imported VRM offers the Space bake, VRMA and the kit once it has a clip', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openAutoRigReady(page);
  await page
    .getByTestId('ar-model-picker')
    .first()
    .setInputFiles({
      name: 'polybot.vrm',
      mimeType: 'model/gltf-binary',
      buffer: fixtureBytes('polybot.vrm'),
    });
  await expect.poll(async () => (await autorig(page))?.step, { timeout: 30_000 }).toBe('animations');
  const character = (await autorig(page))?.subject.character as string;
  await gotoExport(page);
  // no clip yet: an imported avatar exports with its clips baked in
  await expect(page.getByTestId('ar-export-no-targets')).toBeVisible();
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  await expect(page.getByTestId('ar-export-meta')).toHaveCount(0);

  await useClips(page, character, ['walk']);
  await expect(page.getByTestId('ar-export-target-ekza-vrm')).toBeVisible();
  await expect(page.getByTestId('ar-export-target-vrma')).toBeVisible();
  await expect(page.getByTestId('ar-export-target-glb')).toHaveCount(0);
  await expect(page.getByTestId('ar-export-developers')).toBeVisible();
  await expect(page.getByTestId('ar-export-meta')).toHaveCount(0); // the avatar keeps its own meta
  for (const id of ['humanoid', 'size', 'read-back']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'pending');
  }
  const file = await download(page);
  expect(file.name).toMatch(/\.vrm$/);
  // the Space profile passes: every check ✓ after the download
  for (const id of ['humanoid', 'required-bones', 'parents', 'size', 'nodes', 'bones', 'extensions', 'read-back']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
  }
  const clips = (await clipIds(page, character)).filter((clip) => clip.name === 'Walk');
  const base = file.name.replace(/\.vrm$/, '');
  const [studio] = await studioExport(
    page,
    'file.export',
    fileExportRequest(
      character,
      'bake-into-model',
      base,
      clips.map((clip) => clip.id),
      true,
      'ekza/space-avatar-v1',
    ),
  );
  expect(studio?.errors).toEqual([]);
  expect(studio?.sha256).toBe(file.sha);
});

/** AS-AR-6's body: the textured Polybot of the two-mesh scene (the sword unticked by ①), rigged and bound by operators,
 *  exported as the Ekza avatar through ⑤'s UI; returns the character and the VRM's JSON. */
async function texturedBodyVrm(page: Page): Promise<{ character: string; json: Record<string, unknown> }> {
  await openAutoRigReady(page);
  await chooseFile(page, 'polybot-sword.glb', polybotWithSword());
  const state = await waitForReport(page, 'polybot-sword.glb');
  expect((state.intake as { textured: boolean }).textured).toBe(true);
  const body = state.subject.meshes;
  expect(body).toHaveLength(1); // the sword is unticked (D3)
  // Polybot's T-pose truth markers (fixtures/models/polybot-truth.json), rigged by Quick Rig's commit and bound
  const polybot = JSON.parse(fixtureBytes('polybot-truth.json').toString('utf8')) as {
    poses: { tpose: { markers: Record<string, number[]> } };
  };
  const { character } = await runOk<{ character: string }>(page, 'skel.quickRig.commit', {
    preset: 'standard33',
    markers: polybot.poses.tpose.markers,
    meshes: body,
    flexion: 2 * DEG,
  });
  await runOk(page, 'skin.bind', {});
  await expect.poll(async () => (await autorig(page))?.reachable.export, { timeout: 30_000 }).toBe(true);
  await gotoExport(page);
  await thumbnailRendered(page);
  await setAuthorAndLicence(page);
  const file = await download(page);
  expect(file.name).toBe('polybot.vrm');
  keepExport('ar-07-polybot-textured.vrm', file.bytes);
  return { character, json: (await parseGlb(file.bytes)).json };
}

test('AS-AR-6 (⑤ part): the body rigged without the sword exports a clean VRM; the sword stays a scene mesh', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { character, json } = await texturedBodyVrm(page);
  const vrmc = (json['extensions'] as Record<string, Record<string, unknown>>)['VRMC_vrm'] ?? {};
  expect(vrmc['specVersion']).toBe('1.0');
  expect((json['meshes'] as unknown[]).length).toBe(1);
  const sword = (await call(page, 'meshes')).find((mesh) => mesh.name === 'Sword');
  expect(sword).toBeDefined();
  expect(sword?.owner).not.toContain(character);
});

// AUTORIG-SPEC §6.1 "Textured models": the adopted asset material's image texture reaches the VRM (C10's writer copies
// the asset slots' materials of a mesh without a palette, AR-D7-15; was a fixme until D7's fix round).
test('AS-AR-6 (⑤ part): the body’s image texture reaches the VRM', async ({ page }) => {
  test.setTimeout(240_000);
  const { json } = await texturedBodyVrm(page);
  const images = (json['images'] ?? []) as { name?: string }[];
  // the body's texture besides the thumbnail
  expect(images.filter((image) => image.name !== 'thumbnail').length).toBeGreaterThanOrEqual(1);
  const materials = (json['materials'] ?? []) as { pbrMetallicRoughness?: { baseColorTexture?: unknown } }[];
  expect(materials.some((material) => material.pbrMetallicRoughness?.baseColorTexture !== undefined)).toBe(true);
});
