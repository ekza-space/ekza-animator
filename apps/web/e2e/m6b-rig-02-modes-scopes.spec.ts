import { expect, type Page, test } from '@playwright/test';
import { centreOf, paneRect } from './helpers/g1-viewport';
import { modKey } from './helpers/m6a-model';
import { createBodyCharacter, enterRig, keysHash, RIG_PERSP_PANE } from './helpers/m6b-rig';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-RIG-02 (M6B-SPEC §10.1 row cut to the MVP by §0.7: no Shapes mode, no Joint tool; owner C7): the modes `1`,
// `2`, `F8` and the active digit again; `S` in every mode leaves the keys hash unchanged (`S` → `rig.animateOnly`);
// `Mod+E` opens Export; `Alt+C` toggles controls in Object mode and weights in Skin mode; the Animate keymap resolves
// as before. The full row needs a bound body (gates c1, c2, c4); the part that needs no skeleton runs on the imported
// Polybot now.

const GATES = 'c1, c2, c4';

/** Hovers the perspective pane (the keymap's scope chain follows the pointer). */
async function hoverPersp(page: Page): Promise<void> {
  const at = centreOf(await paneRect(page, RIG_PERSP_PANE));
  await page.mouse.move(at.x, at.y);
}

const mode = async (page: Page): Promise<string> => (await call(page, 'rigState')).mode;
const VIEWPORT = { panel: 'viewport', paneId: RIG_PERSP_PANE } as const;

test('E2E-RIG-02 (MVP part): modes, digits, F8; S never keys; Mod+E; Alt+C on an imported character', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const hips = await controlId(page, 'fk.hips');
  // The Animate keymap before entering Rig & Skin (it must resolve exactly the same afterwards).
  const animateKeys = async () =>
    Promise.all(
      [{ code: 'KeyS' }, { code: 'KeyE', mod: true }, { code: 'KeyC', alt: true }, { code: 'Digit1' }].map((chord) =>
        call(page, 'resolveKey', chord, VIEWPORT),
      ),
    );
  const before = await animateKeys();
  await enterRig(page);
  await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('bind');
  await hoverPersp(page);
  await runOk(page, 'select.controls', { ids: [hips], mode: 'replace' });
  const hash = await keysHash(page);

  // S in Object mode → rig.animateOnly; nothing keyed.
  expect(await call(page, 'resolveKey', { code: 'KeyS' }, VIEWPORT)).toMatchObject({
    op: 'rig.animateOnly',
    scope: 'rig.viewport',
  });
  await page.keyboard.press('KeyS');
  // 1 → Skeleton; S there keys nothing either; 1 again → Object; F8 → the last mode → Object.
  await page.keyboard.press('Digit1');
  await expect.poll(() => mode(page)).toBe('skeleton');
  expect(await call(page, 'resolveKey', { code: 'KeyS' }, VIEWPORT)).toMatchObject({ op: 'rig.animateOnly' });
  await page.keyboard.press('KeyS');
  await page.keyboard.press('Digit1');
  await expect.poll(() => mode(page)).toBe('object');
  await page.keyboard.press('F8');
  await expect.poll(() => mode(page)).toBe('skeleton');
  await page.keyboard.press('F8');
  await expect.poll(() => mode(page)).toBe('object');
  // 2 needs a bound mesh: the mode stays Object.
  await page.keyboard.press('Digit2');
  await expect.poll(() => mode(page)).toBe('object');
  expect(await keysHash(page)).toBe(hash);
  // S over the other Rig panels keys nothing.
  for (const panel of ['channelBox', 'outliner', 'timeline']) {
    expect((await call(page, 'resolveKey', { code: 'KeyS' }, { panel }))?.op, panel).toBe('rig.animateOnly');
  }
  // Alt+C toggles the controls in Object mode; Mod+E opens Export in Rig & Skin.
  expect(await call(page, 'resolveKey', { code: 'KeyC', alt: true }, VIEWPORT)).toMatchObject({
    op: 'view.display.toggle',
    args: { flag: 'controls' },
  });
  await page.keyboard.press(`${await modKey(page)}+KeyE`);
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await call(page, 'state')).dialog).toBeNull();
  expect(await keysHash(page)).toBe(hash);
  // The Animate keymap snapshot is unchanged.
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  expect(await animateKeys()).toEqual(before);
});

test.fixme(`E2E-RIG-02: modes, scopes, shadows on a bound body (gates: ${GATES})`, async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const body = await createBodyCharacter(page);
  await runOk(page, 'skin.bind', {});
  await enterRig(page);
  await hoverPersp(page);
  const hips = await controlId(page, 'fk.hips', body.character);
  await runOk(page, 'select.controls', { ids: [hips], mode: 'replace' });
  const hash = await keysHash(page);
  for (const [key, expected] of [
    ['Digit1', 'skeleton'],
    ['Digit2', 'skin'],
    ['Digit2', 'object'],
    ['F8', 'skin'],
    ['F8', 'object'],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => mode(page)).toBe(expected);
    await page.keyboard.press('KeyS');
    expect(await keysHash(page)).toBe(hash);
  }
  await page.keyboard.press('Digit2');
  await expect.poll(() => mode(page)).toBe('skin');
  expect(await call(page, 'resolveKey', { code: 'KeyS' }, VIEWPORT)).toMatchObject({ op: 'rig.animateOnly' });
  expect(await call(page, 'resolveKey', { code: 'KeyC', alt: true }, VIEWPORT)).toMatchObject({
    op: 'view.display.toggle',
    args: { flag: 'weights' },
  });
  await page.keyboard.press(`${await modKey(page)}+KeyE`);
  await expect(page.getByTestId('export-dialog')).toBeVisible();
});
