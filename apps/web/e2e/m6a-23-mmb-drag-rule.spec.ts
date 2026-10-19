import { expect, type Page, test } from '@playwright/test';
import { topFace } from './helpers/m6a-model-ops-ui';
import { clickComponent, createPrimitive, MODEL_PANE, modKey, openModel } from './helpers/m6a-model';
import { paneRect, pressOver, reachable, undoOver } from './helpers/m6a-model-select-ui';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-23 "MMB-drag rule" (M6A-SPEC §10.1, §5.15; owner B12a). With the Move tool and no Channel Box channel
// selected, an MMB drag away from the manipulator moves the selection in the view plane (both vertices by the same
// delta, perpendicular to the camera's forward axis); after a LMB press-release on the `tx` handle (it is picked,
// nothing moves) an MMB drag moves along X only. Part (b): the same first drag through the trackpad profile's MMB
// stand-in (`Alt+Shift`+LMB) gives the same delta.
//
// Gates (§10.1): b3 for the INPUTS part (an extrude, `Enter` with no entry keeps the session open, the INPUTS field's
// virtual slider adds 40 px × metresPerPx as one adjusted step). That part also reads `state().extrudeSession`, which
// B12b's session provides (contract note in docs/wp-notes/m6a-model-transform-tools.md).

type Vec3 = readonly [number, number, number];

async function positions(page: Page, mesh: string, verts: number[]): Promise<Vec3[]> {
  return (await call(page, 'meshPositions', mesh, verts)) as unknown as Vec3[];
}

/** The camera's forward axis in a pane (−Z of its rotation). */
async function forwardOf(page: Page, paneId: string): Promise<Vec3> {
  const { quaternion: q } = await call(page, 'cameraOf', paneId);
  const [x, y, z, w] = q;
  // R·(0, 0, −1)
  return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}

/** A pane point away from the manipulator and the overlays (upper middle of the right half). */
async function awaySpot(page: Page): Promise<{ x: number; y: number }> {
  const rect = await paneRect(page, MODEL_PANE);
  const point = { x: rect.x + rect.w * 0.72, y: rect.y + rect.h * 0.3 };
  expect(await reachable(page, point)).toBe(true);
  return point;
}

async function mmbDrag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
}

/** A cube in vertex mode with two top vertices selected and the Move tool active. */
async function setup(page: Page, query = ''): Promise<{ cube: string; picks: number[] }> {
  await openModel(page, query);
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await pressOver(page, 'Digit1');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('vertex');
  const all = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  const picks = all
    .map((p, v) => ({ p, v }))
    .filter(({ p }) => Math.abs(p[1] - 0.5) < 1e-6 && Math.abs(p[2] - 0.5) < 1e-6)
    .map(({ v }) => v);
  expect(picks).toHaveLength(2);
  await runOk(page, 'select.components', { mesh: cube, kind: 'vertex', indices: picks, mode: 'replace' });
  await pressOver(page, 'KeyW');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('move');
  await expect.poll(() => call(page, 'screenOfManipulator', MODEL_PANE, 'tx')).not.toBeNull();
  return { cube, picks };
}

function deltaOf(before: readonly Vec3[], after: readonly Vec3[], i: number): Vec3 {
  const a = before[i] as Vec3;
  const b = after[i] as Vec3;
  return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
}

test('E2E-MOD-23 — MMB-drag rule (view plane, last-picked handle)', async ({ page }) => {
  const { cube, picks } = await setup(page);
  const before = await positions(page, cube, picks);
  const steps = (await call(page, 'history')).undo.length;
  // First drag: no channel selected, no handle picked → the view plane through the pivot.
  await mmbDrag(page, await awaySpot(page), 40, 0);
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + 1);
  const first = await positions(page, cube, picks);
  const d0 = deltaOf(before, first, 0);
  const d1 = deltaOf(before, first, 1);
  expect(Math.hypot(...d0)).toBeGreaterThan(1e-3);
  d0.forEach((value, k) => expect(Math.abs(value - (d1[k] as number))).toBeLessThanOrEqual(1e-6));
  const forward = await forwardOf(page, MODEL_PANE);
  expect(Math.abs(d0[0] * forward[0] + d0[1] * forward[1] + d0[2] * forward[2])).toBeLessThanOrEqual(1e-6);
  await undoOver(page);
  await expect.poll(() => positions(page, cube, picks)).toEqual(before);
  // A LMB press-release on the tx handle picks it: nothing moves, no step.
  const tx = await call(page, 'screenOfManipulator', MODEL_PANE, 'tx');
  if (tx === null) throw new Error('no tx handle');
  await page.mouse.move(tx.x, tx.y);
  await page.mouse.down();
  await page.mouse.up();
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  expect(await positions(page, cube, picks)).toEqual(before);
  // Second drag, diagonal: along X only.
  await mmbDrag(page, await awaySpot(page), 40, 40);
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + 1);
  const second = await positions(page, cube, picks);
  for (const i of [0, 1]) {
    const d = deltaOf(before, second, i);
    expect(Math.abs(d[0])).toBeGreaterThan(1e-3);
    expect(second[i]?.[1]).toBe(before[i]?.[1]);
    expect(second[i]?.[2]).toBe(before[i]?.[2]);
  }
  await undoOver(page);
  await expect.poll(() => positions(page, cube, picks)).toEqual(before);
});

test('E2E-MOD-23 (b) — the trackpad MMB stand-in (Alt+Shift+LMB) gives the first drag’s delta', async ({ page }) => {
  const { cube, picks } = await setup(page);
  const before = await positions(page, cube, picks);
  const steps = (await call(page, 'history')).undo.length;
  const from = await awaySpot(page);
  await mmbDrag(page, from, 40, 0);
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + 1);
  const viaMmb = deltaOf(before, await positions(page, cube, picks), 0);
  await undoOver(page);
  await expect.poll(() => positions(page, cube, picks)).toEqual(before);
  await runOk(page, 'view.setNavProfile', { profile: 'trackpad' });
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y, { steps: 4 });
  await page.mouse.move(from.x + 40, from.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + 1);
  const viaStandIn = deltaOf(before, await positions(page, cube, picks), 0);
  viaStandIn.forEach((value, k) => expect(Math.abs(value - (viaMmb[k] as number))).toBeLessThanOrEqual(1e-6));
});

test('E2E-MOD-23 — the INPUTS field’s virtual slider after an extrude', async ({ page }) => {
  await openModel(page);
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await pressOver(page, 'Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const top = await topFace(page, cube);
  await clickComponent(page, cube, 'face', top);
  await pressOver(page, `${await modKey(page)}+KeyE`);
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.extrude');
  // `Enter` with no typed entry changes nothing; the session stays open.
  const extruded = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  await page.keyboard.press('Enter');
  expect((await call(page, 'state')).extrudeSession).toBe(true);
  expect(await call(page, 'meshPositions', cube)).toEqual(extruded);
  const steps = (await call(page, 'history')).undo.length;
  const start = Number((await call(page, 'lastOp'))?.args['localTranslateZ'] ?? 0);
  await page.getByTestId('cb-inputs-name-localTranslateZ').click();
  await mmbDrag(page, await awaySpot(page), 40, 0);
  const metresPerPx = 0.01; // prefs.virtualSlider.metresPerPx (default)
  await expect
    .poll(async () => Number((await call(page, 'lastOp'))?.args['localTranslateZ'] ?? 0))
    .toBeCloseTo(start + 40 * metresPerPx, 9);
  // One adjusted step (the history keeps its length); no vertex moved by the move rule.
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  expect((await call(page, 'history')).undo.at(-1)).toMatch(/adjusted/);
  // The mesh is exactly the extrude at the dragged value: adjusting the same extrude back to the start value gives
  // the extruded mesh, and directly to the dragged value gives the dragged mesh (nothing else moved).
  const dragged = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  const value = Number((await call(page, 'lastOp'))?.args['localTranslateZ'] ?? 0);
  await runOk(page, 'edit.adjustLast', { args: { localTranslateZ: start } });
  await expect.poll(() => call(page, 'meshPositions', cube)).toEqual(extruded);
  await runOk(page, 'edit.adjustLast', { args: { localTranslateZ: value } });
  await expect.poll(() => call(page, 'meshPositions', cube)).toEqual(dragged);
  expect((await call(page, 'history')).undo).toHaveLength(steps);
});
