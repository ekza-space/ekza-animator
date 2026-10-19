import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, openModel } from './helpers/m6a-model';
import { counts } from './helpers/m6a-model-ops-ui';
import {
  edgeEnds,
  edgePoint,
  expectTool,
  findEdge,
  keyOver,
  near,
  undoLabels,
  type Vec3,
} from './helpers/m6a-model-topology-tools';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-05 "Multi-Cut across two quads" (M6A-SPEC §10.1, §5.11, §5.17; owner B12b). `K` activates Multi-Cut in
// object mode on the selected plane (its components draw and pick while the tool is active, §5.6); three clicks on
// the left border, the shared middle edge and the right border edge at their midpoints, then RMB (pointer-down button
// 2) complete one "Multi-Cut" step; two clicks then `Esc` leave no step; a `Ctrl`-click on an edge inserts an edge
// loop at the cursor (one "Insert Edge Loop" step, the tool stays active). Part (b): the same `Ctrl`-click with
// `platform=mac` and the trackpad profile (pointer-down button 0 + ctrlKey; the browser's contextmenu follows and
// never completes or opens a menu). Gates (§10.1): — (green at B12b's merge).

/** A 2 × 1 plane of two quads in XZ (6/7/2), selected. */
async function twoQuads(page: Page): Promise<string> {
  const plane = await createPrimitive(page, 'plane', { width: 2, subdivisionsWidth: 2, subdivisionsHeight: 1 });
  await runOk(page, 'select.objects', { ids: [plane], mode: 'replace' });
  expect(await counts(page, plane)).toBe('6/7/2');
  return plane;
}

/** The edge along Z at x (a vertical edge of the plane seen from above). */
const edgeAtX = (page: Page, plane: string, x: number): Promise<number> =>
  findEdge(page, plane, (a, b) => near(a[0], x) && near(b[0], x));

async function click(page: Page, plane: string, e: number, t = 0.5): Promise<void> {
  const point = await edgePoint(page, plane, e, t);
  await page.mouse.click(point.x, point.y);
}

/** The three-click cut of part (a): 6/7/2 → 9/12/4. */
async function cutAcross(page: Page, plane: string): Promise<void> {
  await keyOver(page, 'KeyK');
  await expectTool(page, 'multiCut');
  for (const x of [-1, 0, 1]) await click(page, plane, await edgeAtX(page, plane, x));
  const last = await edgePoint(page, plane, await edgeAtX(page, plane, 1));
  await page.mouse.move(last.x, last.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect.poll(() => counts(page, plane)).toBe('9/12/4');
}

/** `Ctrl`-click at t = 0.5 on the left half's edge on z = −0.5. */
async function ctrlClickLoop(page: Page, plane: string): Promise<void> {
  const e = await findEdge(
    page,
    plane,
    (a, b) => near(a[2], -0.5) && near(b[2], -0.5) && Math.min(a[0], b[0]) < -0.5 && Math.max(a[0], b[0]) <= 1e-6,
  );
  const point = await edgePoint(page, plane, e, 0.5);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Control');
}

test('E2E-MOD-05 — Multi-Cut across two quads, Esc, Ctrl-click loop', async ({ page }) => {
  await openModel(page);
  const plane = await twoQuads(page);
  const before = (await undoLabels(page)).length;
  await cutAcross(page, plane);
  const history = await undoLabels(page);
  expect(history.length).toBe(before + 1);
  expect(history.at(-1)).toBe('Multi-Cut');
  // The three new vertices sit at z = 0 and y = 0 (the cut points at the midpoints of the three Z edges).
  const positions = (await call(page, 'meshPositions', plane)) as unknown as Vec3[];
  const added = positions.slice(6);
  expect(added).toHaveLength(3);
  for (const p of added) {
    expect(Math.abs(p[1])).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(p[2])).toBeLessThanOrEqual(1e-6);
  }
  expect(added.map((p) => Math.round(p[0])).sort((x, y) => x - y)).toEqual([-1, 0, 1]);

  // `K`, two clicks, `Esc`: nothing is cut and no step is recorded.
  await keyOver(page, 'KeyK');
  const xs = (await edgeEnds(page, plane)).filter((edge) => near(edge.a[0], edge.b[0]) && near(edge.a[0], -1));
  await click(page, plane, (xs[0] as { e: number }).e, 0.25);
  await click(page, plane, await edgeAtX(page, plane, 0), 0.25);
  await page.keyboard.press('Escape');
  expect(await counts(page, plane)).toBe('9/12/4');
  expect((await undoLabels(page)).length).toBe(before + 1);
  await expectTool(page, 'multiCut');

  // `K`, `Ctrl`-click: an edge loop through the left half at the cursor, one step, the tool stays active.
  await keyOver(page, 'KeyK');
  await ctrlClickLoop(page, plane);
  await expect.poll(() => counts(page, plane)).toBe('12/17/6');
  const labels = await undoLabels(page);
  expect(labels.length).toBe(before + 2);
  expect(labels.at(-1)).toBe('Insert Edge Loop');
  await expectTool(page, 'multiCut');
});

test('E2E-MOD-05 (b) — the Ctrl-click on macOS with the trackpad profile is a Ctrl-click, not RMB', async ({
  page,
}) => {
  await openModel(page, '&platform=mac&nav=trackpad');
  const plane = await twoQuads(page);
  await cutAcross(page, plane);
  await keyOver(page, 'KeyK');
  await ctrlClickLoop(page, plane);
  await expect.poll(() => counts(page, plane)).toBe('12/17/6');
  await expectTool(page, 'multiCut');
  expect(await call(page, 'markingMenu')).toBeNull();
  expect((await undoLabels(page)).at(-1)).toBe('Insert Edge Loop');
});
