import { expect, type Page, test } from '@playwright/test';
import { pointOf } from './helpers/g1-viewport';
import { controlIdOf, DEG, horizontalDrag, selectIds } from './helpers/m2a-a2';
import { MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, run, runOk } from './helpers/test-api';

// B9 shell checks (M6A-SPEC §9 B9; not an E2E-MOD id): the workspace tabs, `ws=` and the Model layout, per-workspace
// viewport layouts and pane shading (Animate untouched by a Model round trip), the `4`–`7` shading keys, the pixel
// probe, the pointer platform rule (a context menu never opens a marking menu, a right-button press opens the fixture
// menu, press-drag-release and flick run its slots), the command palette and the Scale tool key — real input in
// Chrome, assertions through the test API.

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

/** Heights of the dock groups holding a Mesh Check tab and widths of those holding a Toolkit tab (page CSS px). */
async function dockGroups(page: Page): Promise<{ meshCheck: number[]; toolkit: number[] }> {
  return page.evaluate(() => {
    const groupsOf = (title: string): DOMRect[] =>
      [...document.querySelectorAll('.dv-tab')]
        .filter((tab) => tab.textContent?.trim() === title)
        .map((tab) => tab.closest('.dv-groupview')?.getBoundingClientRect() ?? new DOMRect(0, 0, -1, -1));
    return {
      meshCheck: groupsOf('Mesh Check').map((rect) => Math.round(rect.height)),
      toolkit: groupsOf('Toolkit').map((rect) => Math.round(rect.width)),
    };
  });
}

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
  // Mesh Check starts collapsed to its tab strip (§8.2: 26 px), the right dock 300 px wide; a round trip through
  // Animate restores them.
  expect(await dockGroups(page)).toEqual({ meshCheck: [26], toolkit: [300] });
  await runOk(page, 'workspace.set', { workspace: 'animate' });
  await expect(page.getByTestId('timeline-region')).toBeVisible();
  await runOk(page, 'workspace.set', { workspace: 'model' });
  await expect(page.getByTestId('timeline-region')).toHaveCount(0);
  await expect.poll(() => dockGroups(page)).toEqual({ meshCheck: [26], toolkit: [300] });
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
  // Under parallel workers the character may not be drawn yet: wait until the centre is not the background (the
  // corner's pixel) before reading the shaded look (B13's hand-over: it read [52, 53, 59] at the centre once).
  await expect
    .poll(async () => (await call(page, 'pixel', MODEL_PANE, centre.x, centre.y)).join(), { timeout: 15_000 })
    .not.toBe(corner.join());
  const shaded = await call(page, 'pixel', MODEL_PANE, centre.x, centre.y);
  await runOk(page, 'view.shading', { mode: 'lit', paneId: MODEL_PANE });
  const lit = await call(page, 'pixel', MODEL_PANE, centre.x, centre.y);
  expect(shaded[3]).toBe(255);
  // Clay is neutral grey; whatever the model's own material is, the two looks are not the same pixel.
  const spread = Math.max(shaded[0], shaded[1], shaded[2]) - Math.min(shaded[0], shaded[1], shaded[2]);
  expect(spread).toBeLessThan(24);
  expect(lit).not.toEqual(shaded);
});

/** Dispatches a bare `contextmenu` event on the Model pane; true when the viewport prevented the browser menu. */
async function contextMenuEvent(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(
    ({ x, y }) => {
      const pane = document.querySelector('[data-testid="pane-pane-persp"]');
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: x,
        clientY: y,
      });
      pane?.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { x, y },
  );
}

test('pointer platform rule (a): a context-menu event opens no marking menu; a real RMB press opens a registered one', async ({
  page,
}) => {
  // `mmFixture=1` registers the test API's fixture menu `e2e.fixture` (plain RMB in Model; M6A-B9-23).
  await openModel(page, '&mmFixture=1');
  await expectKernelStarted(page);
  const pane = (await call(page, 'panes')).find((entry) => entry.id === MODEL_PANE);
  if (pane === undefined) throw new Error('no Model pane');
  // Left of the empty-state card, which sits at the pane's centre and takes its own presses.
  const point = { x: pane.rect.x + 160, y: pane.rect.y + pane.rect.h / 2 };
  expect(await contextMenuEvent(page, point.x, point.y)).toBe(true);
  expect(await call(page, 'markingMenu')).toBeNull();

  // A real right-button press (button 2) opens the menu at the pointer. Chrome also fires `contextmenu` on it; the
  // pane suppresses that. The controller loads lazily on entering Model: a press before it is there opens nothing.
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(async () => {
      await page.mouse.down({ button: 'right' });
      const open = await call(page, 'markingMenu');
      if (open === null) await page.mouse.up({ button: 'right' });
      return open?.id ?? null;
    })
    .toBe('e2e.fixture');
  const open = await call(page, 'markingMenu');
  expect(open?.slots).toEqual({
    N: { label: 'Wireframe', op: 'view.shading', enabled: true },
    S: { label: 'Shaded', op: 'view.shading', enabled: true },
    E: { label: 'Later', op: null, enabled: false },
  });
  // Held past the flick window, the menu is drawn; press-drag-release onto a slot runs it.
  const menu = page.getByTestId('mm-e2e.fixture');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('mm-slot-N')).toContainText('Wireframe');
  await expect(menu.getByTestId('mm-slot-E')).toHaveAttribute('aria-disabled', 'true');
  const south = open?.screenOfSlot['S'];
  if (south === undefined) throw new Error('no S slot position');
  await page.mouse.move(south.x, south.y, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'shaded' });
  expect(await call(page, 'markingMenu')).toBeNull();
  await expect(menu).toHaveCount(0);

  // A flick: press, move 40 px toward N and release at once — the slot runs without the menu being drawn.
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(point.x, point.y - 40, { steps: 2 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'wire' });
  expect(await call(page, 'markingMenu')).toBeNull();
  await expect(menu).toHaveCount(0);

  // With the menu registered and its controller loaded, a `contextmenu` event alone still opens nothing.
  expect(await contextMenuEvent(page, point.x, point.y)).toBe(true);
  expect(await call(page, 'markingMenu')).toBeNull();
  await expect(menu).toHaveCount(0);
  expect(await shadingOf(page)).toEqual({ [MODEL_PANE]: 'wire' });
});

/** Right-presses at (x, y) until the fixture menu opens (its controller loads on entering Model), then releases. */
async function fixtureFlick(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await expect
    .poll(async () => {
      await page.mouse.down({ button: 'right' });
      const open = await call(page, 'markingMenu');
      if (open === null) await page.mouse.up({ button: 'right' });
      return open?.id ?? null;
    })
    .toBe('e2e.fixture');
  await page.mouse.move(to.x, to.y, { steps: 2 });
  await page.mouse.up({ button: 'right' });
  expect(await call(page, 'markingMenu')).toBeNull();
}

test('marking menu near the window edges: a flick runs the slot in the direction moved from the press', async ({
  page,
}) => {
  await openModel(page, '&mmFixture=1');
  await expectKernelStarted(page);
  // The viewport panel maximized: the pane reaches the window's left edge.
  await runOk(page, 'view.toggleMaximize', { panel: 'viewport' });
  await expect
    .poll(async () => (await call(page, 'panes')).find((entry) => entry.id === MODEL_PANE)?.rect.x ?? -1)
    .toBeLessThan(2);
  const pane = (await call(page, 'panes')).find((entry) => entry.id === MODEL_PANE);
  if (pane === undefined) throw new Error('no Model pane');
  const inner = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const middle = pane.rect.y + pane.rect.h / 2;
  // Each press is within the menu's edge margin (144 px), where the drawing moves inwards.
  const left = { x: pane.rect.x + 30, y: middle };
  const top = { x: pane.rect.x + pane.rect.w / 2, y: pane.rect.y + 20 };
  const bottom = { x: pane.rect.x + pane.rect.w / 2, y: pane.rect.y + pane.rect.h - 20 };
  expect(left.x).toBeLessThan(144);
  expect(top.y).toBeLessThan(144);
  expect(inner.h - bottom.y).toBeLessThan(144);
  expect(await shadingOf(page)).toEqual({ [MODEL_PANE]: 'colours' });

  await fixtureFlick(page, left, { x: left.x, y: left.y - 40 });
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'wire' });
  await fixtureFlick(page, top, { x: top.x, y: top.y + 40 });
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'shaded' });
  await fixtureFlick(page, bottom, { x: bottom.x, y: bottom.y - 40 });
  await expect.poll(() => shadingOf(page)).toEqual({ [MODEL_PANE]: 'wire' });
  await expect(page.getByTestId('mm-e2e.fixture')).toHaveCount(0);
});

/** The shown pane's whole box (header and surface) and the viewport panel's box, page CSS px. */
async function paneAndPanel(page: Page, paneId: string): Promise<{ pane: number[]; panel: number[] }> {
  return page.evaluate((id) => {
    const box = (el: Element | null | undefined): number[] => {
      const r = el?.getBoundingClientRect();
      return r === undefined ? [] : [r.x, r.y, r.width, r.height].map((v) => Math.round(v));
    };
    const surface = document.querySelector(`[data-testid="pane-${id}"]`);
    return {
      pane: box(surface?.closest('section')),
      panel: box(document.querySelector('[data-testid="viewport-panel"]')),
    };
  }, paneId);
}

async function expectPaneFillsPanel(page: Page, paneId: string): Promise<void> {
  await expect.poll(async () => (await call(page, 'panes')).map((pane) => pane.id)).toEqual([paneId]);
  const { pane, panel } = await paneAndPanel(page, paneId);
  expect(panel[2], 'panel width').toBeGreaterThan(400);
  expect(pane, `${paneId} fills the viewport panel`).toEqual(panel);
  const surface = (await call(page, 'panes'))[0];
  expect(Math.round(surface?.rect.w ?? 0)).toBe(panel[2]);
}

test('a single or maximized pane fills the viewport panel (Model’s first view, Animate’s Space and Single)', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  await expectPaneFillsPanel(page, MODEL_PANE);

  await runOk(page, 'workspace.set', { workspace: 'animate' });
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(2);
  await hoverPane(page, 'pane-right');
  await page.keyboard.press('Space');
  await expectPaneFillsPanel(page, 'pane-right');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await call(page, 'panes')).length).toBe(2);
  await runOk(page, 'view.layout', { layout: 'single' });
  await expectPaneFillsPanel(page, 'pane-single');
});

test('§5.17: a control selected in Animate is neither handled nor slid in a Model pane that hides controls', async ({
  page,
}) => {
  // The trackpad profile has the MMB stand-in in Model; pointer capture instead of Pointer Lock for CDP moves.
  await openEditor(page, '&nav=trackpad&pointerLock=off');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  // The cog translates and rotates freely: in Animate the move and rotate tools sit on it.
  const cog = await controlIdOf(page, 'cog');
  await selectIds(page, [cog]);
  await page.getByTestId('cb-name-rz').click();
  await hoverPane(page, 'pane-right');
  await page.keyboard.press('KeyW');
  await pointOf(page, () => call(page, 'screenOfManipulator', 'pane-right', 'ty'), 'ty arrow in Animate');
  await page.keyboard.press('KeyE');
  await pointOf(page, () => call(page, 'screenOfManipulator', 'pane-right', 'rz'), 'rz ring in Animate');
  const rz = async () => (await call(page, 'channelValues', cog)).rz ?? Number.NaN;
  const before = await call(page, 'channelValues', cog);
  const history = (await call(page, 'state')).history.undoLabel;

  await runOk(page, 'workspace.set', { workspace: 'model' });
  expect((await call(page, 'state')).selection.controls).toEqual([cog]);
  await hoverPane(page, MODEL_PANE);
  for (const [key, tool, handle] of [
    ['KeyW', 'move', 'ty'],
    ['KeyE', 'rotate', 'rz'],
    ['KeyR', 'scale', 'sx'],
  ] as const) {
    await page.keyboard.press(key);
    await expect.poll(async () => (await call(page, 'state')).tool).toBe(tool);
    expect(await call(page, 'screenOfManipulator', MODEL_PANE, handle), `${tool} in Model`).toBeNull();
  }
  // The pane does not draw controls: neither an MMB drag nor the stand-in (Alt+Shift+LMB) slides the channel.
  const pane = (await call(page, 'panes')).find((entry) => entry.id === MODEL_PANE);
  if (pane === undefined) throw new Error('no Model pane');
  const from = { x: pane.rect.x + 80, y: pane.rect.y + pane.rect.h - 80 };
  await horizontalDrag(page, from, 40, { button: 'middle' });
  await horizontalDrag(page, from, 40, { modifiers: ['Alt', 'Shift'] });
  expect(await call(page, 'channelValues', cog)).toEqual(before);
  expect((await call(page, 'state')).history.undoLabel).toBe(history);

  // Show ▸ Controls in the pane: the stand-in slides it at the MMB rate (40 px = +20°, Shift is the chord's, not ×0.1).
  await runOk(page, 'view.display.set', { patch: { controls: true }, paneId: MODEL_PANE });
  await horizontalDrag(page, from, 40, { modifiers: ['Alt', 'Shift'] });
  await expect.poll(async () => Math.abs((await rz()) - ((before.rz ?? 0) + 20 * DEG))).toBeLessThan(1e-9);
  expect((await call(page, 'state')).history.undoLabel).toBe('Drag Rotate Z');
  // The transform tools follow the slider's rule: where the pane draws controls, E puts the ring on the cog.
  await hoverPane(page, MODEL_PANE);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('rotate');
  await pointOf(
    page,
    () => call(page, 'screenOfManipulator', MODEL_PANE, 'rz'),
    'rz ring in Model with Show ▸ Controls',
  );
  // Hidden again: no ring.
  await runOk(page, 'view.display.set', { patch: { controls: false }, paneId: MODEL_PANE });
  await expect.poll(() => call(page, 'screenOfManipulator', MODEL_PANE, 'rz')).toBeNull();
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
