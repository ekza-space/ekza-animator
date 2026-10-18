import { expect, test } from '@playwright/test';
import { glbJson, humanoidNode, quaternionDelta, readFixture, restWorld } from './helpers/g1-viewport';
import { seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-02 (MVP-SPEC §6.2): a freshly loaded Seed-san is at its rest pose: every control's translate and rotate
// channel is 0, and the evaluated hips sit exactly where the glTF scene graph puts them (§4.11.9, rig zero pose).
const TR_CHANNELS = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'] as const;

test('E2E-02: rest pose integrity', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');

  const controls = await call(page, 'controls');
  expect(controls.length).toBeGreaterThan(0);
  const nonZero: string[] = [];
  for (const control of controls) {
    const values = await call(page, 'channelValues', control.id);
    for (const channel of TR_CHANNELS) {
      const value = values[channel];
      if (value === undefined || Math.abs(value) !== 0) nonZero.push(`${control.key}.${channel}=${value}`);
    }
  }
  expect(nonZero).toEqual([]);

  const source = glbJson(readFixture('models/seed-san.vrm'));
  const expected = restWorld(source, humanoidNode(source, 'hips'));
  const hips = await call(page, 'boneWorld', character, 'hips');
  const translationError = Math.max(...expected.t.map((value, i) => Math.abs((hips.t[i] ?? Number.NaN) - value)));
  expect(translationError).toBeLessThanOrEqual(1e-6);
  expect(quaternionDelta(hips.q, expected.q)).toBeLessThanOrEqual(1e-6);
});
