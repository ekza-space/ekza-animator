import { expect, test } from '@playwright/test';
import { boundCubeLad, boxPoints, enterSkin, positionsOf, screenCentroid } from './helpers/m6b-skin-ui';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-RIG-04 "Paint keys" (M6B-SPEC §0.7, §10.1 row without Paint Select mode; C6). Bound Cube Lad; `2`; `B`+drag
// changes the radius, `M`+drag the opacity, `N`+drag the value; `Shift+I`+click on a forearm point makes leftLowerArm
// the active influence; `I`+click sets Value to its weight there (1e-6); Flood (the panel's button) with value 0.5 on a
// fresh joint (one with no weight yet) puts 0.5 on every point of the hilited mesh — with the brush's X-mirror at its
// Skin-mode default (on), since Flood is one-sided (M6B-C6-17); `Alt+F` is never bound. The `U`
// operation marking menu (`rig.paint.ops`) arrives after the MVP (§0.3), so its flick is not part of this cut.
//
// Gates (§0.7): c2 — `test.fixme` until it merges (§3 rule 4).
const GATES = ['c2'] as const;

test.describe('E2E-RIG-04 Paint keys', () => {
  test.fixme(true, `gates ${GATES.join(', ')} have not merged (M6B-SPEC §3 rule 4)`);

  test('B/M/N drags, Shift+I picks the influence, I samples the value, Flood on a fresh joint', async ({ page }) => {
    await openEditor(page);
    await expectKernelStarted(page);
    const lad = await boundCubeLad(page);
    await enterSkin(page);
    await runOk(page, 'skin.influence.setActive', { mesh: lad.mesh, joint: lad.joint('spine') });
    const start = await call(page, 'paint');
    const positions = await positionsOf(page, lad.mesh);
    const at = await screenCentroid(page, lad.mesh, boxPoints(positions, 'forearm.L'));

    const holdDrag = async (key: string, dx: number): Promise<void> => {
      await page.mouse.move(at.x, at.y);
      await page.keyboard.down(key);
      await page.mouse.down();
      for (let i = 1; i <= 4; i++) await page.mouse.move(at.x + (dx * i) / 4, at.y);
      await page.mouse.up();
      await page.keyboard.up(key);
    };
    const undo = (await call(page, 'history')).undo.length;
    await holdDrag('KeyB', 40);
    await expect.poll(async () => (await call(page, 'paint')).radiusPx).toBe(start.radiusPx + 40);
    await holdDrag('KeyM', -40);
    await expect.poll(async () => (await call(page, 'paint')).opacity).toBeCloseTo(start.opacity - 0.2, 6);
    await holdDrag('KeyN', -60);
    await expect.poll(async () => (await call(page, 'paint')).value).toBeCloseTo(start.value - 0.3, 6);
    // No brush drag painted anything.
    expect((await call(page, 'history')).undo.length).toBe(undo);

    // Shift+I: the dominant joint of the forearm point; I: its weight into Value.
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Shift');
    await page.keyboard.down('KeyI');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up('KeyI');
    await page.keyboard.up('Shift');
    await expect.poll(async () => (await call(page, 'paint')).active?.joint).toBe(lad.joint('leftLowerArm'));
    await page.keyboard.down('KeyI');
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up('KeyI');
    await expect.poll(async () => (await call(page, 'paint')).value).toBeCloseTo(1, 6);

    // Flood 0.5 on a fresh joint through the panel's default path: Skin mode turned the brush's X-mirror on (the
    // template skeleton is symmetric), and Flood stays one-sided anyway (M6B-C6-17): a one-sided fresh joint never
    // hands its points to its mirror joint.
    await runOk(page, 'workspace.showPanel', { panel: 'paintWeights' });
    // A fresh joint: a deforming joint no point weights yet (the Cube Lad's boxes bind rigidly to their limbs); a
    // one-sided one first, so the mirror is exercised.
    const rows = await call(page, 'weights', lad.mesh);
    const fresh = ['leftShoulder', 'spine', 'neck']
      .map((bone) => lad.joint(bone))
      .find((id) => !rows.some((row) => row.joints.includes(id)));
    if (fresh === undefined) throw new Error('no fresh joint on the bound Cube Lad');
    const mirrorOfFresh = fresh === lad.joint('leftShoulder') ? lad.joint('rightShoulder') : fresh;
    const mirrorBefore = rows.map((row) => row.weights[row.joints.indexOf(mirrorOfFresh)] ?? 0);
    await page.getByTestId(`pw-influence-${lad.joint('leftLowerArm')}`).click();
    await runOk(page, 'skin.influence.setActive', { mesh: lad.mesh, joint: fresh });
    await expect(page.getByTestId('pw-mirror')).toBeChecked();
    const opacity = page.getByTestId('pw-opacity');
    await opacity.fill('1');
    await opacity.press('Enter');
    const value = page.getByTestId('pw-value');
    await value.fill('0.5');
    await value.press('Enter');
    await expect.poll(async () => (await call(page, 'paint')).value).toBe(0.5);
    const before = (await call(page, 'history')).undo.length;
    await page.getByTestId('pw-flood').click();
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(before + 1);
    expect((await call(page, 'history')).undo.at(-1)).toBe('Flood Skin Weights');
    const after = await call(page, 'weights', lad.mesh);
    for (const [v, row] of after.entries()) {
      const k = row.joints.indexOf(fresh);
      expect(row.weights[k] ?? 0).toBeCloseTo(0.5, 6);
      if (mirrorOfFresh !== fresh) {
        // The mirror joint only shrinks with the rest (it never takes the flood's value).
        const m = row.joints.indexOf(mirrorOfFresh);
        expect(row.weights[m] ?? 0).toBeLessThanOrEqual((mirrorBefore[v] ?? 0) + 1e-6);
      }
    }
    expect(
      await call(page, 'resolveKey', { code: 'KeyF', alt: true }, { panel: 'viewport', paneId: 'pane-persp' }),
    ).toBeNull();
  });
});
