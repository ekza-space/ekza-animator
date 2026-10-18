import { expect, test } from '@playwright/test';
import { drag, pointOf } from './helpers/g1-viewport';
import { clickOutlinerRow, pressOverPane } from './helpers/g3-input';
import { boneWorlds, clickControl, controlIdOf, expectWorldClose, gateOnA1, quatAngle, typeCb } from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-M2A-01 (M2A-SPEC §9.1, §5.3, §5.5; FR-RIG-11): Polybot's legs are IK by default, so lowering `cog` keeps the
// left foot where it is (the knee bends forward) and dragging the IK foot up lifts it without turning it; FK leg
// controls are hidden, IK controls and poles shown; two undos restore the rest worlds (rest exactness).
test('E2E-M2A-01: leg IK holds the feet', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  await gateOnA1(page);

  const limbs = Object.fromEntries((await call(page, 'limbs')).map((limb) => [limb.id, limb.ikFk]));
  expect(limbs).toEqual({ 'leg.L': 1, 'leg.R': 1, 'arm.L': 0, 'arm.R': 0 });
  const visible = Object.fromEntries((await call(page, 'controls')).map((control) => [control.key, control.visible]));
  expect(visible['fk.upperLeg.L']).toBe(false);
  expect(visible['ik.leg.L']).toBe(true);
  expect(visible['pole.leg.L']).toBe(true);
  expect(visible['ik.arm.L']).toBe(false);

  const rest = await boneWorlds(page, character, ['leftFoot', 'leftLowerLeg', 'hips']);
  const history = (await call(page, 'state')).history;
  const cog = await controlIdOf(page, 'cog');
  await clickOutlinerRow(page, cog);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([cog]);
  await typeCb(page, 'cb-field-ty', '-0.05');
  await expect
    .poll(async () => (await boneWorlds(page, character, ['hips'])).hips?.t[1] ?? Number.NaN)
    .toBeCloseTo((rest.hips?.t[1] ?? 0) - 0.05, 9);
  const lowered = await boneWorlds(page, character, ['leftFoot', 'leftLowerLeg', 'hips']);
  expect(Math.abs((lowered.hips?.t[1] ?? 0) - ((rest.hips?.t[1] ?? 0) - 0.05))).toBeLessThanOrEqual(1e-9);
  expectWorldClose(lowered.leftFoot as never, rest.leftFoot as never, 1e-6, 'left foot after the cog edit');
  // The knee bends forward (+z).
  expect((lowered.leftLowerLeg?.t[2] ?? 0) - (rest.leftLowerLeg?.t[2] ?? 0)).toBeGreaterThan(1e-3);

  // Drag the IK foot 40 px up with the move tool.
  const ikLeg = await controlIdOf(page, 'ik.leg.L');
  await clickControl(page, ikLeg);
  await page.keyboard.press('KeyW');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('move');
  const arrow = await pointOf(page, () => call(page, 'screenOfManipulator', 'pane-right', 'ty'), 'ty arrow');
  await drag(page, arrow, { dx: 0, dy: -40 });
  const lifted = await boneWorlds(page, character, ['leftFoot']);
  expect((lifted.leftFoot?.t[1] ?? 0) - (lowered.leftFoot?.t[1] ?? 0)).toBeGreaterThan(1e-3);
  expect(quatAngle(lifted.leftFoot?.q ?? [0, 0, 0, 1], rest.leftFoot?.q ?? [0, 0, 0, 1])).toBeLessThanOrEqual(1e-6);

  // Two undos: the drag, then the cog edit. The rest pose comes back exactly (§5.3 rest exactness).
  await pressOverPane(page, 'Meta+KeyZ');
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe(history.undoLabel);
  const back = await boneWorlds(page, character, ['leftFoot', 'leftLowerLeg', 'hips']);
  for (const bone of ['leftFoot', 'leftLowerLeg', 'hips'] as const) {
    expectWorldClose(back[bone] as never, rest[bone] as never, 1e-7, `${bone} after undo`);
  }
});
