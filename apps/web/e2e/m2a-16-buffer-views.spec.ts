import { expect, test } from '@playwright/test';
import { clickKey, DEG, pointOf, rzKeyAt, typeField } from './helpers/g2-graph';
import { curveOf, keyContent } from './helpers/m2a-a4';
import { seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-M2A-16 (FR-GE-18, FR-GE-19; M2A-SPEC §5.15.1–2): buffer curves snapshot and swap a curve back and forth (values
// and tangents restored exactly, new key IDs); the normalized and stacked views draw the same data differently and
// change nothing in the document; in the stacked view every key is on the canvas.
test('E2E-M2A-16: buffer curves and views', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seed = await seedWaveClip(page);
  await expect.poll(async () => (await call(page, 'graph'))?.visibleCurves.includes(seed.rz) ?? false).toBe(true);
  const snapshot = keyContent(await curveOf(page, seed.clip, seed.control, 'rz'));

  await page.getByTestId('ge-buffer-snapshot').click();
  await expect.poll(async () => (await call(page, 'graph'))?.buffers ?? []).toContain(seed.rz);

  // Edit key@15 to −45°.
  await clickKey(page, (await rzKeyAt(page, seed, 15)).id, 'key@15');
  await typeField(page, 'ge-field-value', '-45');
  await expect.poll(async () => (await rzKeyAt(page, seed, 15)).v).toBeCloseTo(-45 * DEG, 9);
  const edited = keyContent(await curveOf(page, seed.clip, seed.control, 'rz'));
  expect((await call(page, 'graph'))?.buffers).toContain(seed.rz);

  // First swap: the snapshot (values and tangents); second swap: the edit.
  await page.getByTestId('ge-buffer-swap').click();
  await expect.poll(async () => keyContent(await curveOf(page, seed.clip, seed.control, 'rz'))).toEqual(snapshot);
  expect((await call(page, 'state')).history.undoLabel).toBe('Swap Buffer Curves');
  await page.getByTestId('ge-buffer-swap').click();
  await expect.poll(async () => keyContent(await curveOf(page, seed.clip, seed.control, 'rz'))).toEqual(edited);

  // View switches leave the document deep-equal.
  const curves = await call(page, 'curves', seed.clip);
  await page.getByTestId('ge-view-normalized').click();
  await expect.poll(async () => (await call(page, 'graph'))?.viewMode).toBe('normalized');
  expect(await call(page, 'curves', seed.clip)).toEqual(curves);
  await page.getByTestId('ge-view-stacked').click();
  await expect.poll(async () => (await call(page, 'graph'))?.viewMode).toBe('stacked');
  expect(await call(page, 'curves', seed.clip)).toEqual(curves);
  const graph = await call(page, 'graph');
  if (graph === null) throw new Error('no Graph Editor');
  const rect = graph.canvasRect;
  for (const curve of curves.filter((c) => graph.visibleCurves.includes(c.id))) {
    for (const key of curve.keys) {
      const p = await pointOf(page, () => call(page, 'screenOfKey', key.id), `key ${key.id} in the stacked view`);
      expect(p.x).toBeGreaterThanOrEqual(rect.x - 0.5);
      expect(p.x).toBeLessThanOrEqual(rect.x + rect.w + 0.5);
      expect(p.y).toBeGreaterThanOrEqual(rect.y - 0.5);
      expect(p.y).toBeLessThanOrEqual(rect.y + rect.h + 0.5);
    }
  }
  await page.getByTestId('ge-view-absolute').click();
  await expect.poll(async () => (await call(page, 'graph'))?.viewMode).toBe('absolute');
  expect(await call(page, 'curves', seed.clip)).toEqual(curves);
});
