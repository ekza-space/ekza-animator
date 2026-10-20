import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, MODEL_PANE, openModel } from './helpers/m6a-model';
import { counts } from './helpers/m6a-model-ops-ui';
import {
  activateTool,
  createBody,
  edgeEnds,
  inPane,
  near,
  partners,
  type Vec3,
} from './helpers/m6a-model-topology-tools';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-21 "Insert Edge Loop with symmetry" (M6A-SPEC §10.1, §5.11, §5.14; owner B12b). With the Insert Edge Loop
// tool on the humanoid body (Object X): a click at weight 0.3 on an upper-arm edge (its ring circles the arm) inserts
// that loop and its mirror image at the mirrored weight, every new vertex partnered; a click on a vertical torso edge
// whose ring goes round the waist inserts **one** loop (its mirror is itself), the seam vertices self-partnered.
// (b) A cube with Object X: a click at 0.3 on an X edge (it crosses the plane) inserts two loops at x = ±0.2
// (16/28/14); (c) at 0.5 one loop at x = 0 exactly (12/20/10).
//
// Gates (§10.1): b12a (`model.symmetry.set`, `symmetry()`), b13 (the humanoid body template).

/** Clicks a visible edge matching `test` at weight `w` from its end with the smaller `key` (polled until one shows). */
async function clickAtWeight(
  page: Page,
  mesh: string,
  test: (a: Vec3, b: Vec3) => boolean,
  w: number,
  key: (p: Vec3) => number,
): Promise<{ e: number; a: Vec3; b: Vec3 }> {
  let hit: { e: number; a: Vec3; b: Vec3; at: { x: number; y: number } } | null = null;
  await expect
    .poll(
      async () => {
        for (const edge of await edgeEnds(page, mesh)) {
          if (!test(edge.a, edge.b)) continue;
          // t is measured from edgeVert(e, 0): flipped when that end is the far one.
          const t = key(edge.a) <= key(edge.b) ? w : 1 - w;
          const at = await call(page, 'screenOfEdge', mesh, edge.e, MODEL_PANE, t);
          if (at !== null && (await inPane(page, at))) {
            hit = { e: edge.e, a: edge.a, b: edge.b, at };
            return true;
          }
        }
        return false;
      },
      { message: 'a visible edge matches' },
    )
    .toBe(true);
  const found = hit as unknown as { e: number; a: Vec3; b: Vec3; at: { x: number; y: number } };
  await page.mouse.move(found.at.x, found.at.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  return { e: found.e, a: found.a, b: found.b };
}

function expectPartnered(positions: readonly Vec3[], vp: readonly number[], verts: readonly number[]): void {
  for (const v of verts) {
    const p = vp[v] ?? -1;
    expect(p, `vertex ${v} has a partner`).toBeGreaterThanOrEqual(0);
    const a = positions[v] as Vec3;
    const b = positions[p] as Vec3;
    expect(Math.abs(a[0] + b[0])).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(a[1] - b[1])).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(a[2] - b[2])).toBeLessThanOrEqual(1e-6);
  }
}

test('E2E-MOD-21 — Insert Edge Loop with symmetry (arm, waist)', async ({ page }) => {
  await openModel(page);
  const body = await createBody(page);
  await activateTool(page, 'insertLoop');
  const v0 = (await call(page, 'meshInfo', body))?.counts.v ?? 0;
  // An upper-arm edge along X between the two upper-arm rings (x 0.26 → 0.36), clicked 0.3 from the shoulder side.
  const arm = (a: Vec3, b: Vec3): boolean =>
    a[0] > 0.2 && b[0] > 0.2 && Math.min(a[0], b[0]) < 0.27 && Math.max(a[0], b[0]) > 0.35 && near(a[1], b[1], 0.05);
  await clickAtWeight(page, body, arm, 0.3, (p) => Math.abs(p[0]));
  await expect.poll(async () => (await call(page, 'meshInfo', body))?.counts.v).toBe(v0 + 12);
  const positions1 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  const armVerts = Array.from({ length: 12 }, (_, i) => v0 + i);
  expectPartnered(positions1, await partners(page, body), armVerts);
  // The left loop sits 0.3 of the way from the shoulder ring (x 0.26 + 0.3 × 0.1), the right one mirrored.
  for (const v of armVerts) expect(Math.abs(Math.abs((positions1[v] as Vec3)[0]) - 0.29)).toBeLessThanOrEqual(1e-4);

  // A vertical torso edge between the hip and waist rings: its ring goes round the waist and is its own mirror.
  // A torso edge from the hip ring (y 0.82) to the waist ring (y 0.95): its ring goes round the waist.
  const waist = (a: Vec3, b: Vec3): boolean =>
    near(Math.min(a[1], b[1]), 0.82, 1e-3) && near(Math.max(a[1], b[1]), 0.95, 1e-3) && Math.abs(a[0] - b[0]) < 0.05;
  const v1 = positions1.length;
  await clickAtWeight(page, body, waist, 0.5, (p) => p[1]);
  await expect.poll(async () => (await call(page, 'meshInfo', body))?.counts.v).toBe(v1 + 8);
  const positions2 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  const vp = await partners(page, body);
  const ring = Array.from({ length: 8 }, (_, i) => v1 + i);
  expectPartnered(positions2, vp, ring);
  const seam = ring.filter((v) => near((positions2[v] as Vec3)[0], 0, 1e-9));
  expect(seam.length).toBe(2);
  for (const v of seam) expect(vp[v]).toBe(v);
  expect((await call(page, 'symmetry', body))?.unmatched).toBe(0);
});

async function cubeWithSymmetry(page: Page): Promise<string> {
  // The select tool first: the Insert Edge Loop tool hilites the selected mesh when it is activated (§5.6).
  await runOk(page, 'view.tool', { panel: 'viewport', tool: 'select' });
  await runOk(page, 'select.mode', { mode: 'object' });
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await runOk(page, 'model.symmetry.set', { mode: 'object-x' });
  await activateTool(page, 'insertLoop');
  return cube;
}

/** An X-direction edge of the cube (it crosses the YZ plane). */
const xEdge = (a: Vec3, b: Vec3): boolean => near(a[1], b[1]) && near(a[2], b[2]) && Math.abs(a[0] - b[0]) > 0.9;

test('E2E-MOD-21 (b) — a crossing ring at 0.3: two loops at x = ±0.2', async ({ page }) => {
  await openModel(page);
  const cube = await cubeWithSymmetry(page);
  await clickAtWeight(page, cube, xEdge, 0.3, (p) => p[0]);
  await expect.poll(() => counts(page, cube)).toBe('16/28/14');
  const positions = (await call(page, 'meshPositions', cube)) as unknown as Vec3[];
  for (const p of positions.slice(8)) expect(Math.abs(Math.abs(p[0]) - 0.2)).toBeLessThanOrEqual(1e-6);
  expect((await call(page, 'symmetry', cube))?.unmatched).toBe(0);
});

test('E2E-MOD-21 (c) — a crossing ring at 0.5: one loop at x = 0 exactly', async ({ page }) => {
  await openModel(page);
  const cube = await cubeWithSymmetry(page);
  await clickAtWeight(page, cube, xEdge, 0.5, (p) => p[0]);
  await expect.poll(() => counts(page, cube)).toBe('12/20/10');
  for (const p of ((await call(page, 'meshPositions', cube)) as unknown as Vec3[]).slice(8)) expect(p[0]).toBe(0);
  expect((await call(page, 'symmetry', cube))?.unmatched).toBe(0);
});
