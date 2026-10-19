import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, MODEL_PANE, modKey, openModel, setMode } from './helpers/m6a-model';
import { counts, hoverPane, runMenuItem, setCardField } from './helpers/m6a-model-ops-ui';
import { keyOver, near, undoLabels, type Vec3, vertexPoint, worldOf } from './helpers/m6a-model-topology-tools';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-28 "Combine, snap, Bridge" (M6A-SPEC §10.1, §5.12, §5.13, §5.15; owner B12b). Two 8-sided cylinders, A
// without its top cap and B without its bottom cap; B's manipulator centre snapped (`V`) onto a vertex of A's open
// loop, then Translate Y `+=1`; Combine; the two border loops bridged from their pick order; the card's Divisions 2,
// Twist 0 then 1 and Offset 0 adjust the one Bridge step; one undo removes it.
//
// Gates (§10.1): b12a (the `V` vertex snap of the move manipulator). The B12b check below builds the same two loops
// without the snap (B's faces lifted with `mesh.transformComponents`) and runs the Combine and Bridge part today.

/** The cap face of a cylinder at height y (all its vertices there). */
async function capAt(page: Page, mesh: string, y: number): Promise<number> {
  const faces = await call(page, 'meshFaces', mesh);
  const positions = (await call(page, 'meshPositions', mesh)) as unknown as Vec3[];
  const f = faces.findIndex((face) => face.length > 4 && face.every((v) => near((positions[v] as Vec3)[1], y)));
  if (f < 0) throw new Error(`no cap at y = ${y}`);
  return f;
}

async function openCylinder(page: Page, capY: number): Promise<string> {
  await runOk(page, 'select.mode', { mode: 'object' });
  const cylinder = await createPrimitive(page, 'cylinder');
  await runOk(page, 'select.objects', { ids: [cylinder], mode: 'replace' });
  await setMode(page, 'face');
  await runOk(page, 'select.components', {
    mesh: cylinder,
    kind: 'face',
    indices: [await capAt(page, cylinder, capY)],
    mode: 'replace',
  });
  await keyOver(page, 'Delete');
  await expect.poll(() => counts(page, cylinder)).toBe('16/24/9');
  return cylinder;
}

/** Combine, both border loops, Bridge with Divisions 2, Twist 0 → 1, Offset 0, one undo. */
async function combineAndBridge(page: Page, a: string, b: string): Promise<void> {
  await runOk(page, 'select.mode', { mode: 'object' });
  await runOk(page, 'select.objects', { ids: [a, b], mode: 'replace' });
  await runMenuItem(page, 'mesh', 'builtin.model.mesh.combine');
  const combined = (await call(page, 'lastOp'))?.targets[0] ?? a;
  await expect.poll(() => counts(page, combined)).toBe('32/48/18');
  await runOk(page, 'select.objects', { ids: [combined], mode: 'replace' });
  await setMode(page, 'edge');
  await runOk(page, 'select.mesh.border');
  const steps = (await undoLabels(page)).length;
  await runMenuItem(page, 'edit-mesh', 'builtin.model.edit-mesh.bridge');
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.bridge');
  await setCardField(page, 'divisions', '2');
  await expect.poll(() => counts(page, combined)).toBe('48/88/42');
  const info = await call(page, 'meshInfo', combined);
  expect(info?.stats.boundaryLoops).toBe(0);
  expect(info?.stats.nonManifoldEdges).toBe(0);
  expect(info?.stats.nonManifoldVerts).toBe(0);
  await setCardField(page, 'twist', '0');
  const twist0 = await call(page, 'meshEdges', combined);
  await setCardField(page, 'twist', '1');
  await setCardField(page, 'offset', '0');
  const twist1 = await call(page, 'meshEdges', combined);
  // The strip's edges differ by one step of the loop order: the same counts, other vertex pairs.
  expect(twist1).toHaveLength(twist0.length);
  expect(JSON.stringify(twist1)).not.toBe(JSON.stringify(twist0));
  expect((await undoLabels(page)).length).toBe(steps + 1);
  await hoverPane(page);
  await page.keyboard.press(`${await modKey(page)}+KeyZ`);
  await expect.poll(() => counts(page, combined)).toBe('32/48/18');
}

test('E2E-MOD-28 — Combine, vertex snap, Bridge', async ({ page }) => {
  await openModel(page);
  const a = await openCylinder(page, 0.5);
  const b = await openCylinder(page, -0.5);
  // The snap target's screen point (read with A hilited; the camera stays where it is).
  await runOk(page, 'select.mode', { mode: 'object' });
  await runOk(page, 'select.objects', { ids: [a], mode: 'replace' });
  await setMode(page, 'vertex');
  const rim = ((await call(page, 'meshPositions', a)) as unknown as Vec3[]).findIndex((p) => near(p[1], 0.5));
  const target = await vertexPoint(page, a, rim);
  await runOk(page, 'select.mode', { mode: 'object' });
  await runOk(page, 'select.objects', { ids: [b], mode: 'replace' });
  await keyOver(page, 'KeyW');
  const centre = await call(page, 'screenOfManipulator', MODEL_PANE, 'tview');
  if (centre === null) throw new Error('no manipulator centre');
  await page.keyboard.down('KeyV');
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('KeyV');
  // B's placement translation (its origin in world space; B is not rotated or scaled) = that vertex's position.
  const world = await worldOf(page, a, rim);
  const local = ((await call(page, 'meshPositions', b, [0])) as unknown as Vec3[])[0] as Vec3;
  const moved = await worldOf(page, b, 0);
  for (let i = 0; i < 3; i++) {
    expect(Math.abs((moved[i] as number) - (local[i] as number) - (world[i] as number))).toBeLessThanOrEqual(1e-6);
  }
  const ty = page.getByTestId('cb-field-ty');
  await ty.fill('+=1');
  await ty.press('Enter');
  await combineAndBridge(page, a, b);
});

test('B12b — E2E-MOD-28 without the snap: Combine, Bridge from the border loops, the card, one undo', async ({
  page,
}) => {
  await openModel(page);
  const a = await openCylinder(page, 0.5);
  const b = await openCylinder(page, -0.5);
  // B's faces lifted 1.5 m: its open loop sits 0.5 m above A's.
  await runOk(page, 'select.mesh.all');
  await runOk(page, 'mesh.transformComponents', { translateY: 1.5 });
  await combineAndBridge(page, a, b);
});
