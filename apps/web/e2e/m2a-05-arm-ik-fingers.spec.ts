import { expect, test } from '@playwright/test';
import {
  boneWorlds,
  controlIdOf,
  DEG,
  expectWorldClose,
  expectLimbIk,
  relative,
  selectIds,
  typeCb,
  type World,
} from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-05 (M2A-SPEC §9.1, §5.3 follow rule, §5.6): switching Seed-san's left arm to IK (with match) keeps the hand
// and finger worlds; lowering `cog` then leaves the hand where it is and the finger controls follow the hand.
//
// Deviation M2A-A2-13 (docs/wp-notes/m2a-ik-editor.md): Seed-san's arms are straight in the rest T-pose (reach
// 0.47498 m of 0.47502 m), so with the cog 5 cm lower the IK hand would be 3 mm out of reach and could not stay. The
// scenario first bends the left elbow 30° in FK (fk.lowerArm.L ry −30°: the forearm swings forward), so the matched
// IK arm has room to bend.
test('E2E-M2A-05: arm IK with fingers', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  await expectLimbIk(page);
  const hand = await controlIdOf(page, 'fk.hand.L');
  const finger = await controlIdOf(page, 'fk.indexProximal.L');
  await runOk(page, 'channel.setValues', {
    edits: [{ control: await controlIdOf(page, 'fk.lowerArm.L'), channel: 'ry', value: -30 * DEG }],
  });
  await selectIds(page, [hand]);
  const before = await boneWorlds(page, character, ['leftHand', 'leftIndexProximal']);

  await runOk(page, 'workspace.showPanel', { panel: 'attributes' });
  await page.getByTestId('attr-limb-mode-ik-arm.L').click();
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Switch L Arm to IK');
  const switched = await boneWorlds(page, character, ['leftHand', 'leftIndexProximal']);
  for (const bone of ['leftHand', 'leftIndexProximal'] as const) {
    expectWorldClose(switched[bone] as World, before[bone] as World, 1e-6, `${bone} after the switch`);
  }
  const fingerBefore = relative(switched.leftHand as World, await call(page, 'controlWorld', finger));

  await selectIds(page, [await controlIdOf(page, 'cog')]);
  await runOk(page, 'workspace.showPanel', { panel: 'channelBox' });
  await typeCb(page, 'cb-field-ty', '-0.05');
  const lowered = await boneWorlds(page, character, ['leftHand']);
  expectWorldClose(lowered.leftHand as World, switched.leftHand as World, 1e-6, 'hand after the cog edit');
  const fingerAfter = relative(lowered.leftHand as World, await call(page, 'controlWorld', finger));
  expectWorldClose(fingerAfter, fingerBefore, 1e-6, 'finger control relative to the hand');

  const visible = Object.fromEntries((await call(page, 'controls')).map((control) => [control.key, control.visible]));
  expect(visible['ik.arm.L']).toBe(true);
  expect(visible['fk.upperArm.L']).toBe(false);
});
