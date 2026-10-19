import { expect, test } from '@playwright/test';
import { counts, faceCentroid, hoverPane, positions, runMenuItem, topEdge } from './helpers/m6a-model-ops-ui';
import { createPrimitive, openModel } from './helpers/m6a-model';
import { call, expectKernelStarted, runOk } from './helpers/test-api';

// E2E-MOD-09 "Delete half, Mirror, Conform, Mesh Check" (M6A-SPEC §10.1, §5.12, §5.13; owner B11): a centre loop,
// the −X faces deleted with Maya's plain Delete, Mirror from the Mesh menu (defaults: +X kept, cut, merged seam) and
// Conform from Mesh Display — a closed, manifold cube that Mesh Check finds nothing wrong with.
//
// Gates (§10.1): b3 (Insert Edge Loop, Delete), b4 (Mirror, Conform), b5 (Mesh Check), b10 (face mode and the
// selection). The B11 check below runs today: the Channel Box of a primitive — the object's rows and the INPUTS
// primitive entry adjusting the creation in place (same mesh, same step).

test.fixme('b3, b4, b5, b10: E2E-MOD-09 — delete half, Mirror, Conform, Mesh Check', async ({ page }) => {
  await openModel(page);
  const cube = await createPrimitive(page, 'cube');
  const { edge } = await topEdge(page, cube, 'x');
  await runOk(page, 'mesh.insertLoop', { meshes: [cube], kind: 'edge', seedEdge: edge, weight: 0.5 });
  await expect.poll(() => counts(page, cube)).toBe('12/20/10');

  await hoverPane(page);
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('face');
  const faces = (await call(page, 'meshFaces', cube)).map((_, f) => f);
  const negative: number[] = [];
  for (const f of faces) if ((await faceCentroid(page, cube, f))[0] < 0) negative.push(f);
  expect(negative).toHaveLength(5);
  await runOk(page, 'select.components', { mesh: cube, kind: 'face', indices: negative, mode: 'replace' });
  await hoverPane(page);
  await page.keyboard.press('Delete');
  await expect.poll(() => counts(page, cube)).toBe('8/12/5');

  await page.keyboard.press('F8');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('object');
  await runMenuItem(page, 'mesh', 'builtin.model.mesh.mirror');
  await expect.poll(() => counts(page, cube)).toBe('12/20/10');
  const stats = (await call(page, 'meshInfo', cube))?.stats;
  expect(stats).toMatchObject({ boundaryLoops: 0, nonManifoldEdges: 0, nonManifoldVerts: 0 });

  const before = await positions(page, cube);
  await runMenuItem(page, 'mesh-display', 'builtin.model.mesh-display.conform');
  await expect.poll(async () => (await call(page, 'lastOp'))?.id).toBe('mesh.conform');
  expect(await positions(page, cube)).toEqual(before);
  expect(await call(page, 'meshCheck', cube)).toEqual([]);
});

test('B11 — the Channel Box of a primitive: object rows and the INPUTS primitive entry', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cylinder = await createPrimitive(page, 'cylinder');
  expect(await counts(page, cylinder)).toBe('16/24/10');
  await runOk(page, 'workspace.showPanel', { panel: 'channelBox' });
  await expect(page.getByTestId('cb-field-ty')).toHaveValue('0.000');
  await expect(page.getByTestId('cb-field-sx')).toHaveValue('1.000');
  await expect(page.getByTestId('cb-prim-title')).toHaveText('cylinder (primitive)');
  await expect(page.getByTestId('cb-prim-field-subdivisionsAxis')).toHaveValue('8');
  // An edit right after the creation adjusts it: the same mesh id, no new step.
  const steps = (await call(page, 'history')).undo.length;
  await page.getByTestId('cb-prim-field-subdivisionsAxis').fill('10');
  await page.getByTestId('cb-prim-field-subdivisionsAxis').press('Enter');
  await expect.poll(() => counts(page, cylinder)).toBe('20/30/12');
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  const row = (await call(page, 'meshes')).find((mesh) => mesh.id === cylinder);
  expect(row).toMatchObject({ badge: 'prim', generator: 'cylinder' });
  await expect(page.getByTestId('cb-prim-field-subdivisionsAxis')).toHaveValue('10');
  // The Last-op card shows the same values (one operation, two views).
  expect((await call(page, 'lastOp'))?.args['subdivisionsAxis']).toBe(10);
});
