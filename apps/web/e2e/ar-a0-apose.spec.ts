import { expect, test } from '@playwright/test';
import { aposedPolybotBound, checklistTwo, offTPoseTruth, rowCodes, showRigToolkit } from './helpers/apose';
import { exportCharacterFile } from './helpers/m6b-character-writer';
import { validatorErrors, writeArtifact } from './helpers/m6b-mvp-script';
import { runMenuItem } from './helpers/m6a-model-ops-ui';
import { call, runOk } from './helpers/test-api';

// E2E-AR-A0 (AUTORIG-SPEC §10 A0): the A-pose path in Studio. A-posed Polybot imported static → Rig & Skin → Quick
// Rig (the A-pose notice) → Create Skeleton → Bind Skin in the A-pose → Validation's `skel.tpose` Fix "Straighten to
// T-Pose": the row is gone in one undo step, every humanoid joint within 0.05 H of the T-pose truth, and the Space
// export (VRM 1.0) is enabled and written with both validators clean. The menu path: Skeleton › T-Stance (a test pose,
// view Test) then Skeleton › Apply Pose as Rest; its undo brings back the A-pose rest and the T-Stance test pose. With
// a clip, the Fix asks first ("Clips authored on the old rest shift by the pose delta (1 clip). …").

const SPACE = 'ekza/space-avatar-v1';

test.describe('E2E-AR-A0 the A-pose path in Studio', () => {
  test.setTimeout(240_000);

  test("Validation's skel.tpose Fix straightens in one step; the VRM export is enabled and clean", async ({ page }) => {
    const { character } = await aposedPolybotBound(page);
    // Bound in the A-pose: skel.tpose is an error with its Fix; checklist ② names the path.
    const tpose = (await call(page, 'validation', SPACE)).find((row) => row.code === 'skel.tpose');
    expect(tpose).toMatchObject({ severity: 'error', fix: 'skel.pose.applyAsRest' });
    await showRigToolkit(page);
    await expect.poll(() => checklistTwo(page)).toContain('A-posed: Bind Skin, then Straighten to T-Pose');
    await runOk(page, 'char.setVrmMeta', { character, patch: { authors: ['Tester'], licensePreset: 'cc0' } });
    await runOk(page, 'char.renderThumbnail', { character });
    await runOk(page, 'ui.open', { dialog: 'export' });
    await expect(page.getByTestId('export-character')).toContainText('skel.tpose');
    await expect(page.getByTestId('export-confirm')).toBeDisabled();
    await page.keyboard.press('Escape');

    // Windows › Validation, then the row's Fix.
    await page.getByTestId('menu-windows').click();
    await page.getByTestId('menu-item-rig.windows.validation').click();
    await expect(page.getByTestId('val-fix-skel.tpose')).toHaveText('Fix: Straighten to T-Pose');
    const steps = (await call(page, 'history')).undo.length;
    await page.getByTestId('val-fix-skel.tpose').click();
    await expect.poll(() => rowCodes(page), { timeout: 30_000 }).not.toContain('skel.tpose');
    const history = await call(page, 'history');
    expect(history.undo.length).toBe(steps + 1);
    expect(history.undo.at(-1)).toBe('Straighten to T-Pose');
    expect(await offTPoseTruth(page, character, 0.05)).toEqual([]);
    const joints = (await call(page, 'skeleton', character))?.joints ?? [];
    expect(joints.filter((joint) => joint.restRotation.join() !== '0,0,0,1').map((joint) => joint.key)).toEqual([]);

    // The Space export is enabled and written; glTF-Validator and vrm-validator clean.
    await runOk(page, 'ui.open', { dialog: 'export' });
    await expect(page.getByTestId('export-confirm')).toBeEnabled();
    await page.keyboard.press('Escape');
    const { artifact, bytes } = await exportCharacterFile(page, { character, profile: SPACE, format: 'vrm' });
    expect(artifact.lints.filter((lint) => lint.code.startsWith('vrm.'))).toEqual([]);
    expect(await validatorErrors(bytes)).toEqual({ gltf: [], vrm: [] });
    writeArtifact('test-results/autorig-a0/e2e-polybot-apose.vrm', bytes);

    // One step: undo returns the A-pose rest and its row; redo straightens again.
    await runOk(page, 'edit.undo');
    await expect.poll(() => rowCodes(page)).toContain('skel.tpose');
    await runOk(page, 'edit.redo');
    await expect.poll(() => rowCodes(page)).not.toContain('skel.tpose');
  });

  test('Skeleton › T-Stance (test pose) then Skeleton › Apply Pose as Rest; undo restores rest and test pose', async ({
    page,
  }) => {
    const { character } = await aposedPolybotBound(page);
    const before = (await call(page, 'skeleton', character))?.joints ?? [];
    // Apply Pose as Rest is disabled without a test pose, with its reason.
    await page.getByTestId('menu-skeleton').click();
    const apply = page.getByTestId('menu-item-rig.skeleton.applyPoseAsRest');
    await expect(apply).toHaveAttribute('data-disabled', '');
    await expect(apply).toHaveAttribute('title', 'Pose the character first (T-Stance)');
    await page.keyboard.press('Escape');

    await runMenuItem(page, 'skeleton', 'rig.skeleton.tStance');
    await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Test Pose');
    await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
    const posed = (await call(page, 'rigState')).testPose.controls;
    expect(posed).toBeGreaterThan(0);
    // A test pose never edits the rest.
    expect((await call(page, 'skeleton', character))?.joints).toEqual(before);

    await runMenuItem(page, 'skeleton', 'rig.skeleton.applyPoseAsRest');
    await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Apply Pose as Rest');
    await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('bind');
    expect((await call(page, 'rigState')).testPose.controls).toBe(0);
    await expect.poll(() => rowCodes(page)).not.toContain('skel.tpose');
    expect(await offTPoseTruth(page, character, 0.05)).toEqual([]);

    await runOk(page, 'edit.undo');
    await expect.poll(() => rowCodes(page)).toContain('skel.tpose');
    expect((await call(page, 'skeleton', character))?.joints).toEqual(before);
    await expect.poll(async () => (await call(page, 'rigState')).testPose.controls).toBe(posed);
    await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
  });

  test('with a clip, the Fix asks first; Apply straightens in one step', async ({ page }) => {
    const { character } = await aposedPolybotBound(page);
    await runOk(page, 'clip.new', { character, name: 'Idle' });
    await page.getByTestId('menu-windows').click();
    await page.getByTestId('menu-item-rig.windows.validation').click();
    const steps = (await call(page, 'history')).undo.length;
    await page.getByTestId('val-fix-skel.tpose').click();
    await expect(page.getByTestId('apply-pose-as-rest-text')).toHaveText(
      'Clips authored on the old rest shift by the pose delta (1 clip). Do this before animating.',
    );
    expect((await call(page, 'history')).undo.length).toBe(steps);
    await page.getByTestId('apply-pose-as-rest-ok').click();
    await expect
      .poll(async () => (await call(page, 'history')).undo.at(-1), { timeout: 30_000 })
      .toBe('Straighten to T-Pose');
    expect((await call(page, 'history')).undo.length).toBe(steps + 1);
    await expect.poll(() => rowCodes(page)).not.toContain('skel.tpose');
  });
});
