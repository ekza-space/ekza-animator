import { expect, test } from '@playwright/test';
import { pointOf, readRz, sampleCurve } from './helpers/g2-graph';
import { seedWaveClip } from './helpers/seed';
import { call, fixmeIfKernelUnavailable, openEditor } from './helpers/test-api';

// E2E-11 (MVP-SPEC §6.2, §4.11.4 shape-preserving insert): the Graph Editor's Insert tool (I) and a click on the
// wave's rz curve at frame 22 add a key there without changing the curve's shape.
test('E2E-11: insert key', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await fixmeIfKernelUnavailable(page);
  const seed = await seedWaveClip(page);
  const before = await readRz(page, seed);
  const valuesBefore = await sampleCurve(page, seed.rz, 0, 30, 0.25);
  expect(valuesBefore).toHaveLength(121);

  const at22 = await pointOf(page, () => call(page, 'screenOfCurve', seed.rz, 22), 'rz curve at 22');
  await page.mouse.move(at22.x, at22.y);
  await page.keyboard.press('KeyI');
  await page.mouse.click(at22.x, at22.y);

  await expect.poll(async () => (await readRz(page, seed)).keys.map((key) => key.t)).toEqual([0, 15, 22, 30]);
  const after = await readRz(page, seed);
  const inserted = after.keys[2];
  expect(before.keys.map((key) => key.id)).not.toContain(inserted?.id);
  expect(after.keys.filter((key) => key.id !== inserted?.id).map((key) => [key.id, key.t, key.v])).toEqual(
    before.keys.map((key) => [key.id, key.t, key.v]),
  );

  const valuesAfter = await sampleCurve(page, seed.rz, 0, 30, 0.25);
  for (const [i, sample] of valuesAfter.entries()) {
    const old = valuesBefore[i]?.value ?? Number.NaN;
    expect(Math.abs(sample.value - old), `frame ${sample.frame}`).toBeLessThanOrEqual(1e-6);
  }
});
