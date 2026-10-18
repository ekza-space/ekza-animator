import { expect, test } from '@playwright/test';
import { pressOverPane } from './helpers/g3-input';
import { boneWorlds, controlIdOf, DEG, distance, expectLimbIk, quatAngle, selectIds, typeCb } from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-04 (M2A-SPEC §9.1, §5.3.1): the simple foot roll on Seed-san's IK feet, typed in degrees in the Channel
// Box. Roll 20° turns the foot about the ball (toes and ball pivot stay), −15° about the heel, 50° (above the 30°
// break) about the toe tip with the toes turned by 20°; bank pivots on the inner edge for + and the outer edge for −
// on both feet; mirroring a left bank and roll onto the right foot mirrors the pivots.

type Pivots = NonNullable<Awaited<ReturnType<typeof readPivots>>>;
async function readPivots(page: Parameters<typeof call>[0], character: string, limb: string) {
  return call(page, 'limbPivots', character, limb);
}

test('E2E-M2A-04: foot roll', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  await expectLimbIk(page);
  const left = await controlIdOf(page, 'ik.leg.L');
  const right = await controlIdOf(page, 'ik.leg.R');
  const pivots = async (limb: 'leg.L' | 'leg.R'): Promise<Pivots> => {
    const value = await readPivots(page, character, limb);
    if (value === null) throw new Error(`no pivots of ${limb}`);
    return value;
  };
  const near = (a: readonly number[], b: readonly number[], what: string, tolerance = 1e-6) =>
    expect(distance(a, b), what).toBeLessThanOrEqual(tolerance);

  await selectIds(page, [left]);
  const rest = await pivots('leg.L');
  const restBones = await boneWorlds(page, character, ['leftFoot', 'leftToes']);

  await typeCb(page, 'cb-field-@roll', '20');
  const roll20 = await pivots('leg.L');
  const bones20 = await boneWorlds(page, character, ['leftFoot', 'leftToes']);
  near(roll20.ball, rest.ball, 'roll 20: ball pivot');
  near(bones20.leftToes?.t ?? [], restBones.leftToes?.t ?? [], 'roll 20: toes position');
  expect(quatAngle(bones20.leftToes?.q ?? [0, 0, 0, 1], restBones.leftToes?.q ?? [0, 0, 0, 1])).toBeLessThanOrEqual(
    1e-6,
  );
  expect(
    Math.abs(quatAngle(bones20.leftFoot?.q ?? [0, 0, 0, 1], restBones.leftFoot?.q ?? [0, 0, 0, 1]) - 20 * DEG),
  ).toBeLessThanOrEqual(1e-6);

  await typeCb(page, 'cb-field-@roll', '-15');
  near((await pivots('leg.L')).heel, rest.heel, 'roll −15: heel pivot');

  await typeCb(page, 'cb-field-@roll', '50');
  const roll50 = await pivots('leg.L');
  const bones50 = await boneWorlds(page, character, ['leftToes']);
  near(roll50.toe, rest.toe, 'roll 50: toe pivot');
  expect(
    Math.abs(quatAngle(bones50.leftToes?.q ?? [0, 0, 0, 1], restBones.leftToes?.q ?? [0, 0, 0, 1]) - 20 * DEG),
  ).toBeLessThanOrEqual(1e-6);

  await typeCb(page, 'cb-field-@roll', '0');
  await typeCb(page, 'cb-field-@bank', '10');
  const bank10 = await pivots('leg.L');
  near(bank10.inner, rest.inner, 'left bank 10: inner pivot');
  expect((bank10.outer[1] ?? 0) - (rest.outer[1] ?? 0)).toBeGreaterThan(1e-4);
  await typeCb(page, 'cb-field-@bank', '-10');
  const bankMinus = await pivots('leg.L');
  near(bankMinus.outer, rest.outer, 'left bank −10: outer pivot');
  expect((bankMinus.inner[1] ?? 0) - (rest.inner[1] ?? 0)).toBeGreaterThan(1e-4);

  await selectIds(page, [right]);
  const restRight = await pivots('leg.R');
  await typeCb(page, 'cb-field-@bank', '10');
  const rightBank = await pivots('leg.R');
  near(rightBank.inner, restRight.inner, 'right bank 10: inner pivot');
  expect((rightBank.outer[1] ?? 0) - (restRight.outer[1] ?? 0)).toBeGreaterThan(1e-4);
  for (const name of ['heel', 'ball', 'toe', 'inner', 'outer'] as const) {
    expect(
      (rightBank[name][1] ?? 0) - (restRight[name][1] ?? 0),
      `right ${name} above its rest height`,
    ).toBeGreaterThanOrEqual(-1e-6);
  }
  await pressOverPane(page, 'Meta+KeyZ');
  await expect.poll(async () => (await call(page, 'attrs', right))['bank']).toBe(0);

  await selectIds(page, [left]);
  await typeCb(page, 'cb-field-@bank', '10');
  await typeCb(page, 'cb-field-@roll', '20');
  await runOk(page, 'pose.mirror', { mode: 'leftToRight' });
  const mirroredLeft = await pivots('leg.L');
  const mirroredRight = await pivots('leg.R');
  for (const name of ['heel', 'ball', 'toe', 'inner', 'outer'] as const) {
    const l = mirroredLeft[name];
    near(mirroredRight[name], [-(l[0] ?? 0), l[1] ?? 0, l[2] ?? 0], `mirrored ${name}`, 1e-3);
  }
});
