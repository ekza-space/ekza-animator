import { expect, test } from '@playwright/test';
import { expectKernelStarted, openEditor, waitForCount } from './helpers/test-api';

// One drop of two models (W-11): each opens its own import dialog after the previous one closed, and both import.
test('dropping two models imports both, one dialog after the other', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);

  const dataTransfer = await page.evaluateHandle(async () => {
    const transfer = new DataTransfer();
    for (const name of ['polybot.vrm', 'seed-san.vrm']) {
      const bytes = await (await fetch(`/samples/${name}`)).arrayBuffer();
      transfer.items.add(new File([bytes], name, { type: 'model/gltf-binary' }));
    }
    return transfer;
  });
  await page.dispatchEvent('[data-testid="editor-root"]', 'dragenter', { dataTransfer });
  await page.dispatchEvent('[data-testid="editor-root"]', 'drop', { dataTransfer });

  const dialog = page.getByTestId('import-dialog');
  const noImporter = page.getByTestId('toast').filter({ hasText: 'not a 3D model or an Ekza Studio project' });
  await expect(dialog.or(noImporter.first())).toBeVisible();
  await expect(noImporter, 'an importer is registered for .vrm').toHaveCount(0);

  const fileName = page.getByTestId('import-file-name');
  await expect(fileName).toHaveText('polybot.vrm');
  await page.getByTestId('import-confirm').click();
  await waitForCount(page, 'characters', 1);
  await expect(fileName).toHaveText('seed-san.vrm');
  await page.getByTestId('import-confirm').click();
  await expect(dialog).toBeHidden();
  await waitForCount(page, 'characters', 2);
});
