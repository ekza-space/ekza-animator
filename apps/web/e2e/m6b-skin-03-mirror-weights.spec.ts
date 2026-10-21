import { expect, test } from '@playwright/test';
import {
  asymmetricPoints,
  boundCubeLad,
  boxPoints,
  enterSkin,
  partnersOf,
  positionsOf,
  weightMaps,
} from './helpers/m6b-skin-ui';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-SKIN-03 "Mirror Skin Weights" (M6B-SPEC §0.7, §10.1 row; the Component Editor step replaced by
// `run('skin.weights.set', …)`; C6). Bound Cube Lad; Skin mode; the left elbow ring (the left upper arm box's elbow
// end) gets leftUpperArm 0.6; the Rig Toolkit's Mirror Skin Weights (defaults: +X → −X): every right partner holds
// rightUpperArm 0.6 and the rest mirrored (`w(p(v)) = M(w(v))`); then Mirror Skin Weights with the option box's
// direction −X → +X leaves the left side bit-equal (involution). One step per run.
//
// Gates (§0.7): c2 — `test.fixme` until it merges (§3 rule 4).
const GATES = ['c2'] as const;

test.describe('E2E-SKIN-03 Mirror Skin Weights', () => {
  test.fixme(true, `gates ${GATES.join(', ')} have not merged (M6B-SPEC §3 rule 4)`);

  test('left edits reach the right partners; mirroring back is an involution; one step per run', async ({ page }) => {
    await openEditor(page);
    await expectKernelStarted(page);
    const lad = await boundCubeLad(page);
    const positions = await positionsOf(page, lad.mesh);
    const partners = partnersOf(positions);
    const ring = boxPoints(positions, 'upperArm.L').filter((v) => (positions[v]?.[0] ?? 0) > 0.47);
    expect(ring).toHaveLength(4);
    await enterSkin(page);
    await runOk(page, 'skin.weights.set', {
      mesh: lad.mesh,
      points: ring,
      joint: lad.joint('leftUpperArm'),
      value: 0.6,
    });

    await runOk(page, 'workspace.showPanel', { panel: 'rigToolkit' });
    let undo = (await call(page, 'history')).undo.length;
    await page.getByTestId('rtk-btn-skin.weights.mirror').click();
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(undo + 1);
    expect((await call(page, 'history')).undo.at(-1)).toBe('Mirror Skin Weights');
    const first = await weightMaps(page, lad.mesh);
    for (const v of ring) {
      const p = partners[v] as number;
      expect(first[p]?.get(lad.joint('rightUpperArm')) ?? 0).toBeCloseTo(0.6, 6);
    }
    const left = positions.map((_, v) => v).filter((v) => (positions[v]?.[0] ?? 0) > 1e-4);
    expect(asymmetricPoints(first, partners, lad.mirror, left)).toEqual([]);

    // The option box: direction −X → +X; the left side stays bit-equal.
    const leftRows = await call(page, 'weights', lad.mesh, left);
    await page.getByTestId('rtk-opt-skin.weights.mirror').click();
    await page.getByTestId('rtk-opt-skin.weights.mirror-direction').selectOption('negative-to-positive');
    undo = (await call(page, 'history')).undo.length;
    await page.getByTestId('rtk-btn-skin.weights.mirror').click();
    await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Mirror Skin Weights');
    expect((await call(page, 'history')).undo.length).toBeLessThanOrEqual(undo + 1);
    expect(await call(page, 'weights', lad.mesh, left)).toEqual(leftRows);
  });
});
