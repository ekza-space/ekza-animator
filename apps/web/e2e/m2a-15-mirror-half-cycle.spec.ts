import { expect, test } from '@playwright/test';
import { curveOf, keyLinear } from './helpers/m2a-a4';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-15 (FR-POSE-05, M2A-SPEC §5.14): Pose › Mirror Animation › Left → Right (half cycle) on a loop clip writes
// the right IK foot as the left one mirrored and half a cycle later. Needs the leg IK controls of A1 (rig) and A2
// (editor integration): fixme until both merge (M2A-SPEC §8, §10.1).
test('E2E-M2A-15: mirror animation, half cycle', async ({ page }) => {
  test.fixme(true, 'A1,A2: the leg IK controls (ik.leg.L/R) land with A1 (rig) and A2 (editor integration)');
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  const clip = (await call(page, 'state')).activeClip ?? '';
  await runOk(page, 'clip.setSettings', { clip, range: { start: 0, end: 24 }, loop: true });
  const left = await controlId(page, 'ik.leg.L', character);
  const right = await controlId(page, 'ik.leg.R', character);
  const frames = [0, 6, 12, 18, 24];
  await keyLinear(
    page,
    clip,
    left,
    'tz',
    frames.map((t, i) => [t, [0.1, 0, -0.1, 0, 0.1][i] as number] as const),
  );
  await keyLinear(
    page,
    clip,
    left,
    'tx',
    frames.map((t, i) => [t, [0.02, 0, -0.02, 0, 0.02][i] as number] as const),
  );
  const leftBefore = await call(page, 'curves', clip, left);
  await runOk(page, 'select.controls', { ids: [left], mode: 'replace' });

  await page.getByTestId('menu-pose').click();
  await page.getByTestId('menu-sub-pose.mirror-animation').click();
  await page.getByTestId('menu-item-builtin.pose.mirror-animation.leftToRight-half').click();
  await expect.poll(async () => (await call(page, 'state')).history.undoLabel).toBe('Mirror Animation');

  const tz = await curveOf(page, clip, right, 'tz');
  expect(tz.keys.map((key) => [key.t, key.v])).toEqual([
    [0, expect.closeTo(-0.1, 12)],
    [6, expect.closeTo(0, 12)],
    [12, expect.closeTo(0.1, 12)],
    [18, expect.closeTo(0, 12)],
    [24, expect.closeTo(-0.1, 12)],
  ]);
  const tx = await curveOf(page, clip, right, 'tx');
  expect(tx.keys.map((key) => [key.t, key.v])).toEqual([
    [0, expect.closeTo(0.02, 12)],
    [6, expect.closeTo(0, 12)],
    [12, expect.closeTo(-0.02, 12)],
    [18, expect.closeTo(0, 12)],
    [24, expect.closeTo(0.02, 12)],
  ]);
  // The source side is unchanged.
  expect(await call(page, 'curves', clip, left)).toEqual(leftBefore);

  // The gate: the right foot at (t + 12) mod 24 is the left foot at t, mirrored (channels 1e-9, worlds 1e-3 m).
  for (let t = 0; t < 24; t++) {
    const mapped = (t + 12) % 24;
    const l = await call(page, 'channelValues', left, t);
    const r = await call(page, 'channelValues', right, mapped);
    expect([t, r['tx'], r['ty'], r['tz']]).toEqual([
      t,
      expect.closeTo(-(l['tx'] ?? 0), 9),
      expect.closeTo(l['ty'] ?? 0, 9),
      expect.closeTo(l['tz'] ?? 0, 9),
    ]);
    expect([t, r['rx'], r['ry'], r['rz']]).toEqual([
      t,
      expect.closeTo(l['rx'] ?? 0, 9),
      expect.closeTo(-(l['ry'] ?? 0), 9),
      expect.closeTo(-(l['rz'] ?? 0), 9),
    ]);
    const leftFoot = await call(page, 'boneWorld', character, 'leftFoot', t);
    const rightFoot = await call(page, 'boneWorld', character, 'rightFoot', mapped);
    expect([t, ...rightFoot.t]).toEqual([
      t,
      expect.closeTo(-leftFoot.t[0], 3),
      expect.closeTo(leftFoot.t[1], 3),
      expect.closeTo(leftFoot.t[2], 3),
    ]);
  }
});
