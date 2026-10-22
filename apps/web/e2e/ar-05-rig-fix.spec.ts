// E2E-AR-05 (AUTORIG-SPEC §10 D4, §5.4, §4.3, §8.1, §8.3): ③'s fix tools and their rules on the rigged Cube Lad.
// *Paint weights* (Skin mode, C6's tool, the reduced controls): a stroke sets `rig.paintedSinceBind`; after it,
// *Adjust joints* → move → *Done* runs plain Bind Skin, so M6b's "Rebind replaces painted weights" question opens in
// the shared dialog host (*Rebind* → a "Bind Skin" step, the flag cleared); with no weight edit since the bind, Done
// rebinds without the question. *Show weights* switches C6's display. `Space` (focus on no control) toggles the motion
// test. *Back* goes to ② and starts M6b's re-run: the markers seeded from the joints, the template locked; *Auto-rig*
// asks the rebind question first (answered in e2e) and refits in place in one "Refit Skeleton" step. At 390×844 *Paint
// weights* says "Painting needs a larger screen".
import { expect, type Page, test } from '@playwright/test';
import { FRONT, PERSP, sampleAtMarkers, wizard } from './helpers/ar-markers';
import { autoRig, quickRig, stepsSince, subjectCharacter } from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { drag } from './helpers/g1-viewport';
import { boxPoints, screenCentroid, stroke } from './helpers/m6b-skin-ui';
import { jointAt, toolKey } from './helpers/m6b-skeleton-ui';
import { call } from './helpers/test-api';

const rigSlice = async (page: Page) =>
  (await wizard(page)).slices['rig'] as { sub: string; motionTest: boolean; paintedSinceBind: boolean };

/** *Adjust joints*, one `W` drag of a joint in FRONT (one step), then *Done*. */
async function adjustOnce(page: Page, joint: string): Promise<void> {
  await page.getByTestId('ar-rig-adjust').click();
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('skeleton');
  const steps = (await history(page)).undo.length;
  await toolKey(page, 'KeyW', FRONT);
  await drag(page, await jointAt(page, joint, FRONT), { dx: 0, dy: -3 });
  await expect.poll(async () => (await history(page)).undo.length).toBe(steps + 1);
  await page.getByTestId('ar-rig-done').click();
}

test('paint sets paintedSinceBind; Done then asks before rebinding; Show weights; Space; Back re-runs the markers', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await sampleAtMarkers(page, 'cube-lad');
  await autoRig(page);
  const { character, mesh } = await subjectCharacter(page);
  const skeleton = await call(page, 'skeleton', character);
  const id = (bone: string): string => skeleton?.joints.find((joint) => joint.humanBone === bone)?.id ?? bone;
  expect(await rigSlice(page)).toMatchObject({ sub: 'review', paintedSinceBind: false });

  // Space toggles the motion test while the focus is on no control
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('walk');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await rigSlice(page)).motionTest).toBe(false);
  await expect.poll(async () => (await call(page, 'library'))?.preview ?? null).toBeNull();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await rigSlice(page)).motionTest).toBe(true);
  expect((await call(page, 'state')).maximizedPane).toBeNull();

  // Show weights: C6's display on every pane, and off again
  const showWeights = page.getByTestId('ar-rig-show-weights');
  const shown = await showWeights.isChecked();
  await showWeights.click();
  await expect.poll(async () => (await call(page, 'paint')).display !== 'off').toBe(!shown);
  await showWeights.click();
  await expect.poll(async () => (await call(page, 'paint')).display !== 'off').toBe(shown);

  // Paint weights: one stroke sets paintedSinceBind
  await page.getByTestId('ar-rig-paint').click();
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('paintSkinWeights');
  await expect.poll(async () => (await call(page, 'library'))?.preview ?? null).toBeNull();
  if ((await call(page, 'paint')).display === 'off') await showWeights.click();
  await page.getByTestId(`pw-influence-${id('leftUpperArm')}`).click();
  const positions = await call(page, 'meshPositions', mesh, undefined, 'local');
  const forearm = boxPoints(positions, 'forearm.L');
  const at = await screenCentroid(page, mesh, forearm, PERSP);
  const before = (await history(page)).undo.length;
  await stroke(page, at, 12, 0);
  await expect.poll(async () => (await history(page)).undo.length).toBe(before + 1);
  await expect.poll(async () => (await rigSlice(page)).paintedSinceBind).toBe(true);
  await page.getByTestId('ar-rig-done').click();
  await expect.poll(async () => (await rigSlice(page)).sub).toBe('review');

  // Adjust joints after painting: Done asks "Rebind replaces painted weights" (the shared dialog); Rebind binds
  await adjustOnce(page, id('leftUpperArm'));
  await expect(page.getByTestId('rebind-skin-dialog')).toBeVisible();
  const asked = (await history(page)).undo;
  await page.getByTestId('rebind-ok').click();
  await expect.poll(async () => (await history(page)).undo.length, { timeout: 30_000 }).toBe(asked.length + 1);
  expect((await history(page)).undo.at(-1)).toBe('Bind Skin');
  await expect.poll(async () => (await rigSlice(page)).paintedSinceBind).toBe(false);

  // no weight edit since the bind: Done rebinds without the question
  await expect.poll(async () => (await rigSlice(page)).sub).toBe('review');
  await adjustOnce(page, id('rightUpperArm'));
  await expect.poll(async () => (await history(page)).undo.at(-1), { timeout: 30_000 }).toBe('Bind Skin');
  expect((await call(page, 'state')).dialog).toBeNull();
  await expect(page.getByTestId('rebind-skin-dialog')).toHaveCount(0);

  // Back: ② with M6b's re-run — markers from the joints, the template locked; Auto-rig refits in place in one step
  await expect.poll(async () => (await rigSlice(page)).sub).toBe('review');
  await page.getByRole('button', { name: /Back/ }).click();
  await expect.poll(async () => (await wizard(page)).step).toBe('markers');
  await expect.poll(async () => (await quickRig(page))?.moved.length ?? 0, { timeout: 20_000 }).toBe(9);
  await expect(page.getByTestId('ar-markers-notice-rerun')).toBeVisible();
  await expect(page.getByTestId('ar-markers-fingers').locator('[data-preset="full52"]')).toBeDisabled();
  const rerun = (await history(page)).undo;
  await autoRig(page);
  expect(await stepsSince(page, rerun)).toEqual(['Refit Skeleton']);
  expect((await subjectCharacter(page)).character).toBe(character);
  expect((await wizard(page)).done.rig).toBe(true);
});

test('AS-AR-12 (③ part): at 390×844 Paint weights says it needs a larger screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await sampleAtMarkers(page, 'cube-lad');
  await autoRig(page);
  await page.getByTestId('ar-rig-paint').click();
  await expect(page.getByTestId('ar-rig-paint-phone')).toHaveText('Painting needs a larger screen');
  await expect(page.getByTestId('pw-controls')).toHaveCount(0);
  await page.getByTestId('ar-rig-done').click();
  await expect.poll(async () => (await rigSlice(page)).sub).toBe('review');
  // Adjust joints on a phone: the 3D pane only
  await page.getByTestId('ar-rig-adjust').click();
  await expect(page.getByTestId('ar-panes')).toHaveAttribute('data-panes', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
