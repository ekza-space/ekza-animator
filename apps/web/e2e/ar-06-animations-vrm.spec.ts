// E2E-AR-06 (AUTORIG-SPEC §10 D5, §5.5, §5.4.1, §11 AS-AR-4): ④ on an already rigged avatar (the Polybot VRM sample,
// which ① routes straight to ④). AS-AR-4's ④ part: add Walk = one step "Use Clip Walk" on Polybot. A `.vrma`
// dropped on the step goes to the character through the shipped `file.importAnimation` (the wizard stays on ④).
// *Skip* with no clips marks ④ done and goes to ⑤; Export ▸ is enabled with zero clips and the footer says OMOBA
// needs none. The range-of-motion clip previews by the byte route (`library.preview {bytes}`): the PREVIEW badge
// shows its label, the avatar moves, the document does not change.
import { romVrma } from '@ekza-studio/io';
import { expect, type Page, test } from '@playwright/test';
import { animationsWithVrm, clipNamed, clipsOf, libraryPreview } from './helpers/ar-animations';
import { autorig, history } from './helpers/autorig';
import { starterPackFile } from './helpers/m6b-clip-library';
import { call, run } from './helpers/test-api';

test.describe.configure({ timeout: 120_000 });

/** Drops files on the wizard (a DataTransfer built in the page from bytes sent as base64). */
async function dropFiles(page: Page, files: readonly { name: string; bytes: Uint8Array }[]): Promise<void> {
  const payload = files.map((file) => ({ name: file.name, data: Buffer.from(file.bytes).toString('base64') }));
  await page.evaluate((list) => {
    const transfer = new DataTransfer();
    for (const file of list) {
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: 'application/octet-stream' }));
    }
    const target = document.querySelector('[data-testid="ar-anim-drop"]') ?? document.body;
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, payload);
}

test('AS-AR-4 (④ part): the Polybot VRM goes straight to ④; Walk is one Use Clip step', async ({ page }) => {
  const character = await animationsWithVrm(page);
  expect((await autorig(page))?.reachable['markers']).toBe(false);
  await expect(page.getByTestId('ar-anim-character')).toContainText('On Polybot');
  // zero clips: Export ▸ is enabled and the footer says OMOBA plays its own
  await expect(page.getByTestId('ar-status')).toContainText('No animations — the VRM still works in OMOBA');
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  const before = (await history(page)).undo.length;
  await page.getByTestId('ar-clip-card-walk').click();
  await expect.poll(async () => (await libraryPreview(page))?.clip).toBe('walk');
  await expect(page.locator('[data-testid^="hud-badge-preview-"]').first()).toHaveText('PREVIEW Walk');
  await page.getByTestId('ar-clip-add').click();
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Use Clip Walk');
  expect((await history(page)).undo.length).toBe(before + 1);
  const walk = await clipNamed(page, character, 'Walk');
  await expect(page.getByTestId(`ar-char-clip-${walk.id}`)).toBeVisible();
  await expect(page.getByTestId(`ar-char-clip-slot-${walk.id}`)).toHaveValue('walk');
  await expect.poll(async () => (await autorig(page))?.done['animations']).toBe(true);
  await page.getByTestId('ar-primary').click();
  await expect.poll(async () => (await autorig(page))?.step).toBe('export');
});

test('a .vrma dropped on ④ is imported onto the character; Skip marks ④ done', async ({ page }) => {
  const character = await animationsWithVrm(page);
  // Skip with no clips: ④ done, on to ⑤
  await page.getByTestId('ar-anim-skip').click();
  await expect.poll(async () => (await autorig(page))?.step).toBe('export');
  expect((await autorig(page))?.done['animations']).toBe(true);
  expect((await autorig(page))?.slices['animations']).toMatchObject({ skipped: true });
  await page.keyboard.press('Alt+Digit4');
  await expect.poll(async () => (await autorig(page))?.step).toBe('animations');
  await expect(page.getByTestId('ar-status')).toContainText('Skipped');

  // a dropped .vrma: the shipped import onto the subject, the wizard stays on ④
  const before = (await clipsOf(page, character)).length;
  await dropFiles(page, [{ name: 'dance.vrma', bytes: starterPackFile('dance.vrma') }]);
  await expect.poll(async () => (await clipsOf(page, character)).length).toBe(before + 1);
  expect((await autorig(page))?.step).toBe('animations');
  await expect(page.getByTestId('ar-status')).toContainText('Added dance.vrma');
  const dance = (await clipsOf(page, character)).at(-1);
  await expect(page.getByTestId(`ar-char-clip-${dance?.id}`)).toBeVisible();
});

test('the range-of-motion clip previews by the byte route; the document is untouched', async ({ page }) => {
  const character = await animationsWithVrm(page);
  const marks = async () => ({
    history: await history(page),
    keys: await call(page, 'keysHash'),
    counts: await call(page, 'counts'),
  });
  const before = await marks();
  const bytes = Buffer.from(await romVrma({ fingers: false })).toString('base64');
  const result = await page.evaluate(
    async ([data, target]) => {
      const array = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return window.__EKZA_STUDIO_TEST__?.run('library.preview', {
        character: target,
        clip: 'rom',
        bytes: array,
        label: 'Range test',
      });
    },
    [bytes, character] as const,
  );
  expect(result?.status, JSON.stringify(result)).toBe('finished');
  await expect.poll(async () => (await libraryPreview(page))?.clip).toBe('Range test');
  await expect(page.locator('[data-testid^="hud-badge-preview-"]').first()).toHaveText('PREVIEW Range test');
  // the displayed avatar moves (the left hand) over half a second
  const hand = () => call(page, 'displayNodeWorld', character, 'mixamorigLeftHand');
  const a = await hand();
  await page.waitForTimeout(500);
  const b = await hand();
  expect(a).not.toBeNull();
  expect(Math.hypot(...(a as number[]).map((v, i) => v - ((b as number[])[i] as number)))).toBeGreaterThan(0.01);
  expect(await marks()).toEqual(before);
  expect((await run(page, 'library.stop')).status).toBe('finished');
});
