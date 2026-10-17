import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedWaveClip } from './helpers/seed';
import {
  call,
  fixmeIfKernelUnavailable,
  lastExport,
  loadFile,
  openEditor,
  runOk,
  waitForTestApi,
} from './helpers/test-api';

// E2E-19 (MVP-SPEC §6.2): save the wave project, reload the page, open the saved .ekzanim; records, curves and
// evaluated values come back unchanged.
const FRAMES = [0, 7, 15, 22, 30] as const;

test('E2E-19: project round trip', async ({ page }) => {
  await openEditor(page);
  await fixmeIfKernelUnavailable(page);
  const seed = await seedWaveClip(page);

  const valuesAt = async () => {
    const values: Record<string, number>[] = [];
    for (const frame of FRAMES) values.push(await call(page, 'channelValues', seed.control, frame));
    return values;
  };
  const before = {
    counts: await call(page, 'counts'),
    curves: await call(page, 'curves', seed.clip),
    values: await valuesAt(),
  };

  const download = page.waitForEvent('download');
  const saved = await runOk<{ fileName: string; bytes: number }>(page, 'file.save');
  const file = await download;
  expect(file.suggestedFilename()).toBe(saved.fileName);
  expect(saved.fileName).toMatch(/\.ekzanim$/);
  const bytes = readFileSync(await file.path());
  expect(bytes.byteLength).toBe(saved.bytes);
  // lastExport() records saves too (the same download path).
  const last = await lastExport(page);
  expect(last?.fileName).toBe(saved.fileName);
  expect(last?.bytes.equals(bytes)).toBe(true);
  await expect
    .poll(async () => (await lastExport(page))?.sha256)
    .toBe(createHash('sha256').update(bytes).digest('hex'));

  await page.reload();
  await waitForTestApi(page);
  expect((await call(page, 'counts'))['characters']).toBe(0);
  await loadFile(page, saved.fileName, new Uint8Array(bytes));

  expect(await call(page, 'counts')).toEqual(before.counts);
  expect(await call(page, 'curves', seed.clip)).toEqual(before.curves);
  // The session is not part of the file: make the wave clip active again before reading values.
  await runOk(page, 'clip.setActive', { clip: seed.clip });
  expect(await valuesAt()).toEqual(before.values);
});
