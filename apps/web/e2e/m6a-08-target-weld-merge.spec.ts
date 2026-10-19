import { expect, type Page, test } from '@playwright/test';
import { clickComponent, createPrimitive, openModel, setMode } from './helpers/m6a-model';
import { counts, hoverPane, openKeyMenu, runMenuItem, topFace } from './helpers/m6a-model-ops-ui';
import { dragFrom, expectTool, undoLabels, type Vec3, vertexPoint } from './helpers/m6a-model-topology-tools';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-08 "Target Weld, Merge to Center, Merge by Distance" (M6A-SPEC §10.1, §5.12; owner B12b). (a) The Target
// Weld tool welds a dragged vertex onto its neighbour at the neighbour (7/11/6, the target bit-equal); (b) `M` → N
// Merge to Center on a cube's top face (5/8/5, the apex at (0, 0.5, 0)); (c) two planes side by side, Combine, then
// Merge by Distance (8/8/2 → 6/7/2).
//
// Gates (§10.1): b12a (part (c) moves the second plane with `scene.object.transform`, B12a's operator). The B12b
// checks below run (a) and (b) today, and the MMB (centre) weld.

/** Two adjacent vertices of the cube's top face whose screen points the pane shows, with their positions. */
async function adjacentVisible(page: Page, cube: string): Promise<{ a: number; b: number; positions: Vec3[] }> {
  const positions = (await call(page, 'meshPositions', cube)) as Vec3[];
  const edges = await call(page, 'meshEdges', cube);
  for (const edge of edges) {
    const [a, b] = edge.v;
    if ((positions[a] as Vec3)[1] < 0.49 || (positions[b] as Vec3)[1] < 0.49) continue;
    const pa = await call(page, 'screenOfVertex', cube, a, 'pane-persp');
    const pb = await call(page, 'screenOfVertex', cube, b, 'pane-persp');
    if (pa !== null && pb !== null) return { a, b, positions };
  }
  throw new Error('no visible top edge');
}

async function weldDrag(
  page: Page,
  cube: string,
  button: 'left' | 'middle',
): Promise<{ a: number; b: number; positions: Vec3[] }> {
  const pair = await adjacentVisible(page, cube);
  const from = await vertexPoint(page, cube, pair.a);
  const to = await vertexPoint(page, cube, pair.b);
  await dragFrom(page, from, to, { button, steps: 10 });
  return pair;
}

async function partA(page: Page): Promise<void> {
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await setMode(page, 'vertex');
  await page.getByTestId('mtk-btn-mesh.targetWeld').click();
  await expectTool(page, 'targetWeld');
  const before = (await undoLabels(page)).length;
  const { b, positions } = await weldDrag(page, cube, 'left');
  await expect.poll(() => counts(page, cube)).toBe('7/11/6');
  expect((await undoLabels(page)).slice(before)).toEqual(['Target Weld']);
  // B kept its position exactly (the source merged into it); every remaining position is one of the cube's.
  const after = (await call(page, 'meshPositions', cube)) as Vec3[];
  expect(
    after.filter(
      (p) =>
        p[0] === (positions[b] as Vec3)[0] && p[1] === (positions[b] as Vec3)[1] && p[2] === (positions[b] as Vec3)[2],
    ),
  ).toHaveLength(1);
}

async function partB(page: Page): Promise<void> {
  await runOk(page, 'view.tool', { panel: 'viewport', tool: 'select' });
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await setMode(page, 'face');
  await clickComponent(page, cube, 'face', await topFace(page, cube));
  await hoverPane(page);
  expect(await openKeyMenu(page, 'KeyM')).toBe('model.merge');
  await page.getByTestId('mm-slot-N').click();
  await expect.poll(() => counts(page, cube)).toBe('5/8/5');
  const positions = (await call(page, 'meshPositions', cube)) as Vec3[];
  const apex = positions.find((p) => p[1] > 0.49);
  expect(apex).toBeDefined();
  for (const [i, value] of [0, 0.5, 0].entries()) expect(Math.abs((apex as Vec3)[i] - value)).toBeLessThanOrEqual(1e-6);
}

test.fixme('b12a: E2E-MOD-08 — Target Weld, Merge to Center, Merge by Distance', async ({ page }) => {
  await openModel(page);
  await partA(page);
  await partB(page);
  // (c) Two 1 × 1 planes, the second moved +1 m in X, combined, then merged by distance.
  await runOk(page, 'select.mode', { mode: 'object' });
  const a = await createPrimitive(page, 'plane');
  const b = await createPrimitive(page, 'plane');
  const record = (await call(page, 'meshes')).find((row) => row.id === b);
  expect(record).toBeDefined();
  await runOk(page, 'scene.object.transform', {
    ids: [b],
    placements: [{ t: [1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }],
  });
  await runOk(page, 'select.objects', { ids: [a, b], mode: 'replace' });
  await runMenuItem(page, 'mesh', 'builtin.model.mesh.combine');
  const combined = (await call(page, 'lastOp'))?.targets[0] ?? a;
  await expect.poll(() => counts(page, combined)).toBe('8/8/2');
  await runOk(page, 'mesh.mergeByDistance', { distance: 0.001 });
  await expect.poll(() => counts(page, combined)).toBe('6/7/2');
});

test('B12b — E2E-MOD-08 parts (a) and (b): the Target Weld tool and Merge to Center', async ({ page }) => {
  await openModel(page);
  await partA(page);
  await runOk(page, 'select.mode', { mode: 'object' });
  await partB(page);
});

test('B12b — Target Weld with MMB welds at the midpoint; Esc leaves no step', async ({ page }) => {
  await openModel(page);
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await setMode(page, 'vertex');
  await runOk(page, 'view.tool', { panel: 'viewport', tool: 'targetWeld' });
  const before = (await undoLabels(page)).length;
  // Esc during the drag cancels it.
  const pair = await adjacentVisible(page, cube);
  const from = await vertexPoint(page, cube, pair.a);
  const to = await vertexPoint(page, cube, pair.b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await counts(page, cube)).toBe('8/12/6');
  expect((await undoLabels(page)).length).toBe(before);
  // MMB: the centre of the two.
  const { a, b, positions } = await weldDrag(page, cube, 'middle');
  await expect.poll(() => counts(page, cube)).toBe('7/11/6');
  const pa = positions[a] as Vec3;
  const pb = positions[b] as Vec3;
  const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
  const after = (await call(page, 'meshPositions', cube)) as Vec3[];
  expect(after.some((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]) <= 1e-6)).toBe(true);
  expect((await call(page, 'lastOp'))?.args['mode']).toBe('center');
});
