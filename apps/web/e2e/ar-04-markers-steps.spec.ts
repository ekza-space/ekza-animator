// E2E-AR-04 (AUTORIG-SPEC §10 D4, §5.3, §8.1, §8.3; AS-AR-1 steps 3–4, AS-AR-2 step 2, AS-AR-12's ② part): ② Markers
// through the UI. A T-posed Polybot from ①'s sample: *Next* opens front │ side │ persp (`'rig-markers'`), the nine
// guessed markers lie within 0.05 H of the T-pose truth and the guess made no undo step; Elbow selected in the list and
// dragged back in SIDE keeps its x bit-equal, `Shift+↓` twice on Knee in FRONT keeps its z bit-equal (−2 mm in y), the
// preview follows, still no document change. The fingers choice runs C3's template select; `↑ / ↓` in the list move the
// selection; `G` guesses again. The A-posed Polybot: markers within 0.05 H of the A-pose truth, A0's notice plus
// Auto-Rig's, *Auto-rig ▸* enabled, `startPose` 'a'. At 390×844 one pane at a time with the Front │ Side │ 3D switch.
import { expect, test } from '@playwright/test';
import {
  dist,
  FRONT,
  hoverPane,
  MARKERS,
  markerAt,
  PERSP,
  polybotMarkers,
  type QuickRigView,
  quickRig,
  sampleAtMarkers,
  sampleAtModel,
  SIDE,
  selectMarker,
  toMarkers,
  wizard,
} from './helpers/ar-markers';
import { history } from './helpers/autorig';
import { modKey } from './helpers/m6a-model';
import { drag } from './helpers/g1-viewport';
import { call } from './helpers/test-api';

const marker = (state: QuickRigView | null, name: string): number[] => state?.markers[name] ?? [];

test('AS-AR-1 steps 3–4: front │ side │ persp, the guess on the T-pose truth, side drag and Shift+↓ keep the hidden axis', async ({
  page,
}) => {
  await sampleAtModel(page, 'polybot-tpose');
  const before = await history(page);
  // step 3: rename in the header, then Next
  await page.getByTestId('ar-subject-name').click();
  const field = page.getByRole('textbox', { name: 'Character name' });
  await field.fill('Polybot');
  await field.press('Enter');
  await expect(page.getByTestId('ar-subject-name')).toHaveText('Polybot');
  const renamed = await history(page);
  expect(renamed.undo.slice(0, before.undo.length)).toEqual(before.undo);

  const guessed = await toMarkers(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Markers/);
  await expect(page.getByTestId('ar-panes')).toHaveAttribute('data-panes', '3');
  const panes = (await call(page, 'panes')).map((pane) => [pane.id, pane.camera]);
  expect(panes).toEqual(
    expect.arrayContaining([
      [FRONT, 'front'],
      [SIDE, 'side'],
      [PERSP, 'persp'],
    ]),
  );
  expect((await call(page, 'state')).layout).toBe('rig-markers');
  await expect(page.locator('[data-pane-label="pane-front"]')).toHaveText('FRONT · drag ↔ ↕');
  const truth = polybotMarkers('tpose');
  const off = MARKERS.map(
    (name) => [name, dist(marker(guessed, name), truth.markers[name] ?? []) / truth.height] as const,
  )
    .filter(([, error]) => error > 0.05)
    .map(([name]) => name);
  expect(off).toEqual([]);
  // the guess is U state: no undo step
  expect(await history(page)).toEqual(renamed);
  expect((await wizard(page)).startPose).toMatchObject({ kind: 't' });
  await expect(page.getByTestId('ar-primary')).toHaveText(/Auto-rig/);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  await expect(page.getByTestId('ar-markers-symmetry')).toHaveText(/Left side mirrors the right/);

  // step 4: Elbow selected in the list, dragged back in SIDE: its x unchanged bit for bit
  await selectMarker(page, 'elbow');
  await expect(page.getByTestId('ar-markers-pictogram')).toHaveAttribute('data-selected', 'elbow');
  await expect(page.getByTestId('ar-markers-selected')).toContainText('Elbow');
  const stacked = (await quickRig(page)) as QuickRigView;
  const toe = await markerAt(page, 'toe', 'R', SIDE);
  const ankle = await markerAt(page, 'ankle', 'R', SIDE);
  const zRight = Math.sign(toe.x - ankle.x) * Math.sign(marker(stacked, 'toe')[2]! - marker(stacked, 'ankle')[2]!);
  const metresPerPx = Math.abs(marker(stacked, 'toe')[2]! - marker(stacked, 'ankle')[2]!) / Math.abs(toe.x - ankle.x);
  const elbow = await markerAt(page, 'elbow', 'R', SIDE);
  await drag(page, elbow, { dx: (-0.02 / metresPerPx) * zRight, dy: 0 });
  const dragged = (await quickRig(page)) as QuickRigView;
  expect(marker(dragged, 'elbow')[0]).toBe(marker(stacked, 'elbow')[0]);
  expect(marker(dragged, 'elbow')[2]).toBeLessThan(marker(stacked, 'elbow')[2]! - 0.01);
  expect(marker(dragged, 'elbow')[2]).toBeGreaterThan(marker(stacked, 'elbow')[2]! - 0.03);
  expect(dragged.preview).not.toEqual(stacked.preview);
  expect(dragged.moved).toContain('elbow');

  // Shift+↓ twice on Knee in FRONT: −2 mm in y, z (and x) bit-equal; the preview follows
  await selectMarker(page, 'knee');
  await hoverPane(page, FRONT);
  const kneeBefore = marker(await quickRig(page), 'knee');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => marker(await quickRig(page), 'knee')[1]).toBeCloseTo(kneeBefore[1]! - 0.002, 9);
  const nudged = (await quickRig(page)) as QuickRigView;
  expect(marker(nudged, 'knee')[2]).toBe(kneeBefore[2]);
  expect(marker(nudged, 'knee')[0]).toBe(kneeBefore[0]);
  expect(nudged.preview).not.toEqual(dragged.preview);
  // over the persp pane the nudge acts in the last ortho pane (FRONT): → moves x only
  await hoverPane(page, PERSP);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => marker(await quickRig(page), 'knee')[0]).not.toBe(kneeBefore[0]);
  expect(Math.abs(marker(await quickRig(page), 'knee')[0]! - kneeBefore[0]!)).toBeCloseTo(0.01, 9);
  expect(marker(await quickRig(page), 'knee')[2]).toBe(kneeBefore[2]);
  // still no document change
  expect(await history(page)).toEqual(renamed);
});

test('fingers choose the template; ↑ / ↓ walk the list; G guesses again', async ({ page }) => {
  await sampleAtMarkers(page, 'cube-lad');
  const fingers = page.getByTestId('ar-markers-fingers');
  await expect(fingers.locator('[data-preset="standard33"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('ar-markers-joints')).toHaveText('34 joints — fingers: thumb + 1');
  await fingers.locator('[data-preset="core21"]').click();
  await expect.poll(async () => (await quickRig(page))?.preset).toBe('core21');
  await expect(page.getByTestId('ar-markers-joints')).toHaveText(/fingers: none/);
  await fingers.locator('[data-preset="full52"]').click();
  await expect.poll(async () => (await quickRig(page))?.preset).toBe('full52');
  await fingers.locator('[data-preset="lite17"]').check();
  await expect.poll(async () => (await quickRig(page))?.preset).toBe('lite17');
  await fingers.locator('[data-preset="standard33"]').click();
  await expect.poll(async () => (await quickRig(page))?.preset).toBe('standard33');

  // ↑ / ↓ in the marker list
  await selectMarker(page, 'elbow');
  await page.getByTestId('quickrig-marker-elbow').focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await quickRig(page))?.selected).toBe('wrist');
  await expect(page.getByTestId('quickrig-marker-wrist')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await quickRig(page))?.selected).toBe('shoulder');

  // G: Guess again (the moved marker goes back to its guess)
  const guessed = (await quickRig(page)) as QuickRigView;
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await hoverPane(page, FRONT);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await quickRig(page))?.moved).toContain('shoulder');
  await page.keyboard.press('KeyG');
  await expect.poll(async () => (await quickRig(page))?.moved).toEqual([]);
  expect(marker(await quickRig(page), 'shoulder')).toEqual(marker(guessed, 'shoulder'));
});

test('AS-AR-2 step 2: the A-posed Polybot — markers on the A-pose truth, the A-pose notices, Auto-rig enabled', async ({
  page,
}) => {
  const state = await sampleAtMarkers(page, 'polybot-apose');
  const truth = polybotMarkers('apose');
  const off = MARKERS.map(
    (name) => [name, dist(marker(state, name), truth.markers[name] ?? []) / truth.height] as const,
  )
    .filter(([, error]) => error > 0.05)
    .map(([name]) => name);
  expect(off).toEqual([]);
  expect(state.aPose).toBe(true);
  await expect(page.getByTestId('quickrig-apose')).toHaveText(
    'A-posed arms: the skeleton follows them; after Bind Skin, Straighten to T-Pose makes the rest a VRM T-pose',
  );
  await expect(page.getByTestId('ar-markers-notice-apose')).toHaveText('Auto-rig straightens it for you.');
  expect((await wizard(page)).startPose).toMatchObject({ kind: 'a' });
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  // the body's own Create Skeleton row is hidden: Auto-rig ▸ replaces it
  await expect(page.getByTestId('quickrig-commit')).toHaveCount(0);
});

test('AS-AR-12 (② part): at 390×844 one pane at a time with the Front │ Side │ 3D switch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await sampleAtMarkers(page, 'cube-lad');
  await expect(page.getByTestId('ar-panes')).toHaveAttribute('data-panes', '1');
  const ids = async () => (await call(page, 'panes')).map((pane) => pane.id).sort();
  await expect.poll(ids).toEqual([FRONT]);
  const switcher = page.getByTestId('ar-markers-pane-switch');
  await switcher.locator('[data-pane="side"]').click();
  await expect.poll(ids).toEqual([SIDE]);
  await expect(switcher.locator('[data-pane="side"]')).toHaveAttribute('aria-pressed', 'true');
  await switcher.locator('[data-pane="persp"]').click();
  await expect.poll(ids).toEqual([PERSP]);
  await switcher.locator('[data-pane="front"]').click();
  await expect.poll(ids).toEqual([FRONT]);
  // the markers are drawn in the one pane (the tool works there)
  await markerAt(page, 'headTop', 'R', FRONT);
  // no horizontal scroll
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('AR-D8-3: Mod+Z on ② reverts a marker drag, never the import; Mod+Shift+Z redoes it; an empty history does nothing', async ({
  page,
}) => {
  const guessed = await sampleAtMarkers(page, 'polybot-tpose');
  const mod = await modKey(page);
  const docBefore = await history(page);
  await expect(page.getByTestId('ar-undo')).toBeDisabled();
  // Mod+Z with nothing moved: the model and ② stay, the document history is untouched
  await page.keyboard.press(`${mod}+KeyZ`);
  expect(await history(page)).toEqual(docBefore);
  expect((await quickRig(page))?.markers).toEqual(guessed.markers);
  // drag Elbow in FRONT: one step "Marker Move"
  await selectMarker(page, 'elbow');
  const elbow = await markerAt(page, 'elbow', 'R', FRONT);
  await drag(page, elbow, { dx: 0, dy: 25 });
  await expect.poll(async () => marker(await quickRig(page), 'elbow')).not.toEqual(marker(guessed, 'elbow'));
  const moved = (await quickRig(page)) as QuickRigView;
  expect(moved.moved).toContain('elbow');
  await expect(page.getByTestId('ar-undo')).toHaveAttribute('title', 'Undo Marker Move');
  // Mod+Z: the drag is reverted (markers, moved and preview), the import stays
  await page.keyboard.press(`${mod}+KeyZ`);
  await expect.poll(async () => marker(await quickRig(page), 'elbow')).toEqual(marker(guessed, 'elbow'));
  const undone = (await quickRig(page)) as QuickRigView;
  expect(undone.moved).not.toContain('elbow');
  expect(undone.preview).toEqual(guessed.preview);
  expect(await history(page)).toEqual(docBefore);
  expect((await wizard(page)).step).toBe('markers');
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  // a second Mod+Z does nothing; Mod+Shift+Z brings the drag back
  await page.keyboard.press(`${mod}+KeyZ`);
  expect(await history(page)).toEqual(docBefore);
  await page.keyboard.press(`${mod}+Shift+KeyZ`);
  await expect.poll(async () => marker(await quickRig(page), 'elbow')).toEqual(marker(moved, 'elbow'));
  expect((await quickRig(page))?.moved).toContain('elbow');
  expect(await history(page)).toEqual(docBefore);
});
