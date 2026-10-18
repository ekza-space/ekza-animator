import { expect, test } from '@playwright/test';
import { breakAndPenDrag, readRz, sampleCurve } from './helpers/g2-graph';
import { seedWaveClip } from './helpers/seed';
import { expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-09 (MVP-SPEC §6.2, §4.11.4 handle drag): click key@15, break its tangents (B), drag its out handle 40 px up.
// Only the dragged side becomes fixed; the span before the key keeps its shape, the span after it changes.
test('E2E-09: break + pen handle', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seed = await seedWaveClip(page);
  const before = await readRz(page, seed);
  const valuesBefore = await sampleCurve(page, seed.rz, 0, 30, 0.25);

  const { broken, dragged } = await breakAndPenDrag(page, seed);
  const [b15, d15] = [broken.keys[1], dragged.keys[1]];
  expect(b15?.inType).toBe(before.keys[1]?.inType);
  expect(d15?.t).toBe(15);
  expect(d15?.outType).toBe('fixed');
  expect(d15?.inType).toBe(b15?.inType);
  expect(d15?.broken).toBe(true);
  // Dragged up: the out handle now rises (a positive slope on the rising side of the minimum).
  expect(d15?.outHandle.dv ?? 0).toBeGreaterThan(0);
  expect(dragged.keys.map((key) => [key.t, key.v])).toEqual(before.keys.map((key) => [key.t, key.v]));

  const valuesAfter = await sampleCurve(page, seed.rz, 0, 30, 0.25);
  for (const [i, sample] of valuesAfter.entries()) {
    const old = valuesBefore[i]?.value ?? Number.NaN;
    if (sample.frame <= 15) {
      expect(Math.abs(sample.value - old), `frame ${sample.frame} unchanged`).toBeLessThanOrEqual(1e-9);
    } else if (sample.frame < 30) {
      expect(Math.abs(sample.value - old), `frame ${sample.frame} changed`).toBeGreaterThan(1e-6);
    }
  }
});
