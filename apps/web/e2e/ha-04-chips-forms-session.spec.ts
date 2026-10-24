import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { expectStudioShown } from './helpers/ar-host';
import {
  emptyPoint,
  meshPoint,
  halo,
  haloMenu,
  loadCubeLadInMake,
  loadPolybot,
  openHalo,
  petal,
  tapStage,
} from './helpers/halo';
import { call, runOk } from './helpers/test-api';
import { fingerHold, fingerTap } from './helpers/touch';

// ha-04 Echo chips, forms and the session bar (STUDIO-TOUCH-SPEC §5.6, §5.7, §6.1, P15, ST-34; T6a exit test),
// `chrome-touch`: after an adjustable operation its parameters float as chips beside the result and a change is one
// Adjust Last (the step is replaced, not added), with the numpad on a tap; after a face operation a reduced Halo stays
// (Pull again · Bevel · Inset); a non-adjustable operator opens its pre-run form first (✓ runs it); a modal tool
// session shows `✕ Cancel · tool · hint · ✓ Done`, and leaving — a stage switch, ▤ Pro layout — commits it.

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

async function centre(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`no ${testId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('Pull: Echo chips adjust the last run in place; a reduced Halo stays; leaving commits the cap', async ({
  page,
}, testInfo) => {
  touchOnly(testInfo);
  await openHalo(page);
  await loadCubeLadInMake(page);
  // Faces, then a face: its Halo
  await page.getByTestId('halo-pick').getByRole('radio', { name: 'Faces' }).click();
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  await fingerTap(page, await meshPoint(page));
  await expect.poll(async () => (await halo(page)).noun?.kind).toBe('faces');
  await expect(petal(page, 'Pull')).toBeVisible();
  const steps = (await call(page, 'history')).undo.length;
  const box = await petal(page, 'Pull').boundingBox();
  if (box === null) throw new Error('no Pull petal');
  await fingerTap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + 1);
  const pulled = await call(page, 'lastOp');
  expect(pulled?.id).toBe('mesh.extrude');

  // the chips of its parameters, beside the result; the reduced Halo (no ⋯ More) offers the next face verb
  await expect(page.getByTestId('halo-echo')).toBeVisible();
  await expect(haloMenu(page).getByRole('menuitem', { name: /^Pull again/ })).toBeVisible();
  await expect(haloMenu(page).getByRole('menuitem', { name: /^More/ })).toHaveCount(0);
  // the extrude session shows the session bar
  await expect(page.getByTestId('halo-session')).toHaveAttribute('data-session', 'extrude');

  // a chip's numpad: a new value is one Adjust Last (the step replaced, the count unchanged)
  const chip = page.getByTestId('halo-echo').getByRole('slider').first();
  const name = (await chip.getAttribute('data-testid'))?.replace('halo-chip-', '') ?? '';
  const chipBox = await chip.boundingBox();
  if (chipBox === null) throw new Error('no chip');
  await fingerTap(page, { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 });
  const numpad = page.getByTestId('halo-numpad');
  await expect(numpad).toBeVisible();
  await page.keyboard.type('0.25');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'lastOp'))?.args[name]).toBeCloseTo(0.25, 3);
  expect((await call(page, 'history')).undo.length).toBe(steps + 1);

  // leaving commits (P15): a stage switch ends the session and keeps the extrude
  await tapStage(page, 'animate');
  await expect.poll(async () => (await call(page, 'state')).extrudeSession).toBe(false);
  await expect(page.getByTestId('halo-session')).toHaveCount(0);
  expect((await call(page, 'history')).undo.length).toBe(steps + 1);
});

test('a non-adjustable operator opens its pre-run form; ✓ runs it, ✕ runs nothing', async ({ page }, testInfo) => {
  touchOnly(testInfo);
  await openHalo(page);
  await loadPolybot(page);
  const clips = (await call(page, 'clips')).length;
  // empty space's Halo (its ring; in Animate the tray is the Thread, T7): New animation (clip.new has a form, §5.6)
  await fingerTap(page, await trayVerb(page, '\\+ New animation'));
  const form = page.getByTestId('halo-form');
  await expect(form).toBeVisible();
  await expect(form).toHaveAttribute('data-op', 'clip.new');
  expect((await halo(page)).slices['grammar']).toMatchObject({ form: 'clip.new' });
  await fingerTap(page, await centre(page, 'halo-form-cancel'));
  await expect(form).toHaveCount(0);
  expect((await call(page, 'clips')).length).toBe(clips);
  await fingerTap(page, await trayVerb(page, '\\+ New animation'));
  await expect(form).toBeVisible();
  await fingerTap(page, await centre(page, 'halo-form-run'));
  await expect.poll(async () => (await call(page, 'clips')).length).toBe(clips + 1);
  await expect(form).toHaveCount(0);
});

test('the session bar: ✓ Done keeps, ✕ Cancel discards, leaving for Pro commits', async ({ page }, testInfo) => {
  touchOnly(testInfo);
  await openHalo(page);
  await loadCubeLadInMake(page);
  await runOk(page, 'model.pivot.editToggle');
  await expect(page.getByTestId('halo-session')).toHaveAttribute('data-session', 'pivot');
  await expect(page.getByTestId('halo-session')).toContainText('Pivot');
  await fingerTap(page, await centre(page, 'halo-session-done'));
  await expect(page.getByTestId('halo-session')).toHaveCount(0);
  expect((await halo(page)).slices['grammar']).toMatchObject({ session: null });

  await runOk(page, 'model.pivot.editToggle');
  await expect(page.getByTestId('halo-session')).toBeVisible();
  await fingerTap(page, await centre(page, 'halo-session-cancel'));
  await expect(page.getByTestId('halo-session')).toHaveCount(0);

  // leaving for Pro commits the open session (P15, ST-34)
  await runOk(page, 'model.pivot.editToggle');
  await expect(page.getByTestId('halo-session')).toBeVisible();
  await page.getByTestId('halo-pro-layout').tap();
  if (await page.getByTestId('halo-pro-line').isVisible()) await page.getByTestId('halo-pro-open').tap();
  await expectStudioShown(page);
  expect((await call(page, 'state')).workspace).toBe('model');
  // back in Halo the pivot edit is over: it was committed on the way out, not carried into Pro
  await page.evaluate(async () => await window.__EKZA_STUDIO_TEST__?.navigate({ to: 'halo', from: 'studio' }));
  await expect.poll(async () => (await call(page, 'mountedShell')) === 'halo').toBe(true);
  await expect.poll(async () => (await halo(page)).stage).toBe('make');
  expect((await halo(page)).slices['grammar']).toMatchObject({ session: null });
});

async function trayVerb(page: Page, label: string): Promise<{ x: number; y: number }> {
  // T7: in Animate the tray is the Thread and the Animations row; empty space's verbs are its long-press ring
  await fingerHold(page, await emptyPoint(page), 600);
  await expect(haloMenu(page)).toHaveAttribute('data-mode', 'ring');
  const box = await petal(page, label).boundingBox();
  if (box === null) throw new Error(`no empty-space verb ${label}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
