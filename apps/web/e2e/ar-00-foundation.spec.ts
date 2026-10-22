import { expect, test } from '@playwright/test';
import { autorig, history, loaded, openAutoRig, SHELL_MARKERS, scriptsOf } from './helpers/autorig';
import { expectRefused } from './helpers/m6b-rig';
import { call, expectKernelStarted, openEditor, run } from './helpers/test-api';

// E2E-AR-00 (AUTORIG-SPEC §10 D0): the Auto-Rig contracts on a real build. Every `autorig.*` composition is a stub of
// the rig-workspace chunk — running one from Studio loads that chunk (never with the route) and refuses with
// "Arrives with Auto-Rig"; the palette lists them; `/editor` never loads the Auto-Rig shell and its test API answers
// `autorig()` with null; the placeholder `/autorig` page mounts the shell stub without dockview, the curve editor,
// the Studio shell or any Rig & Skin chunk.

const WIZARD_IDS = [
  'autorig.sample',
  'autorig.intake',
  'autorig.inspect',
  'autorig.fix',
  'autorig.rig',
  'autorig.cancel',
  'autorig.clip.add',
  'autorig.export',
  'autorig.navigate',
] as const;

test('autorig.* ids load the rig-workspace chunk on first run and refuse as stubs; /editor never loads the shell', async ({
  page,
}) => {
  const scripts = scriptsOf(page);
  await openEditor(page);
  await expectKernelStarted(page);
  expect(loaded(scripts, 'ekza-rig-workspace')).toBe(false);
  const before = await call(page, 'counts');

  await expectRefused(page, 'autorig.rig', 'Arrives with Auto-Rig', { straighten: true });
  await expect.poll(() => loaded(scripts, 'ekza-rig-workspace')).toBe(true);
  for (const op of WIZARD_IDS) await expectRefused(page, op, 'Arrives with Auto-Rig');
  // the moved M6b stubs: A0 landed them (E2E-AR-A0); without a character they refuse with their own reason
  await expectRefused(page, 'skel.pose.applyAsRest', 'Make a character from your model first', { pose: 'tStance' });

  expect(await autorig(page)).toBeNull();
  expect(loaded(scripts, SHELL_MARKERS.autorig)).toBe(false);
  expect(await call(page, 'counts')).toEqual(before);
  expect(await history(page)).toEqual({ undo: [], redo: [] });
});

test('the command palette lists the Auto-Rig compositions, disabled with their reason', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await expectRefused(page, 'autorig.cancel', 'Arrives with Auto-Rig'); // loads the rig-workspace chunk
  expect((await run(page, 'ui.commandPalette')).status).toBe('finished');
  await expect(page.getByTestId('cmdk')).toBeVisible();
  const palette = await call(page, 'commandPalette');
  const items = new Map((palette?.items ?? []).map((item) => [item.op, item]));
  expect(WIZARD_IDS.filter((op) => !items.has(op))).toEqual([]);
  expect(items.get('autorig.rig')).toMatchObject({ label: 'Auto-Rig', enabled: false });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cmdk')).toBeHidden();
});

test('/autorig mounts the shell placeholder without dockview, the curve editor, the Studio shell or rig chunks', async ({
  page,
}) => {
  const scripts = scriptsOf(page);
  await openAutoRig(page);
  const shell = page.locator(`[data-shell="${SHELL_MARKERS.autorig}"]`);
  await expect(shell).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Auto-Rig is on its way');
  await expect(page).toHaveTitle(/Auto-Rig/);
  await expect.poll(() => loaded(scripts, SHELL_MARKERS.autorig)).toBe(true);
  for (const marker of [
    'dv-dockview',
    'Absolute, normalized or stacked curves',
    SHELL_MARKERS.studio,
    'ekza-rig-workspace',
    'ekza-clip-library',
    'firstrun-dialog',
    'cmdk-input',
  ]) {
    expect([marker, loaded(scripts, marker)]).toEqual([marker, false]);
  }
  // "Open Studio" leads to the full editor
  await page.getByRole('link', { name: 'Open Studio' }).click();
  await expect(page).toHaveURL(/\/editor$/);
});
