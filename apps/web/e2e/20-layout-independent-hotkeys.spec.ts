import { expect, type Page, test } from '@playwright/test';
import { controlId, seedSample } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, fixmeIfPlaceholder, openEditor, runOk } from './helpers/test-api';

// E2E-20 (MVP-SPEC §6.2; §4.10): hotkeys match KeyboardEvent.code, so a Cyrillic layout (`key: 'ы'`) and macOS
// Option characters (`key: '√'` for Alt+V) still run S = key.set and Alt+V = time.togglePlay.
interface KeyInit {
  readonly code: string;
  readonly key: string;
  readonly altKey?: boolean;
}

async function dispatchKey(page: Page, init: KeyInit): Promise<void> {
  await page.evaluate(({ code, key, altKey }) => {
    const target = document.activeElement ?? document.body;
    const options = { code, key, altKey: altKey === true, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', options));
    target.dispatchEvent(new KeyboardEvent('keyup', options));
  }, init);
}

test('E2E-20: layout-independent hotkeys', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await fixmeIfKernelUnavailable(page);
  await fixmeIfPlaceholder(page, 'viewport');
  await seedSample(page, 'polybot');
  const control = await controlId(page, 'fk.lowerArm.L');
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  const clip = (await call(page, 'state')).activeClip;
  expect(clip).not.toBeNull();
  const keyCount = async () =>
    (await call(page, 'curves', clip ?? '', control)).reduce((sum, curve) => sum + curve.keys.length, 0);
  expect(await keyCount()).toBe(0);

  const viewport = await page.getByTestId('panel-viewport').boundingBox();
  if (viewport === null) throw new Error('the viewport panel is not visible');
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);

  await dispatchKey(page, { code: 'KeyS', key: 'ы' });
  await expect.poll(keyCount).toBeGreaterThan(0);

  expect((await call(page, 'state')).playing).toBe(false);
  await dispatchKey(page, { code: 'KeyV', key: '√', altKey: true });
  await expect.poll(async () => (await call(page, 'state')).playing).toBe(true);
  await runOk(page, 'time.stop');
});
