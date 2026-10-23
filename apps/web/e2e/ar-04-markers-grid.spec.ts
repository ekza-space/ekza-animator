// E2E-AR-04, CR-AR-5's plain-grid test (AUTORIG-SPEC §4.1, §9 CR-AR-5; D4): M6b's viewport tools work unchanged in
// Auto-Rig's CSS-grid panes (`WizardPane`s, no dockview): a marker drag in FRONT (x and y follow the pointer, z
// bit-equal), a joint `W` drag in ③'s *Adjust joints* FRONT pane (one "Move Joints" step), and one Paint Skin Weights
// stroke in ③'s *Paint weights* persp pane (one undo step, the stroked points' weights change).
import { expect, test } from '@playwright/test';
import { FRONT, markerAt, PERSP, sampleAtMarkers } from './helpers/ar-markers';
import { autoRig, markerOf, quickRig, subjectCharacter } from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { drag } from './helpers/g1-viewport';
import { boxPoints, screenCentroid, stroke } from './helpers/m6b-skin-ui';
import { jointAt, toolKey } from './helpers/m6b-skeleton-ui';
import { call } from './helpers/test-api';

test('CR-AR-5: markers drag, joint W and a paint stroke in the wizard panes', async ({ page }) => {
  test.setTimeout(120_000);
  await sampleAtMarkers(page, 'cube-lad');
  // no dockview on /autorig: the panes are the wizard's grid
  await expect(page.locator('.dv-dockview')).toHaveCount(0);
  await expect(page.locator(`[data-testid="pane-${FRONT}"]`)).toBeVisible();

  // a marker drag in FRONT: x and y move, z bit-equal (C3's axis rule)
  const before = await quickRig(page);
  const wrist = await markerAt(page, 'wrist', 'R', FRONT);
  await drag(page, wrist, { dx: -10, dy: -6 });
  const after = await quickRig(page);
  expect(markerOf(after, 'wrist')[2]).toBe(markerOf(before, 'wrist')[2]);
  expect(markerOf(after, 'wrist')[0]).toBeLessThan(markerOf(before, 'wrist')[0]!);
  expect(markerOf(after, 'wrist')[1]).toBeGreaterThan(markerOf(before, 'wrist')[1]!);
  expect(after?.moved).toContain('wrist');

  await autoRig(page);
  const { character, mesh } = await subjectCharacter(page);
  const skeleton = await call(page, 'skeleton', character);
  const id = (bone: string): string => skeleton?.joints.find((joint) => joint.humanBone === bone)?.id ?? bone;

  // a joint W drag in Adjust joints (FRONT): the upper arm with its subtree, one step
  await page.getByTestId('ar-rig-adjust').click();
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('skeleton');
  const steps = (await history(page)).undo.length;
  await toolKey(page, 'KeyW', FRONT);
  const arm = await jointAt(page, id('leftUpperArm'), FRONT);
  await drag(page, arm, { dx: 0, dy: -4 });
  await expect.poll(async () => (await history(page)).undo.length).toBe(steps + 1);
  expect((await history(page)).undo.at(-1)).toBe('Move Joints');
  await page.getByTestId('ar-rig-done').click();
  await expect.poll(async () => (await history(page)).undo.at(-1), { timeout: 30_000 }).toBe('Bind Skin');
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('object');

  // one paint stroke in Paint weights (persp): one undo step, the stroked forearm points change
  await page.getByTestId('ar-rig-paint').click();
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('skin');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('paintSkinWeights');
  await expect(page.getByTestId('pw-controls')).toHaveAttribute('data-compact', 'true');
  await page.getByTestId(`pw-influence-${id('leftUpperArm')}`).click();
  await expect.poll(async () => (await call(page, 'paint')).active?.joint).toBe(id('leftUpperArm'));
  await expect(page.getByTestId(`pw-influence-${id('leftUpperArm')}`)).toContainText('Left upper arm');
  const positions = await call(page, 'meshPositions', mesh, undefined, 'local');
  const forearm = boxPoints(positions, 'forearm.L');
  expect(forearm.length).toBeGreaterThan(0);
  const weights = await call(page, 'weights', mesh, forearm);
  const at = await screenCentroid(page, mesh, forearm, PERSP);
  const painted = (await history(page)).undo.length;
  await stroke(page, at, 12, 0);
  await expect.poll(async () => (await history(page)).undo.length).toBe(painted + 1);
  expect(await call(page, 'weights', mesh, forearm)).not.toEqual(weights);
  await expect.poll(async () => (await call(page, 'autorig'))?.slices['rig']).toMatchObject({ paintedSinceBind: true });
});
