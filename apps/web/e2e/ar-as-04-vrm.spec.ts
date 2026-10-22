// AUTORIG-SPEC §11 AS-AR-4 (D7, in full; D3, D5 and D6 own its parts): "VRM skips to animations". `polybot.vrm`
// dropped on ① goes straight to ④; ② and ③ are not reachable and say the avatar is already rigged; Walk is added
// through the grid (one step); ⑤ offers the imported avatar's targets — the Space bake, VRMA and the OMOBA kit, never a
// plain GLB — and the Space profile passes: every check ✓ after Download, the bytes equal Studio's `file.export` bake.
import { expect, test } from '@playwright/test';
import { addClip, dropModel, onStep, primary } from './helpers/ar-as';
import { checkOf, clipIds, download, fileExportRequest, studioExport } from './helpers/ar-export';
import { openAutoRigReady } from './helpers/ar-host';
import { fixtureBytes } from './helpers/ar-model';
import { wizard } from './helpers/ar-markers';
import { history } from './helpers/autorig';
import { validatorErrors } from './helpers/m6b-mvp-script';

test('AS-AR-4: polybot.vrm goes straight to ④, takes Walk, and exports the Space bake byte-equal to Studio', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openAutoRigReady(page);
  await dropModel(page, 'polybot.vrm', new Uint8Array(fixtureBytes('polybot.vrm')));
  await onStep(page, 'animations');
  const state = await wizard(page);
  expect(state.intake).toMatchObject({ kind: 'vrm', fileName: 'polybot.vrm' });
  const character = state.subject.character as string;
  expect(character).not.toBeNull();
  expect(state.reachable).toMatchObject({ markers: false, rig: false, animations: true, export: true });
  for (const step of ['markers', 'rig']) {
    const button = page.locator(`[data-step="${step}"] button`);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /This avatar is already rigged/);
  }
  expect((await history(page)).undo).toEqual(['Import polybot.vrm']);

  // ④: Walk through the grid, one step
  await expect(page.getByTestId('ar-anim-grid')).toBeVisible();
  await addClip(page, { id: 'walk', name: 'Walk', search: 'walk' });
  await expect.poll(async () => (await wizard(page)).done['animations']).toBe(true);

  // ⑤: the imported avatar's targets; Download; the Space profile passes
  await primary(page, /Export/);
  await onStep(page, 'export');
  await expect(page.getByTestId('ar-export-target-ekza-vrm')).toBeVisible();
  await expect(page.getByTestId('ar-export-target-vrma')).toBeVisible();
  await expect(page.getByTestId('ar-export-target-glb')).toHaveCount(0);
  await expect(page.getByTestId('ar-export-developers')).toBeVisible();
  await expect(page.getByText(/Publish to Ekza Hub/)).toHaveCount(0);
  const file = await download(page);
  expect(file.name).toMatch(/\.vrm$/);
  for (const id of ['humanoid', 'required-bones', 'parents', 'size', 'nodes', 'bones', 'extensions', 'read-back']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
  }
  expect(await validatorErrors(file.bytes)).toEqual({ gltf: [], vrm: [] });
  const walk = (await clipIds(page, character)).filter((clip) => clip.name === 'Walk');
  const [studio] = await studioExport(
    page,
    'file.export',
    fileExportRequest(
      character,
      'bake-into-model',
      file.name.replace(/\.vrm$/, ''),
      walk.map((clip) => clip.id),
      true,
      'ekza/space-avatar-v1',
    ),
  );
  expect(studio?.errors).toEqual([]);
  expect(studio?.sha256).toBe(file.sha);
});
