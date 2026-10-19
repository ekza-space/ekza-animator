import { expect, type Page, test } from '@playwright/test';
import { clickComponent, createPrimitive, MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, run } from './helpers/test-api';

// E2E-MOD-03 "Mod+E scopes" (M6A-SPEC §10.1; owner B0b): Mod+E is Extrude everywhere in the Model workspace (scope
// `model`, §7), Export keeps Mod+Shift+E there and stays on Mod+E in Animate. Real key presses through the editor's
// keyboard adapter, with the pointer over the named panel.
//
// Gates (§3 rule 4): part (a) needed the Model workspace, which B9 registers (its `b9` gate is lifted; see
// docs/wp-notes/m6a-keymap-menus.md for the Gates-column request); part (b) is gated on b3, b7, b10 as §10.1 says.
// The Export dialog opens only with something to export (`ui.open` polls "Load a character to export"), so the
// scenes that press an Export chord load the Polybot sample first; the key routing is what this scenario checks.

/** Moves the pointer to the middle of a viewport pane. */
async function hoverPane(page: Page, paneId: string): Promise<void> {
  const pane = (await call(page, 'panes')).find((entry) => entry.id === paneId);
  expect(pane, `pane ${paneId}`).toBeDefined();
  if (pane === undefined) return;
  await page.mouse.move(pane.rect.x + pane.rect.w / 2, pane.rect.y + pane.rect.h / 2);
}

async function hoverOutliner(page: Page): Promise<void> {
  const box = await page.getByTestId('panel-outliner').boundingBox();
  expect(box, 'the Outliner panel').not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

async function pressMod(page: Page, key: string): Promise<void> {
  await page.keyboard.press(`${await modKey(page)}+${key}`);
}

/** Waits for the (lazy) Export dialog to show, then closes it with Esc. */
async function closeExport(page: Page): Promise<void> {
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toBeHidden();
  await expect.poll(() => dialog(page)).toBeNull();
}

async function dialog(page: Page): Promise<string | null> {
  return (await call(page, 'state')).dialog;
}

test('E2E-MOD-03 (a) — Mod+E resolves to Extrude over the pane and the Outliner in Model', async ({ page }) => {
  await openModel(page);
  for (const at of [{ panel: 'viewport', paneId: MODEL_PANE }, { panel: 'outliner' }]) {
    expect(await call(page, 'resolveKey', { code: 'KeyE', mod: true }, at)).toEqual({
      op: 'mesh.extrude',
      scope: 'model',
    });
  }
  // Pressed over the Outliner: no dialog; the help line says why Extrude cannot run (its poll reason).
  const refused = await run(page, 'mesh.extrude', undefined, { panel: 'outliner' });
  expect(refused.status).toBe('cancelled');
  await hoverOutliner(page);
  await pressMod(page, 'KeyE');
  await expect(page.getByTestId('helpline-text')).toHaveText(refused.reason ?? '');
  expect(await dialog(page)).toBeNull();
  // Mod+Shift+E over the pane opens Export; Esc closes it.
  await seedSample(page, 'polybot');
  await hoverPane(page, MODEL_PANE);
  await page.keyboard.press(`${await modKey(page)}+Shift+KeyE`);
  await expect.poll(() => dialog(page)).toBe('export');
  await closeExport(page);
});

test.fixme('b3, b7, b10: E2E-MOD-03 (b) — Mod+E over the pane extrudes the top face of a cube', async ({ page }) => {
  await openModel(page);
  const cube = await createPrimitive(page, 'cube');
  // §7: in object mode (and over other panels) Mod+E poll-fails with this help-line text.
  await hoverOutliner(page);
  await pressMod(page, 'KeyE');
  await expect(page.getByTestId('helpline-text')).toHaveText('Select faces or border edges');
  await hoverPane(page, MODEL_PANE);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const top = await topFace(page, cube);
  await clickComponent(page, cube, 'face', top);
  await hoverPane(page, MODEL_PANE);
  await pressMod(page, 'KeyE');
  await expect.poll(async () => (await call(page, 'meshInfo', cube))?.counts).toMatchObject({ v: 12, e: 20, f: 10 });
  expect(await dialog(page)).toBeNull();
});

test('E2E-MOD-03 (c) — in Animate Mod+E opens Export (ui.open, scope global), Mod+Shift+E too', async ({ page }) => {
  await openEditor(page, '&ws=animate');
  await expectKernelStarted(page);
  expect((await call(page, 'state')).workspace).toBe('animate');
  await seedSample(page, 'polybot');
  for (const at of [{ panel: 'viewport', paneId: 'pane-right' }, { panel: 'outliner' }, { panel: 'graph' }]) {
    expect(await call(page, 'resolveKey', { code: 'KeyE', mod: true }, at)).toEqual({
      op: 'ui.open',
      args: { dialog: 'export' },
      scope: 'global',
    });
  }
  const pane = (await call(page, 'panes'))[0];
  expect(pane).toBeDefined();
  if (pane === undefined) return;
  await page.mouse.move(pane.rect.x + pane.rect.w / 2, pane.rect.y + pane.rect.h / 2);
  await pressMod(page, 'KeyE');
  await expect.poll(() => dialog(page)).toBe('export');
  await closeExport(page);
  await hoverOutliner(page);
  await page.keyboard.press(`${await modKey(page)}+Shift+KeyE`);
  await expect.poll(() => dialog(page)).toBe('export');
  await closeExport(page);
  // Nothing of Model leaked into Animate's menu bar.
  await expect(page.getByTestId('menu-edit-mesh')).toHaveCount(0);
  await expect(page.getByTestId('menu-key')).toBeVisible();
});

/** The face whose centroid is highest (+Y): the cube's top. */
async function topFace(page: Page, mesh: string): Promise<number> {
  const faces = await call(page, 'meshFaces', mesh);
  const positions = await call(page, 'meshPositions', mesh);
  let best = -1;
  let bestY = Number.NEGATIVE_INFINITY;
  faces.forEach((face, index) => {
    const y = face.reduce((sum, vertex) => sum + (positions[vertex]?.[1] ?? 0), 0) / face.length;
    if (y > bestY) {
      bestY = y;
      best = index;
    }
  });
  return best;
}
