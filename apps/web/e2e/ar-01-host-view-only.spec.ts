import { expect, test } from '@playwright/test';
import { expectAutoRigShown, expectStudioShown, importStatic, navigate, rigCubeLad } from './helpers/ar-host';
import { expectRefused } from './helpers/m6b-rig';
import { call, expectKernelStarted, openEditor, run, runOk } from './helpers/test-api';

// E2E-AR-01, the per-shell view-only rule (AUTORIG-SPEC §8.3, AR-V1; D1) at 390×844: Studio's Rig & Skin is view-only
// below 1024 px and refuses document edits; switching to Auto-Rig on the same page disposes Studio's shell, which
// clears the flag, so the rig edits Auto-Rig runs (import, Create Skeleton, Bind Skin — `autorig.rig` is a stub at
// D1's merge) succeed; back in Studio the rule applies again.

test.use({ viewport: { width: 390, height: 844 } });

const VIEW_ONLY = 'Open on a larger screen to edit';

test('Studio is view-only at 390×844; Auto-Rig on the same page rigs; Studio is view-only again', async ({ page }) => {
  await openEditor(page, '&ws=rig');
  await expectKernelStarted(page);
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('rig');
  await expect(page.getByTestId('rig-view-only')).toContainText(VIEW_ONLY);
  await expectRefused(page, 'channel.toggleLock', VIEW_ONLY, { refs: [] });

  await navigate(page, { to: 'autorig', from: 'studio' });
  await expectAutoRigShown(page);
  expect((await call(page, 'state')).workspace).toBe('rig');
  // Studio's shell goes a task after it unmounts; then nothing refuses Auto-Rig's edits.
  await expect
    .poll(async () => (await run(page, 'channel.toggleLock', { refs: [] })).reason ?? null)
    .not.toBe(VIEW_ONLY);
  const { character, meshes } = await rigCubeLad(page);
  expect(meshes.length).toBeGreaterThan(0);
  await runOk(page, 'skin.bind', {});
  expect((await call(page, 'history')).undo.slice(-2)).toEqual(['Create Skeleton', 'Bind Skin']);
  expect((await call(page, 'characters')).map((row) => row.id)).toContain(character);

  await navigate(page, { to: 'studio', workspace: 'rig', from: 'autorig' });
  await expectStudioShown(page);
  await expect(page.getByTestId('rig-view-only')).toContainText(VIEW_ONLY);
  await expectRefused(page, 'channel.toggleLock', VIEW_ONLY, { refs: [] });
  // and once more in Auto-Rig
  await navigate(page, { to: 'autorig', from: 'studio' });
  await expectAutoRigShown(page);
  await expect
    .poll(async () => (await run(page, 'channel.toggleLock', { refs: [] })).reason ?? null)
    .not.toBe(VIEW_ONLY);
  await importStatic(page, 'cube-lad.glb');
});
