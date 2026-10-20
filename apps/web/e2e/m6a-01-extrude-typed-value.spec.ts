import { expect, type Page, test } from '@playwright/test';
import { clickComponent, MODEL_PANE, modKey, openModel, screenOf } from './helpers/m6a-model';
import {
  areaOf,
  centroidOf,
  faceCorners,
  hoverPane,
  markingMenuSlot,
  mode,
  paneRect,
  pressOver,
  setLastOpField,
  undoLabels,
  undoOver,
} from './helpers/m6a-model-select-ui';
import { call } from './helpers/test-api';

// E2E-MOD-01 "Extrude with a typed value" (M6A-SPEC §10.1; owner INT): the Model scene, a cube from the primitives
// marking menu (Shift+RMB on empty space → N), face mode by `3`, a click on the top face, `Mod+E`, `0.5` `Enter`
// through the numeric capture window, Divisions 2 on the Last-op card (adjusted in place), then the extrude undone.
// §10.1 as amended at INT (M6A-INT-3): the extrude session of §5.8 is open after `Mod+E` and the typed value and
// Divisions step its args, so `Esc` ends the session first and one undo then removes the whole extrude.

type Vec3 = readonly [number, number, number];

/** The face whose Newell normal points along +Y (the cube's top). */
async function topFace(page: Page, mesh: string): Promise<number> {
  const faces = await call(page, 'meshFaces', mesh);
  const positions = (await call(page, 'meshPositions', mesh)) as unknown as Vec3[];
  let best = -1;
  let bestY = 0;
  faces.forEach((verts, f) => {
    const n = [0, 0, 0];
    verts.forEach((v, i) => {
      const a = positions[v] as Vec3;
      const b = positions[verts[(i + 1) % verts.length] as number] as Vec3;
      n[0] = (n[0] ?? 0) + (a[1] - b[1]) * (a[2] + b[2]);
      n[1] = (n[1] ?? 0) + (a[2] - b[2]) * (a[0] + b[0]);
      n[2] = (n[2] ?? 0) + (a[0] - b[0]) * (a[1] + b[1]);
    });
    const length = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
    const y = (n[1] ?? 0) / length;
    if (y > bestY) {
      bestY = y;
      best = f;
    }
  });
  expect(bestY).toBeCloseTo(1, 9);
  return best;
}

const counts = async (page: Page, mesh: string): Promise<unknown> => (await call(page, 'meshInfo', mesh))?.counts;

test('E2E-MOD-01 — extrude with a typed value', async ({ page }) => {
  await openModel(page);
  // Shift+RMB on empty pane space → the primitives menu's N slot (Cube, the low-poly defaults).
  const rect = await paneRect(page, MODEL_PANE);
  await page.keyboard.down('Shift');
  await markingMenuSlot(page, { x: rect.x + 60, y: rect.y + rect.h - 60 }, 'model.primitives', 'N');
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await call(page, 'meshes')).length).toBe(1);
  const cube = (await call(page, 'meshes'))[0]?.id as string;
  await expect.poll(() => counts(page, cube)).toMatchObject({ v: 8, e: 12, f: 6 });
  const manifest = (await call(page, 'meshInfo', cube))?.manifest;

  // `3` with the pointer over the pane: face mode on the (selected) cube; a click on the top face.
  await pressOver(page, 'Digit3');
  await expect.poll(() => mode(page)).toBe('face');
  const top = await topFace(page, cube);
  const before = centroidOf(await faceCorners(page, cube, top));
  await screenOf(page, cube, 'face', top);
  await clickComponent(page, cube, 'face', top);
  await expect.poll(async () => (await call(page, 'model')).selected[cube]?.face).toEqual([top]);

  // Mod+E, then `0.5` Enter (the numeric capture window armed by the keyboard run, §5.10).
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyE`);
  await page.keyboard.type('0.5');
  await page.keyboard.press('Enter');
  await expect.poll(() => counts(page, cube)).toMatchObject({ v: 12, e: 20, f: 10 });
  // The top face (same index) has its four corners at y = 1.0, its centroid moved by (0, 0.5, 0), area 1.0 (1e-6:
  // float32 positions).
  const corners = await faceCorners(page, cube, top);
  expect(corners).toHaveLength(4);
  for (const [, y] of corners) expect(y).toBeCloseTo(1, 6);
  const after = centroidOf(corners);
  expect(after.map((value, k) => value - (before[k] as number))).toEqual([
    expect.closeTo(0, 6),
    expect.closeTo(0.5, 6),
    expect.closeTo(0, 6),
  ]);
  expect(areaOf(corners)).toBeCloseTo(1, 6);
  const card = await call(page, 'lastOpCard');
  expect(card?.title).toBe('Extrude');
  expect(card?.fields.find((field) => field.name === 'localTranslateZ')?.text).toBe('0.500 m');

  // Divisions 2 on the card: adjusted in place (the history keeps its length).
  const steps = (await undoLabels(page)).length;
  await setLastOpField(page, 'divisions', '2');
  await expect.poll(() => counts(page, cube)).toMatchObject({ v: 16, e: 28, f: 14 });
  expect((await undoLabels(page)).length).toBe(steps);

  // Esc ends the extrude session (the cap moved: no zero-drop); one undo removes the extrude.
  expect((await call(page, 'state')).extrudeSession).toBe(true);
  await pressOver(page, 'Escape');
  await expect.poll(async () => (await call(page, 'state')).extrudeSession).toBe(false);
  expect(await counts(page, cube)).toMatchObject({ v: 16, e: 28, f: 14 });
  await undoOver(page);
  await expect.poll(() => counts(page, cube)).toMatchObject({ v: 8, e: 12, f: 6 });
  expect((await call(page, 'meshInfo', cube))?.manifest).toBe(manifest);
  expect((await undoLabels(page)).length).toBe(steps - 1);
});
