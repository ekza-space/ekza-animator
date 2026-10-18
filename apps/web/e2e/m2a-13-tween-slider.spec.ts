import { expect, test } from '@playwright/test';
import { hoverGraph } from './helpers/g2-graph';
import { curveOf, DEG, dragTween, expectUndoLabel, keyLinear } from './helpers/m2a-a4';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-13 (FR-KEY-09, M2A-SPEC §5.13): the Graph Editor's Tween bar drags a breakdown into the pose in one step;
// the one-shot `key.tween` modes give the §5.13 values from a linear 0° → 60° span over frames 0…20 at frame 10.
test('E2E-M2A-13: tween slider', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'tween' });
  const control = await controlId(page, 'fk.lowerArm.L', character);
  await keyLinear(page, clip, control, 'rz', [
    [0, 0],
    [20, 60 * DEG],
  ]);
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  await runOk(page, 'time.setFrame', { frame: 10 });
  expect((await call(page, 'channelValues', control)).rz).toBeCloseTo(30 * DEG, 9);
  const rzAt10 = async () => (await curveOf(page, clip, control, 'rz')).keys.find((key) => key.t === 10) ?? null;

  // The Graph Editor's bar shows the resolved target and drags from 0 to 50.
  await expect.poll(() => call(page, 'tweenTarget', 'graph')).toEqual({ kind: 'frame', label: 'Pose @ f10' });
  const stepsBefore = (await call(page, 'state')).history.undoLabel;
  await dragTween(page, 'graph', 0, 50);
  await expect.poll(async () => (await rzAt10())?.v ?? null).not.toBeNull();
  const key = await rzAt10();
  expect(key?.v ?? 0).toBeCloseTo(45 * DEG, 9);
  expect(key?.breakdown).toBe(true);
  await expectUndoLabel(page, 'Tween');
  expect(stepsBefore).not.toBe('Tween');

  // One history step: one undo removes the key and the pose returns to 30°.
  await hoverGraph(page);
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(rzAt10).toBeNull();
  expect((await call(page, 'channelValues', control)).rz).toBeCloseTo(30 * DEG, 9);
  expect(await call(page, 'tweenTarget', 'graph')).toEqual({ kind: 'frame', label: 'Pose @ f10' });

  // One-shot modes, each from the same setup (undone after each).
  const oneShot = async (args: Record<string, unknown>, degrees: number) => {
    await runOk(page, 'key.tween', args);
    expect([args, ((await rzAt10())?.v ?? Number.NaN) / DEG]).toEqual([args, expect.closeTo(degrees, 9)]);
  };
  // Overshoot on (the bar's toggle): tween 125 → w = 1.125.
  await page.getByTestId('tween-overshoot-graph').click();
  await expect.poll(async () => (await call(page, 'screenOfTween', 'graph', 140)) !== null).toBe(true);
  await oneShot({ mode: 'tween', amount: 125 }, 67.5);
  await runOk(page, 'edit.undo');
  await oneShot({ mode: 'neighbor', amount: -50 }, 15);
  await runOk(page, 'edit.undo');
  await oneShot({ mode: 'ease', amount: -50 }, 60 * 0.5 ** 2.5);
  await runOk(page, 'edit.undo');
  await oneShot({ mode: 'toDefault', amount: 50 }, 15);
  await runOk(page, 'edit.undo');
  await oneShot({ mode: 'tween', amount: 50 }, 45);
  await oneShot({ mode: 'pushPull', amount: 100 }, 60);
});
