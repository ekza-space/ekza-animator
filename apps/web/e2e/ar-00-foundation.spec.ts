import { expect, test } from '@playwright/test';
import { autorig, history, loaded, openAutoRig, SHELL_MARKERS, scriptsOf } from './helpers/autorig';
import { expectRefused } from './helpers/m6b-rig';
import { call, expectKernelStarted, openEditor, run } from './helpers/test-api';

// E2E-AR-00 (AUTORIG-SPEC §10 D0): the Auto-Rig contracts on a real build. Every `autorig.*` composition is a stub of
// the rig-workspace chunk — running one from Studio loads that chunk (never with the route) and refuses with
// "Arrives with Auto-Rig"; the palette lists them; `/editor` never loads the Auto-Rig shell and its test API answers
// `autorig()` with null; `/autorig` mounts the wizard (D3; D0's placeholder before it) without dockview, the curve
// editor, the Studio shell or any Rig & Skin chunk. The ids their owners landed refuse with their own argument polls.

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
  // D1 landed `autorig.navigate` (the host's navigation port), D3 the ① compositions: without arguments each refuses
  // with its own argument poll; the others are stubs until their owners land them.
  const landed: Readonly<Record<string, string>> = {
    'autorig.navigate': "expects { to: 'autorig' | 'studio' | 'chooser' }",
    'autorig.sample': 'expects { sample: cube-lad | polybot-tpose | polybot-apose | polybot | seed-san }',
    'autorig.intake': 'expects { bytes, name }',
    'autorig.inspect': 'expects { meshes }',
    'autorig.fix': 'expects { fix: center | face | standUp | scale | freeze, meshes }',
    // D6 landed `autorig.export` (its argument poll)
    'autorig.export': "expects { character, target: 'ekza-vrm' | 'glb' | 'vrma' | 'omoba-kit', fileName }",
  };
  for (const op of WIZARD_IDS) await expectRefused(page, op, landed[op] ?? 'Arrives with Auto-Rig');
  // the moved M6b stubs are unchanged until A0 lands them
  await expectRefused(page, 'skel.pose.applyAsRest', 'Arrives after the MVP', { pose: 'tStance' });

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

test('/autorig mounts the wizard without dockview, the curve editor, the Studio shell or rig chunks', async ({
  page,
}) => {
  const scripts = scriptsOf(page);
  await openAutoRig(page);
  const shell = page.locator(`[data-shell="${SHELL_MARKERS.autorig}"]`);
  await expect(shell).toBeVisible();
  // D3 replaced the placeholder with the wizard: ① Model (no model yet, so no Rig & Skin chunk either)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Model/);
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
  // "Open in Studio" leads to the full editor (Rig & Skin from ①)
  await page.getByRole('link', { name: /Open in Studio/ }).click();
  await expect(page).toHaveURL(/\/editor\?(.*&)?ws=rig/);
});
