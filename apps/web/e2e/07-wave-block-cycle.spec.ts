import { expect, type Page, test } from '@playwright/test';
import { clickFrame, clickOutlinerRow, DEG, keysOf, pointOf, pressOverPane, typeChannel } from './helpers/g3-input';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor } from './helpers/test-api';

// E2E-07 (MVP-SPEC §6.2): block a wave with the Outliner, the Channel Box and S, cycle it with the Graph Editor's
// post-infinity, then play it: frame 45 repeats frame 15, playback advances and wraps at the end of the loop.

/** Samples the clip frame on every animation frame for `ms` milliseconds (page side). */
function sampleFrames(page: Page, ms: number): Promise<number[]> {
  return page.evaluate(
    (duration) =>
      new Promise<number[]>((resolve) => {
        const frames: number[] = [];
        const start = performance.now();
        const tick = (): void => {
          const state = window.__EKZA_ANIMATOR_TEST__?.state();
          if (state?.clipFrame !== null && state?.clipFrame !== undefined) frames.push(state.clipFrame);
          if (performance.now() - start < duration) requestAnimationFrame(tick);
          else resolve(frames);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

test('E2E-07: wave block + cycle', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const lowerArm = await controlId(page, 'fk.lowerArm.L');

  // Select fk.lowerArm.L in the Outliner.
  await clickOutlinerRow(page, lowerArm);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([lowerArm]);

  // rz 30 at 0, −30 at 15, 30 at 30: typed in the Channel Box, keyed with S over the viewport.
  for (const [frame, degrees] of [
    [0, 30],
    [15, -30],
    [30, 30],
  ] as const) {
    await clickFrame(page, frame);
    await typeChannel(page, 'rz', degrees);
    await expect.poll(async () => (await call(page, 'channelValues', lowerArm)).rz ?? 0).toBeCloseTo(degrees * DEG, 9);
    await pressOverPane(page, 'KeyS');
    await expect
      .poll(async () => (await keysOf(page, lowerArm, 'rz')).find((key) => key.t === frame)?.v ?? Number.NaN)
      .toBeCloseTo(degrees * DEG, 9);
  }

  // Keys at 0/15/30 (S keys the three rotation channels together, §4.11.1 rule 2).
  for (const channel of ['rx', 'ry', 'rz']) {
    expect(
      (await keysOf(page, lowerArm, channel)).map((key) => key.t),
      channel,
    ).toEqual([0, 15, 30]);
  }
  expect((await keysOf(page, lowerArm, 'rz')).map((key) => key.v / DEG)).toEqual([
    expect.closeTo(30, 9),
    expect.closeTo(-30, 9),
    expect.closeTo(30, 9),
  ]);

  // Graph Editor post-infinity → Cycle (the selected control's curves).
  await page.getByTestId('graph-infinity-post').selectOption('cycle');
  const clip = (await call(page, 'state')).activeClip ?? '';
  await expect
    .poll(async () => (await call(page, 'curves', clip, lowerArm)).map((curve) => curve.post))
    .toEqual(['cycle', 'cycle', 'cycle']);
  expect((await call(page, 'state')).history.undoLabel).toBe('Set Infinity');

  const rz = (await call(page, 'curves', clip, lowerArm)).find((curve) => curve.channel === 'rz');
  if (rz === undefined) throw new Error('no rz curve');
  const at15 = await call(page, 'curveValue', rz.id, 15);
  expect(at15).toBeCloseTo(-30 * DEG, 9);
  expect(Math.abs(((await call(page, 'channelValues', lowerArm, 45)).rz ?? Number.NaN) - at15)).toBeLessThanOrEqual(
    1e-9,
  );
  // The cycle repeats the whole block past its last key, not just frame 45.
  for (const frame of [31, 37.5, 52, 59]) {
    const cycled = (await call(page, 'channelValues', lowerArm, frame)).rz ?? Number.NaN;
    expect(Math.abs(cycled - (await call(page, 'curveValue', rz.id, frame - 30))), `frame ${frame}`).toBeLessThan(1e-9);
  }

  // Play 1 s from frame 0, then stop: the frame advanced.
  await clickFrame(page, 0);
  const play = page.getByTestId('timeline-play');
  await play.click();
  await expect.poll(async () => (await call(page, 'state')).playing).toBe(true);
  await page.waitForTimeout(1_000);
  await play.click();
  await expect.poll(async () => (await call(page, 'state')).playing).toBe(false);
  const stopped = (await call(page, 'state')).clipFrame ?? 0;
  expect(stopped).toBeGreaterThan(0);
  // `stop` keeps the current frame (Maya), and the pose there is the cycled curve's.
  await page.waitForTimeout(200);
  expect((await call(page, 'state')).clipFrame).toBe(stopped);
  const pose = (await call(page, 'channelValues', lowerArm)).rz ?? Number.NaN;
  expect(Math.abs(pose - (await call(page, 'curveValue', rz.id, stopped)))).toBeLessThan(1e-9);

  // Loop wraps: from frame 50 of the 0–60 clip, one second of playback passes the end and comes back to the start.
  const range = (await call(page, 'clips')).find((candidate) => candidate.id === clip);
  expect(range?.end).toBe(60);
  await clickFrame(page, 50);
  await play.click();
  const frames = await sampleFrames(page, 1_200);
  await play.click();
  await expect.poll(async () => (await call(page, 'state')).playing).toBe(false);
  const wrap = frames.findIndex((frame, index) => index > 0 && frame < (frames[index - 1] ?? 0));
  expect(wrap, `frames seen: ${frames.join(' ')}`).toBeGreaterThan(0);
  expect(frames.slice(0, wrap).every((frame) => frame >= 50 && frame < 60)).toBe(true);
  expect(frames.slice(wrap).every((frame) => frame >= 0 && frame < 50)).toBe(true);
  expect(frames.at(-1) ?? 60).toBeLessThan(50);
  await pointOf(page, () => call(page, 'screenOfTick', 15), 'key tick at 15');
});
