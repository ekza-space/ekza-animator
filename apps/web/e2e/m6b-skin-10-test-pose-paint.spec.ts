import { expect, test } from '@playwright/test';
import { drag, pointOf } from './helpers/g1-viewport';
import { enterRig, keysHash, RIG_PERSP_PANE } from './helpers/m6b-rig';
import {
  asymmetricPoints,
  boundCubeLad,
  boxPoints,
  dismissGettingStarted,
  enterSkin,
  hoverPersp,
  partnersOf,
  positionsOf,
  screenCentroid,
  stroke,
  weightMaps,
} from './helpers/m6b-skin-ui';
import { controlId } from './helpers/seed';
import { call, expectKernelStarted, openEditor, run, runOk } from './helpers/test-api';

// E2E-SKIN-10 "Test pose, posed painting with mirror stroke, Go to Bind Pose" (M6B-SPEC §0.7, §10.1 part (a) and the
// knee / Skin-mode `E` items of part (b); C6). Part (a), on the bound Cube Lad: an unkeyed override on fk.head in
// Animate; Rig & Skin, Object mode, `E` drags fk.lowerArm.L's ring (a test pose: TEST POSE, keys unchanged); `2`;
// the active influence leftLowerArm; Replace value 1 with the X-mirror stroke on; one stroke over the inner elbow on
// the posed mesh: the left points and their partners change (`w(p(v)) = M(w(v))`, rightLowerArm on the right), one
// step per stroke; status Bind empties the test pose, Test restores it, Reset Test Pose empties it; back in Animate
// the fk.head override is unchanged and fk.lowerArm.L has none. Part (b) needs C3's joint overlay and E on joints.
//
// Gates (§0.7): c2; part (b) + c3 — `test.fixme` until they merge (§3 rule 4).
const GATES = ['c2'] as const;
const GATES_B = ['c2', 'c3'] as const;

test.describe('E2E-SKIN-10 test pose, posed painting, Go to Bind Pose', () => {
  test.fixme(true, `gates ${GATES.join(', ')} have not merged (M6B-SPEC §3 rule 4)`);

  test('(a) a test pose, a mirrored stroke on the posed mesh, Bind / Test / Reset, nothing leaks into Animate', async ({
    page,
  }) => {
    await openEditor(page);
    await expectKernelStarted(page);
    const lad = await boundCubeLad(page);
    const head = await controlId(page, 'fk.head', lad.character);
    const arm = await controlId(page, 'fk.lowerArm.L', lad.character);
    // Animate: a clip, a key on fk.head, then an unkeyed override on it.
    await runOk(page, 'workspace.set', { workspace: 'animate' });
    await runOk(page, 'clip.new', { character: lad.character });
    await runOk(page, 'select.controls', { ids: [head], mode: 'replace' });
    await runOk(page, 'key.set');
    await runOk(page, 'channel.setValues', { edits: [{ control: head, channel: 'rx', value: 0.25 }], key: 'none' });
    const override = await call(page, 'overrides', head);
    expect(override['rx']).toBeCloseTo(0.25);

    await enterRig(page);
    const hash = await keysHash(page);
    await dismissGettingStarted(page);
    await hoverPersp(page);
    await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
    await page.keyboard.press('KeyE');
    await expect.poll(async () => (await call(page, 'state')).tool).toBe('rotate');
    const ring = await pointOf(page, () => call(page, 'screenOfManipulator', RIG_PERSP_PANE, 'rz'), 'rz ring');
    await drag(page, ring, { dx: 60, dy: 0 });
    await expect.poll(async () => (await call(page, 'rigState')).poseView).toBe('test');
    await expect(page.getByTestId(`hud-badge-pose-${RIG_PERSP_PANE}`)).toHaveText('TEST POSE');
    expect(await keysHash(page)).toBe(hash);

    await enterSkin(page);
    expect((await call(page, 'rigState')).poseView).toBe('test');
    await runOk(page, 'workspace.showPanel', { panel: 'paintWeights' });
    await page.getByTestId(`pw-influence-${lad.joint('leftLowerArm')}`).click();
    expect(await call(page, 'paint')).toMatchObject({ op: 'replace', value: 1, mirror: true });
    await page.getByTestId('pw-falloff').selectOption('constant');
    const radius = page.getByTestId('pw-radius');
    await radius.fill('150');
    await radius.press('Enter');

    const positions = await positionsOf(page, lad.mesh);
    const partners = partnersOf(positions);
    const upper = boxPoints(positions, 'upperArm.L');
    const before = await weightMaps(page, lad.mesh);
    const undo = (await call(page, 'history')).undo.length;
    await stroke(page, await screenCentroid(page, lad.mesh, upper));
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(undo + 1);
    expect((await call(page, 'history')).undo.at(-1)).toBe('Paint Skin Weights');
    const after = await weightMaps(page, lad.mesh);
    const changed = after
      .map((_, v) => v)
      .filter((v) => {
        const a = after[v] as Map<string, number>;
        const b = before[v] as Map<string, number>;
        return a.size !== b.size || [...a].some(([key, w]) => b.get(key) !== w);
      });
    expect(changed.some((v) => (positions[v]?.[0] ?? 0) > 0)).toBe(true);
    expect(changed.some((v) => (positions[v]?.[0] ?? 0) < 0)).toBe(true);
    for (const v of changed.filter((p) => (positions[p]?.[0] ?? 0) < 0)) {
      expect(after[v]?.get(lad.joint('rightLowerArm')) ?? 0).toBeGreaterThan(0);
    }
    expect(asymmetricPoints(after, partners, lad.mirror)).toEqual([]);
    expect(await keysHash(page)).toBe(hash);

    // Bind → empty, Test → restored, Reset after Bind → empty.
    await page.getByTestId('status-poseview-bind').click();
    await expect.poll(async () => (await call(page, 'rigState')).testPose.controls).toBe(0);
    await page.getByTestId('status-poseview-test').click();
    await expect.poll(async () => (await call(page, 'rigState')).testPose.controls).toBeGreaterThan(0);
    await page.getByTestId('status-poseview-bind').click();
    await runOk(page, 'rig.pose.resetTest');
    await expect.poll(async () => (await call(page, 'rigState')).testPose.controls).toBe(0);
    expect((await run(page, 'rig.pose.view', { view: 'test' })).status).not.toBe('failed');
    expect((await call(page, 'rigState')).testPose.controls).toBe(0);

    await runOk(page, 'workspace.set', { workspace: 'animate' });
    expect(await call(page, 'overrides', head)).toEqual(override);
    expect(await call(page, 'overrides', arm)).toEqual({});
  });

  test.fixme(`(b) E on joints, IK legs switch to FK for the test, the Skin-mode E (gates: ${GATES_B.join(', ')})`, async ({
    page,
  }) => {
    await openEditor(page);
    await expectKernelStarted(page);
    const lad = await boundCubeLad(page);
    await enterSkin(page);
    await runOk(page, 'skin.influence.setActive', { mesh: lad.mesh, joint: lad.joint('leftLowerArm') });
    await hoverPersp(page);
    await page.keyboard.press('KeyE');
    const posed = await call(page, 'posedPositions', lad.mesh);
    const centre = await screenCentroid(page, lad.mesh, boxPoints(await positionsOf(page, lad.mesh), 'forearm.L'));
    await drag(page, { x: centre.x + 48, y: centre.y }, { dx: 0, dy: -30 });
    expect((await call(page, 'state')).tool).toBe('paintSkinWeights');
    expect(await call(page, 'posedPositions', lad.mesh)).not.toEqual(posed);
  });
});
