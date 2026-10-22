// E2E-AR-05 (AUTORIG-SPEC §10 D4, §5.4, §6.1; AS-AR-2 steps 2–4 and the motion test of step 5): the A-posed Polybot
// through the UI. *Auto-rig ▸* (Standard 33) shows Skeleton, Skinning, **Straightening to a T-pose**, Checking and
// makes exactly three undo steps — "Create Skeleton", "Bind Skin", "Straighten to T-Pose": no `skel.tpose` row, every
// humanoid joint within 0.05 H of the **T-pose** truth, every template joint's rest rotation identity, ≤ 4 influences
// summing to 1. `Mod+Z` once returns the A-posed rest — the points bit-equal to the import (= after Bind Skin, which
// writes no position), the joints bit-equal to the state after Bind Skin (the committed rest positions are the last
// Quick Rig preview, C2's rule; Bind Skin writes no joint; the whole skeleton the same after another redo / undo) and
// the `skel.tpose` row back; `Mod+Shift+Z` restores the T-pose with the weights bit-equal (the straighten never
// touches weights). The motion test's Walk swings the hands below the shoulders: each hand lower than
// its upper arm by ≥ 0.3 × the arm's length.
import { expect, test } from '@playwright/test';
import { dist, polybotMarkers, sampleAtModel, toMarkers, wizard } from './helpers/ar-markers';
import {
  autoRig,
  expectCleanWeights,
  readStages,
  recordStages,
  rows,
  stepsSince,
  subjectCharacter,
} from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { modKey } from './helpers/m6a-model';
import { call } from './helpers/test-api';

test('AS-AR-2 steps 2–5: three steps to a T-pose rest, undo / redo exact, the hands swing below the shoulders', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const model = await sampleAtModel(page, 'polybot-apose');
  const scene = model.subject.meshes[0] ?? '';
  const imported = await call(page, 'meshPositions', scene, undefined, 'local');
  const preview = (await toMarkers(page)).preview ?? [];
  expect(preview.length).toBeGreaterThan(0);
  expect((await wizard(page)).startPose).toMatchObject({ kind: 'a' });
  const before = (await history(page)).undo;
  await recordStages(page);
  await autoRig(page);
  const seen = await readStages(page);
  expect(seen.stages).toEqual(expect.arrayContaining(['skeleton', 'skin', 'straighten', 'check']));
  for (const list of seen.rows) expect(list).toEqual(['skeleton', 'skin', 'straighten', 'check']);
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin', 'Straighten to T-Pose']);

  const { character, mesh } = await subjectCharacter(page);
  const codes = async () => (await rows(page)).map((row) => row.code);
  expect(await codes()).not.toContain('skel.tpose');
  const truth = polybotMarkers('tpose');
  const skeleton = await call(page, 'skeleton', character);
  const off = (skeleton?.joints ?? [])
    .filter((joint) => joint.humanBone !== null && truth.humanoid[joint.humanBone] !== undefined)
    .map((joint) => [
      joint.humanBone,
      dist(joint.restPosition, truth.humanoid[joint.humanBone ?? ''] ?? []) / truth.height,
    ])
    .filter(([, error]) => (error as number) > 0.05);
  expect(off).toEqual([]);
  expect(
    (skeleton?.joints ?? []).filter((joint) => joint.restRotation.join() !== '0,0,0,1').map((joint) => joint.key),
  ).toEqual([]);
  await expectCleanWeights(page, character, mesh);
  await expect(page.getByTestId('ar-rig-all-good')).toBeVisible();

  // step 4: Mod+Z once — the A-posed rest, the import's points, the skel.tpose row
  const straightened = await call(page, 'meshPositions', mesh, undefined, 'local');
  const weights = await call(page, 'weights', mesh);
  const mod = await modKey(page);
  await page.keyboard.press(`${mod}+KeyZ`);
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Bind Skin');
  expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(imported);
  await expect.poll(codes).toContain('skel.tpose');
  const aPosed = await call(page, 'skeleton', character);
  // the joints after Bind Skin, bit for bit: the committed rest positions are the last preview (C2's rule)
  const undone = new Map((aPosed?.joints ?? []).map((joint) => [joint.key, joint.restPosition]));
  for (const joint of preview) expect([joint.key, undone.get(joint.key)]).toEqual([joint.key, joint.position]);
  const hand = aPosed?.joints.find((joint) => joint.humanBone === 'leftHand')?.restPosition ?? [];
  const upper = aPosed?.joints.find((joint) => joint.humanBone === 'leftUpperArm')?.restPosition ?? [];
  expect((upper[1] ?? 0) - (hand[1] ?? 0)).toBeGreaterThan(0.1);
  expect(await call(page, 'weights', mesh)).toEqual(weights);
  // ③ blocks Animations on the row (the A-posed input's Fix is Straighten to T-Pose)
  await expect(page.getByTestId('ar-rig-row-fix-skel.tpose')).toHaveText('Straighten to T-Pose');
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  // Mod+Shift+Z: the T-pose back, the weights bit-equal
  await page.keyboard.press(`${mod}+Shift+KeyZ`);
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Straighten to T-Pose');
  expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(straightened);
  expect(await call(page, 'weights', mesh)).toEqual(weights);
  await expect.poll(codes).not.toContain('skel.tpose');
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  // undo again: the whole skeleton (positions, rotations, tails) is the A-posed one read above, bit for bit
  await page.keyboard.press(`${mod}+KeyZ`);
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Bind Skin');
  expect(await call(page, 'skeleton', character)).toEqual(aPosed);
  await page.keyboard.press(`${mod}+Shift+KeyZ`);
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Straighten to T-Pose');
  await expect.poll(codes).not.toContain('skel.tpose');

  // step 5 (motion test): Walk swings the hands below the shoulders
  await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('walk');
  // the hands: the outermost point on each side at rest (the T-pose fingertips), posed by the preview
  const rest = await call(page, 'skeleton', character);
  const at = (bone: string) => rest?.joints.find((joint) => joint.humanBone === bone)?.restPosition ?? [];
  const points = await call(page, 'meshPositions', mesh, undefined, 'local');
  const outermost = (sign: 1 | -1): number =>
    points.reduce((best, p, i) => ((p[0] ?? 0) * sign > (points[best]?.[0] ?? 0) * sign ? i : best), 0);
  for (const [side, sign] of [
    ['left', 1],
    ['right', -1],
  ] as const) {
    const length = dist(at(`${side}UpperArm`), at(`${side}Hand`));
    const shoulder = at(`${side}UpperArm`)[1] ?? 0;
    const point = outermost(sign);
    for (let sample = 0; sample < 3; sample++) {
      const posed = (await call(page, 'posedPositions', mesh, [point]))[0] ?? [];
      expect(shoulder - (posed[1] ?? 0)).toBeGreaterThanOrEqual(0.3 * length);
      await page.waitForTimeout(150);
    }
  }
});

test('A-posed input, Cancel mid-bind, Bind again: the bind and the straighten, as on the first run', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await sampleAtModel(page, 'polybot-apose');
  await toMarkers(page);
  expect((await wizard(page)).startPose).toMatchObject({ kind: 'a' });
  const before = (await history(page)).undo;
  // Cancel the moment the sheet offers it (a DOM observer in the page: the bind would otherwise finish first)
  const cancelled = page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          const button = document.querySelector<HTMLButtonElement>('[data-testid="ar-rig-cancel"]');
          if (button === null) return;
          observer.disconnect();
          button.click();
          resolve();
        });
        observer.observe(document.body, { subtree: true, childList: true });
      }),
  );
  await page.getByTestId('ar-primary').click();
  await cancelled;
  await expect.poll(async () => (await wizard(page)).busy, { timeout: 30_000 }).toBeNull();
  await expect.poll(async () => (await wizard(page)).step).toBe('rig');
  await expect(page.getByTestId('ar-rig-unbound-text')).toHaveText('Skeleton created; skinning cancelled');
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton']);

  // Bind again: Skinning, Straightening, Checking — "Bind Skin" then "Straighten to T-Pose", no skel.tpose row
  await recordStages(page);
  await page.getByTestId('ar-rig-bind-again').click();
  await expect.poll(async () => (await history(page)).undo.at(-1), { timeout: 60_000 }).toBe('Straighten to T-Pose');
  await expect.poll(async () => (await wizard(page)).busy, { timeout: 30_000 }).toBeNull();
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin', 'Straighten to T-Pose']);
  const seen = await readStages(page);
  expect(seen.stages).toEqual(expect.arrayContaining(['skin', 'straighten']));
  for (const list of seen.rows) expect(list).toEqual(['skin', 'straighten', 'check']);
  expect((await rows(page)).map((row) => row.code)).not.toContain('skel.tpose');
  await expect(page.getByTestId('ar-rig-unbound')).toHaveCount(0);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
});
