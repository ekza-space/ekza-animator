// E2E-AR-13 (AUTORIG-SPEC §11 AS-AR-2; D7): "A-posed GLB to a T-pose OMOBA VRM", in full through the UI. 1 the
// A-posed Polybot dropped on ①: static, the Pose row "A-pose (arms N° down)" with N within 5° of the truth, centred,
// grounded, facing; 2 *Next*: the markers within 0.05 H of the A-pose truth, A0's notice (N > 15°), *Auto-rig* enabled;
// 3 *Auto-rig*: Skeleton, Skinning, Straightening to a T-pose, Checking — exactly three steps, no `skel.tpose`, every
// humanoid joint within 0.05 H of the T-pose truth, identity rest rotations, clean weights; 4 `Mod+Z` returns the
// A-posed rest (points and row) with the weights bit-equal, `Mod+Shift+Z` the T-pose; 5 the motion test's Walk swings
// the hands below the shoulders, Walk added in one step; 6 ⑤ VRM (Tester, CC0): every row ✓ incl. "T-pose rest",
// the validators and `vrm.*` lints clean, the written rest along ±X / −Y within 5°, the SHA-256 equal to Studio's
// `file.exportCharacter`; 7 the file kept in `test-results/autorig/` for OMOBA's validator (local, D7's record);
// 8 undo to before "Straighten to T-Pose": the VRM checklist shows "T-pose rest" ✗ with *Straighten to T-Pose*,
// Download disabled, the GLB target allowed; the Fix is one step and turns the row ✓.
import { expect, test } from '@playwright/test';
import {
  characterRequest,
  checkOf,
  chooseTarget,
  download,
  keepExport,
  setAuthorAndLicence,
  studioExport,
} from './helpers/ar-export';
import {
  addClip,
  dropModel,
  exportMeta,
  jointsOff,
  markersOff,
  nextToMarkers,
  onStep,
  primary,
  restDirections,
  startFromLanding,
  truthArmAngle,
} from './helpers/ar-as';
import { checkRow, fixtureBytes } from './helpers/ar-model';
import { dist, polybotMarkers, wizard } from './helpers/ar-markers';
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
import { validatorErrors } from './helpers/m6b-mvp-script';
import { call, runOk } from './helpers/test-api';

test('AS-AR-2: an A-posed GLB becomes a T-pose OMOBA VRM, byte-equal to Studio, and undo shows why', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const codes = async (): Promise<string[]> => (await rows(page)).map((row) => row.code);

  // 1 — drop the A-posed Polybot: static, the Pose row names the arm angle (within 5° of the truth)
  await startFromLanding(page);
  await dropModel(page, 'polybot-unskinned.glb', new Uint8Array(fixtureBytes('polybot-unskinned.glb')));
  const model = await wizard(page);
  const aTruth = polybotMarkers('apose');
  const truthAngle = truthArmAngle(aTruth.humanoid);
  expect(model.intake).toMatchObject({ kind: 'static', pose: { kind: 'a' } });
  const armAngle = ((model.intake as { pose: { armAngle: number } }).pose.armAngle * 180) / Math.PI;
  expect(Math.abs(armAngle - truthAngle)).toBeLessThanOrEqual(5);
  const poseText = (await checkRow(page, 'pose').textContent()) ?? '';
  const shown = Number(/A-pose \(arms (\d+)° down\)/.exec(poseText)?.[1] ?? Number.NaN);
  expect(Math.abs(shown - truthAngle)).toBeLessThanOrEqual(5);
  for (const check of ['centred', 'grounded', 'facing']) {
    await expect(checkRow(page, check)).toHaveAttribute('data-ok', 'true');
  }
  const scene = model.subject.meshes[0] ?? '';
  const imported = await call(page, 'meshPositions', scene, undefined, 'local');

  // 2 — Next: the guess on the A-pose truth, A0's notice above 15°, Auto-rig enabled
  const guessed = await nextToMarkers(page);
  expect(markersOff(guessed, aTruth)).toEqual([]);
  if (shown > 15) {
    await expect(page.getByTestId('ar-markers-notice-apose')).toHaveText('Auto-rig straightens it for you.');
    await expect(page.getByTestId('quickrig-apose')).toHaveCount(0); // AR-D8-8: no Studio jargon on ②
  }
  expect((await wizard(page)).startPose).toMatchObject({ kind: 'a' });
  await expect(page.getByTestId('ar-primary')).toBeEnabled();

  // 3 — Auto-rig (Standard 33): four stages, three steps, the T-pose rest
  await expect(page.getByTestId('ar-markers-fingers').locator('[data-preset="standard33"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const before = (await history(page)).undo;
  await recordStages(page);
  await autoRig(page);
  const seen = await readStages(page);
  expect(seen.stages).toEqual(expect.arrayContaining(['skeleton', 'skin', 'straighten', 'check']));
  for (const list of seen.rows) expect(list).toEqual(['skeleton', 'skin', 'straighten', 'check']);
  expect(await stepsSince(page, before)).toEqual(['Create Skeleton', 'Bind Skin', 'Straighten to T-Pose']);
  const { character, mesh } = await subjectCharacter(page);
  expect(await codes()).not.toContain('skel.tpose');
  const tTruth = polybotMarkers('tpose');
  const straightenedSkeleton = await call(page, 'skeleton', character);
  expect(jointsOff(straightenedSkeleton?.joints ?? [], tTruth)).toEqual([]);
  expect(
    (straightenedSkeleton?.joints ?? []).filter((j) => j.restRotation.join() !== '0,0,0,1').map((j) => j.key),
  ).toEqual([]);
  await expectCleanWeights(page, character, mesh);

  // 4 — Mod+Z: the A-posed rest, the import's points, the row; Mod+Shift+Z: the T-pose, the weights bit-equal
  const straightened = await call(page, 'meshPositions', mesh, undefined, 'local');
  const weights = await call(page, 'weights', mesh);
  const mod = await modKey(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(`${mod}+KeyZ`);
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Bind Skin');
  expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(imported);
  await expect.poll(codes).toContain('skel.tpose');
  expect(await call(page, 'weights', mesh)).toEqual(weights);
  await page.keyboard.press(`${mod}+Shift+KeyZ`);
  await expect.poll(async () => (await history(page)).undo.at(-1)).toBe('Straighten to T-Pose');
  expect(await call(page, 'meshPositions', mesh, undefined, 'local')).toEqual(straightened);
  expect(await call(page, 'weights', mesh)).toEqual(weights);
  await expect.poll(codes).not.toContain('skel.tpose');

  // 5 — the motion test's Walk: the hands swing below the shoulders (≥ 0.3 × the arm's length); Animations ▸ Walk
  await expect.poll(async () => (await call(page, 'library'))?.preview?.clip).toBe('walk');
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
    const posed = (await call(page, 'posedPositions', mesh, [outermost(sign)]))[0] ?? [];
    expect(shoulder - (posed[1] ?? 0)).toBeGreaterThanOrEqual(0.3 * length);
  }
  await primary(page, /Animations/);
  await onStep(page, 'animations');
  await expect(page.getByTestId('ar-anim-grid')).toBeVisible();
  await addClip(page, { id: 'walk', name: 'Walk', search: 'walk' });

  // 6 — Export ▸ VRM (Tester, CC0), Download: every row ✓, validators clean, the written rest is a T-pose
  await primary(page, /Export/);
  await onStep(page, 'export');
  await exportMeta(page);
  for (const id of ['humanoid', 'required-bones', 'parents', 'tpose', 'skinned', 'transforms', 'meta', 'licence']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
  }
  await expect(checkOf(page, 'tpose')).toContainText('T-pose rest');
  const file = await download(page);
  expect(file.name).toBe('polybot.vrm');
  for (const id of ['size', 'nodes', 'bones', 'extensions', 'read-back']) {
    await expect(checkOf(page, id)).toHaveAttribute('data-state', 'ok');
  }
  expect(await validatorErrors(file.bytes)).toEqual({ gltf: [], vrm: [] });
  const directions = restDirections(file.bytes);
  for (const [segment, degrees] of Object.entries(directions)) {
    expect(degrees, `${segment} rest direction`).toBeLessThanOrEqual(5);
  }
  // FR-AR-12: Studio's `file.exportCharacter` (the operator every shell has) with the same request, same document
  const [studio] = await studioExport(page, 'file.exportCharacter', characterRequest(character, 'ekza-vrm', 'polybot'));
  expect(studio?.errors).toEqual([]);
  expect(studio?.sha256).toBe(file.sha);
  // 7 — kept for OMOBA's validator (D7's local run)
  keepExport('as-ar-2-polybot-apose.vrm', file.bytes);

  // 8 — undo to before "Straighten to T-Pose": ⑤ shows the row ✗ with its Fix; Download off; GLB allowed
  const done = (await history(page)).undo;
  const straightenAt = done.lastIndexOf('Straighten to T-Pose');
  for (let i = done.length; i > straightenAt; i--) await runOk(page, 'edit.undo');
  expect((await history(page)).undo.at(-1)).toBe('Bind Skin');
  await expect.poll(async () => (await wizard(page)).step).toBe('export');
  await chooseTarget(page, 'ekza-vrm');
  await expect(checkOf(page, 'tpose')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('ar-export-fix-tpose')).toHaveText('Straighten to T-Pose');
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  await chooseTarget(page, 'glb');
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  await chooseTarget(page, 'ekza-vrm');
  const fixFrom = (await history(page)).undo.length;
  await page.getByTestId('ar-export-fix-tpose').click();
  await expect.poll(async () => (await history(page)).undo.at(-1), { timeout: 30_000 }).toBe('Straighten to T-Pose');
  expect((await history(page)).undo.length).toBe(fixFrom + 1);
  await expect(checkOf(page, 'tpose')).toHaveAttribute('data-state', 'ok');
  // the meta was undone with the rest of the export's steps: with it back, Download is enabled again
  await setAuthorAndLicence(page, 'Tester', 'cc0');
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
});
