import { expect, type Page, test } from '@playwright/test';
import { clickOutlinerRow, DEG, keysOf } from './helpers/g3-input';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-27 (MVP-SPEC §6.2; §4.11.8): one scene clock (30 fps), two characters with their own clips — Seed-san's at
// 24 fps, Polybot's starting at scene frame 6. Scene frame 30 is clip frame 24 of both; switching the active
// character changes the frames the UI shows, never the scene clock.

/** Keys `fk.lowerArm.L` rz of the active character at clip frames 0 / 24 / 48 (degrees), then returns its id. */
async function keyLowerArm(page: Page, character: string, rz24: number): Promise<string> {
  const control = await controlId(page, 'fk.lowerArm.L', character);
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  expect((await call(page, 'state')).activeCharacter).toBe(character);
  for (const [frame, degrees] of [
    [0, 0],
    [24, rz24],
    [48, 0],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    expect((await call(page, 'state')).clipFrame).toBe(frame);
    await runOk(page, 'channel.setValues', { edits: [{ control, channel: 'rz', value: degrees * DEG }] });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  expect((await keysOf(page, control, 'rz')).map((key) => key.t)).toEqual([0, 24, 48]);
  return control;
}

test('E2E-27: scene clock, two characters', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seedSan = (await seedSample(page, 'seed-san')).character;
  const polybot = (await seedSample(page, 'polybot')).character;
  expect((await call(page, 'counts'))['characters']).toBe(2);

  // Seed-san's clip at 24 fps (keep seconds: range 0–60 → 0–48); Polybot's clip starts at scene frame 6.
  const seedSanClip = (await call(page, 'clips', seedSan))[0];
  const polybotClip = (await call(page, 'clips', polybot))[0];
  if (seedSanClip === undefined || polybotClip === undefined) throw new Error('a sample without a clip');
  await runOk(page, 'clip.setSettings', { clip: seedSanClip.id, fps: { num: 24, den: 1 } });
  await runOk(page, 'clip.setSettings', { clip: polybotClip.id, sceneStart: 6 });
  expect((await call(page, 'clips', seedSan)).map((clip) => [clip.fps, clip.start, clip.end, clip.sceneStart])).toEqual(
    [[24, 0, 48, 0]],
  );
  expect((await call(page, 'clips', polybot)).map((clip) => [clip.fps, clip.start, clip.end, clip.sceneStart])).toEqual(
    [[30, 0, 60, 6]],
  );

  // Key each character at its clip frame 24 (and 0 / 48 around it, so the pose shows which frame is evaluated).
  const seedSanArm = await keyLowerArm(page, seedSan, 40);
  const polybotArm = await keyLowerArm(page, polybot, -40);

  // Scene frame 30 (from elsewhere on the clock).
  await runOk(page, 'time.setFrame', { frame: 0, unit: 'scene' });
  await runOk(page, 'time.setFrame', { frame: 30, unit: 'scene' });
  const polybotState = await call(page, 'state');
  expect([polybotState.activeCharacter, polybotState.sceneFrame, polybotState.clipFrame]).toEqual([polybot, 30, 24]);
  await expect(page.getByTestId('timeline-frame-field')).toHaveValue('24');

  // Switch the active character with an Outliner click on Seed-san's control: the scene clock stays at 30.
  await clickOutlinerRow(page, seedSanArm);
  await expect.poll(async () => (await call(page, 'state')).activeCharacter).toBe(seedSan);
  const seedSanState = await call(page, 'state');
  expect([seedSanState.sceneFrame, seedSanState.clipFrame]).toEqual([30, 24]);
  await expect(page.getByTestId('timeline-frame-field')).toHaveValue('24');

  // Each character evaluates its own clip at its own clip frame 24.
  expect((await call(page, 'channelValues', seedSanArm)).rz).toBeCloseTo(40 * DEG, 12);
  expect((await call(page, 'channelValues', polybotArm)).rz).toBeCloseTo(-40 * DEG, 12);

  // And back: switching to Polybot keeps the scene frame too.
  await clickOutlinerRow(page, polybotArm);
  await expect.poll(async () => (await call(page, 'state')).activeCharacter).toBe(polybot);
  const back = await call(page, 'state');
  expect([back.sceneFrame, back.clipFrame]).toEqual([30, 24]);
});
