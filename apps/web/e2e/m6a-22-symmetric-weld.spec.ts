import { expect, type Page, test } from '@playwright/test';
import { MODEL_PANE, openModel } from './helpers/m6a-model';
import {
  createBody,
  dragFrom,
  edgeBetween,
  edgePoint,
  faceTable,
  keyOver,
  near,
  partners,
  activateTool,
  type Vec3,
} from './helpers/m6a-model-topology-tools';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-22 "Target Weld under symmetry" (M6A-SPEC §10.1, §5.12, §5.14; owner B12b). With Object X: a left vertex
// dragged onto its off-seam neighbour also welds its partner onto the neighbour's partner (V − 2); a vertex next to
// the seam dragged onto a seam vertex welds both it and its partner there, the seam vertex staying on x = 0.
// (b) Vertices cut in with symmetry off have no partner: welding one welds once, warns `symmetry.unmatched-partner`
// (count 1) and the help line says "No mirror partner: applied to one side".
//
// Gates (§10.1): b12a (`model.symmetry.set`, `symmetry()`), b13 (the humanoid body template).

async function screen(page: Page, mesh: string, v: number): Promise<{ x: number; y: number } | null> {
  return call(page, 'screenOfVertex', mesh, v, MODEL_PANE);
}

/** A visible edge whose ends satisfy `test` (as [source, target]). */
async function visiblePair(
  page: Page,
  mesh: string,
  test: (s: Vec3, g: Vec3) => boolean,
  source?: number,
): Promise<{ s: number; g: number; from: { x: number; y: number }; to: { x: number; y: number } }> {
  const positions = (await call(page, 'meshPositions', mesh)) as unknown as Vec3[];
  for (const edge of await call(page, 'meshEdges', mesh)) {
    for (const [s, g] of [edge.v, [edge.v[1], edge.v[0]] as const]) {
      if (source !== undefined && s !== source) continue;
      if (!test(positions[s] as Vec3, positions[g] as Vec3)) continue;
      const from = await screen(page, mesh, s);
      const to = await screen(page, mesh, g);
      if (from !== null && to !== null) return { s, g, from, to };
    }
  }
  throw new Error('no visible vertex pair matches');
}

const count = async (page: Page, mesh: string): Promise<number> => (await call(page, 'meshInfo', mesh))?.counts.v ?? 0;

const hasPosition = (positions: readonly Vec3[], p: Vec3): boolean =>
  positions.some((q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2]);

test.fixme('b12a, b13: E2E-MOD-22 — Target Weld under symmetry', async ({ page }) => {
  await openModel(page);
  const body = await createBody(page);
  await activateTool(page, 'targetWeld');
  const positions0 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  const vp0 = await partners(page, body);
  // 1. Both off the seam (x > 0.05).
  const off = await visiblePair(page, body, (s, g) => s[0] > 0.05 && g[0] > 0.05);
  const g = positions0[off.g] as Vec3;
  const pg = positions0[vp0[off.g] as number] as Vec3;
  const v0 = await count(page, body);
  await dragFrom(page, off.from, off.to);
  await expect.poll(() => count(page, body)).toBe(v0 - 2);
  const positions1 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  expect(hasPosition(positions1, g)).toBe(true);
  expect(hasPosition(positions1, pg)).toBe(true);
  expect(hasPosition(positions1, positions0[off.s] as Vec3)).toBe(false);
  expect(hasPosition(positions1, positions0[vp0[off.s] as number] as Vec3)).toBe(false);

  // 2. A vertex next to the seam onto a seam vertex: both it and its partner weld there; the seam vertex stays on x = 0.
  const toSeam = await visiblePair(page, body, (s, t) => s[0] > 0.01 && near(t[0], 0, 1e-9));
  const seam = positions1[toSeam.g] as Vec3;
  await dragFrom(page, toSeam.from, toSeam.to);
  await expect.poll(() => count(page, body)).toBe(v0 - 4);
  const positions2 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  expect(hasPosition(positions2, seam)).toBe(true);
  expect(seam[0]).toBe(0);
});

test.fixme('b12a, b13: E2E-MOD-22 (b) — an unpaired weld welds once and says so', async ({ page }) => {
  await openModel(page);
  const body = await createBody(page, { symmetry: false });
  // A cut across one left torso quad with symmetry off: its two new vertices have no partner.
  await keyOver(page, 'KeyK');
  const positions0 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  const table = await faceTable(page, body);
  let cut: { e1: number; e2: number } | null = null;
  for (const face of table) {
    if (face.verts.length !== 4 || face.centroid[1] < 0.85 || face.centroid[1] > 1.3) continue;
    if (!face.verts.every((v) => (positions0[v] as Vec3)[0] > 0.01)) continue;
    const [a, b, c, d] = face.verts as [number, number, number, number];
    const e1 = await edgeBetween(page, body, a, b);
    const e2 = await edgeBetween(page, body, c, d);
    if ((await call(page, 'screenOfEdge', body, e1, MODEL_PANE, 0.5)) === null) continue;
    if ((await call(page, 'screenOfEdge', body, e2, MODEL_PANE, 0.5)) === null) continue;
    cut = { e1, e2 };
    break;
  }
  if (cut === null) throw new Error('no visible left torso quad');
  for (const e of [cut.e1, cut.e2]) {
    const at = await edgePoint(page, body, e, 0.5);
    await page.mouse.click(at.x, at.y);
  }
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const v0 = positions0.length + 2;
  await expect.poll(() => count(page, body)).toBe(v0);
  await runOk(page, 'model.symmetry.set', { mode: 'object-x' });
  await expect.poll(async () => (await call(page, 'symmetry', body))?.unmatched).toBe(2);
  // Weld one new vertex onto its neighbour (an end of the edge it split).
  await activateTool(page, 'targetWeld');
  const fresh = v0 - 2;
  const pair = await visiblePair(page, body, (_s, t) => t[0] > 0.01, fresh);
  await dragFrom(page, pair.from, pair.to);
  await expect.poll(() => count(page, body)).toBe(v0 - 1);
  const warnings = (await call(page, 'lastOp'))?.warnings ?? [];
  expect(warnings).toContainEqual({ code: 'symmetry.unmatched-partner', count: 1 });
  await expect.poll(() => call(page, 'helpLine')).toContain('No mirror partner: applied to one side');
});
