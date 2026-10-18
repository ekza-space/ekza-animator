import { expect, test } from '@playwright/test';
import { clickKey, DEG, hoverGraph, K_ROT, readRz, rzKeyAt, typeField } from './helpers/g2-graph';
import { seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-12 (MVP-SPEC §6.2, §4.11.4 numeric fields): the Graph Editor's key fields set a key's value, frame and tangent
// angles in display units (degrees, Maya's angle convention with time in seconds).
test('E2E-12: numeric fields', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seed = await seedWaveClip(page);
  const fps = (await call(page, 'clips')).find((clip) => clip.id === seed.clip)?.fps;
  expect(fps).toBe(30);

  // key@15: value −45°, frame 18, out angle 0°.
  const key15 = (await rzKeyAt(page, seed, 15)).id;
  await clickKey(page, key15, 'key@15');
  await typeField(page, 'ge-field-value', '-45');
  await expect.poll(async () => (await rzKeyAt(page, seed, 15)).v).toBeCloseTo(-45 * DEG, 9);
  await typeField(page, 'ge-field-frame', '18');
  await expect.poll(async () => (await readRz(page, seed)).keys.map((key) => key.t)).toEqual([0, 18, 30]);
  await typeField(page, 'ge-field-out-angle', '0');
  await expect.poll(async () => (await rzKeyAt(page, seed, 18)).outType).toBe('fixed');
  const k18 = await rzKeyAt(page, seed, 18);
  expect(k18.id).toBe(key15);
  expect(k18.v).toBeCloseTo(-45 * DEG, 12);
  expect(k18.outHandle.dt).toBeGreaterThan(0);
  expect(Math.abs(k18.outHandle.dv / k18.outHandle.dt)).toBe(0);

  // A key rising from 30° at 30 to 60° at 40; its in angle typed as +30° gives a positive incoming slope.
  await runOk(page, 'time.setFrame', { frame: 40 });
  await runOk(page, 'channel.setValues', { edits: [{ control: seed.control, channel: 'rz', value: 60 * DEG }] });
  await runOk(page, 'key.set', { channels: 'rotate' });
  await expect.poll(async () => (await readRz(page, seed)).keys.map((key) => key.t)).toEqual([0, 18, 30, 40]);
  const key40 = (await rzKeyAt(page, seed, 40)).id;
  expect((await rzKeyAt(page, seed, 40)).v).toBeCloseTo(60 * DEG, 12);
  await hoverGraph(page);
  await page.keyboard.press('KeyA'); // frame all: key@40 lies beyond the view the earlier clicks left
  await clickKey(page, key40, 'key@40');
  await typeField(page, 'ge-field-in-angle', '30');
  await expect.poll(async () => (await rzKeyAt(page, seed, 40)).inType).toBe('fixed');
  const k40 = await rzKeyAt(page, seed, 40);
  expect(k40.inHandle.dt).toBeLessThan(0);
  const inSlope = k40.inHandle.dv / k40.inHandle.dt;
  expect(inSlope).toBeGreaterThan(0);
  expect(inSlope).toBeCloseTo(Math.tan(30 * DEG) / (30 * K_ROT), 9);
});
