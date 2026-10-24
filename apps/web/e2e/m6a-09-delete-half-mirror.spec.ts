import { expect, test } from '@playwright/test';
import { counts, faceCentroid, hoverPane, positions, runMenuItem, topEdge } from './helpers/m6a-model-ops-ui';
import { createPrimitive, openModel } from './helpers/m6a-model';
import { call, expectKernelStarted, runOk } from './helpers/test-api';

// E2E-MOD-09 "Delete half, Mirror, Conform, Mesh Check" (M6A-SPEC §10.1, §5.12, §5.13; owner B11): a centre loop,
// the −X faces deleted with plain Delete, Mirror from the Mesh menu (defaults: +X kept, cut, merged seam) and
// Conform from Mesh Display — a closed, manifold cube that Mesh Check finds nothing wrong with.
//
// Gates (§10.1): b3 (Insert Edge Loop, Delete), b4 (Mirror, Conform), b5 (Mesh Check), b10 (face mode and the
// selection). The B11 check below runs today: the Channel Box of a primitive — the object's rows and the INPUTS
// primitive entry adjusting the creation in place (same mesh, same step).

test('E2E-MOD-09 — delete half, Mirror, Conform, Mesh Check', async ({ page }) => {
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
  const wound = await call(page, 'meshFaces', cube);
  // Conform runs on the whole mesh in object mode (§6.1 Modes "f, object"). To see the menu click's own run finish,
  // the whole mesh is reversed first (the API, object mode): Conform from the menu turns every face back outward and
  // records its step (the LastRun of a menu run).
  await runOk(page, 'mesh.reverse', { meshes: [cube] });
  expect(await call(page, 'meshFaces', cube)).not.toEqual(wound);
  await page.getByTestId('menu-mesh-display').click();
  const conform = page.getByTestId('menu-item-builtin.model.mesh-display.conform');
  await expect(conform).not.toHaveAttribute('aria-disabled', 'true');
  await conform.click();
  await expect
    .poll(async () => {
      const last = await call(page, 'lastOp');
      return last === null ? null : { id: last.id, source: last.source, targets: last.targets };
    })
    .toEqual({ id: 'mesh.conform', source: 'menu', targets: [cube] });
  expect(await call(page, 'meshFaces', cube)).toEqual(wound);
  // A consistent mesh stays as it is (a run that changes nothing records no step, §5.7).
  const steps = (await call(page, 'history')).undo.length;
  await runOk(page, 'mesh.conform');
  expect((await call(page, 'history')).undo).toHaveLength(steps);
  expect(await positions(page, cube)).toEqual(before);
  expect(await call(page, 'meshFaces', cube)).toEqual(wound);
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
