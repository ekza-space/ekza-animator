import { expect, type TestInfo, test } from '@playwright/test';
import { animate, centreOf, dockedPetal, loadSample, touches } from './helpers/halo-animate';
import { halo, openHalo } from './helpers/halo';
import { call } from './helpers/test-api';
import { fingerDrag, fingerTap } from './helpers/touch';

// ha-J5 Mix animations from the library (STUDIO-TOUCH-SPEC §9 J5, §10.6, §22 AS-ST-4; T7 exit test), `chrome-touch`,
// from a fresh project with the real defaults: Library › tap Walk (it plays on the character, the chrome stays live)
// › expand the card › ⟨Speed⟩ scrub › Stay in place › Add — at most 6 touches; then the left/right pair: tap the new
// chip › Duplicate ▾ › + swap sides — 9 with the pair.

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

test('ha-J5: a library animation with its speed and in place in ≤ 6 touches, the pair in ≤ 9', async ({
  page,
}, testInfo) => {
  touchOnly(testInfo);
  test.setTimeout(120_000);
  await openHalo(page);
  await loadSample(page, 'seed-san');
  const before = (await animate(page)).animations;
  const base = await touches(page);

  // Library › tap Walk (2): it previews on the character; the Thread stays live under the sheet
  await fingerTap(page, await centreOf(page, 'halo-library'));
  await expect(page.getByTestId('halo-sheet-library')).toBeVisible();
  await expect(page.getByTestId('halo-library-card-walk')).toBeVisible({ timeout: 20_000 });
  expect((await halo(page)).sheet).toBe('library');
  await fingerTap(page, await centreOf(page, 'halo-library-preview-walk'));
  await expect.poll(async () => (await animate(page)).preview).toBe('walk');
  await expect(page.getByTestId('halo-thread-play')).toBeEnabled();

  // expand the card › Speed scrub › Stay in place › Add (4)
  await fingerTap(page, await centreOf(page, 'halo-library-expand-walk'));
  await expect(page.getByTestId('halo-library-params-walk')).toBeVisible();
  const speed = await centreOf(page, 'halo-library-speed-walk');
  await fingerDrag(page, speed, { x: speed.x + 60, y: speed.y }, 10);
  await expect
    .poll(async () => Number(await page.getByTestId('halo-library-speed-walk').getAttribute('aria-valuenow')))
    .toBeGreaterThan(1);
  await fingerTap(page, await centreOf(page, 'halo-library-inplace-walk'));
  await expect(page.getByTestId('halo-library-inplace-walk')).toHaveAttribute('aria-pressed', 'true');
  await fingerTap(page, await centreOf(page, 'halo-library-add-walk'));
  await expect.poll(async () => (await animate(page)).animations.length).toBe(before.length + 1);
  const added = (await animate(page)).animations.find((name) => !before.includes(name)) ?? '';
  const six = (await touches(page)) - base;
  testInfo.annotations.push({ type: 'touches', description: `J5: ${six} touches` });
  expect(six).toBeLessThanOrEqual(6);
  // one Use Clip step with the card's parameters (speed above 1, in place)
  expect((await call(page, 'history')).undo.at(-1)).toMatch(/Use Clip/);
  const record = (await call(page, 'clips')).find((clip) => clip.name === added);
  expect(record).toBeDefined();

  // the left/right pair: the new chip › Duplicate ▾ › + swap sides (3)
  // the sheet docks on the right edge and leaves the Animations row live (§4.1)
  const pairBase = await touches(page);
  await fingerTap(page, await centreOf(page, `halo-clip-chip-${added}`));
  await expect(page.getByTestId('halo-docked')).toHaveAttribute('data-noun', 'clip');
  await fingerTap(page, await dockedPetal(page, 'Duplicate'));
  await fingerTap(page, await centreOf(page, 'halo-docked-choice-+ swap sides'));
  await expect.poll(async () => (await animate(page)).animations.length).toBe(before.length + 2);
  await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Mirror Animation');
  const pair = (await touches(page)) - pairBase;
  testInfo.annotations.push({ type: 'touches', description: `J5 pair: ${six + pair} touches` });
  expect(six + pair).toBeLessThanOrEqual(9);
});
