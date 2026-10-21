import { expect, test } from '@playwright/test';
import { keysHash } from './helpers/m6b-rig';
import {
  boundCubeLad,
  boxPoints,
  enterSkin,
  positionsOf,
  screenCentroid,
  stroke,
  weightMaps,
} from './helpers/m6b-skin-ui';
import { call, expectKernelStarted, openEditor, renderedFrames, runOk } from './helpers/test-api';

// E2E-SKIN-02 "Paint fix with one undo" (M6B-SPEC §0.7, §10.1 row on the bound Cube Lad; C6). A left forearm point is
// seeded on the spine (`skin.weights.set`); Skin mode (`2`); the Paint Weights panel makes leftLowerArm the active
// influence and holds leftHand; Replace, value 1, opacity 1 (the defaults), constant falloff and a radius that covers
// the forearm box; one stroke over the forearm. The point's dominant joint is leftLowerArm (≥ 0.99), every point's
// leftHand weight is bit-equal, the history grew by exactly one "Paint Skin Weights", one undo restores the seeded
// weights bit-equal, and the keys hash is unchanged.
//
// Gates (§0.7): c2 (Create Skeleton through the Quick Rig commit) — `test.fixme` until it merges (§3 rule 4).
const GATES = ['c2'] as const;

test.describe('E2E-SKIN-02 Paint fix with one undo', () => {
  test.fixme(true, `gates ${GATES.join(', ')} have not merged (M6B-SPEC §3 rule 4)`);

  test('one stroke fixes a seeded point; held leftHand stays; one undo step restores it', async ({ page }) => {
    await openEditor(page);
    await expectKernelStarted(page);
    const lad = await boundCubeLad(page);
    const positions = await positionsOf(page, lad.mesh);
    const forearm = boxPoints(positions, 'forearm.L');
    expect(forearm.length).toBeGreaterThan(0);
    // The seeded point: a visible left forearm point (posed = bind here).
    await enterSkin(page);
    const visible = (await call(page, 'weightLabels', 'pane-persp')).filter(
      (label) => label.mesh === lad.mesh && forearm.includes(label.point),
    );
    expect(visible.length).toBeGreaterThan(0);
    const p = visible[0]?.point as number;
    await runOk(page, 'skin.weights.set', { mesh: lad.mesh, points: [p], joint: lad.joint('spine'), value: 1 });
    const seeded = await call(page, 'weights', lad.mesh);
    expect(seeded[p]?.joints).toEqual([lad.joint('spine')]);
    const hash = await keysHash(page);

    await runOk(page, 'workspace.showPanel', { panel: 'paintWeights' });
    await page.getByTestId(`pw-influence-${lad.joint('leftLowerArm')}`).click();
    await expect.poll(async () => (await call(page, 'paint')).active?.joint).toBe(lad.joint('leftLowerArm'));
    await page.getByTestId(`pw-hold-${lad.joint('leftHand')}`).click();
    await expect
      .poll(async () => (await call(page, 'paint')).holds[lad.character] ?? [])
      .toEqual([lad.joint('leftHand')]);
    // The 0-byte gate (§5.25): switching the active influence redraws with uniforms only — no buffer upload.
    await page.evaluate(() => {
      const probe = { bytes: 0 };
      (window as unknown as { __EKZA_UPLOADS__: typeof probe }).__EKZA_UPLOADS__ = probe;
      const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
      for (const [name, at] of [
        ['bufferData', 1],
        ['bufferSubData', 2],
      ] as const) {
        const original = proto[name] as (...args: unknown[]) => unknown;
        proto[name] = function (this: unknown, ...args: unknown[]) {
          const value = args[at];
          probe.bytes += typeof value === 'number' ? value : ((value as ArrayBufferView | null)?.byteLength ?? 0);
          return original.apply(this, args);
        };
      }
    });
    const frames = await renderedFrames(page);
    await page.getByTestId(`pw-influence-${lad.joint('spine')}`).click();
    await page.getByTestId(`pw-influence-${lad.joint('leftLowerArm')}`).click();
    await expect.poll(async () => (await call(page, 'paint')).active?.joint).toBe(lad.joint('leftLowerArm'));
    await expect.poll(() => renderedFrames(page)).toBeGreaterThan(frames);
    expect(
      await page.evaluate(() => (window as unknown as { __EKZA_UPLOADS__: { bytes: number } }).__EKZA_UPLOADS__.bytes),
    ).toBe(0);
    await expect(page.getByTestId('pw-op-replace')).toBeChecked();
    expect(await call(page, 'paint')).toMatchObject({ op: 'replace', value: 1, opacity: 1 });
    await page.getByTestId('pw-falloff').selectOption('constant');
    const radius = page.getByTestId('pw-radius');
    await radius.fill('150');
    await radius.press('Enter');
    await expect.poll(async () => (await call(page, 'paint')).radiusPx).toBe(150);

    const before = await weightMaps(page, lad.mesh);
    const undo = (await call(page, 'history')).undo.length;
    await stroke(page, await screenCentroid(page, lad.mesh, forearm));
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(undo + 1);
    expect((await call(page, 'history')).undo.at(-1)).toBe('Paint Skin Weights');
    const after = await weightMaps(page, lad.mesh);
    const row = (await call(page, 'weights', lad.mesh, [p]))[0];
    expect(row?.joints[0]).toBe(lad.joint('leftLowerArm'));
    expect(row?.weights[0] ?? 0).toBeGreaterThanOrEqual(0.99);
    const hand = lad.joint('leftHand');
    expect(after.map((m) => m.get(hand) ?? 0)).toEqual(before.map((m) => m.get(hand) ?? 0));
    expect(await keysHash(page)).toBe(hash);

    await runOk(page, 'edit.undo');
    expect(await call(page, 'weights', lad.mesh)).toEqual(seeded);
  });
});
