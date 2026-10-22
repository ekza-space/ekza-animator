import { expect, type Page, test } from '@playwright/test';
import { drag } from './helpers/g1-viewport';
import { cubeLadTruth } from './helpers/m6b-cube-lad';
import { enterRig, RIG_FRONT_PANE, RIG_PERSP_PANE, RIG_SIDE_PANE } from './helpers/m6b-rig';
import {
  cubeLadInRig,
  dist,
  frontMarkerPoints,
  markerAt,
  previewOf,
  type QuickRigView,
  quickRig,
  sideZSign,
  startQuickRig,
} from './helpers/m6b-skeleton-ui';
import { call, runOk } from './helpers/test-api';

// E2E-QR-01 (M6B-SPEC §0.7 "Markers: guess, axis rule, live preview"; owner C3, no gates): the Cube Lad; Quick Rig →
// the nine guessed markers within 0.05 H (chin included) and six ghosts; a front drag keeps z bit-equal, a side drag
// keeps x bit-equal, centre markers keep x = 0; the elbow selected in the panel list wins the side-pane spot where
// shoulder, elbow and wrist overlap, and two clicks there cycle; the ghosts mirror; the preview follows each pointer
// frame; Clear empties, clicks in the front pane place the markers in list order, Guess restores; Esc closes with the
// history unchanged. The off-centre Cube Lad: the centre notice, Create Skeleton disabled, Center and ground = one
// undo step, then the guess runs and Create Skeleton is enabled.

const MARKERS = ['headTop', 'chin', 'pelvis', 'shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe'] as const;
const truth = cubeLadTruth();
const H = truth.height;

const marker = (state: QuickRigView | null, name: string): number[] => state?.markers[name] ?? [];
const history = async (page: Page) => (await call(page, 'history')).undo;

test('E2E-QR-01: guess, the axis rule, the pick rule, ghosts, live preview, Clear and Guess, Esc', async ({ page }) => {
  await cubeLadInRig(page);
  const undo = await history(page);
  const guessed = await startQuickRig(page);
  // R-Markers: front │ side │ persp.
  expect((await call(page, 'panes')).map((pane) => pane.id).sort()).toEqual(
    [RIG_FRONT_PANE, RIG_SIDE_PANE, RIG_PERSP_PANE].sort(),
  );
  // Nine markers within 0.05 H of the truth (the box neck's chin included); six ghosts of the side markers.
  const off = MARKERS.map((name) => [name, dist(marker(guessed, name), truth.markers[name] ?? [])] as const).filter(
    ([, d]) => d / H > 0.05,
  );
  expect(off).toEqual([]);
  for (const name of ['headTop', 'chin', 'pelvis']) expect(marker(guessed, name)[0]).toBe(0);
  for (const name of ['shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe']) {
    await markerAt(page, name, 'L', RIG_FRONT_PANE);
  }
  expect(await call(page, 'screenOfMarker', 'chin', 'L', RIG_FRONT_PANE)).toBeNull();
  expect(guessed.moved).toEqual([]);
  expect(await history(page)).toEqual(undo);
  // §0.2 step 3: the persp pane shows the markers but does not drag them: its hover hint says where to drag (the help
  // line, acceptance fix); the front pane keeps the axis hint. The empty-state card is gone while Quick Rig runs.
  await expect(page.getByTestId('rig-empty')).toBeHidden();
  const chinPersp = await markerAt(page, 'chin', 'R', RIG_PERSP_PANE);
  await page.mouse.move(chinPersp.x, chinPersp.y);
  await expect(page.getByTestId('helpline-text')).toContainText('Drag markers in the front or side view', {
    ignoreCase: true,
  });
  const chinFront = await markerAt(page, 'chin', 'R', RIG_FRONT_PANE);
  await page.mouse.move(chinFront.x, chinFront.y);
  await expect(page.getByTestId('helpline-text')).toContainText('front (X/Y) or side (Z/Y)');
  const front = await frontMarkerPoints(page, MARKERS);

  // Front drag of the right elbow 12 px down: x/y change, z bit-equal; the preview follows every pointer frame.
  const elbow = await markerAt(page, 'elbow', 'R', RIG_FRONT_PANE);
  const before = (await quickRig(page)) as QuickRigView;
  await page.mouse.move(elbow.x, elbow.y);
  await page.mouse.down();
  const frames: number[][] = [];
  for (let step = 1; step <= 4; step++) {
    await page.mouse.move(elbow.x, elbow.y + step * 3);
    frames.push(previewOf((await quickRig(page)) as QuickRigView, 'rightLowerArm') ?? []);
  }
  await page.mouse.up();
  for (let i = 1; i < frames.length; i++) expect(frames[i]?.[1]).toBeLessThan(frames[i - 1]?.[1] ?? 0);
  const afterFront = (await quickRig(page)) as QuickRigView;
  expect(marker(afterFront, 'elbow')[2]).toBe(marker(before, 'elbow')[2]);
  expect(marker(afterFront, 'elbow')[1]).toBeLessThan(marker(before, 'elbow')[1] ?? 0);
  expect(afterFront.moved).toEqual(['elbow']);
  // The left ghost mirrors it; the preview's left elbow too.
  expect(previewOf(afterFront, 'leftLowerArm')?.[1]).toBeCloseTo(previewOf(afterFront, 'rightLowerArm')?.[1] ?? 0, 9);

  // Side drag of the right knee forward: z and y change, x bit-equal.
  const zRight = await sideZSign(page);
  const knee = await markerAt(page, 'knee', 'R', RIG_SIDE_PANE);
  await drag(page, knee, { dx: 8 * zRight, dy: 0 });
  const afterKnee = (await quickRig(page)) as QuickRigView;
  expect(marker(afterKnee, 'knee')[0]).toBe(marker(before, 'knee')[0]);
  expect(marker(afterKnee, 'knee')[2]).toBeGreaterThan(marker(before, 'knee')[2] ?? 0);

  // Centre markers keep x = 0 in a front drag.
  const chin = await markerAt(page, 'chin', 'R', RIG_FRONT_PANE);
  await drag(page, chin, { dx: 15, dy: -2 });
  expect(marker(await quickRig(page), 'chin')[0]).toBe(0);

  // Select Elbow in the panel list, drag it back in the side pane where shoulder, elbow and wrist overlap: only the
  // elbow's z (and y) change; its bend now exceeds the 2° minimum, so the preview's rightLowerArm equals the marker.
  await page.getByTestId('quickrig-marker-elbow').click();
  expect((await quickRig(page))?.selected).toBe('elbow');
  const stacked = await quickRig(page);
  const spot = await markerAt(page, 'elbow', 'R', RIG_SIDE_PANE);
  await drag(page, spot, { dx: -12 * zRight, dy: 0 });
  const afterSide = (await quickRig(page)) as QuickRigView;
  expect(marker(afterSide, 'elbow')[0]).toBe(marker(stacked, 'elbow')[0]);
  expect(marker(afterSide, 'elbow')[2]).toBeLessThan(marker(stacked, 'elbow')[2] ?? 0);
  expect(marker(afterSide, 'shoulder')).toEqual(marker(stacked, 'shoulder'));
  expect(marker(afterSide, 'wrist')).toEqual(marker(stacked, 'wrist'));
  expect(previewOf(afterSide, 'rightLowerArm')).toEqual(marker(afterSide, 'elbow'));
  const mirrored = previewOf(afterSide, 'leftLowerArm') ?? [];
  expect([-(mirrored[0] ?? 0), mirrored[1], mirrored[2]]).toEqual(marker(afterSide, 'elbow'));

  // Two clicks on the shoulder/wrist spot cycle the selection there.
  const pair = await markerAt(page, 'wrist', 'R', RIG_SIDE_PANE);
  await page.mouse.click(pair.x, pair.y);
  const first = (await quickRig(page))?.selected;
  await page.mouse.click(pair.x, pair.y);
  const second = (await quickRig(page))?.selected;
  expect(['shoulder', 'wrist']).toContain(first);
  expect(['shoulder', 'wrist']).toContain(second);
  expect(second).not.toBe(first);

  // Clear empties; clicks in the front pane place the markers in list order (x/y at the click); Guess restores.
  await page.getByTestId('quickrig-clear').click();
  await expect.poll(async () => Object.keys((await quickRig(page))?.markers ?? {}).length).toBe(0);
  for (const [i, name] of MARKERS.entries()) {
    await expect(page.getByTestId('quickrig-next')).toHaveAttribute('data-marker', name);
    const at = front[i] as { x: number; y: number };
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => Object.keys((await quickRig(page))?.markers ?? {})).toContain(name);
    const placed = marker(await quickRig(page), name);
    expect(
      Math.hypot(
        (placed[0] ?? 0) - (marker(guessed, name)[0] ?? 0),
        (placed[1] ?? 0) - (marker(guessed, name)[1] ?? 0),
      ),
    ).toBeLessThan(0.02 * H);
  }
  expect(Object.keys((await quickRig(page))?.markers ?? {})).toEqual([...MARKERS]);
  await page.getByTestId('quickrig-guess').click();
  await expect.poll(async () => (await quickRig(page))?.markers).toEqual(guessed.markers);

  // Esc closes Quick Rig: nothing in the history.
  await page.mouse.move(front[0]?.x ?? 0, front[0]?.y ?? 0);
  await page.keyboard.press('Escape');
  await expect.poll(() => quickRig(page)).toBeNull();
  expect(await history(page)).toEqual(undo);
});

test('E2E-QR-01: an off-centre Cube Lad — the centre notice, Center and ground in one step, then the guess', async ({
  page,
}) => {
  const mesh = await cubeLadInRig(page);
  await runOk(page, 'workspace.set', { workspace: 'model' });
  await runOk(page, 'scene.object.transform', {
    ids: [mesh],
    placements: [{ t: [0.1, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }],
  });
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await enterRig(page);
  await page.getByTestId('rtk-step-1-btn').click();
  await expect(page.getByTestId('quickrig-notice')).toContainText('off the centre line');
  await expect(page.getByTestId('quickrig-commit')).toBeDisabled();
  expect(Object.keys((await quickRig(page))?.markers ?? {})).toEqual([]);
  const steps = (await call(page, 'history')).undo.length;
  await page.getByTestId('quickrig-fix-center').click();
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Center and Ground');
  expect((await call(page, 'history')).undo.length).toBe(steps + 1);
  await expect(page.getByTestId('quickrig-notice')).toBeHidden();
  await expect.poll(async () => Object.keys((await quickRig(page))?.markers ?? {}).length).toBe(MARKERS.length);
  await expect(page.getByTestId('quickrig-commit')).toBeEnabled();
});
