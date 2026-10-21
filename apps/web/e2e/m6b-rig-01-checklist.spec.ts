import { expect, type Page, test } from '@playwright/test';
import { drag, pointOf } from './helpers/g1-viewport';
import { createPrimitive, openModel } from './helpers/m6a-model';
import { buildCubeLad } from './helpers/m6b-cube-lad';
import { enterRig, expectRefused, RIG_FRONT_PANE, RIG_PERSP_PANE } from './helpers/m6b-rig';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-RIG-01 (M6B-SPEC §0.7 "MVP checklist"; owner C7): the Cube Lad goes through ① Place markers + Create Skeleton,
// ② a `D`-drag of a knee, ③ Bind, ④ one stroke, ⑤ a library preview and ⑥ the Export Character dialog with Export
// enabled: every checklist glyph turns done and the tab glyph ●. Gates c1, c2, c3, c4, c6, c10, c12 (every step is
// another package's). The checklist frame, the empty state, the Getting started card and the tab glyph run now.

const GATES = 'c1, c2, c3, c4, c6, c10, c12';

const glyphs = async (page: Page): Promise<string[]> =>
  (await call(page, 'rigState')).checklist.map((step) => step.glyph);

test('E2E-RIG-01 (MVP part): the checklist starts at ①, the empty state, Getting started, the tab glyph', async ({
  page,
}) => {
  await openEditor(page);
  await expectKernelStarted(page);
  await enterRig(page);
  const toolkit = page.getByTestId('rtk-panel');
  await expect(toolkit).toBeVisible();
  // ① asks for markers; the rest wait for a skeleton.
  await expect.poll(() => glyphs(page)).toEqual(['attention', 'todo', 'todo', 'todo', 'todo', 'todo']);
  await expect(page.getByTestId('rtk-step-1')).toHaveAttribute('data-glyph', 'attention');
  await expect(page.getByTestId('rtk-step-1-btn')).toHaveText('Quick Rig');
  await expect(page.getByTestId('rtk-empty')).toContainText('Select a mesh');
  // The tab glyph: ○ without a skeleton.
  expect((await call(page, 'workspaces')).find((workspace) => workspace.id === 'rig')).toMatchObject({
    glyph: 'todo',
    reasons: ['No skeleton yet'],
  });
  // The empty state over the viewport, and the Getting started card with the owner flow (dismissible).
  await expect(page.getByTestId('rig-empty')).toContainText('Select a mesh to turn into a character');
  const card = page.getByTestId('rig-getting-started');
  await expect(card).toContainText('Quick Rig');
  await page.getByTestId('rig-getting-started-dismiss').click();
  await expect(card).toBeHidden();
  // The R-Side layout: front │ persp.
  expect((await call(page, 'panes')).map((pane) => pane.id).sort()).toEqual([RIG_FRONT_PANE, RIG_PERSP_PANE].sort());
  // The sample button loads Polybot (the empty state goes away with the first character).
  await page.getByTestId('rig-empty-sample').click();
  await expect(page.getByTestId('rig-empty')).toBeHidden();
  expect((await call(page, 'rigState')).character).not.toBeNull();
});

test('E2E-RIG-01 (MVP part): Object mode picks a scene mesh (Quick Rig on it); view-only below 1024 px', async ({
  page,
}) => {
  await openModel(page);
  await expectKernelStarted(page);
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [], mode: 'replace' });
  await enterRig(page);
  const quickRig = page.getByTestId('rig-empty-quickrig');
  await expect(quickRig).toBeDisabled();
  // §5.24: the Object-mode pick mask has meshes; a click on the cube selects it, and Quick Rig is offered on it.
  const face = await pointOf(page, () => call(page, 'screenOfFace', cube, 0, RIG_PERSP_PANE), 'a cube face');
  await page.mouse.click(face.x, face.y);
  await expect(quickRig).toBeEnabled();
  expect((await call(page, 'history')).undo.at(-1)).toBe('Select'); // selection undo in Rig & Skin
  await runOk(page, 'edit.undo');
  await expect(quickRig).toBeDisabled();
  await runOk(page, 'edit.redo');
  await expect(quickRig).toBeEnabled();
  // Below 1024 px Rig & Skin is view-only: the banner, and document edits are refused (§5.24).
  const size = page.viewportSize();
  await page.setViewportSize({ width: 900, height: size?.height ?? 800 });
  await expect(page.getByTestId('rig-view-only')).toContainText('Open on a larger screen to edit');
  await expectRefused(page, 'channel.toggleLock', 'Open on a larger screen to edit', { refs: [] });
  if (size !== null) await page.setViewportSize(size);
  await expect(page.getByTestId('rig-view-only')).toBeHidden();
});

test.fixme(`E2E-RIG-01: the MVP checklist on the Cube Lad (gates: ${GATES})`, async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const mesh = await buildCubeLad(page);
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await enterRig(page);
  // ① Quick Rig from the checklist, then Create Skeleton.
  await page.getByTestId('rtk-step-1-btn').click();
  await expect.poll(async () => (await call(page, 'quickRig'))?.preview?.length ?? 0).toBeGreaterThan(0);
  await page.getByTestId('quickrig-commit').click();
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('skeleton');
  const character = (await call(page, 'rigState')).character ?? '';
  // ② D + W drag of the left knee in the front pane.
  const knee = (await call(page, 'skeleton', character))?.joints.find((j) => j.humanBone === 'leftLowerLeg');
  const at = await pointOf(page, () => call(page, 'screenOfJoint', knee?.id ?? '', RIG_FRONT_PANE), 'left knee');
  await page.keyboard.press('KeyW');
  await page.keyboard.down('KeyD');
  await drag(page, at, { dx: 6, dy: 0 });
  await page.keyboard.up('KeyD');
  // ③ Bind Skin, one click.
  await page.getByTestId('rtk-step-3-btn').click();
  await expect.poll(async () => (await call(page, 'rigState')).checklist[2]?.glyph).toBe('done');
  // ④ One Replace stroke in Skin mode on the bound mesh.
  await page.keyboard.press('Digit2');
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('skin');
  const point = await pointOf(page, () => call(page, 'screenOfVertex', mesh, 0, RIG_PERSP_PANE), 'a point');
  await drag(page, point, { dx: 10, dy: 0 });
  // ⑤ Preview a library clip.
  await runOk(page, 'library.preview', { character, clip: 'walk' });
  await expect.poll(async () => (await call(page, 'library'))?.preview?.clip ?? null).toBe('walk');
  await runOk(page, 'library.stop');
  // ⑥ The Export Character dialog with Export enabled.
  await page.getByTestId('rtk-step-6-btn').click();
  await expect(page.getByTestId('export-confirm')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect.poll(() => glyphs(page)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
  await expect.poll(async () => (await call(page, 'rigState')).glyph).toBe('done');
  expect((await call(page, 'workspaces')).find((workspace) => workspace.id === 'rig')?.glyph).toBe('done');
});
