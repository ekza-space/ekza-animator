import { expect, test } from '@playwright/test';
import { createBodyCharacter, enterRig } from './helpers/m6b-rig';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-RIG-08 (M6B-SPEC §10.1 row + §0.7's A-pose line; owner C7): Validation is the export gate. A character body
// with its left forearm unmapped gives `skel.required-bones` (an error for the Ekza profile); the Export dialog's
// Character section lists it and disables Export; the Fix (`skel.template.addMissing`) maps the joint in one step and
// Export is enabled. An A-posed body's `skel.tpose` blocks the Ekza profile but not `local/generic`. Gates c1, c2,
// c10; the panel frame (profile selector, empty states, the Windows item) runs now.

test('E2E-RIG-08 (MVP part): the Validation panel, its profile and its empty states', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await enterRig(page);
  // Windows › Validation shows the bottom tab; without a character it says so.
  await page.getByTestId('menu-windows').click();
  await page.getByTestId('menu-item-rig.windows.validation').click();
  await expect(page.getByTestId('val-panel')).toContainText('No character to validate');
  // An imported character: no Rig & Skin rows (its export profile's lints judge it); the profile is U state.
  await seedSample(page, 'polybot');
  await expect(page.getByTestId('val-clean')).toBeVisible();
  const profile = page.getByTestId('val-profile');
  await expect(profile).toHaveValue('ekza/space-avatar-v1');
  const history = await call(page, 'history');
  await profile.selectOption('local/generic');
  await expect(profile).toHaveValue('local/generic');
  await expect(page.getByTestId('val-ready')).toContainText('Local / generic ✓');
  expect(await call(page, 'history')).toEqual(history);
  expect(await call(page, 'validation')).toEqual([]);
  // [Re-run] re-derives the rows (no document change, no step).
  await page.getByTestId('val-rerun').click();
  await expect(page.getByTestId('val-clean')).toBeVisible();
  expect(await call(page, 'history')).toEqual(history);
});

test(`E2E-RIG-08: Validation as the export gate`, async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const body = await createBodyCharacter(page);
  await enterRig(page);
  // A bound body with its VRM meta set (author, licence): the remaining export errors are the skeleton's own.
  await runOk(page, 'skin.bind', {});
  await runOk(page, 'char.setVrmMeta', {
    character: body.character,
    patch: { authors: ['Tester'], licensePreset: 'cc0' },
  });
  const forearm = (await call(page, 'skeleton', body.character))?.joints.find((j) => j.humanBone === 'leftLowerArm');
  expect(forearm).toBeDefined();
  await runOk(page, 'skel.joint.setHumanBone', { joint: forearm?.id, bone: null });
  await runOk(page, 'rig.validation.profile', { profile: 'ekza/space-avatar-v1' });
  expect((await call(page, 'validation')).find((row) => row.code === 'skel.required-bones')).toMatchObject({
    severity: 'error',
    fix: 'skel.template.addMissing',
  });
  await expect(page.getByTestId('val-row-skel.required-bones')).toBeVisible();
  // The Export dialog's Character section lists the row and blocks Export.
  await runOk(page, 'ui.open', { dialog: 'export' });
  const exportCharacter = page.getByTestId('export-character');
  await expect(exportCharacter).toContainText('skel.required-bones');
  await expect(page.getByTestId('export-confirm')).toBeDisabled();
  await page.keyboard.press('Escape');
  // The Fix: one step, the joint mapped at the template position, the error gone, Export enabled.
  const steps = (await call(page, 'history')).undo.length;
  await page.getByTestId('val-fix-skel.required-bones').click();
  await expect
    .poll(async () => (await call(page, 'validation')).some((row) => row.code === 'skel.required-bones'))
    .toBe(false);
  expect((await call(page, 'history')).undo.length).toBe(steps + 1);
  await runOk(page, 'ui.open', { dialog: 'export' });
  await expect(page.getByTestId('export-confirm')).toBeEnabled();
  await page.keyboard.press('Escape');

  // An A-posed body: skel.tpose blocks the Ekza profile, warns for local/generic.
  await runOk(page, 'workspace.set', { workspace: 'model' });
  const aPosed = await createBodyCharacter(page);
  await runOk(page, 'rig.mode', { mode: 'object' });
  await runOk(page, 'select.objects', { ids: [aPosed.mesh], mode: 'replace' });
  await enterRig(page);
  // Both upper arms 35° down (the left one rotated about −Z; symmetry mirrors the right one).
  const upperArm = (await call(page, 'skeleton', aPosed.character))?.joints.find((j) => j.humanBone === 'leftUpperArm');
  await runOk(page, 'skel.joint.rotateRest', { joints: [upperArm?.id], rotateZ: (-35 * Math.PI) / 180 });
  const tpose = async (profile: string) =>
    (await call(page, 'validation', profile)).find((row) => row.code === 'skel.tpose')?.severity;
  expect(await tpose('ekza/space-avatar-v1')).toBe('error');
  expect(await tpose('local/generic')).toBe('warning');
});
