import { expect, type Page, test } from '@playwright/test';
import { clickComponent, createPrimitive, MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { counts, hoverPane, setCardField, topFace } from './helpers/m6a-model-ops-ui';
import { dragFrom, keyOver, type Vec3 } from './helpers/m6a-model-topology-tools';
import { call } from './helpers/test-api';

// E2E-MOD-17 "Extrude session and its undo stack" (M6A-SPEC §10.1, §5.8; owner B12b). After `Mod+E` the session is
// open: an `R` drag on the cap's uniform scale handle changes the extrude's `localScaleX/Y` (not the original faces),
// Divisions 2 through the card, and the whole session is one history step; `Mod+Z` steps back through the args
// stack (Divisions, then the drag) with the session open and the history length unchanged; the third removes the
// extrude. Part (b): a mode switch (`1`) ends the session without the zero-drop.
//
// Gates (§10.1): b12a (the `R` drag is B12a's component Scale tool absorbed by the session). The B12b check below
// runs today with the extrude manipulator's own uniform scale cube (the same session, stack and undo rules), and
// part (b), which needs no B12a.

async function cubeTopFace(page: Page): Promise<{ cube: string; top: number }> {
  const cube = await createPrimitive(page, 'cube');
  await hoverPane(page);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const top = await topFace(page, cube);
  await clickComponent(page, cube, 'face', top);
  return { cube, top };
}

async function modE(page: Page): Promise<void> {
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyE`);
  await expect.poll(async () => (await call(page, 'state')).extrudeSession).toBe(true);
}

async function undoOnce(page: Page): Promise<void> {
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyZ`);
}

/** Lengths of the cap's edges (its face's corners in order). */
async function capEdgeLengths(page: Page, cube: string, top: number): Promise<number[]> {
  const faces = await call(page, 'meshFaces', cube);
  const positions = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  const loop = faces[top] ?? [];
  return loop.map((v, i) => {
    const a = positions[v] as Vec3;
    const b = positions[loop[(i + 1) % loop.length] as number] as Vec3;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  });
}

async function scaleArgs(page: Page): Promise<[number, number]> {
  const args = (await call(page, 'lastOp'))?.args ?? {};
  return [Number(args['localScaleX']), Number(args['localScaleY'])];
}

/** The session flow after the scale drag: Divisions 2, then three undos through the stack and the extrude. */
async function stackAndUndo(page: Page, cube: string, top: number, manifest: string, steps: number): Promise<void> {
  const [sx] = await scaleArgs(page);
  for (const length of await capEdgeLengths(page, cube, top)) expect(Math.abs(length - sx)).toBeLessThanOrEqual(1e-6);
  await setCardField(page, 'divisions', '2');
  await expect.poll(() => counts(page, cube)).toBe('16/28/14');
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  // First undo: Divisions back to 1, the scale kept; the session open; the history length unchanged.
  await undoOnce(page);
  await expect.poll(() => counts(page, cube)).toBe('12/20/10');
  expect((await scaleArgs(page))[0]).toBeCloseTo(sx, 12);
  expect((await call(page, 'state')).extrudeSession).toBe(true);
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  // Second: the scale back to 1.
  await undoOnce(page);
  await expect.poll(async () => (await scaleArgs(page))[0]).toBe(1);
  expect((await scaleArgs(page))[1]).toBe(1);
  expect(await counts(page, cube)).toBe('12/20/10');
  expect((await call(page, 'state')).extrudeSession).toBe(true);
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  // Third: the extrude itself; the cube's own revision again; the session ended.
  await undoOnce(page);
  await expect.poll(() => counts(page, cube)).toBe('8/12/6');
  expect((await call(page, 'meshInfo', cube))?.manifest).toBe(manifest);
  expect((await call(page, 'state')).extrudeSession).toBe(false);
}

test.fixme('b12a: E2E-MOD-17 — extrude session and its undo stack (R drag)', async ({ page }) => {
  await openModel(page);
  const { cube, top } = await cubeTopFace(page);
  const manifest = (await call(page, 'meshInfo', cube))?.manifest ?? '';
  const steps = (await call(page, 'history')).undo.length + 1;
  const before = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  await modE(page);
  await keyOver(page, 'KeyR');
  const handle = await call(page, 'screenOfManipulator', MODEL_PANE, 'suniform');
  if (handle === null) throw new Error('no suniform handle');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let dx = 4; dx <= 200; dx += 4) {
    await page.mouse.move(handle.x - dx, handle.y);
    const [sx] = await scaleArgs(page);
    if (Math.abs(sx - 0.5) < 0.02) break;
  }
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await scaleArgs(page))[0] - 0.5)).toBeLessThan(0.05);
  expect((await call(page, 'state')).extrudeSession).toBe(true);
  // The original faces' vertices (the base ring) did not move: the drag changed the extrude's args.
  const after = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  expect(after.slice(0, 8)).toEqual(before);
  await stackAndUndo(page, cube, top, manifest, steps);
});

test('B12b — E2E-MOD-17 part (b): a mode switch ends the session and keeps a zero extrude', async ({ page }) => {
  await openModel(page);
  const { cube } = await cubeTopFace(page);
  await modE(page);
  // The window armed by the keyboard run disarms at the first pointer move beyond 3 px from where it armed.
  await expect.poll(async () => (await call(page, 'state')).capture.armed).toBe('keyboard-op');
  // Pointer moves one frame apart, back and forth over 20 px, until the window disarms: B11's page bridge (a lazy chunk
  // mounted on the first Model entry) measures the moves, and on a loaded machine it may mount after the first ones.
  const at = await hoverPane(page);
  let dx = 0;
  await expect
    .poll(async () => {
      dx = dx >= 20 ? 0 : dx + 4;
      await page.mouse.move(at.x + dx, at.y);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
      return (await call(page, 'state')).capture.armed;
    })
    .toBeNull();
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('vertex');
  expect((await call(page, 'state')).extrudeSession).toBe(false);
  expect(await counts(page, cube)).toBe('12/20/10');
  expect(await call(page, 'helpLine')).not.toContain('Extrude removed');
});

test('B12b — the extrude manipulator: uniform scale drag, Divisions, undo through the args stack', async ({ page }) => {
  await openModel(page);
  const { cube, top } = await cubeTopFace(page);
  const manifest = (await call(page, 'meshInfo', cube))?.manifest ?? '';
  const steps = (await call(page, 'history')).undo.length + 1;
  const before = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  await modE(page);
  expect((await call(page, 'state')).tool).toBe('extrude');
  const handle = await call(page, 'screenOfManipulator', MODEL_PANE, 'suniform');
  if (handle === null) throw new Error('no suniform handle');
  // The centre cube scales uniformly by 1 % per px: 50 px left is 0.5.
  await dragFrom(page, handle, { x: handle.x - 50, y: handle.y }, { steps: 10 });
  await expect.poll(async () => (await scaleArgs(page))[0]).toBeCloseTo(0.5, 9);
  expect((await scaleArgs(page))[1]).toBeCloseTo(0.5, 9);
  expect((await call(page, 'state')).extrudeSession).toBe(true);
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  const after = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  expect(after.slice(0, 8)).toEqual(before);
  await stackAndUndo(page, cube, top, manifest, steps);
  // The manipulator tool hands the viewport back to the select tool with the session.
  expect((await call(page, 'state')).tool).toBe('select');
});
