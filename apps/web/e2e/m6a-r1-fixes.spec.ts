// M6a acceptance fix round 1 (DECISIONS-OPEN §J): the defects the M6a acceptance found that only show in the real
// build in real Chrome — a moved mesh drawn at its old transform, double-click loop selection with the transform
// tools, the status-line Symmetry select, the Channel Box lead in Model and the collapsed Mesh Check dock.
import { expect, type Page, test } from '@playwright/test';
import { controlIdOf, selectIds, typeCb } from './helpers/m2a-a2';
import { createPrimitive, enterModel, MODEL_PANE, openModel, selectedComponents, setMode } from './helpers/m6a-model';
import { showChannelBox } from './helpers/m6a-model-ops-ui';
import { edgeLoop, pressOver, reachable, sorted, topology } from './helpers/m6a-model-select-ui';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

type Rgba = readonly number[];

async function pixel(page: Page, at: { x: number; y: number }): Promise<Rgba> {
  return call(page, 'pixel', MODEL_PANE, at.x, at.y);
}

const differs = (a: Rgba, b: Rgba): boolean => a.some((value, i) => Math.abs(value - (b[i] ?? 0)) > 12);

/** A face the pane shows and its screen point (face mode finds it; the caller goes back to object mode to sample). */
async function visibleFace(
  page: Page,
  mesh: string,
  prefer = -1,
): Promise<{ face: number; at: { x: number; y: number } }> {
  await setMode(page, 'face');
  const faces = (await call(page, 'meshInfo', mesh))?.counts.f ?? 0;
  const order = prefer >= 0 ? [prefer] : Array.from({ length: faces }, (_, f) => f);
  const found: { hit: { face: number; at: { x: number; y: number } } | null } = { hit: null };
  await expect
    .poll(async () => {
      for (const face of order) {
        const at = await call(page, 'screenOfFace', mesh, face, MODEL_PANE);
        if (at !== null) {
          found.hit = { face, at };
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  await setMode(page, 'object');
  if (found.hit === null) throw new Error(`no visible face of ${mesh}`);
  return found.hit;
}

test('a moved mesh is drawn at its new transform (Channel Box, then undo)', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cube = await createPrimitive(page, 'cube');
  const { at: before } = await visibleFace(page, cube);
  await expect.poll(async () => (await pixel(page, before)).join()).not.toBe('0,0,0,0');
  const drawn = await pixel(page, before);

  // Translate X 1.5 from the Channel Box: the data, the picking and the drawing all move.
  await showChannelBox(page);
  await typeCb(page, 'cb-field-tx', '1.5');
  // Nothing of the cube is left where it was.
  await expect.poll(async () => differs(await pixel(page, before), drawn), { timeout: 10_000 }).toBe(true);
  const empty = await pixel(page, before);
  // The face is drawn where picking now finds it.
  const { at: after } = await visibleFace(page, cube);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(40);
  await expect.poll(async () => differs(await pixel(page, after), empty), { timeout: 10_000 }).toBe(true);

  // Undo puts it back, drawn at the origin again.
  await runOk(page, 'edit.undo');
  await expect.poll(async () => differs(await pixel(page, before), empty), { timeout: 10_000 }).toBe(true);
});

test('double-click selects the edge loop with the Move, Rotate and Scale tools active', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const plane = await createPrimitive(page, 'plane', { subdivisionsWidth: 4, subdivisionsHeight: 4 });
  await setMode(page, 'edge');
  const topo = await topology(page, plane);
  let edge = -1;
  let at: { x: number; y: number } | null = null;
  for (let e = 0; e < topo.edges.length && at === null; e++) {
    if (topo.facesOf(e).length !== 2 || edgeLoop(topo, e).length < 4) continue;
    const point = await call(page, 'screenOfEdge', plane, e, MODEL_PANE);
    if (point !== null && (await reachable(page, point))) {
      edge = e;
      at = point;
    }
  }
  if (at === null) throw new Error('no visible interior edge');
  const loop = sorted(edgeLoop(topo, edge));
  for (const [key, tool] of [
    ['KeyW', 'move'],
    ['KeyE', 'rotate'],
    ['KeyR', 'scale'],
  ] as const) {
    await pressOver(page, key);
    await expect.poll(async () => (await call(page, 'state')).tool).toBe(tool);
    // The tool is ready (the Scale tool's chunk loads on first use): a single click selects the edge.
    await runOk(page, 'select.mesh.none');
    const point = at;
    await expect
      .poll(async () => {
        await page.mouse.click(point.x, point.y);
        return selectedComponents(page, plane, 'edge');
      })
      .toEqual([edge]);
    await runOk(page, 'select.mesh.none');
    await page.waitForTimeout(600); // past the double-click window of that click
    await page.mouse.dblclick(at.x, at.y);
    await expect
      .poll(() => selectedComponents(page, plane, 'edge'), { message: `double-click with ${tool}` })
      .toEqual(loop);
  }
});

test('the status-line Symmetry select is enabled as soon as a mesh is selected or hilited', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const sym = page.getByTestId('status-sym');
  await expect(sym).toBeDisabled();
  await page.getByTestId('model-start-cube').click();
  await expect.poll(async () => (await call(page, 'meshes')).length).toBe(1);
  await expect(sym).toBeEnabled();
  await setMode(page, 'face');
  await expect(sym).toBeEnabled();
  await sym.selectOption('object-x');
  await expect(sym).toHaveValue('object-x');
});

test('in Model the Channel Box shows the selected mesh, not the Animate control selection', async ({ page }) => {
  test.setTimeout(90_000);
  await openEditor(page);
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  await selectIds(page, [await controlIdOf(page, 'fk.head')]);
  await enterModel(page);
  const cube = await createPrimitive(page, 'cube');
  expect((await call(page, 'state')).mode).toBe('object');
  await showChannelBox(page);
  await expect(page.getByTestId('cb-field-tx')).toBeVisible();
  await expect(page.getByTestId('cb-lead-name')).not.toHaveText('Head');
  expect((await call(page, 'meshes')).some((row) => row.id === cube)).toBe(true);
});

test('a click on the collapsed Mesh Check tab opens the dock to a usable height', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const panel = page.getByTestId('panel-meshCheck');
  await page
    .locator('.dv-tab', { hasText: /^Mesh Check$/ })
    .first()
    .click();
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeGreaterThan(120);
});
