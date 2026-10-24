import { expect, test } from '@playwright/test';
import { clickKey, dragBy, pointOf, readRz, rzKeyAt, weightOf } from './helpers/g2-graph';
import { seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-10 (MVP-SPEC §6.2, §4.11.4 handle drag): on a weighted curve with free weights a handle drag changes the angle
// and the length; with the weight locked a drag changes only the angle (the tangent weight keeps).
test('E2E-10: weighted handles', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seed = await seedWaveClip(page);
  const fps = (await call(page, 'clips')).find((clip) => clip.id === seed.clip)?.fps ?? Number.NaN;
  await runOk(page, 'graph.curve.setWeighted', { weighted: true });
  await runOk(page, 'graph.tangent.lockWeight', { locked: false });
  const before = await readRz(page, seed);
  expect(before.weighted).toBe(true);
  const at7 = await call(page, 'curveValue', seed.rz, 7);

  // Select key@0 and drag its out handle 60 px to the right (longer, still flat).
  const key0 = (await rzKeyAt(page, seed, 0)).id;
  await clickKey(page, key0, 'key@0');
  const handle = await pointOf(page, () => call(page, 'screenOfHandle', key0, 'out'), 'out handle of key@0');
  await dragBy(page, handle, 60, 0);
  await expect.poll(async () => (await rzKeyAt(page, seed, 0)).outType).toBe('fixed');
  const free = await readRz(page, seed);
  expect(free.keys.map((key) => [key.t, key.v])).toEqual(before.keys.map((key) => [key.t, key.v]));
  expect(Math.abs((await call(page, 'curveValue', seed.rz, 7)) - at7)).toBeGreaterThan(1e-6);
  const freeOut = free.keys[0]?.outHandle ?? { dt: Number.NaN, dv: Number.NaN };
  expect(freeOut.dt).toBeGreaterThan(5); // longer than the computed third of the span

  // Lock the weight, then drag the handle 40 px up: the angle changes, the length (weight) keeps.
  await runOk(page, 'graph.tangent.lockWeight', { locked: true });
  const lockedHandle = await pointOf(page, () => call(page, 'screenOfHandle', key0, 'out'), 'out handle of key@0');
  await dragBy(page, lockedHandle, 0, -40);
  await expect.poll(async () => (await rzKeyAt(page, seed, 0)).outHandle.dv).not.toBe(freeOut.dv);
  const locked = await readRz(page, seed);
  const lockedOut = locked.keys[0]?.outHandle ?? { dt: Number.NaN, dv: Number.NaN };
  expect(lockedOut.dv).toBeGreaterThan(0);
  expect(Math.abs(weightOf(lockedOut, fps) - weightOf(freeOut, fps))).toBeLessThanOrEqual(1e-6);
  expect(locked.keys.map((key) => [key.t, key.v])).toEqual(before.keys.map((key) => [key.t, key.v]));
});
