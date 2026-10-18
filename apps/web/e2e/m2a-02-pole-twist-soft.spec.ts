import { expect, test } from '@playwright/test';
import {
  boneWorlds,
  controlIdOf,
  cross,
  DEG,
  distance,
  dot,
  gateOnA1,
  normalize,
  selectIds,
  sub,
  typeCb,
  type Vec3,
} from './helpers/m2a-a2';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-02 (M2A-SPEC §9.1, §5.3): on Polybot's IK leg, moving the knee pole sideways swings the knee without
// moving the foot; a 30° twist rotates the knee's bend offset by 30° about the hip→foot axis; with soft IK the
// hip→foot distance never decreases and stays below the leg length while the target moves away, and the foot misses
// the target inside the soft zone.

/** The knee's offset from the hip→foot line (the bend direction). */
function bendOffset(hip: Vec3, knee: Vec3, foot: Vec3): [number, number, number] {
  const axis = normalize(sub(foot, hip));
  const offset = sub(knee, hip);
  const along = dot(offset, axis);
  return [offset[0] - axis[0] * along, offset[1] - axis[1] * along, offset[2] - axis[2] * along];
}

test('E2E-M2A-02: pole, twist, soft', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  await gateOnA1(page);
  const bones = ['leftUpperLeg', 'leftLowerLeg', 'leftFoot'] as const;
  const rest = await boneWorlds(page, character, bones);
  const hip = rest.leftUpperLeg?.t as Vec3;
  const legLength =
    distance(rest.leftUpperLeg?.t ?? [0, 0, 0], rest.leftLowerLeg?.t ?? [0, 0, 0]) +
    distance(rest.leftLowerLeg?.t ?? [0, 0, 0], rest.leftFoot?.t ?? [0, 0, 0]);

  // Pole +0.3 m in x: the knee follows, the foot stays.
  await selectIds(page, [await controlIdOf(page, 'pole.leg.L')]);
  await typeCb(page, 'cb-field-tx', '+=0.3');
  const poled = await boneWorlds(page, character, bones);
  expect((poled.leftLowerLeg?.t[0] ?? 0) - (rest.leftLowerLeg?.t[0] ?? 0)).toBeGreaterThan(5e-3);
  expect(distance(poled.leftFoot?.t ?? [0, 0, 0], rest.leftFoot?.t ?? [0, 0, 0])).toBeLessThanOrEqual(1e-6);

  // Twist 30°: the bend offset turns by 30° about hip → foot.
  const ikLeg = await controlIdOf(page, 'ik.leg.L');
  await selectIds(page, [ikLeg]);
  await typeCb(page, 'cb-field-@twist', '30');
  const twisted = await boneWorlds(page, character, bones);
  const before = normalize(bendOffset(hip, poled.leftLowerLeg?.t as Vec3, poled.leftFoot?.t as Vec3));
  const after = normalize(bendOffset(hip, twisted.leftLowerLeg?.t as Vec3, twisted.leftFoot?.t as Vec3));
  const angle = Math.atan2(Math.hypot(...cross(before, after)), dot(before, after));
  expect(Math.abs(angle - 30 * DEG)).toBeLessThanOrEqual(1e-6);
  expect(distance(twisted.leftFoot?.t ?? [0, 0, 0], poled.leftFoot?.t ?? [0, 0, 0])).toBeLessThanOrEqual(1e-6);

  // Soft 0.1, then the IK foot moves down (away from the hip) in 20 steps of 0.01·L.
  await typeCb(page, 'cb-field-@soft', '0.1');
  expect((await call(page, 'attrs', ikLeg))['soft']).toBeCloseTo(0.1, 12);
  const startTy = (await call(page, 'channelValues', ikLeg)).ty ?? 0;
  let previous = 0;
  let missed = 0;
  for (let step = 1; step <= 20; step++) {
    await runOk(page, 'channel.setValues', {
      edits: [{ control: ikLeg, channel: 'ty', value: startTy - step * 0.01 * legLength }],
    });
    const world = await boneWorlds(page, character, ['leftUpperLeg', 'leftFoot']);
    const reach = distance(world.leftUpperLeg?.t ?? [0, 0, 0], world.leftFoot?.t ?? [0, 0, 0]);
    expect(reach, `step ${step}: hip→foot never decreases`).toBeGreaterThanOrEqual(previous - 1e-9);
    expect(reach, `step ${step}: below the leg length`).toBeLessThan(legLength);
    previous = reach;
    const target = (await call(page, 'controlWorld', ikLeg)).t;
    missed = Math.max(missed, distance(world.leftFoot?.t ?? [0, 0, 0], target));
  }
  expect(missed, 'the foot misses the target inside the soft zone').toBeGreaterThan(1e-4);
});
