// E2E-AR-05 (AUTORIG-SPEC §10 D4, §5.4, §6.1; AS-AR-1's negative case): a T-posed Cube Lad whose right Elbow marker
// is nudged with the keyboard so the upper arm runs 8° below the arm line in FRONT. `startPose` stays 't', so *Auto-rig*
// does **not** straighten: exactly two undo steps, the mesh points bit-equal to the import, and ③ shows the
// `skel.tpose` row with *Adjust joints* first and *Straighten to T-Pose* as the secondary Fix, *Animations ▸* blocked.
// *Adjust joints* (front │ side │ persp, Skeleton mode): `D` + `W` drags the elbow joint back onto the line (one
// "Move Joint" step, its partner follows); *Done* rebinds without a question (no weight edit since the bind). The row
// then names only the hands (their tails stay on the old forearm line: AR-D4-9).
import { expect, test } from '@playwright/test';
import { FRONT, hoverPane, sampleAtMarkers, selectMarker, wizard } from './helpers/ar-markers';
import { autoRig, markerOf, nudge, quickRig, rows, stepsSince, subjectCharacter } from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { drag } from './helpers/g1-viewport';
import { jointAt, toolKey } from './helpers/m6b-skeleton-ui';
import { call } from './helpers/test-api';

const DEG = Math.PI / 180;

test('AS-AR-1 negative: the elbow 8° off the line rigs in two steps with the skel.tpose row; Adjust joints moves it back', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const state = await sampleAtMarkers(page, 'cube-lad');
  const scene = (await wizard(page)).subject.meshes[0] ?? '';
  const imported = await call(page, 'meshPositions', scene, undefined, 'local');
  // ② the right Elbow 3.9 cm down in FRONT (3 × 1 cm, 9 × 1 mm): the upper arm 8° below ±X
  await selectMarker(page, 'elbow');
  await hoverPane(page, FRONT);
  await nudge(page, 'ArrowDown', 3);
  await nudge(page, 'Shift+ArrowDown', 9);
  const nudged = await quickRig(page);
  const shoulder = markerOf(nudged, 'shoulder');
  const elbow = markerOf(nudged, 'elbow');
  expect(elbow[2]).toBe(markerOf(state, 'elbow')[2]);
  expect(elbow[0]).toBe(markerOf(state, 'elbow')[0]);
  const angle = Math.atan2(shoulder[1]! - elbow[1]!, Math.abs(elbow[0]! - shoulder[0]!)) / DEG;
  expect(angle).toBeGreaterThan(7.5);
  expect(angle).toBeLessThan(8.5);

  const before = (await history(page)).undo;
  await autoRig(page);
  expect((await wizard(page)).startPose).toMatchObject({ kind: 't' });
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin']);
  const { character, mesh } = await subjectCharacter(page);
  expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(imported);
  expect((await rows(page)).map((row) => row.code)).toContain('skel.tpose');
  const row = page.locator('[data-testid="ar-rig-validation"] [data-row="skel.tpose"]');
  await expect(row).toContainText('An arm or shin is off its T-pose line — move the joint, or straighten the pose');
  const buttons = row.locator('button');
  await expect(buttons.nth(0)).toHaveAttribute('data-testid', 'ar-rig-row-adjust');
  await expect(buttons.nth(1)).toHaveText('Straighten to T-Pose');
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  expect((await wizard(page)).reachable.animations).toBe(false);
  await expect(page.locator('[data-step="animations"] button')).toBeDisabled();

  // Adjust joints: three panes, Skeleton mode; D + W the right elbow back onto the line
  await buttons.nth(0).click();
  await expect.poll(async () => (await wizard(page)).slices['rig']).toMatchObject({ sub: 'adjust' });
  await expect(page.getByTestId('ar-panes')).toHaveAttribute('data-panes', '3');
  await expect.poll(async () => (await call(page, 'rigState')).mode).toBe('skeleton');
  const skeleton = await call(page, 'skeleton', character);
  const id = (bone: string): string => skeleton?.joints.find((joint) => joint.humanBone === bone)?.id ?? bone;
  const restOf = async (bone: string): Promise<number[]> =>
    (await call(page, 'skeleton', character))?.joints.find((joint) => joint.humanBone === bone)?.restPosition ?? [];
  const upper = await restOf('rightUpperArm');
  const lower = await restOf('rightLowerArm');
  const hand = await restOf('rightHand');
  // metres per pixel in FRONT from two joints
  const a = await jointAt(page, id('rightUpperArm'), FRONT);
  const b = await jointAt(page, id('rightHand'), FRONT);
  const perPx = Math.abs(hand[0]! - upper[0]!) / Math.abs(b.x - a.x);
  const steps = (await history(page)).undo;
  await toolKey(page, 'KeyW', FRONT);
  const at = await jointAt(page, id('rightLowerArm'), FRONT);
  await page.keyboard.down('KeyD');
  await drag(page, at, { dx: 0, dy: -(upper[1]! - lower[1]!) / perPx });
  await page.keyboard.up('KeyD');
  await expect.poll(async () => (await history(page)).undo.length).toBe(steps.length + 1);
  expect((await history(page)).undo.at(-1)).toBe('Move Joint');
  const moved = await restOf('rightLowerArm');
  expect(Math.abs(moved[1]! - upper[1]!)).toBeLessThan(0.01);
  expect(await restOf('rightHand')).toEqual(hand);
  await expect(page.getByTestId('ar-rig-joint')).toContainText('cm');

  // Done: Bind Skin again without the question (no weight edit since the bind); the row is gone
  await page.getByTestId('ar-rig-done').click();
  await expect.poll(async () => (await history(page)).undo.at(-1), { timeout: 30_000 }).toBe('Bind Skin');
  expect((await call(page, 'state')).dialog).toBeNull();
  await expect.poll(async () => (await wizard(page)).slices['rig']).toMatchObject({ sub: 'review' });
  // The upper arm is back on the line. The row stays for the hand: Move Joint leaves the hand's tail on the old
  // forearm line (C3's rest edit does not re-aim a child's tail), so the hand → tail segment is still ~8° up — a
  // finding for D7 / C3 (AS-AR-1 step 12's "moving the elbow back clears it", docs/wp-notes/ar-rig-steps.md AR-D4-9).
  const tpose = (await rows(page)).filter((r) => r.code === 'skel.tpose');
  expect(tpose.map((r) => r.count)).toEqual([2]);
  const after = await call(page, 'skeleton', character);
  const handJoint = after?.joints.find((joint) => joint.humanBone === 'rightHand');
  const tail = handJoint?.tail ?? [];
  const tailAngle = Math.atan2(
    tail[1]! - handJoint!.restPosition[1]!,
    Math.abs(tail[0]! - handJoint!.restPosition[0]!),
  );
  expect(tailAngle / DEG).toBeGreaterThan(5);
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  expect((await call(page, 'rigState')).mode).toBe('object');
});
