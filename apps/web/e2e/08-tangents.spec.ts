import { expect, test } from '@playwright/test';
import { DEG, pointOf, readRz, slopesAt } from './helpers/g2-graph';
import { seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-08 (MVP-SPEC §6.2, §4.11.4): double-click the wave's rz curve in the Graph Editor (all three keys), then the
// tangent hotkeys 4 (linear), 6 (step) and 1 (auto) over it; the evaluated curve follows the AnimX span rules.
test('E2E-08: tangents', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seed = await seedWaveClip(page);
  const before = await readRz(page, seed);
  const [v0, v15, v30] = before.keys.map((key) => key.v);
  expect([v0, v15, v30]).toEqual([30 * DEG, -30 * DEG, 30 * DEG].map((v) => expect.closeTo(v, 12)));

  const onCurve = await pointOf(page, () => call(page, 'screenOfCurve', seed.rz, 7.5), 'rz curve at 7.5');
  await page.mouse.move(onCurve.x, onCurve.y);
  await page.mouse.dblclick(onCurve.x, onCurve.y);
  await expect
    .poll(async () => [...(await call(page, 'state')).selection.keys].sort())
    .toEqual(before.keys.map((key) => key.id).sort());

  // 4 = linear: the span 0–15 is the chord, so its midpoint is the mean of its keys.
  await page.keyboard.press('Digit4');
  await expect
    .poll(async () => (await readRz(page, seed)).keys.map((key) => [key.inType, key.outType]))
    .toEqual(before.keys.map(() => ['linear', 'linear']));
  expect(await call(page, 'curveValue', seed.rz, 7.5)).toBeCloseTo(((v0 ?? 0) + (v15 ?? 0)) / 2, 9);
  expect(await call(page, 'curveValue', seed.rz, 7.5)).toBeCloseTo(0, 9);

  // 6 = step (out sides only): each span holds its start key's value until the next key.
  await page.keyboard.press('Digit6');
  await expect
    .poll(async () => (await readRz(page, seed)).keys.map((key) => [key.inType, key.outType]))
    .toEqual(before.keys.map(() => ['linear', 'step']));
  expect(await call(page, 'curveValue', seed.rz, 14)).toBeCloseTo(v0 ?? Number.NaN, 9);
  expect(await call(page, 'curveValue', seed.rz, 14)).toBeCloseTo(30 * DEG, 9);
  expect(await call(page, 'curveValue', seed.rz, 29)).toBeCloseTo(v15 ?? Number.NaN, 9);
  expect(await call(page, 'curveValue', seed.rz, 29)).toBeCloseTo(-30 * DEG, 9);

  // 1 = auto: key@15 is a local minimum, so the auto clamp makes both of its slopes 0.
  await page.keyboard.press('Digit1');
  await expect
    .poll(async () => (await readRz(page, seed)).keys.map((key) => [key.inType, key.outType]))
    .toEqual(before.keys.map(() => ['auto', 'auto']));
  const slopes = await slopesAt(page, seed.rz, 15);
  expect(slopes.in).toBeCloseTo(0, 9);
  expect(slopes.out).toBeCloseTo(0, 9);
});
