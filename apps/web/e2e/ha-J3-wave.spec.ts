import { expect, type Page, type TestInfo, test } from '@playwright/test';
import {
  animate,
  centreOf,
  controlFree,
  dockedPetal,
  loadSample,
  ringPoint,
  rulerPoint,
  touches,
} from './helpers/halo-animate';
import { halo, openHalo, PANE, selectedControls } from './helpers/halo';
import { call } from './helpers/test-api';
import { fingerDrag, fingerTap } from './helpers/touch';

// ha-J3 Pose and key a two-second wave (STUDIO-TOUCH-SPEC §9 J3, §22 AS-ST-4; T7 exit test), `chrome-touch`, from a
// fresh project with the real defaults (Rec on): Animate on Seed-san › + New › "Wave" › 2 s; tap the right upper arm,
// drag its ring (Rec keys it at 0 s); tap 0.5 s on the ruler, tap the forearm, drag; 1.0 s, drag; 1.5 s, drag; tap the
// Wave chip › Loop it › ▶. At most 15 touches, counted by the test API's touch counter.

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

/** Drags the manipulator's free ring by 70 px sideways (one touch). */
async function turnRing(page: Page): Promise<void> {
  const ring = await ringPoint(page);
  await fingerDrag(page, ring, { x: ring.x + 70, y: ring.y + 10 }, 10);
}

test('ha-J3: pose and key a two-second wave in ≤ 15 touches', async ({ page }, testInfo) => {
  touchOnly(testInfo);
  test.setTimeout(120_000);
  await openHalo(page);
  await loadSample(page, 'seed-san');
  expect((await animate(page)).thread.rec).toBe(true);
  // Rec is the shell's override of Auto Key, every channel (§10.2)
  expect((await animate(page)).thread).toMatchObject({ autoKey: true, autoKeyMode: 'all' });
  const base = await touches(page);
  const control = async (name: string): Promise<string> => {
    const found = (await call(page, 'controls')).find((c) => c.name === name);
    if (found === undefined) throw new Error(`no ${name}`);
    return found.id;
  };
  const upper = await control('R Upper Arm');
  const forearm = await control('R Lower Arm');

  // 1. + New › name › 2 s (3)
  await fingerTap(page, await centreOf(page, 'halo-new'));
  await expect(page.getByTestId('halo-new-animation')).toBeVisible();
  await fingerTap(page, await centreOf(page, 'halo-new-name'));
  await page.keyboard.type('Wave');
  await fingerTap(page, await centreOf(page, 'halo-new-length-2'));
  await expect.poll(async () => (await animate(page)).active).toBe('Wave');
  const slice = await animate(page);
  expect(slice.thread.range).toEqual({ start: 0, end: 60 });
  expect(slice.thread.frame).toBe(0);

  // 2. tap the right upper arm, drag its ring: a key at 0 s (2)
  await fingerTap(page, await controlFree(page, 'R Upper Arm'));
  await expect.poll(() => selectedControls(page)).toEqual([upper]);
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('rotate');
  await turnRing(page);
  const clip = async (): Promise<string> => (await call(page, 'state')).activeClip ?? '';
  const keyTimes = async (id: string): Promise<number[]> => {
    const curves = await call(page, 'curves', await clip(), id);
    return [...new Set(curves.filter((c) => c.channel.startsWith('r')).flatMap((c) => c.keys.map((k) => k.t)))].sort(
      (a, b) => a - b,
    );
  };
  await expect.poll(() => keyTimes(upper)).toEqual([0]);

  // 3. 0.5 s › forearm › drag; 1.0 s › drag; 1.5 s › drag (7)
  await fingerTap(page, await rulerPoint(page, 15));
  await expect.poll(async () => (await animate(page)).thread.frame).toBe(15);
  await fingerTap(page, await controlFree(page, 'R Lower Arm'));
  await expect.poll(() => selectedControls(page)).toEqual([forearm]);
  await turnRing(page);
  await expect.poll(() => keyTimes(forearm)).toEqual([15]);
  for (const frame of [30, 45]) {
    await fingerTap(page, await rulerPoint(page, frame));
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(frame);
    await turnRing(page);
    await expect.poll(async () => (await keyTimes(forearm)).includes(frame)).toBe(true);
  }
  expect(await keyTimes(forearm)).toEqual([15, 30, 45]);
  // the Thread shows the forearm's keys
  expect((await animate(page)).thread.dots.map((d) => d.frame)).toEqual([15, 30, 45]);

  // 4. the Wave chip › Loop it › ▶ (3)
  await fingerTap(page, await centreOf(page, 'halo-clip-chip-Wave'));
  await expect(page.getByTestId('halo-docked')).toHaveAttribute('data-noun', 'clip');
  await fingerTap(page, await dockedPetal(page, 'Loop it'));
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Make Loop "Wave"');
  await fingerTap(page, await centreOf(page, 'halo-thread-play'));
  await expect.poll(async () => (await animate(page)).thread.playing).toBe(true);

  const used = (await touches(page)) - base;
  testInfo.annotations.push({ type: 'touches', description: `J3: ${used} touches` });
  expect(used).toBeLessThanOrEqual(15);
  // every step was an operator run: the history names them (no store writes from Halo)
  expect((await call(page, 'history')).undo).toEqual(expect.arrayContaining(['New Clip', 'Make Loop "Wave"']));
  expect((await halo(page)).stage).toBe('animate');
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.run('time.stop'));
  void PANE;
});
