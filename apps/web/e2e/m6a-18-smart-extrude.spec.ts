import { expect, type Page, test } from '@playwright/test';
import { clickComponent, createPrimitive, MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { counts, hoverPane, setCardField, topFace } from './helpers/m6a-model-ops-ui';
import { dragFrom, keyOver, undoLabels } from './helpers/m6a-model-topology-tools';
import { call } from './helpers/test-api';

// E2E-MOD-18 "Smart extrude and chains" (M6A-SPEC §10.1, §5.8; owner B12b). `Shift` held at the start of a W handle
// drag with a face selected runs a new extrude whose drag becomes its `localTranslate*` (one "Extrude" step, the card
// titled "Extrude", Divisions editable); three `Shift`+drags build a three-segment chain in three steps.
//
// Gates (§10.1): b12a (the W tool's `Shift`-start calls B12b's `beginSmartExtrude`). The B12b check below runs today
// with the extrude manipulator's `tz` arrow (after `Mod+E`, whose zero extrude the first `Shift`-start drops).

async function cubeTopFace(page: Page): Promise<string> {
  const cube = await createPrimitive(page, 'cube');
  await hoverPane(page);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  await clickComponent(page, cube, 'face', await topFace(page, cube));
  return cube;
}

/** A `Shift`+drag of a manipulator handle `dy` px up. */
async function shiftDrag(page: Page, handle: 'ty' | 'tz', dy: number): Promise<void> {
  let at: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      at = await call(page, 'screenOfManipulator', MODEL_PANE, handle);
      return at;
    })
    .not.toBeNull();
  const from = at as unknown as { x: number; y: number };
  await dragFrom(page, from, { x: from.x, y: from.y - dy }, { hold: ['Shift'], steps: 8 });
}

test('E2E-MOD-18 — smart extrude and chains (W)', async ({ page }) => {
  await openModel(page);
  const cube = await cubeTopFace(page);
  await keyOver(page, 'KeyW');
  const before = (await undoLabels(page)).length;
  await shiftDrag(page, 'ty', 40);
  await expect.poll(async () => (await call(page, 'lastOp'))?.label).toBe('Extrude');
  expect(Number((await call(page, 'lastOp'))?.args['localTranslateZ'])).toBeGreaterThan(0);
  await setCardField(page, 'divisions', '3');
  await expect.poll(() => counts(page, cube)).toBe('20/36/18');
  expect((await undoLabels(page)).length).toBe(before + 1);
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyZ`);
  await page.keyboard.press(`${await modKey(page)}+KeyZ`);
  await page.keyboard.press(`${await modKey(page)}+KeyZ`);
  await page.keyboard.press(`${await modKey(page)}+KeyZ`);
  await expect.poll(() => counts(page, cube)).toBe('8/12/6');
});

test('E2E-MOD-18 (b) — three Shift+drags of W build three extrudes', async ({ page }) => {
  await openModel(page);
  const cube = await cubeTopFace(page);
  await keyOver(page, 'KeyW');
  const before = (await undoLabels(page)).length;
  for (let i = 0; i < 3; i++) await shiftDrag(page, 'ty', 30);
  await expect.poll(() => counts(page, cube)).toBe('20/36/18');
  const labels = await undoLabels(page);
  expect(labels.slice(before)).toEqual(['Extrude', 'Extrude', 'Extrude']);
});

test('B12b — Shift-start on the extrude manipulator is smart extrude: one step, Divisions, chains', async ({
  page,
}) => {
  await openModel(page);
  const cube = await cubeTopFace(page);
  const before = (await undoLabels(page)).length;
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyE`);
  await expect.poll(async () => (await call(page, 'state')).extrudeSession).toBe(true);
  // The Shift-start drops the zero extrude of Mod+E and runs a new one from the drag.
  await shiftDrag(page, 'tz', 40);
  await expect.poll(async () => (await call(page, 'lastOp'))?.label).toBe('Extrude');
  await expect.poll(() => counts(page, cube)).toBe('12/20/10');
  const last = await call(page, 'lastOp');
  expect(Number(last?.args['localTranslateZ'])).toBeGreaterThan(0);
  expect(last?.source).toBe('tool');
  expect(await undoLabels(page)).toEqual([...(await undoLabels(page)).slice(0, before), 'Extrude']);
  expect((await call(page, 'state')).extrudeSession).toBe(true);
  await setCardField(page, 'divisions', '3');
  await expect.poll(() => counts(page, cube)).toBe('20/36/18');
  expect((await undoLabels(page)).length).toBe(before + 1);
  // Two more Shift-drags: a three-segment chain, one "Extrude" step each (Divisions 3 stays on the first).
  await shiftDrag(page, 'tz', 30);
  await expect.poll(() => counts(page, cube)).toBe('24/44/22');
  await shiftDrag(page, 'tz', 30);
  await expect.poll(() => counts(page, cube)).toBe('28/52/26');
  expect((await undoLabels(page)).slice(before)).toEqual(['Extrude (adjusted)', 'Extrude', 'Extrude']);
});
