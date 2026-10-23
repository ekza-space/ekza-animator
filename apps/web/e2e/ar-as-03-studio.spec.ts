// AUTORIG-SPEC §11 AS-AR-3 (D7, in full; E2E-AR-01 is D1's operator-built part): "Open in Studio and back". After
// AS-AR-1 step 7 through the UI (the Cube Lad dropped, rigged, Walk added): the header's *Open in Studio ▸* goes to
// `/editor?ws=animate` on the same page — the clip Walk is the active clip, `Mod+Z` undoes "Use Clip Walk" (the
// history crossed the switch); *Help › Switch to Auto-Rig* returns to ④ where Walk is gone; `⋯ › Open in Studio (new
// tab)` opens the same document in a new tab through a handoff record, without the Recovery dialog.
import { expect, test } from '@playwright/test';
import { addClip, onStep, rigThroughUi, toAnimations } from './helpers/ar-as';
import { expectAutoRigShown, expectStudioShown, markPage, openAutoRigReady, pageMark } from './helpers/ar-host';
import { fixtureBytes } from './helpers/ar-model';
import { wizard } from './helpers/ar-markers';
import { subjectCharacter } from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { hoverViewport } from './helpers/m6b-clip-library';
import { call, waitForTestApi } from './helpers/test-api';

test('AS-AR-3: Open in Studio keeps the page and the undo history; Switch to Auto-Rig returns; a new tab hands over', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  // one storage namespace for both tabs (e2e pages otherwise get a private one each, so a handoff could not be found)
  const ns = `as-ar-3-${test.info().workerIndex}-${Date.now().toString(36)}`;
  await openAutoRigReady(page, `&platform=mac&ns=${ns}`);
  await rigThroughUi(page, 'cube-lad.glb', new Uint8Array(fixtureBytes('cube-lad.glb')));
  const { character } = await subjectCharacter(page);
  await toAnimations(page);
  await addClip(page, { id: 'walk', name: 'Walk', search: 'walk' });
  const walk = (await call(page, 'clips', character)).find((clip) => clip.name === 'Walk');
  expect(walk).toBeDefined();
  const before = await history(page);
  const counts = await call(page, 'counts');
  await markPage(page);

  // Open in Studio ▸ (the header, on ④): Animate, same page, the clip active, the same history
  const open = page.getByTestId('ar-open-studio');
  await expect(open).toHaveAttribute('href', /\/editor\?.*ws=animate/);
  await open.click();
  await expectStudioShown(page);
  await expect(page).toHaveURL(/\/editor\?.*ws=animate/);
  expect(await pageMark(page)).toBe('kept');
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('animate');
  expect((await call(page, 'state')).activeClip).toBe(walk?.id);
  expect(await history(page)).toEqual(before);
  expect(await call(page, 'counts')).toEqual(counts);

  // Mod+Z in Studio undoes "Use Clip Walk": the undo history crossed the switch
  await hoverViewport(page);
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => (await history(page)).redo).toEqual(['Use Clip Walk']);
  expect((await history(page)).undo).toEqual(before.undo.slice(0, -1));

  // Help › Switch to Auto-Rig: back to ④ on the same page, Walk gone
  await page.getByTestId('menu-help').click();
  await page.getByTestId('menu-item-shell.help.autoRig').click();
  await expectAutoRigShown(page);
  expect(await pageMark(page)).toBe('kept');
  // ① offers Studio's character (D3's From Studio card: nothing is replaced without a click); then ④
  const card = page.getByTestId('ar-from-studio');
  await expect(card).toContainText('The character “Cube Lad” from Studio');
  await card.getByRole('button').click();
  await expect.poll(async () => (await wizard(page)).subject.character).toBe(character);
  await onStep(page, 'animations');
  await expect(page.getByTestId('ar-anim-grid')).toBeVisible();
  expect((await call(page, 'clips', character)).some((clip) => clip.name === 'Walk')).toBe(false);
  await expect(page.locator('[data-testid^="ar-char-clip-"]')).toHaveCount(0);
  expect((await wizard(page)).subject.character).toBe(character);

  // ⋯ › Open in Studio (new tab): the same document in a new tab, no Recovery dialog, history starts there
  const now = await call(page, 'counts');
  await page.getByTestId('ar-more').click();
  const [studio] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('menuitem', { name: 'Open in Studio (new tab)' }).click(),
  ]);
  await studio.waitForURL(/\/editor\?/);
  await waitForTestApi(studio);
  await expectStudioShown(studio);
  await expect.poll(() => call(studio, 'counts')).toEqual(now);
  await expect(studio.locator('[data-testid="toast"][data-kind="success"]')).toHaveText(
    'Opened in Studio; undo history starts here',
  );
  expect(studio.url()).not.toContain('handoff=');
  await expect.poll(async () => (await call(studio, 'state')).workspace).toBe('animate');
  expect(await history(studio)).toEqual({ undo: [], redo: [] });
  await studio.waitForTimeout(1_000);
  await expect(studio.getByTestId('recovery-dialog')).toHaveCount(0);
  // the source tab is still Auto-Rig with its document
  expect(page.url()).toMatch(/\/autorig\?/);
  expect(await call(page, 'counts')).toEqual(now);
});
