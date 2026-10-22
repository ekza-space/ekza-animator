// E2E-AR-05 (AUTORIG-SPEC §10 D4, §5.4; AS-AR-1 steps 5–6): ③ Rig on the T-posed Polybot through the UI. *Auto-rig ▸*
// (fingers Thumb + 1) shows the sheet with Skeleton, Skinning and Checking — no Straightening — and makes exactly two
// undo steps, "Create Skeleton" and "Bind Skin": a model character with 34 joints (Standard 33 + root), every humanoid
// joint within 0.05 H of the T-pose truth, every point weighted with ≤ 4 influences summing to 1 (1e-6), none on
// root, the mesh points bit-equal to the import, no `skel.*` / `skin.*` error or warning; ③ review plays `PREVIEW Walk`
// at once, and the preview changes neither the store version nor the history nor the keys hash. The motion test's
// Sword and Dance move a hand point over 0.5 s each.
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
import { call } from './helpers/test-api';

test('AS-AR-1 steps 5–6: Auto-rig makes two steps, a clean Standard 33 rig, and the motion test plays', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const model = await sampleAtModel(page, 'polybot-tpose');
  const scene = model.subject.meshes[0] ?? '';
  const imported = await call(page, 'meshPositions', scene, undefined, 'local');
  await toMarkers(page);
  // step 5: Fingers Thumb + 1, Auto-rig
  await page.getByTestId('ar-markers-fingers').locator('[data-preset="standard33"]').click();
  const before = (await history(page)).undo;
  await recordStages(page);
  await autoRig(page);
  const seen = await readStages(page);
  expect(seen.stages).toEqual(expect.arrayContaining(['skeleton', 'skin', 'check']));
  expect(seen.stages).not.toContain('straighten');
  for (const list of seen.rows) expect(list).toEqual(['skeleton', 'skin', 'check']);
  expect(seen.rows.length).toBeGreaterThan(0);
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin']);

  const { character, mesh } = await subjectCharacter(page);
  const record = (await call(page, 'characters')).find((row) => row.id === character);
  expect(record?.source).toBe('model');
  const skeleton = await call(page, 'skeleton', character);
  expect(skeleton?.preset).toBe('standard33');
  expect(skeleton?.joints).toHaveLength(34);
  const truth = polybotMarkers('tpose');
  const off = (skeleton?.joints ?? [])
    .filter((joint) => joint.humanBone !== null && truth.humanoid[joint.humanBone] !== undefined)
    .map((joint) => [
      joint.humanBone,
      dist(joint.restPosition, truth.humanoid[joint.humanBone ?? ''] ?? []) / truth.height,
    ])
    .filter(([, error]) => (error as number) > 0.05);
  expect(off).toEqual([]);
  await expectCleanWeights(page, character, mesh);
  expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(imported);
  const problems = (await rows(page)).filter(
    (row) => /^(skel|skin)\./.test(row.code) && (row.severity === 'error' || row.severity === 'warning'),
  );
  expect(problems).toEqual([]);
  await expect(page.getByTestId('ar-rig-all-good')).toBeVisible();
  expect((await wizard(page)).done.rig).toBe(true);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();

  // ③ review: PREVIEW Walk right after Checking (the recorder's clock; §5.4 asks ≤ 300 ms on the reference machine)
  await expect(page.getByTestId('hud-badge-preview-pane-persp')).toHaveText('PREVIEW walk', { ignoreCase: true });
  const timing = await page.evaluate(() => window.__AR_STAGES__);
  expect(timing?.endedAt).not.toBeNull();
  expect(timing?.previewAt).not.toBeNull();
  expect((timing?.previewAt ?? 0) - (timing?.endedAt ?? 0)).toBeLessThanOrEqual(300);
  await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('walk');
  expect((await call(page, 'rigState')).mode).toBe('object');
  // the preview is no document change
  const version = (await call(page, 'state')).storeVersion;
  const steps = await history(page);
  const keys = await call(page, 'keysHash');
  await page.waitForTimeout(600);
  expect((await call(page, 'state')).storeVersion).toBe(version);
  expect(await history(page)).toEqual(steps);
  expect(await call(page, 'keysHash')).toBe(keys);

  // step 6: Sword, then Dance — a hand point moves over 0.5 s each
  const positions = await call(page, 'meshPositions', mesh, undefined, 'local');
  let hand = 0;
  positions.forEach((p, i) => {
    if ((p[0] ?? 0) < (positions[hand]?.[0] ?? 0)) hand = i;
  });
  for (const clip of ['sword-attack', 'dance']) {
    await page.locator(`[data-testid="ar-rig-motion"] [data-clip="${clip}"]`).click();
    await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe(clip);
    const a = (await call(page, 'posedPositions', mesh, [hand]))[0] ?? [];
    await page.waitForTimeout(500);
    const b = (await call(page, 'posedPositions', mesh, [hand]))[0] ?? [];
    expect(dist(a, b)).toBeGreaterThan(1e-3);
  }
  // the motion test off: the preview stops; on again: it plays
  await page.getByTestId('ar-rig-motion-toggle').click();
  await expect.poll(async () => (await call(page, 'library'))?.preview ?? null).toBeNull();
  await page.getByTestId('ar-rig-motion-toggle').click();
  await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('dance');
});
