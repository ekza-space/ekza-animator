// ha-J10 Resume after a reload or from autosave (STUDIO-TOUCH-SPEC §9 J10, §17, §6.7 `recovery`, AS-ST-4 "J10 ≤ 1";
// T11): a tab that reloads while a project is open comes back to it silently — the same document, stage, time and
// selection, with *Back where you were* — in **0 touches**, and never shows the Recovery dialog. Any other unsaved work
// (a closed tab) is Home › **Continue** — **1 touch**. One storage namespace (`ns=`) across the pages, as a real
// browser keeps its storage.
import { expect, test } from '@playwright/test';
import { halo, openHalo } from './helpers/halo';
import { press, t11, touches } from './helpers/halo-share';
import { call, runOk, waitForTestApi } from './helpers/test-api';

test('ha-J10: a reload while a project is open restores it silently — 0 touches, no Recovery dialog', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const ns = `ha-j10-a-${info.workerIndex}-${Date.now().toString(36)}`;
  await openHalo(page, `&ns=${ns}`);
  await press(page, 'halo-home-sample', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await runOk(page, 'autorig.clip.add', {
    character,
    clip: 'walk',
    params: { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 },
  });
  await runOk(page, 'time.setFrame', { frame: 9 });
  const control = (await call(page, 'controls'))[1]?.id ?? '';
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  const counts = await call(page, 'counts');
  const stage = (await halo(page)).stage;
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());
  // this tab remembers its slot (sessionStorage) once the autosave wrote it
  await expect.poll(async () => (await t11(page)).resume?.slot ?? null).not.toBeNull();
  await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());

  await page.reload();
  await waitForTestApi(page);
  // back where it was: the document, the stage, the time, the selection — and nobody tapped
  await expect.poll(async () => (await call(page, 'counts')).characters, { timeout: 60_000 }).toBe(1);
  await expect(page.getByTestId('halo-home')).toHaveCount(0);
  expect(await call(page, 'counts')).toEqual(counts);
  await expect.poll(async () => (await halo(page)).stage).toBe(stage);
  await expect.poll(async () => (await call(page, 'state')).sceneFrame).toBe(9);
  await expect.poll(async () => (await call(page, 'state')).selection.controls).toEqual([control]);
  await expect(page.getByTestId('halo-toasts')).toContainText('Back where you were');
  expect(await touches(page)).toBe(0);
  info.annotations.push({ type: 'J10 touches (reload)', description: String(await touches(page)) });
  await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
  expect((await call(page, 'state')).dialog).toBeNull();
});

test('ha-J10: work left in a closed tab is Home › Continue — 1 touch', async ({ context }, info) => {
  test.setTimeout(180_000);
  const ns = `ha-j10-b-${info.workerIndex}-${Date.now().toString(36)}`;
  const first = await context.newPage();
  await openHalo(first, `&ns=${ns}`);
  await press(first, 'halo-home-sample', info);
  await expect(first.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  const character = (await call(first, 'characters'))[0]?.id ?? '';
  await runOk(first, 'autorig.clip.add', {
    character,
    clip: 'walk',
    params: { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 },
  });
  const counts = await call(first, 'counts');
  await first.evaluate(() => window.__EKZA_STUDIO_TEST__?.flushAutosave());
  // the tab goes away without saving (iPadOS discards it); its snapshot is an orphan for the next page
  await first.close({ runBeforeUnload: false });

  // a new tab (its own sessionStorage): Home lists the work; one tap continues it
  const page = await context.newPage();
  await openHalo(page, `&ns=${ns}`);
  const card = page.getByTestId('halo-home-continue-card').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(/polybot/i);
  await expect(card).toContainText('1 character · 2 animations');
  await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
  // Continue is first and filled; Try a sample is no longer the primary door (§4.2 A)
  await expect(card).toHaveClass(/bg-accent/);
  await expect(page.getByTestId('halo-home-sample')).not.toHaveClass(/bg-accent /);
  await press(page, 'halo-home-continue-card', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await call(page, 'counts')).characters).toBe(1);
  expect(await call(page, 'counts')).toEqual(counts);
  expect(await touches(page)).toBe(1);
  info.annotations.push({ type: 'J10 touches (continue)', description: String(await touches(page)) });
  await expect.poll(async () => (await halo(page)).stage).toBe('animate');
});
