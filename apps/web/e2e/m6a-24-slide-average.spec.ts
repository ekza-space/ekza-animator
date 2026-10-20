import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, openModel, setMode } from './helpers/m6a-model';
import { counts, expandCard, runMenuItem } from './helpers/m6a-model-ops-ui';
import { dragFrom, expectTool, keyOver, near, type Vec3, visibleEdge } from './helpers/m6a-model-topology-tools';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-24 "Slide Edge and Average" (M6A-SPEC §10.1, §5.12; owner B12b). A middle ring of a three-band cylinder
// (a double-click edge loop) slides along its rails with the Slide Edge tool, then `T` 0.3: every loop vertex lies on
// its rail and on the pre-slide surface. Average Vertices on a plane keeps its border vertices bit-equal and moves
// interior ones; with symmetry Object X on a mirrored plane the seam vertices keep x = 0 exactly.
//
// Gates (§10.1): b12a (`model.symmetry.set`). The B12b check runs the slide and the average without symmetry today.
// A flat regular grid's interior vertices already sit at their neighbours' average (Average would move none), so the
// plane gets one interior vertex lifted first (`mesh.transformComponents`).

/** The vertices of the stored edge selection. */
async function selectedLoopVerts(page: Page, mesh: string): Promise<number[]> {
  const model = await call(page, 'model');
  const edges = await call(page, 'meshEdges', mesh);
  const verts = new Set<number>();
  for (const e of model.selected[mesh]?.edge ?? []) for (const v of edges[e]?.v ?? []) verts.add(v);
  return [...verts];
}

async function slideMiddleRing(page: Page): Promise<void> {
  const cylinder = await createPrimitive(page, 'cylinder', { subdivisionsHeight: 3 });
  await runOk(page, 'select.objects', { ids: [cylinder], mode: 'replace' });
  await setMode(page, 'edge');
  // A horizontal edge of the upper middle ring (y = 1/6): its double-click selects the whole ring.
  const ring = await visibleEdge(page, cylinder, (a, b) => near(a[1], 1 / 6, 1e-4) && near(b[1], 1 / 6, 1e-4));
  await page.mouse.dblclick(ring.at.x, ring.at.y);
  await expect.poll(async () => (await call(page, 'model')).selected[cylinder]?.edge.length).toBe(8);
  const verts = await selectedLoopVerts(page, cylinder);
  expect(verts).toHaveLength(8);
  const before = (await call(page, 'meshPositions', cylinder)) as unknown as Vec3[];
  const edges = await call(page, 'meshEdges', cylinder);

  await runOk(page, 'view.tool', { panel: 'viewport', tool: 'slide' });
  await expectTool(page, 'slide');
  // A drag along the screen's vertical (the rails are vertical edges) slides the ring.
  const at = ring.at;
  await dragFrom(page, { x: at.x + 30, y: at.y }, { x: at.x + 30, y: at.y - 25 }, { steps: 10 });
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.slide');
  expect(Math.abs(Number((await call(page, 'lastOp'))?.args['percent']))).toBeGreaterThan(0);
  // T 0.3 Enter: exactly 0.3 along the same rails.
  await keyOver(page, 'KeyT');
  await expandCard(page);
  await expect.poll(async () => (await call(page, 'lastOpCard'))?.focused).toBe('percent');
  await page.keyboard.type('0.3');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'lastOp'))?.args['percent']).toBe(0.3);
  expect(await counts(page, cylinder)).toBe('32/56/26');

  // Every loop vertex lies on one of its rails (a vertical edge from its pre-slide position), 0.3 along it.
  const after = (await call(page, 'meshPositions', cylinder)) as unknown as Vec3[];
  for (const v of verts) {
    const o = before[v] as Vec3;
    const p = after[v] as Vec3;
    const rails = edges
      .filter((edge) => edge.v.includes(v))
      .map((edge) => before[edge.v[0] === v ? edge.v[1] : edge.v[0]] as Vec3)
      .filter((n) => near(n[0], o[0], 1e-6) && near(n[2], o[2], 1e-6));
    const onRail = rails.some((n) => {
      const d: Vec3 = [n[0] - o[0], n[1] - o[1], n[2] - o[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      const s = ((p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1] + (p[2] - o[2]) * d[2]) / (len * len);
      const q: Vec3 = [o[0] + s * d[0], o[1] + s * d[1], o[2] + s * d[2]];
      return s >= -1e-9 && s <= 1 + 1e-9 && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= 1e-6;
    });
    expect(onRail, `vertex ${v} on a rail`).toBe(true);
    // The pre-slide surface: the side of the cylinder (the vertex keeps its x/z column).
    expect(Math.hypot(p[0] - o[0], p[2] - o[2])).toBeLessThanOrEqual(1e-4);
  }
}

async function averagePlane(page: Page): Promise<void> {
  await runOk(page, 'view.tool', { panel: 'viewport', tool: 'select' });
  await runOk(page, 'select.mode', { mode: 'object' });
  const plane = await createPrimitive(page, 'plane', { subdivisionsWidth: 4, subdivisionsHeight: 4 });
  await runOk(page, 'select.objects', { ids: [plane], mode: 'replace' });
  await setMode(page, 'vertex');
  const before = (await call(page, 'meshPositions', plane)) as unknown as Vec3[];
  const centre = before.findIndex((p) => near(p[0], 0) && near(p[2], 0));
  await runOk(page, 'select.components', { mesh: plane, kind: 'vertex', indices: [centre], mode: 'replace' });
  await runOk(page, 'mesh.transformComponents', { translateY: 0.2 });
  const lifted = (await call(page, 'meshPositions', plane)) as unknown as Vec3[];
  await runOk(page, 'select.mesh.all');
  await runMenuItem(page, 'edit-mesh', 'builtin.model.edit-mesh.averageVertices');
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.averageVertices');
  const after = (await call(page, 'meshPositions', plane)) as unknown as Vec3[];
  let moved = 0;
  after.forEach((p, v) => {
    const b = lifted[v] as Vec3;
    const border = near(Math.abs(b[0]), 0.5) || near(Math.abs(b[2]), 0.5);
    if (border) expect(p).toEqual(b);
    else if (p[0] !== b[0] || p[1] !== b[1] || p[2] !== b[2]) moved++;
  });
  expect(moved).toBeGreaterThan(0);
}

test('E2E-MOD-24 — Slide Edge, Average Vertices, Average under symmetry', async ({ page }) => {
  await openModel(page);
  await slideMiddleRing(page);
  await averagePlane(page);
  // The same Average with symmetry Object X on a mirrored plane: seam vertices keep x = 0 exactly.
  await runOk(page, 'select.mode', { mode: 'object' });
  const plane = await createPrimitive(page, 'plane', { subdivisionsWidth: 4, subdivisionsHeight: 4 });
  await runOk(page, 'select.objects', { ids: [plane], mode: 'replace' });
  await runOk(page, 'model.symmetry.set', { mode: 'object-x' });
  await setMode(page, 'vertex');
  const before = (await call(page, 'meshPositions', plane)) as unknown as Vec3[];
  const pair = before
    .map((p, v) => ({ p, v }))
    .filter(({ p }) => near(Math.abs(p[0]), 0.25) && near(p[2], 0))
    .map(({ v }) => v);
  await runOk(page, 'select.components', { mesh: plane, kind: 'vertex', indices: pair, mode: 'replace' });
  await runOk(page, 'mesh.transformComponents', { translateY: 0.2 });
  await runOk(page, 'select.mesh.all');
  await runMenuItem(page, 'edit-mesh', 'builtin.model.edit-mesh.averageVertices');
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.averageVertices');
  const after = (await call(page, 'meshPositions', plane)) as unknown as Vec3[];
  before.forEach((p, v) => {
    if (near(p[0], 0)) expect((after[v] as Vec3)[0]).toBe(0);
  });
});

test('B12b — E2E-MOD-24 without symmetry: Slide Edge with T 0.3, Average Vertices', async ({ page }) => {
  await openModel(page);
  await slideMiddleRing(page);
  await averagePlane(page);
});
