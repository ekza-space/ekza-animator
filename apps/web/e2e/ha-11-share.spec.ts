// ha-11 Share (STUDIO-TOUCH-SPEC §13.3, wireframe F, §7.3, J1 steps 6–8, J6 step 3, AS-ST-5, AS-ST-13, S9, ST-33; T11):
// destination first; choosing a card prepares its file at once and the export button names the file it writes; that
// tap delivers it (a download on Chrome, the iOS share sheet — mocked on WebKit, the device check is D11); the bytes
// are Studio Pro's for the same document (the same request run through the test API right after); **an export never
// clears the unsaved dot**, only *Save project to Files* does; the OMOBA card fixes the licence (an explicit choice,
// none pre-selected) and the author in place; made for an OMOBA hero it writes C2's package. Green on `chrome-touch`
// (and `chrome`); the two-step save and the storage card on `webkit-ipad` with a mocked share.
import { expect, type Page, test, type TestInfo } from '@playwright/test';
import { rigCubeLad } from './helpers/ar-host';
import { halo, openHalo } from './helpers/halo';
import { isWebkit, mockShare, press, shareSettled, sharedFiles, t11, touches, unsavedDot } from './helpers/halo-share';
import { call, lastExport, runOk } from './helpers/test-api';

/** Polybot (an imported VRM) with the library's Walk in its slot. */
async function polybotWithWalk(page: Page, info: TestInfo): Promise<string> {
  await press(page, 'halo-home-sample', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await runOk(page, 'autorig.clip.add', {
    character,
    clip: 'walk',
    params: { speed: 1, trim: null, mirror: false, inPlace: false, armSpace: 0 },
  });
  return character;
}

async function openShare(page: Page, info: TestInfo): Promise<void> {
  await press(page, 'halo-share', info);
  await expect(page.getByTestId('halo-sheet-share')).toBeVisible();
  await expect.poll(async () => (await halo(page)).sheet).toBe('share');
}

/** Delivers the prepared file from the export button; on Chrome it is a download (returns its name). */
async function exportFile(page: Page, info: TestInfo): Promise<string | null> {
  const button = page.getByTestId('halo-share-export');
  await expect(button).toBeEnabled({ timeout: 60_000 });
  if (isWebkit(info)) {
    await button.tap();
    return null;
  }
  const download = page.waitForEvent('download');
  await (info.project.name === 'chrome' ? button.click() : button.tap());
  return (await download).suggestedFilename();
}

test('ha-11: Just exploring offers the project save; the destinations name their file; Share counts one touch', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  if (isWebkit(info)) await mockShare(page);
  await openHalo(page);
  await polybotWithWalk(page, info);
  const before = await touches(page);
  await openShare(page, info);
  expect(await touches(page)).toBe(before + 1);
  // the default destination is Just exploring (ST-4): nothing to export, the project save is the primary action
  await expect(page.getByTestId('halo-share-exploring')).toBeVisible();
  await expect(page.getByTestId('halo-share-export')).toHaveCount(0);
  await expect(page.getByTestId('halo-share-save')).toBeVisible();
  for (const id of ['omoba', 'engine', 'animations', 'prop', 'original', 'exploring']) {
    await expect(page.getByTestId(`halo-share-dest-${id}`)).toBeVisible();
  }
  // a destination: its file is prepared at once and the button names it
  await press(page, 'halo-share-dest-animations', info);
  const settled = await shareSettled(page);
  expect(settled).toMatchObject({ status: 'ready', fileName: 'polybot-walk.vrma' });
  await expect(page.getByTestId('halo-share-export')).toHaveText('Export polybot-walk.vrma to Files');
  // the badge on Share ⤴ (§7.3)
  await expect(page.getByTestId('halo-share-badge')).toHaveText('VRMA');
});

test('ha-11: an export writes Studio Pro’s bytes and never clears the unsaved dot; Save project does', async ({
  page,
}, info) => {
  test.skip(isWebkit(info), 'the WebKit two-step save has its own test below');
  test.setTimeout(180_000);
  await openHalo(page);
  const character = await polybotWithWalk(page, info);
  expect(await unsavedDot(page)).toBe(true);
  await openShare(page, info);
  await press(page, 'halo-share-dest-omoba', info);
  expect(await shareSettled(page)).toMatchObject({ status: 'ready', fileName: 'polybot.vrm' });
  const name = await exportFile(page, info);
  expect(name).toBe('polybot.vrm');
  await expect.poll(async () => (await t11(page)).share?.delivered).toBe('downloaded');
  await expect(page.getByTestId('halo-toasts')).toContainText('Exported polybot.vrm');
  await expect(page.getByTestId('halo-toasts')).toContainText('Also save the project');
  // the export is the project's unsaved state's business: the dot stays (ST-33)
  expect(await unsavedDot(page)).toBe(true);
  expect((await call(page, 'state')).dirty).toBe(true);
  // AS-ST-5 in the browser: Studio Pro's request for the same file writes the same bytes
  await expect.poll(async () => (await lastExport(page))?.sha256 ?? '').not.toBe('');
  const halos = await lastExport(page);
  expect(halos?.fileName).toBe('polybot.vrm');
  // Pro's Export dialog: the bake of the animated clips (Walk; the sample's empty first clip stays unticked) through
  // the OMOBA profile, its default options
  const walk = (await call(page, 'clips', character)).find((clip) => clip.name === 'Walk');
  await runOk(page, 'file.export', {
    kind: 'bake-into-model',
    character,
    clips: [walk?.id],
    fileNamePattern: '{character}',
    closeLoop: walk?.loop === true,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: 'ekza/space-avatar-v1',
    reduce: { positionM: 0.0002, rotationCapRad: 0.004363323129985824, minLeverM: 0.01, scaleRel: 1e-4 },
  });
  await expect.poll(async () => (await lastExport(page))?.fileName).toBe('Polybot.vrm');
  const pros = await lastExport(page);
  expect(pros?.fileName).toBe('Polybot.vrm');
  expect(pros?.sha256).toBe(halos?.sha256);
  // the project save clears it (Share's footer)
  const download = page.waitForEvent('download');
  await press(page, 'halo-share-save', info);
  expect((await download).suggestedFilename()).toMatch(/\.ekzanim$/);
  await expect.poll(() => unsavedDot(page)).toBe(false);
});

test('ha-11: OMOBA for a model character — the licence is an explicit choice, the author asked once, Pro’s bytes', async ({
  page,
}, info) => {
  test.skip(isWebkit(info), 'Chrome: the bytes; WebKit: the two-step save below');
  test.setTimeout(180_000);
  await openHalo(page);
  const { character } = await rigCubeLad(page);
  await runOk(page, 'skin.bind', {});
  await runOk(page, 'library.useClip', { character, clip: 'walk' });
  await openShare(page, info);
  await press(page, 'halo-share-dest-omoba', info);
  // no licence yet: none is chosen for the person (Q-SKIN-3); the export is blocked by Studio's own gate
  const licence = page.getByTestId('halo-share-licence');
  await expect(licence).toContainText('Licence: choose one');
  await expect(page.getByTestId('halo-share-licence-cc0')).not.toHaveAttribute('data-checked', /.*/);
  const blocked = await shareSettled(page);
  expect(blocked.status).toBe('blocked');
  await expect(page.getByTestId('halo-share-export')).toHaveText('Fix the list above to export');
  // fixed in place: the licence (one tap) and the author (one filled field)
  await press(page, 'halo-share-licence-cc0', info);
  const author = page.getByTestId('halo-share-author');
  await (isWebkit(info) || info.project.name === 'chrome' ? author.click() : author.tap());
  await author.fill('Tester');
  await author.press('Enter');
  await expect.poll(async () => (await t11(page)).share?.status, { timeout: 60_000 }).toBe('ready');
  const file = (await t11(page)).share?.fileName ?? '';
  expect(file).toMatch(/\.vrm$/);
  await expect(page.getByTestId('halo-share-export')).toHaveText(`Export ${file} to Files`);
  await exportFile(page, info);
  await expect.poll(async () => (await lastExport(page))?.sha256 ?? '').not.toBe('');
  const halos = await lastExport(page);
  // Studio Pro's Character section request for the same document
  const record = (await call(page, 'characters')).find((c) => c.id === character);
  await runOk(page, 'file.exportCharacter', {
    character,
    fileName: record?.name ?? '',
    format: 'vrm',
    profile: 'ekza/space-avatar-v1',
    clips: 'slots',
    includeProps: null,
    material: null,
    thumbnail: 'stored',
    validate: true,
  });
  expect((await lastExport(page))?.sha256).toBe(halos?.sha256);
  // remembered for the next character (asked once)
  expect(await page.evaluate(() => localStorage.getItem('ekza-studio:halo:author:v1'))).toBe('Tester');
});

test('ha-11: made for an OMOBA hero, the OMOBA card writes C2’s package; its slots are listed', async ({
  page,
}, info) => {
  test.skip(isWebkit(info), 'Chrome only');
  test.setTimeout(180_000);
  await openHalo(page);
  const { character } = await rigCubeLad(page);
  await runOk(page, 'skin.bind', {});
  await runOk(page, 'char.setVrmMeta', { character, patch: { authors: ['Tester'], licensePreset: 'cc0' } });
  await openShare(page, info);
  await press(page, 'halo-share-dest-omoba', info);
  await expect(page.getByTestId('halo-share-card')).toHaveAttribute('data-call', 'file.exportCharacter');
  await press(page, 'halo-share-target-choose', info);
  await press(page, 'halo-share-hero-wildspark', info);
  await expect(page.getByTestId('halo-share-card')).toHaveAttribute('data-call', 'target.exportPackage', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('halo-share-target-hero')).toContainText('Wildspark');
  await expect(page.getByTestId('halo-share-slots').locator('li').first()).toBeVisible();
  // a slot's animation in one tap (the game default's copy, C2's settings)
  await page.getByTestId('halo-share-slot-make').first().click();
  await expect.poll(async () => (await call(page, 'clips', character)).length, { timeout: 30_000 }).toBeGreaterThan(0);
});

test('ha-11 (WebKit): the two-step save — the file waits, a fresh tap shares it; Save project offers the storage card', async ({
  page,
}, info) => {
  test.skip(!isWebkit(info), 'the iPad path (iOS WebKit with Web Share): webkit-ipad');
  test.setTimeout(180_000);
  await mockShare(page);
  await openHalo(page);
  await polybotWithWalk(page, info);
  await openShare(page, info);
  await press(page, 'halo-share-dest-animations', info);
  // step one happened with the card: the file is prepared and nothing has left the page yet
  expect(await shareSettled(page)).toMatchObject({ status: 'ready', fileName: 'polybot-walk.vrma', delivered: null });
  expect(await sharedFiles(page)).toEqual([]);
  // step two: the export button's fresh tap shares it
  await press(page, 'halo-share-export', info);
  await expect.poll(async () => (await sharedFiles(page)).map((f) => f.name)).toEqual(['polybot-walk.vrma']);
  await expect(page.getByTestId('halo-toasts')).toContainText('Shared · iPad does not confirm where it went');
  await expect.poll(async () => (await t11(page)).share?.delivered).toBe('shared');
  expect(await unsavedDot(page)).toBe(true);
  // Save project to Files: the host's save prompt holds it, a tap shares it, the dot clears, the storage card shows
  await press(page, 'halo-share-save', info);
  await expect(page.getByTestId('save-prompt')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('save-prompt-deliver').tap();
  await expect.poll(async () => (await sharedFiles(page)).length).toBe(2);
  expect((await sharedFiles(page))[1]?.name).toMatch(/\.ekzanim$/);
  await expect.poll(() => unsavedDot(page)).toBe(false);
  await expect(page.getByTestId('halo-share-storage')).toHaveAttribute('data-card', 'keep');
  expect((await t11(page)).storage).toBe('keep');
});
