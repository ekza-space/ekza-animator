import { expect, test } from '@playwright/test';
import {
  counts,
  emptySpot,
  expandCard,
  faceCentroid,
  hoverPane,
  openShiftRmbMenu,
  releaseOnSlot,
  topFace,
} from './helpers/m6a-model-ops-ui';
import { clickComponent, createPrimitive, MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { call, expectKernelStarted } from './helpers/test-api';

// E2E-MOD-19 "Numeric capture window" (M6A-SPEC §10.1, §5.10, §5.7; owner B11). The capture window is armed during a
// drag and right after a keyboard-invoked operation; digits outside it keep their meanings (`4` shading, `3` mode);
// a mode switch with the same hilite keeps the card live (Maya's INPUTS stay with the object); `T` focuses the
// primary field; the typed value re-runs on the restored face selection with the recorded targets.
//
// Gates (§10.1): b3 (Extrude), b10 (face mode, component picks), b12b (the extrude manipulator's `tz` handle).
// The B11 check below runs today: the same window with a primitive (`G` from the keyboard repeats `mesh.create.cube`
// with its primary field Subdivisions Width), the pointer slop, "Entry discarded", `T` and `4`.

/** The pane rows carry their shading since B9 (an additive field the M1 type does not list). */
type PaneRow = { readonly id: string; readonly shading?: string };

async function paneShading(page: Parameters<typeof call>[0], paneId: string): Promise<string | undefined> {
  const rows = (await call(page, 'panes')) as PaneRow[];
  return rows.find((pane) => pane.id === paneId)?.shading;
}

test('E2E-MOD-19 — numeric capture window', async ({ page }) => {
  await openModel(page);
  const cube = await createPrimitive(page, 'cube');
  await hoverPane(page);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const top = await topFace(page, cube);
  await clickComponent(page, cube, 'face', top);
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyE`);
  await expect.poll(async () => (await call(page, 'state')).capture.armed).toBe('keyboard-op');
  // Drag the extrude manipulator's tz handle 30 px: armed for the drag, released afterwards.
  const tz = await call(page, 'screenOfManipulator', MODEL_PANE, 'tz');
  if (tz === null) throw new Error('no tz handle');
  await page.mouse.move(tz.x, tz.y);
  await page.mouse.down();
  await page.mouse.move(tz.x, tz.y - 15, { steps: 3 });
  expect((await call(page, 'state')).capture.armed).toBe('drag');
  await page.mouse.move(tz.x, tz.y - 30, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await call(page, 'state')).capture.armed).toBeNull();
  // `4` → wireframe shading; the operation's args are untouched.
  const before = (await call(page, 'lastOp'))?.args;
  await hoverPane(page);
  await page.keyboard.press('Digit4');
  await expect.poll(() => paneShading(page, MODEL_PANE)).toBe('wire');
  expect((await call(page, 'lastOp'))?.args).toEqual(before);
  // `3` again → object mode; the hilite keeps the cube and the card stays live.
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('object');
  expect((await call(page, 'model')).hilite).toContain(cube);
  expect((await call(page, 'lastOp'))?.closed).toBeNull();
  // `T` → the card expanded with Local Translate Z focused; typing 0.3 + Enter adjusts in place.
  await page.keyboard.press('KeyT');
  await expect(page.getByTestId(`lastop-card-${MODEL_PANE}`)).toHaveAttribute('data-state', 'expanded');
  await expect.poll(async () => (await call(page, 'lastOpCard', MODEL_PANE))?.focused).toBe('localTranslateZ');
  await page.keyboard.type('0.3');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'lastOp'))?.args['localTranslateZ']).toBe(0.3);
  const last = await call(page, 'lastOp');
  expect(Math.abs(Number(last?.args['localTranslateZ']) - 0.3)).toBeLessThanOrEqual(1e-9);
  expect(last?.kind).toBe('face');
  expect(last?.targets).toEqual([cube]);
  expect(Math.abs((await faceCentroid(page, cube, top))[1] - 0.8)).toBeLessThanOrEqual(1e-6);
});

test('B11 — the capture window after a keyboard run, the pointer slop, T and digits outside the window', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  // Shift+RMB over empty space in object mode → the primitives menu (B11) → N Cube.
  const point = await emptySpot(page);
  expect(await openShiftRmbMenu(page, point)).toBe('model.primitives');
  await releaseOnSlot(page, 'N');
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.create.cube');
  expect((await call(page, 'lastOp'))?.source).toBe('marking-menu');
  expect((await call(page, 'state')).capture.armed).toBeNull();

  // `G` from the keyboard repeats the creation: the window arms on the primary field.
  await hoverPane(page);
  await page.keyboard.press('KeyG');
  await expect.poll(async () => (await call(page, 'state')).capture.armed).toBe('keyboard-op');
  const repeated = await call(page, 'lastOp');
  const cube = repeated?.targets[0] ?? '';
  expect(repeated).toMatchObject({ id: 'mesh.create.cube', source: 'keyboard', closed: null });
  expect((await call(page, 'state')).capture.field).toBe('subdivisionsWidth');
  const steps = (await call(page, 'history')).undo.length;
  // Typed digits go to the field (not to mode or shading); Enter adjusts in place.
  await page.keyboard.type('2');
  expect((await call(page, 'state')).capture.text).toBe('2');
  expect((await call(page, 'state')).mode).toBe('object');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'lastOp'))?.args['subdivisionsWidth']).toBe(2);
  expect((await call(page, 'lastOp'))?.targets).toEqual([cube]);
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  await expect.poll(() => counts(page, cube)).toBe('12/20/10');
  expect((await call(page, 'state')).capture.armed).toBeNull();

  // Again: an entry, then the pointer moves 10 px → the window disarms and the entry is discarded.
  await page.keyboard.press('KeyG');
  await expect.poll(async () => (await call(page, 'state')).capture.armed).toBe('keyboard-op');
  const third = (await call(page, 'lastOp'))?.targets[0] ?? '';
  await page.keyboard.type('3');
  await hoverPane(page, MODEL_PANE, 10, 0);
  await expect.poll(async () => (await call(page, 'state')).capture.armed).toBeNull();
  await expect.poll(() => call(page, 'helpLine')).toBe('Entry discarded');
  expect((await call(page, 'lastOp'))?.args['subdivisionsWidth']).toBe(2);
  expect(await counts(page, third)).toBe('12/20/10');

  // `T` opens the card expanded with the primary field focused; typing there adjusts.
  await hoverPane(page);
  await page.keyboard.press('KeyT');
  await expandCard(page);
  await expect.poll(async () => (await call(page, 'lastOpCard', MODEL_PANE))?.focused).toBe('subdivisionsWidth');
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'lastOp'))?.args['subdivisionsWidth']).toBe(4);
  await page.keyboard.press('Escape');

  // Outside the window `4` is wireframe shading again; the card stays live with its values.
  await hoverPane(page);
  await page.keyboard.press('Digit4');
  await expect.poll(() => paneShading(page, MODEL_PANE)).toBe('wire');
  expect(await call(page, 'lastOp')).toMatchObject({ closed: null, args: { subdivisionsWidth: 4 } });
  expect((await call(page, 'lastOpCard', MODEL_PANE))?.fields[0]).toMatchObject({
    name: 'subdivisionsWidth',
    text: '4',
  });
});
