import { expect, type Page, test } from '@playwright/test';
import { drag } from './helpers/g1-viewport';
import { keysHash, RIG_FRONT_PANE } from './helpers/m6b-rig';
import { cubeLadInRig, jointAt, jointsByKey, quickRig } from './helpers/m6b-skeleton-ui';
import { call, runOk } from './helpers/test-api';

// E2E-JNT-01 (M6B-SPEC §0.7 "Fit joints"; owner C3, gates c1 — the character — and c4 — the bind): the Cube Lad
// character from Create Skeleton (`run`), already in Skeleton mode (no key press); `D` + `W` a knee in the front pane
// → the partner follows, the feet bit-equal; `W` an upper arm → its subtree moves; `E` rotates the rest before
// binding; Orient Joints (Auto → World on humanoid joints) changes nothing; Mirror Joints L → R updates in place (ids
// unchanged); every rest edit one step; the keys hash unchanged. After `skin.bind`, `W` keeps the mesh (Move Skinned
// Joints) and `E` is a test pose.

const GATES = 'c1, c4';

async function steps(page: Page): Promise<string[]> {
  return (await call(page, 'history')).undo;
}

async function rest(page: Page, character: string, key: string): Promise<number[]> {
  return (await jointsByKey(page, character)).get(key)?.restPosition ?? [];
}

test.fixme(`E2E-JNT-01: fit joints with the §5.7 gestures; bound: Move Skinned Joints and E test poses (gates: ${GATES})`, async ({
  page,
}) => {
  const mesh = await cubeLadInRig(page);
  await runOk(page, 'skel.quickRig.start', { meshes: [mesh] });
  await expect.poll(async () => (await quickRig(page))?.preview?.length ?? 0).toBeGreaterThan(0);
  const state = await quickRig(page);
  const { character } = await runOk<{ character: string }>(page, 'skel.quickRig.commit', {
    preset: state?.preset,
    markers: state?.markers,
    meshes: [mesh],
    flexion: (2 * Math.PI) / 180,
  });
  // Create Skeleton left the workspace in Skeleton mode: no `1` (it would toggle back to Object).
  expect((await call(page, 'rigState')).mode).toBe('skeleton');
  const hash = await keysHash(page);
  const joints = await jointsByKey(page, character);
  const id = (key: string): string => joints.get(key)?.id ?? key;

  // D + W the right knee (front pane): the left knee follows, the feet stay bit-equal; one step.
  const feet = [await rest(page, character, 'rightFoot'), await rest(page, character, 'leftFoot')];
  const kneeL = await rest(page, character, 'leftLowerLeg');
  const before = (await steps(page)).length;
  await page.keyboard.press('KeyW');
  const knee = await jointAt(page, id('rightLowerLeg'), RIG_FRONT_PANE);
  await page.keyboard.down('KeyD');
  await drag(page, knee, { dx: -6, dy: 0 });
  await page.keyboard.up('KeyD');
  await expect.poll(async () => (await steps(page)).at(-1)).toBe('Move Joint');
  expect((await steps(page)).length).toBe(before + 1);
  expect(await rest(page, character, 'leftLowerLeg')).not.toEqual(kneeL);
  expect([await rest(page, character, 'rightFoot'), await rest(page, character, 'leftFoot')]).toEqual(feet);

  // W the right upper arm: the subtree (lower arm, hand) moves with it.
  const hand = await rest(page, character, 'rightHand');
  const arm = await jointAt(page, id('rightUpperArm'), RIG_FRONT_PANE);
  await drag(page, arm, { dx: 0, dy: -5 });
  await expect.poll(async () => (await steps(page)).at(-1)).toBe('Move Joints');
  expect((await rest(page, character, 'rightHand'))[1]).toBeGreaterThan(hand[1] ?? 0);

  // E before binding: the rests rotate (the subtree about the joint).
  await page.keyboard.press('KeyE');
  const elbow = await jointAt(page, id('rightLowerArm'), RIG_FRONT_PANE);
  const wrist = await rest(page, character, 'rightHand');
  await drag(page, elbow, { dx: 3, dy: 18 });
  await expect.poll(async () => (await steps(page)).at(-1)).toBe('Rotate Joints');
  expect(await rest(page, character, 'rightHand')).not.toEqual(wrist);

  // Orient Joints (Auto → World on humanoid joints): no change.
  const rotations = [...(await jointsByKey(page, character)).values()].map((joint) => joint.restRotation);
  await runOk(page, 'select.joints', { ids: [id('hips')], mode: 'replace' });
  await page.getByTestId('rtk-btn-skel.joint.orient').click();
  await expect
    .poll(async () => [...(await jointsByKey(page, character)).values()].map((joint) => joint.restRotation))
    .toEqual(rotations);

  // Mirror Joints L → R updates in place: the same ids.
  const ids = [...(await jointsByKey(page, character)).values()].map((joint) => joint.id).sort();
  await runOk(page, 'skel.joint.mirror', { root: id('leftUpperArm'), direction: 'left-to-right' });
  expect([...(await jointsByKey(page, character)).values()].map((joint) => joint.id).sort()).toEqual(ids);
  expect(await keysHash(page)).toBe(hash);

  // Bound: W moves the joint, never the mesh (Move Skinned Joints); E is a test pose.
  await runOk(page, 'skin.bind', {});
  const body = (await call(page, 'meshes')).find((row) => row.owner === character)?.id ?? '';
  const points = await call(page, 'posedPositions', body, [0, 1, 2, 3]);
  await page.keyboard.press('KeyW');
  const head = await jointAt(page, id('head'), RIG_FRONT_PANE);
  await drag(page, head, { dx: 0, dy: -4 });
  await expect.poll(async () => (await steps(page)).at(-1)).toBe('Move Joints');
  expect(await call(page, 'posedPositions', body, [0, 1, 2, 3])).toEqual(points);
  await page.keyboard.press('KeyE');
  const forearm = await jointAt(page, id('leftLowerArm'), RIG_FRONT_PANE);
  await drag(page, forearm, { dx: -2, dy: 20 });
  await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
  expect((await call(page, 'rigState')).testPose.controls).toBeGreaterThan(0);
  expect(await keysHash(page)).toBe(hash);
});
