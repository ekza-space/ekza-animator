// E2E-AR-03's AS-AR-5 in full (AUTORIG-SPEC §11; D7): "Bad placement". A Z-up, ×100, off-centre Cube Lad dropped on
// ① fails Upright, Size and Centred; the three one-click fixes are three undo steps and leave the body at the origin
// (bounds centred in x and z, standing on y = 0: C2's *Center and Ground* centres z too, AR-D7-14); then *Next* opens ②
// and its guess lies within 0.05 H of the truth scaled to the fixed 1.70 m (no shift); *Auto-rig* puts the hips over
// the origin.
import { expect, type Page, test } from '@playwright/test';
import { dropModel, nextToMarkers } from './helpers/ar-as';
import { openAutoRigReady } from './helpers/ar-host';
import { badCubeLad, checkRow, report } from './helpers/ar-model';
import { cubeLadMarkers, dist, MARKERS, wizard } from './helpers/ar-markers';
import { autoRig, subjectCharacter } from './helpers/ar-rig';
import { history } from './helpers/autorig';
import { call } from './helpers/test-api';

const fix = (page: Page, name: string) => page.locator(`[data-testid="ar-model-report"] [data-fix="${name}"]`).first();

test('AS-AR-5: three fixes, three undo steps, then ② guesses within 0.05 H', async ({ page }) => {
  test.setTimeout(180_000);
  await openAutoRigReady(page);
  await dropModel(page, 'lad-zup.glb', new Uint8Array(badCubeLad()));
  for (const check of ['upright', 'size', 'centred']) {
    await expect(checkRow(page, check)).toHaveAttribute('data-ok', 'false');
  }
  expect((await history(page)).undo).toEqual(['Import Static Model']);
  await fix(page, 'standUp').click();
  await expect(checkRow(page, 'upright')).toHaveAttribute('data-ok', 'true');
  await fix(page, 'scale').click();
  await expect(checkRow(page, 'size')).toHaveAttribute('data-ok', 'true');
  await fix(page, 'center').click();
  await expect(checkRow(page, 'centred')).toHaveAttribute('data-ok', 'true');
  for (const check of ['grounded', 'facing', 'upright', 'size', 'centred']) {
    await expect(checkRow(page, check)).toHaveAttribute('data-ok', 'true');
  }
  const steps = (await history(page)).undo;
  expect(steps).toHaveLength(4);
  expect(steps[0]).toBe('Import Static Model');
  expect(steps[3]).toBe('Center and Ground');
  expect((await report(page))?.height).toBeCloseTo(1.7, 4);

  // ② through Next: the guess on the truth at 1.70 m
  const meshes = (await wizard(page)).subject.meshes;
  const points = await page.evaluate(
    (ids) => ids.flatMap((id) => window.__EKZA_STUDIO_TEST__?.meshPositions(id, undefined, 'world') ?? []),
    meshes,
  );
  const centre = (k: number): number => {
    const values = points.map((p) => p[k] ?? 0);
    return (Math.min(...values) + Math.max(...values)) / 2;
  };
  // at the origin: centred in x and z (not 73 m along +Z), standing on y = 0
  expect(Math.abs(centre(0))).toBeLessThan(1e-6);
  expect(Math.abs(centre(2))).toBeLessThan(1e-6);
  expect(Math.abs(Math.min(...points.map((p) => p[1] ?? 0)))).toBeLessThan(1e-6);
  const guessed = await nextToMarkers(page);
  const truth = cubeLadMarkers();
  const k = 1.7 / truth.height;
  const off = MARKERS.filter((name) => {
    const t = truth.markers[name] ?? [0, 0, 0];
    return dist(guessed.markers[name] ?? [], [t[0] * k, t[1] * k, t[2] * k]) / 1.7 > 0.05;
  });
  expect(off).toEqual([]);
  expect((await history(page)).undo).toEqual(steps);

  // ③: the rigged hips stand over the origin (the exported VRM's hips are not tens of metres away)
  await autoRig(page);
  const { character } = await subjectCharacter(page);
  const hips = (await call(page, 'skeleton', character))?.joints.find((joint) => joint.humanBone === 'hips');
  expect(Math.abs(hips?.restPosition[0] ?? Number.NaN)).toBeLessThan(0.01 * 1.7);
  expect(Math.abs(hips?.restPosition[2] ?? Number.NaN)).toBeLessThan(0.05 * 1.7);
});
