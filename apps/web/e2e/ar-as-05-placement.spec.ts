// E2E-AR-03's AS-AR-5 in full (AUTORIG-SPEC §11; D7): "Bad placement". A Z-up, ×100, off-centre Cube Lad dropped on
// ① fails Upright, Size and Centred; the three one-click fixes are three undo steps; then *Next* opens ② and its
// guess lies within 0.05 H of the truth (scaled to the fixed 1.70 m; C2's *Center and Ground* leaves z, AR-D3-15, so
// the truth moves along z by the body's centre).
import { expect, type Page, test } from '@playwright/test';
import { dropModel, nextToMarkers } from './helpers/ar-as';
import { openAutoRigReady } from './helpers/ar-host';
import { badCubeLad, checkRow, report } from './helpers/ar-model';
import { cubeLadMarkers, dist, MARKERS, wizard } from './helpers/ar-markers';
import { history } from './helpers/autorig';

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
  const zs = points.map((p) => p[2] ?? 0);
  const z = (Math.min(...zs) + Math.max(...zs)) / 2;
  const guessed = await nextToMarkers(page);
  const truth = cubeLadMarkers();
  const k = 1.7 / truth.height;
  const off = MARKERS.filter((name) => {
    const t = truth.markers[name] ?? [0, 0, 0];
    return dist(guessed.markers[name] ?? [], [t[0] * k, t[1] * k, t[2] * k + z]) / 1.7 > 0.05;
  });
  expect(off).toEqual([]);
  expect((await history(page)).undo).toEqual(steps);
});
