import { expect, type Page, test } from '@playwright/test';
import { MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, run, runOk } from './helpers/test-api';

// B9 shell checks (M6A-SPEC §9 B9; not an E2E-MOD id): the workspace tabs, `ws=` and the Model layout, per-workspace
// viewport layouts and pane shading (Animate untouched by a Model round trip), the `4`–`7` shading keys, the pixel
// probe, the pointer platform rule (a context menu never opens a marking menu), the command palette and the Scale
// tool key — real input in Chrome, assertions through the test API.

async function hoverPane(page: Page, paneId: string): Promise<void> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === paneId);
  expect(pane, `pane ${paneId}`).toBeDefined();
  if (pane === undefined) return;
  await page.mouse.move(pane.rect.x + pane.rect.w / 2, pane.rect.y + pane.rect.h / 2);
}

type PaneRow = { id: string; shading?: string };
async function shadingOf(page: Page): Promise<Record<string, string | undefined>> {
  const rows = (await call(page, 'panes')) as PaneRow[];
  return Object.fromEntries(rows.map((row) => [row.id, row.shading]));
}

test('workspace tabs: Model › Rig & Skin › Animate › Review; a click on Model switches, Rig & Skin is disabled', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const tabs = page.getByTestId('ws-tabs');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  expect((await call(page, 'workspaces')).map((w) => [w.id, w.enabled, w.active, w.glyph])).toEqual([
    ['model', true, false, 'todo'],
    ['rig', false, false, 'none'],
    ['animate', true, true, 'todo'],
    ['review', false, false, 'none'],
  ]);
  await expect(page.getByTestId('ws-glyph-model')).toHaveText('○');
  await page.getByTestId('ws-tab-rig').click({ force: true });
  expect((await call(page, 'state')).workspace).toBe('animate');
  await page.getByTestId('ws-tab-model').click();
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('model');
  await expect(page.getByTestId('ws-tab-model')).toHaveAttribute('aria-selected', 'true');
  // Model's menus (§8.1): no Key or Pose menu.
  await expect(page.getByTestId('menu-create')).toBeVisible();
  await expect(page.getByTestId('menu-edit-mesh')).toBeVisible();
  await expect(page.getByTestId('menu-key')).toHaveCount(0);
});

test('ws=model opens the Model layout: Outliner, the M-Quad viewport with persp maximized, the right dock, no time slider', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  await expect(page.getByTestId('panel-outliner')).toBeVisible();
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-layout', 'quad');
  await expect.poll(async () => (await call(page, 'panes')).map((pane) => pane.id)).toEqual([MODEL_PANE]);
  await expect(page.getByTestId('timeline-region')).toHaveCount(0);
  // The Toolkit is the right dock's first tab (a placeholder until B11 lands it).
  await expect(page.getByText('Toolkit', { exact: true }).first()).toBeVisible();
  // Model's status-line groups and help line.
  for (const id of ['status-mode-object', 'status-sym', 'status-soft', 'status-snap-grid', 'status-pivot']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await hoverPane(page, MODEL_PANE);
  await expect(page.getByTestId('helpline-text')).toContainText('Object mode');
  // Windows › Timeline shows the time slider in Model.
  await runOk(page, 'workspace.toggleTimeline');
  await expect(page.getByTestId('timeline-region')).toBeVisible();
});

test('per-workspace views: Model’s colours and quad never show in Animate after a round trip; 4–7 set the pane', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(2);
  expect(await shadingOf(page)).toEqual({ 'pane-left': 'lit', 'pane-right': 'lit' });

  await runOk(page, 'workspace.set', { workspace: 'model' });
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'colours' });
  await hoverPane(page, MODEL_PANE);
  await page.keyboard.press('Digit4');
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'wire' });
  await page.keyboard.press('Digit5');
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'shaded' });

  await runOk(page, 'workspace.set', { workspace: 'animate' });
  await expect(page.getByTestId('viewport-panel')).toHaveAttribute('data-layout', 'split');
  await expect.poll(() => shadingOf(page)).toEqual({ 'pane-left': 'lit', 'pane-right': 'lit' });
  // In Animate the keys set Animate's pane only (§3 rule 10).
  await hoverPane(page, 'pane-right');
  await page.keyboard.press('Digit4');
  await expect.poll(() => shadingOf(page)).toEqual({ 'pane-left': 'lit', 'pane-right': 'wire' });
  await page.keyboard.press('Digit7');
  await expect.poll(() => shadingOf(page)).toEqual({ 'pane-left': 'lit', 'pane-right': 'lit' });

  await runOk(page, 'workspace.set', { workspace: 'model' });
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'shaded' });
});

test('the pixel probe reads the rendered pane (and nothing outside it); shading changes what it reads', async ({
  page,
}) => {
  await openEditor(page, '&ws=model');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(1);
  const pane = (await call(page, 'panes'))[0];
  if (pane === undefined) throw new Error('no pane');
  const corner = await call(page, 'pixel', MODEL_PANE, pane.rect.x + 4, pane.rect.y + 30);
  expect(corner[3]).toBe(255);
  expect(await call(page, 'pixel', MODEL_PANE, pane.rect.x - 50, pane.rect.y - 50)).toEqual([0, 0, 0, 0]);
  // The character covers the pane's centre: in wireframe the surface is gone there or drawn as lines.
  const centre = { x: pane.rect.x + pane.rect.w / 2, y: pane.rect.y + pane.rect.h / 2 };
  await runOk(page, 'view.shading', { mode: 'shaded', paneId: MODEL_PANE });
  const shaded = await call(page, 'pixel', MODEL_PANE, centre.x, centre.y);
  await runOk(page, 'view.shading', { mode: 'lit', paneId: MODEL_PANE });
  const lit = await call(page, 'pixel', MODEL_PANE, centre.x, centre.y);
  expect(shaded[3]).toBe(255);
  // Clay is neutral grey; whatever the model's own material is, the two looks are not the same pixel.
  const spread = Math.max(shaded[0], shaded[1], shaded[2]) - Math.min(shaded[0], shaded[1], shaded[2]);
  expect(spread).toBeLessThan(24);
  expect(lit).not.toEqual(shaded);
});

test('pointer platform rule (a): a context-menu event in a Model pane opens no marking menu and no browser menu', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  await hoverPane(page, MODEL_PANE);
  const prevented = await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="pane-pane-persp"]');
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 600,
      clientY: 400,
    });
    pane?.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  expect(await call(page, 'markingMenu')).toBeNull();
  // A real RMB press over empty space: no menu is registered for it yet (owners B10/B11), so nothing opens.
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  expect(await call(page, 'markingMenu')).toBeNull();
});

test('Mod+K opens the command palette: search with aliases, Enter runs the entry, Esc closes', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await hoverPane(page, 'pane-right');
  await page.keyboard.press(`${await modKey(page)}+KeyK`);
  await expect(page.getByTestId('cmdk')).toBeVisible();
  await expect(page.getByTestId('cmdk-input')).toBeFocused();
  expect(await call(page, 'commandPalette')).toMatchObject({ open: true, query: '' });
  await page.keyboard.type('workspace');
  // Disabled entries stay listed with their reason.
  await expect(page.getByTestId('cmdk-item-workspace.set:rig')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('cmdk-item-workspace.set:rig')).toContainText('v0.4');
  await page.keyboard.type(': model');
  await expect
    .poll(async () => (await call(page, 'commandPalette'))?.items[0])
    .toEqual({ op: 'workspace.set', label: 'Workspace: Model', enabled: true });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'state')).workspace).toBe('model');
  await expect(page.getByTestId('cmdk')).toBeHidden();
  // Blender-style aliases find operators by their other names ("Search" is the palette's own alias).
  await run(page, 'ui.commandPalette');
  await page.keyboard.type('f3 search');
  await expect.poll(async () => (await call(page, 'commandPalette'))?.items[0]?.op).toBe('ui.commandPalette');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cmdk')).toBeHidden();
  expect((await call(page, 'commandPalette'))?.open).toBe(false);
});

test('R selects the viewport Scale tool in Animate and in Model (§3 rule 10)', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await hoverPane(page, 'pane-right');
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('scale');
  await expect(page.getByTestId('status-tool-scale')).toHaveAttribute('aria-checked', 'true');
  await runOk(page, 'workspace.set', { workspace: 'model' });
  // Model starts with its own tool (select) and remembers Animate's.
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('select');
  await hoverPane(page, MODEL_PANE);
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('scale');
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('scale');
});
