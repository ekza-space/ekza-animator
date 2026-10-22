// E2E-AR-03 (AUTORIG-SPEC §10 D3, §4.3, §4.4, §3.1, §8.1): the wizard's session and frame on ①. The ① part of AS-AR-9 —
// a reload in the same tab offers "Continue where you left off" on ① and returns to the mirrored step once the
// document is back (Start over discards the slot); `?sample=` and `?step=`; From Studio ("Use these"); the `autorig`
// keys (Mod+Enter, Alt+1…5, Mod+Z; Studio's Mod+K palette key off, the palette through `⋯`); Simple navigation —
// a plain drag on empty space orbits the persp pane, Alt (Maya) keeps working, and after a switch to Studio a plain
// drag no longer orbits (the override is gone; the unit tests prove `navProfile` is never written); Open in Studio keeps the page and the history.
import { expect, type Page, test } from '@playwright/test';
import { expectStudioShown, importStatic, markPage, navigate, openAutoRigReady, pageMark } from './helpers/ar-host';
import { waitForReport } from './helpers/ar-model';
import { autorig, history } from './helpers/autorig';
import { call, openEditor, waitForTestApi } from './helpers/test-api';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function loadCubeLad(page: Page): Promise<void> {
  await page.locator('[data-sample="cube-lad"]').click();
  await waitForReport(page, 'cube-lad.glb');
}

/** The centre of a pane's surface (page CSS px). */
async function paneCentre(page: Page, paneId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`pane-${paneId}`).boundingBox();
  if (box === null) throw new Error(`no pane ${paneId}`);
  return { x: box.x + box.width * 0.2, y: box.y + box.height * 0.2 };
}

async function drag(page: Page, at: { x: number; y: number }, dx: number, alt = false): Promise<void> {
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(at.x + (dx * i) / 5, at.y + i);
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

const moved = (a: { position: number[] }, b: { position: number[] }): boolean =>
  a.position.some((v, i) => Math.abs(v - (b.position[i] ?? 0)) > 1e-6);

test('AS-AR-9 (① part): a reload offers Continue on ① and returns to the mirrored step', async ({ page }) => {
  const ns = `ar03-${Date.now()}`;
  await openAutoRigReady(page, `&ns=${ns}`);
  await loadCubeLad(page);
  await page.getByTestId('ar-primary').click();
  await expect.poll(async () => (await autorig(page))?.step).toBe('markers');
  const subject = (await autorig(page))?.subject;
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());

  await page.reload();
  await waitForTestApi(page);
  // the document is not back yet: ① with the card, the step waits
  await expect(page.getByTestId('ar-continue')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ar-continue')).toContainText('Continue where you left off');
  expect((await autorig(page))?.step).toBe('model');
  // never Studio's Recovery dialog
  await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
  await page.getByTestId('ar-continue').getByRole('button', { name: 'Continue' }).click();
  await expect.poll(async () => (await autorig(page))?.step, { timeout: 15_000 }).toBe('markers');
  expect((await autorig(page))?.subject).toEqual(subject);
  expect((await call(page, 'counts'))['meshes']).toBe(1);

  // Start over discards the slot: another reload offers nothing
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());
  await page.reload();
  await waitForTestApi(page);
  const card = page.getByTestId('ar-continue');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Start over' }).click();
  await expect(card).toHaveCount(0);
  expect((await call(page, 'state')).recovery).toEqual([]);
});

test('?sample= loads a sample once and ?step= opens that step when it becomes reachable', async ({ page }) => {
  await openAutoRigReady(page, '&sample=cube-lad&step=markers');
  await expect.poll(async () => (await autorig(page))?.step, { timeout: 30_000 }).toBe('markers');
  expect((await autorig(page))?.intake).toMatchObject({ kind: 'static', fileName: 'cube-lad.glb' });
  expect(await history(page)).toEqual({ undo: ['Import Static Model'], redo: [] });
  // the parameters are dropped (a reload neither loads the sample again nor jumps)
  expect(page.url()).not.toMatch(/sample=|step=/);
  // an unreachable step lands on the furthest reachable one
  await openAutoRigReady(page, '&step=export');
  expect((await autorig(page))?.step).toBe('model');
});

test('From Studio: the scene meshes Studio hands over wait for "Use these" on ①', async ({ page }) => {
  await openEditor(page);
  const meshes = await importStatic(page, 'cube-lad.glb');
  await navigate(page, { to: 'autorig', from: 'studio' });
  await waitForTestApi(page);
  const card = page.getByTestId('ar-from-studio');
  await expect(card).toBeVisible();
  await expect(card).toContainText('1 mesh from your Studio scene');
  expect((await autorig(page))?.subject).toEqual({ character: null, meshes: [] });
  await card.getByRole('button', { name: 'Use these' }).click();
  await expect.poll(async () => (await autorig(page))?.subject.meshes).toEqual(meshes);
  await expect(page.getByTestId('ar-model-report')).toBeVisible();
  await expect(card).toHaveCount(0);
  expect((await autorig(page))?.intake).toMatchObject({ kind: 'static', checks: { centred: true } });
  expect((await autorig(page))?.startPose).toMatchObject({ kind: 't' });
  // "From Studio never replaces anything": the import is still the one undo step
  expect((await history(page)).undo).toEqual(['Import Static Model']);
});

test('the autorig keys: Mod+Enter, Alt+1…5, Mod+Z; no palette key, the palette through ⋯', async ({ page }) => {
  await openAutoRigReady(page, '&platform=mac');
  await loadCubeLad(page);
  await page.locator('body').click({ position: { x: 5, y: 120 } });
  await page.keyboard.press(`${mod}+Enter`);
  await expect.poll(async () => (await autorig(page))?.step).toBe('markers');
  await page.keyboard.press('Alt+Digit1');
  await expect.poll(async () => (await autorig(page))?.step).toBe('model');
  await page.keyboard.press('Alt+Digit3'); // ③ is not reachable: nothing happens
  await page.waitForTimeout(100);
  expect((await autorig(page))?.step).toBe('model');
  // Studio's palette key is off in Auto-Rig; ⋯ › Command palette… opens it
  await page.keyboard.press(`${mod}+KeyK`);
  await page.waitForTimeout(100);
  expect((await call(page, 'commandPalette'))?.open ?? false).toBe(false);
  await page.getByTestId('ar-more').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Command palette…' }).click();
  await expect(page.getByTestId('cmdk')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cmdk')).toBeHidden();
  // the ⋯ menu by keyboard: arrows move, Esc closes and gives the focus back
  await page.getByTestId('ar-more').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Open project…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByTestId('ar-more')).toBeFocused();
  // Mod+Z undoes the import: ① has no model again
  await page.keyboard.press(`${mod}+KeyZ`);
  await expect.poll(async () => (await autorig(page))?.done.model).toBe(false);
  await expect(page.getByTestId('ar-drop-zone')).toBeVisible();
});

test('Simple navigation: a plain drag orbits on ①; after a switch Studio navigates with the user profile', async ({
  page,
}) => {
  await openAutoRigReady(page);
  await loadCubeLad(page);
  const at = await paneCentre(page, 'pane-persp');
  const start = await call(page, 'cameraOf', 'pane-persp');
  await drag(page, at, 120);
  const orbited = await call(page, 'cameraOf', 'pane-persp');
  expect(moved(orbited, start)).toBe(true);
  // Alt + mouse (Maya) keeps working
  await drag(page, at, -80, true);
  expect(moved(await call(page, 'cameraOf', 'pane-persp'), orbited)).toBe(true);

  await markPage(page);
  await navigate(page, { to: 'studio', workspace: 'rig', from: 'autorig' });
  await expectStudioShown(page);
  expect(await pageMark(page)).toBe('kept');
  const persp = (await call(page, 'panes')).find((pane) => pane.camera === 'persp');
  if (persp === undefined) throw new Error('no persp pane in Studio');
  // low in the pane: Studio's empty-state and Getting started cards sit over its top
  const studioAt = { x: persp.rect.x + persp.rect.w * 0.15, y: persp.rect.y + persp.rect.h * 0.85 };
  const before = await call(page, 'cameraOf', persp.id);
  await drag(page, studioAt, 120);
  expect(moved(await call(page, 'cameraOf', persp.id), before)).toBe(false);
  await drag(page, studioAt, 120, true);
  expect(moved(await call(page, 'cameraOf', persp.id), before)).toBe(true);
});

test('Open in Studio switches on the same page with the history; Rig & Skin from ①', async ({ page }) => {
  await openAutoRigReady(page);
  await loadCubeLad(page);
  await markPage(page);
  const link = page.getByTestId('ar-open-studio');
  await expect(link).toHaveAttribute('href', '/editor?ws=rig');
  await link.click();
  await expectStudioShown(page);
  expect(await pageMark(page)).toBe('kept');
  expect((await call(page, 'state')).workspace).toBe('rig');
  expect(await history(page)).toEqual({ undo: ['Import Static Model'], redo: [] });
  // and back: the wizard returns to ① with its subject (the session mirror of this tab)
  await navigate(page, { to: 'autorig', from: 'studio' });
  await waitForTestApi(page);
  await expect.poll(async () => (await autorig(page))?.subject.meshes.length).toBe(1);
  await expect(page.getByTestId('ar-from-studio')).toHaveCount(0);
});
