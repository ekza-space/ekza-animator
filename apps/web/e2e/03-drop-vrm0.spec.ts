import { expect, test } from '@playwright/test';
import { call, expectKernelStarted, openEditor, waitForCount } from './helpers/test-api';

// E2E-03 (MVP-SPEC §6.2): a real DataTransfer drop of Polybot (VRM 0.x) on the window, the import dialog's badges,
// then the humanoid rig facing +Z (§4.11.9).
test('E2E-03: drag-and-drop VRM 0.x', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);

  const dataTransfer = await page.evaluateHandle(async () => {
    const bytes = await (await fetch('/samples/polybot.vrm')).arrayBuffer();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'polybot.vrm', { type: 'model/gltf-binary' }));
    return transfer;
  });
  await page.dispatchEvent('[data-testid="editor-root"]', 'dragenter', { dataTransfer });
  await page.dispatchEvent('[data-testid="editor-root"]', 'dragover', { dataTransfer });
  await page.dispatchEvent('[data-testid="editor-root"]', 'drop', { dataTransfer });

  const dialog = page.getByTestId('import-dialog');
  const noImporter = page.getByTestId('toast').filter({ hasText: 'not a 3D model or an Ekza Studio project' });
  await expect(dialog.or(noImporter)).toBeVisible();
  await expect(noImporter, 'an importer is registered for .vrm').toHaveCount(0);
  await expect(page.getByTestId('import-summary-error')).toHaveCount(0);
  await expect(page.getByTestId('import-format-badge')).toHaveText('VRM 0.x');
  await expect(page.getByTestId('import-license-badge')).toContainText('CC0');

  await page.getByTestId('import-confirm').click();
  await expect(dialog).toBeHidden();
  await waitForCount(page, 'characters', 1);

  const character = (await call(page, 'state')).activeCharacter;
  expect(character).not.toBeNull();
  const keys = new Set((await call(page, 'controls')).map((control) => control.key));
  for (const key of ['root', 'cog', 'fk.hips', 'fk.spine', 'fk.head', 'fk.upperArm.L', 'fk.upperLeg.R']) {
    expect(keys.has(key), `humanoid control ${key}`).toBe(true);
  }
  // The runtime (rig program) is created asynchronously after the import transaction.
  let facing: readonly number[] = [];
  await expect
    .poll(
      async () => {
        try {
          facing = await call(page, 'facing', character ?? '');
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  // §4.11.9 facing check (v0.3 integration, DECISIONS-OPEN E-INT-2): the yaw of f. Polybot's head sits 1.35 cm ahead
  // of its hips, which pitches f by ~2.8° (f·z = 0.99882); the horizontal part measures the facing alone and is
  // still −1 for a missing π-yaw and 0 for a quarter turn.
  const [fx = Number.NaN, , fz = Number.NaN] = facing;
  expect(fz / Math.hypot(fx, fz)).toBeGreaterThan(0.999);
});
