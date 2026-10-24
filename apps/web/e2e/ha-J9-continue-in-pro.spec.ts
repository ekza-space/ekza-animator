// ha-J9 Continue the same project in Studio Pro (STUDIO-TOUCH-SPEC §9 J9, §16.1, §16.2, AS-ST-4 "J9 ≤ 2 on iPad (1 on
// desktop)", AS-ST-6; T11): on the same page ▤ Pro layout opens Pro on the matching workspace with the same document,
// undo history, selection and time — one touch with a mouse and keyboard, two on a touch-only iPad (the one line *Studio
// Pro is laid out for a mouse and keyboard* first, then *Open anyway*). Another device: project menu › *Save project
// to Files* (two touches) writes the `.ekzanim`, and Studio Pro opens it with the same document. Counted with the
// test API's touch counter (`halo().touches`) while Halo is mounted; the tap that leaves for Pro is the last one.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { documentState, expectStudioShown, markPage, pageMark } from './helpers/ar-host';
import { halo, openHalo } from './helpers/halo';
import { isTouch, isWebkit, press, touches } from './helpers/halo-share';
import { call, loadFile, openEditor, runOk } from './helpers/test-api';

test('ha-J9: ▤ Pro layout continues on the same page — ≤ 2 touches on the iPad, 1 with a mouse', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await openHalo(page, '&firstRun=1');
  await press(page, 'halo-home-sample', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  // a little work: a library animation (undo history), a time, a selection
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await runOk(page, 'autorig.clip.add', {
    character,
    clip: 'walk',
    params: { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 },
  });
  await runOk(page, 'time.setFrame', { frame: 12 });
  const control = (await call(page, 'controls'))[0]?.id ?? '';
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  const before = await documentState(page);
  const workspace = (await call(page, 'state')).workspace;
  await markPage(page);

  const start = await touches(page);
  await press(page, 'halo-pro-layout', info);
  let taps = 1;
  // a touch-only device first says Pro is laid out for a mouse and keyboard (§16.1)
  const line = page.getByTestId('halo-pro-line');
  if (await line.isVisible().catch(() => false)) {
    expect(await touches(page)).toBe(start + 1);
    await expect(line).toContainText('Studio Pro is laid out for a mouse and keyboard');
    await press(page, 'halo-pro-open', info);
    taps += 1;
  }
  await expectStudioShown(page);
  info.annotations.push({ type: 'J9 touches', description: `${taps} (${info.project.name})` });
  expect(taps).toBeLessThanOrEqual(isTouch(info) ? 2 : 1);
  if (!isTouch(info)) expect(taps).toBe(1);
  // the same page, the same project: document, undo history, selection, time; Pro on the matching workspace
  expect(await pageMark(page)).toBe('kept');
  expect(await documentState(page)).toEqual(before);
  expect((await call(page, 'state')).workspace).toBe(workspace);
  expect((await call(page, 'state')).selection.controls).toEqual([control]);
  expect((await call(page, 'state')).sceneFrame).toBe(12);
  await expect(page).toHaveURL(new RegExp(`/editor\\?e2e=1&firstRun=1&ws=${workspace}&from=halo$`));
  // Pro's own first-run dialog stays away for a page that came from Halo
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
  // undo still works across the switch
  await runOk(page, 'edit.undo');
  expect((await call(page, 'history')).redo).toEqual(['Use Clip Walk']);
});

test('ha-J9: another device — Save project to Files (2 touches), then Studio Pro opens the same project', async ({
  page,
  browser,
}, info) => {
  test.skip(isWebkit(info), 'the iPad save is the two-step share (ha-11); the file opens on a computer here');
  test.setTimeout(180_000);
  await openHalo(page);
  await press(page, 'halo-home-sample', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await runOk(page, 'autorig.clip.add', {
    character,
    clip: 'walk',
    params: { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 },
  });
  const counts = await call(page, 'counts');
  const start = await touches(page);
  const download = page.waitForEvent('download');
  await press(page, 'halo-project', info);
  await press(page, 'halo-project-save', info);
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/\.ekzanim$/);
  // the menu tap and *Save project to Files*: J9's other device (2), both made here
  info.annotations.push({ type: 'J9 other device touches', description: '2' });
  expect((await touches(page)) - start).toBeLessThanOrEqual(2);
  await expect.poll(async () => (await call(page, 'state')).dirty).toBe(false);
  const path = await saved.path();
  const bytes = new Uint8Array(readFileSync(path));

  // "on the desktop, drop the file or Open": a fresh Studio Pro page opens it with the same document
  const desktop = await browser.newPage();
  await openEditor(desktop);
  await loadFile(desktop, saved.suggestedFilename(), bytes);
  await expect.poll(async () => (await call(desktop, 'counts')).characters).toBe(counts['characters']);
  expect((await call(desktop, 'counts')).clips).toBe(counts['clips']);
  expect((await call(desktop, 'clips', (await call(desktop, 'characters'))[0]?.id)).map((c) => c.name)).toContain(
    'Walk',
  );
  await desktop.close();
  expect((await halo(page)).stage).toBe('animate');
});
