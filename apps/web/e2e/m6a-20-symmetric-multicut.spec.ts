import { expect, type Page, test } from '@playwright/test';
import { MODEL_PANE, openModel } from './helpers/m6a-model';
import { counts } from './helpers/m6a-model-ops-ui';
import {
  createBody,
  edgeBetween,
  edgePoint,
  expectTool,
  faceTable,
  inPane,
  keyOver,
  near,
  partners,
  type Vec3,
} from './helpers/m6a-model-topology-tools';
import { call } from './helpers/test-api';

// E2E-MOD-20 "Symmetric Multi-Cut" (M6A-SPEC §10.1, §5.11, §5.14; owner B12b). On the humanoid body with Object X
// symmetry: a cut across one left torso face is mirrored as a second cut in the same run (+4 vertices, all partnered
// and mirrored); a path from a front face over the centre line into its right neighbour is clipped at the seam and its
// kept half mirrored: one symmetric cut (+3 vertices), the seam vertex at x = 0 exactly at the clicked parameter (an
// in-seam edge is never snapped to 0.5).
//
// Gates (§10.1): b12a (`model.symmetry.set`, `symmetry()`), b13 (the humanoid body template).

type Face = Awaited<ReturnType<typeof faceTable>>[number];

async function visible(page: Page, mesh: string, e: number, t: number): Promise<boolean> {
  const at = await call(page, 'screenOfEdge', mesh, e, MODEL_PANE, t);
  return at !== null && (await inPane(page, at));
}

async function rightClick(page: Page): Promise<void> {
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
}

async function clickEdge(page: Page, mesh: string, e: number, t: number): Promise<void> {
  const at = await edgePoint(page, mesh, e, t);
  await page.mouse.click(at.x, at.y);
}

function expectMirrored(positions: readonly Vec3[], vp: readonly number[], verts: readonly number[]): void {
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

test.fixme('b12a, b13: E2E-MOD-20 — symmetric Multi-Cut', async ({ page }) => {
  await openModel(page);
  const body = await createBody(page);
  await keyOver(page, 'KeyK');
  await expectTool(page, 'multiCut');
  const positions0 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  const table = await faceTable(page, body);
  const torso = (face: Face): boolean => face.centroid[1] > 0.85 && face.centroid[1] < 1.3 && face.verts.length === 4;

  // 1. A left torso quad (every vertex at x > 0): its two opposite edges at their midpoints.
  let first: { e1: number; e2: number } | null = null;
  for (const face of table.filter((f) => torso(f) && f.verts.every((v) => (positions0[v] as Vec3)[0] > 0.01))) {
    const [a, b, c, d] = face.verts as [number, number, number, number];
    const e1 = await edgeBetween(page, body, a, b);
    const e2 = await edgeBetween(page, body, c, d);
    if ((await visible(page, body, e1, 0.5)) && (await visible(page, body, e2, 0.5))) {
      first = { e1, e2 };
      break;
    }
  }
  if (first === null) throw new Error('no visible left torso quad');
  const v0 = (await call(page, 'meshInfo', body))?.counts.v ?? 0;
  await clickEdge(page, body, first.e1, 0.5);
  await clickEdge(page, body, first.e2, 0.5);
  await rightClick(page);
  await expect.poll(async () => (await call(page, 'meshInfo', body))?.counts.v).toBe(v0 + 4);
  const positions1 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  expectMirrored(positions1, await partners(page, body), [v0, v0 + 1, v0 + 2, v0 + 3]);

  // 2. A front torso quad left of the centre line, its centre-line edge (both ends on x = 0) and its right neighbour.
  const table1 = await faceTable(page, body);
  const seam = (v: number): boolean => near((positions1[v] as Vec3)[0], 0, 1e-9);
  let second: { outerL: number; centre: number; outerR: number } | null = null;
  for (const face of table1.filter((f) => torso(f) && f.centroid[0] > 0 && f.centroid[2] > 0)) {
    const onSeam = face.verts.filter(seam);
    const off = face.verts.filter((v) => !seam(v));
    if (onSeam.length !== 2 || off.length !== 2) continue;
    const centre = await edgeBetween(page, body, onSeam[0] as number, onSeam[1] as number);
    const outerL = await edgeBetween(page, body, off[0] as number, off[1] as number);
    const right = table1.find(
      (g) => g.f !== face.f && g.verts.includes(onSeam[0] as number) && g.verts.includes(onSeam[1] as number),
    );
    if (centre < 0 || outerL < 0 || right === undefined) continue;
    const offR = right.verts.filter((v) => !seam(v));
    const outerR = await edgeBetween(page, body, offR[0] as number, offR[1] as number);
    if (outerR < 0) continue;
    if (
      (await visible(page, body, outerL, 0.5)) &&
      (await visible(page, body, centre, 0.3)) &&
      (await visible(page, body, outerR, 0.5))
    ) {
      second = { outerL, centre, outerR };
      break;
    }
  }
  if (second === null) throw new Error('no visible front quad pair across the centre line');
  const edges = await call(page, 'meshEdges', body);
  const [ca, cb] = edges[second.centre]?.v ?? [0, 0];
  const expectedSeam: Vec3 = [
    0,
    (positions1[ca] as Vec3)[1] + ((positions1[cb] as Vec3)[1] - (positions1[ca] as Vec3)[1]) * 0.3,
    (positions1[ca] as Vec3)[2] + ((positions1[cb] as Vec3)[2] - (positions1[ca] as Vec3)[2]) * 0.3,
  ];
  const v1 = positions1.length;
  await keyOver(page, 'KeyK');
  await clickEdge(page, body, second.outerL, 0.5);
  await clickEdge(page, body, second.centre, 0.3);
  await clickEdge(page, body, second.outerR, 0.5);
  await rightClick(page);
  await expect.poll(async () => (await call(page, 'meshInfo', body))?.counts.v).toBe(v1 + 3);
  const positions2 = (await call(page, 'meshPositions', body)) as unknown as Vec3[];
  const added = [v1, v1 + 1, v1 + 2];
  const seamVertex = added.find((v) => (positions2[v] as Vec3)[0] === 0);
  expect(seamVertex, 'one new vertex exactly on x = 0').toBeDefined();
  const s = positions2[seamVertex as number] as Vec3;
  expect(Math.abs(s[1] - expectedSeam[1])).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(s[2] - expectedSeam[2])).toBeLessThanOrEqual(1e-6);
  expectMirrored(
    positions2,
    await partners(page, body),
    added.filter((v) => v !== seamVertex),
  );
  expect((await call(page, 'symmetry', body))?.unmatched).toBe(0);
  expect(await counts(page, body)).toMatch(/^\d+\/\d+\/\d+$/);
});
