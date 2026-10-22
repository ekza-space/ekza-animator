import { expect, type Page, test } from '@playwright/test';
import { history, loaded, scriptsOf } from './helpers/autorig';
import { expectAutoRigShown, importStatic, markPage, pageMark } from './helpers/ar-host';
import { runMenuItem } from './helpers/m6a-model-ops-ui';
import { call, openEditor } from './helpers/test-api';

// E2E-AR-02 (AUTORIG-SPEC §3.3–§3.4; D2): Studio's switches to Auto-Rig. File › Auto-Rig This Model… is disabled
// without meshes or a character and, with the Cube Lad imported, switches on the same page keeping the document (no
// page load, the undo history kept, `?from=studio`) without loading the Rig & Skin chunk first; Help › Switch to
// Auto-Rig works in an empty document; the first-run dialog's third answer switches and remembers Auto-Rig for `/`
// only when ticked; Preferences › Start in sets what `/` opens (Ask shows the chooser).

const ENTRY_KEY = 'ekza-studio:entry:v1';
const RIG_CHUNK_MARKER = 'ekza-rig-workspace';

const remembered = (page: Page): Promise<unknown> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as unknown, ENTRY_KEY);

async function openMenu(page: Page, menu: string): Promise<void> {
  await page.getByTestId(`menu-${menu}`).click();
}

test('File › Auto-Rig This Model… needs a model, then switches on the same page keeping the document', async ({
  page,
}) => {
  await openEditor(page);
  await openMenu(page, 'file');
  const item = page.getByTestId('menu-item-shell.file.autoRig');
  await expect(item).toHaveText('Auto-Rig This Model…');
  await expect(item).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  await importStatic(page, 'cube-lad.glb');
  const before = await history(page);
  expect(before.undo).toEqual(['Import Static Model']);
  await markPage(page);
  await runMenuItem(page, 'file', 'shell.file.autoRig');
  await expectAutoRigShown(page);
  await expect(page).toHaveURL(/\/autorig\?e2e=1&from=studio$/);
  expect(await pageMark(page)).toBe('kept');
  expect(await history(page)).toEqual(before);
  expect((await call(page, 'counts'))['meshes']).toBeGreaterThan(0);
});

test('Help › Switch to Auto-Rig switches from an empty document without loading the Rig & Skin chunk', async ({
  page,
}) => {
  const scripts = scriptsOf(page);
  await openEditor(page);
  await markPage(page);
  await openMenu(page, 'help');
  await expect(page.getByTestId('menu-item-shell.help.autoRig')).toHaveText('Switch to Auto-Rig');
  await page.getByTestId('menu-item-shell.help.autoRig').click();
  await expectAutoRigShown(page);
  await expect(page).toHaveURL(/\/autorig\?e2e=1&from=studio$/);
  expect(await pageMark(page)).toBe('kept');
  // UI controls never route a navigation through the rig-workspace chunk (§3.4)
  expect(loaded(scripts, RIG_CHUNK_MARKER)).toBe(false);
});

test("the first-run dialog's third answer switches to Auto-Rig; ticked, it remembers Auto-Rig for /", async ({
  page,
}) => {
  await openEditor(page, '&firstRun=1');
  const dialog = page.getByTestId('firstrun-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('firstrun-remember-autorig')).toHaveCount(0);
  await page.getByTestId('firstrun-start-autorig').click();
  await expect(page.getByTestId('firstrun-done')).toHaveText('Start Auto-Rig');
  await page.getByTestId('firstrun-remember-autorig').check();
  await markPage(page);
  await page.getByTestId('firstrun-done').click();
  await expectAutoRigShown(page);
  expect(await pageMark(page)).toBe('kept');
  await expect.poll(() => remembered(page)).toMatchObject({ choice: 'autorig' });
  await page.goto('/');
  await expect(page).toHaveURL(/\/autorig$/);
});

test('the first-run third answer without the tick remembers nothing', async ({ page }) => {
  await openEditor(page, '&firstRun=1');
  await page.getByTestId('firstrun-start-autorig').click();
  await page.getByTestId('firstrun-done').click();
  await expectAutoRigShown(page);
  expect(await remembered(page)).toBeNull();
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
});

test('Preferences › Start in: Studio makes / open Studio, Ask brings the chooser back', async ({ page }) => {
  await openEditor(page);
  await runMenuItem(page, 'edit', 'shell.edit.prefs');
  const select = page.getByTestId('prefs-start-in');
  await expect(select).toHaveValue('ask');
  await select.selectOption('studio');
  expect(await remembered(page)).toMatchObject({ choice: 'studio' });
  await page.goto('/');
  await expect(page).toHaveURL(/\/editor$/);

  await openEditor(page);
  await runMenuItem(page, 'edit', 'shell.edit.prefs');
  await expect(page.getByTestId('prefs-start-in')).toHaveValue('studio');
  await page.getByTestId('prefs-start-in').selectOption('autorig');
  await page.goto('/');
  await expect(page).toHaveURL(/\/autorig$/);

  await openEditor(page);
  await runMenuItem(page, 'edit', 'shell.edit.prefs');
  await page.getByTestId('prefs-start-in').selectOption('ask');
  expect(await remembered(page)).toBeNull();
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('entry-chooser')).toBeVisible();
});
