// ha-01 Home and intake (STUDIO-TOUCH-SPEC §4.2 A, §17, §9 J1 step 1, J2 step 1, §15 rows 11.1–11.3, S10; T11): the first
// open is Home — no modal, no first-run or Recovery dialog; one sentence, three doors (*Try a sample* filled when
// there is nothing to continue), *Rig a model for me*, the gesture line, ▤ Pro layout. *Bring a model* sniffs the bytes
// (a GLB named `.bin` still opens as a model) and routes through the shared intake of `editor-core/autorigFlow`: a
// static model waits in Rig for *Rig it for me ▸*, a VRM is a character in Animate, an animation needs a model, an
// unknown file says so. *Make a character* has three starts. A document that holds something asks before a new
// project. Green on `chrome-touch` (and `chrome`); boots on `webkit-ipad`.
import { expect, test } from '@playwright/test';
import { halo, openHalo } from './helpers/halo';
import { isWebkit, press, touches } from './helpers/halo-share';
import { fixtureBytes } from './helpers/ar-model';
import { call } from './helpers/test-api';

const file = (name: string, bytes: Buffer, mimeType = 'application/octet-stream') => ({
  name,
  mimeType,
  buffer: bytes,
});

test('ha-01: the first open is Home — three doors, no modal; Try a sample is the filled door', async ({ page }) => {
  await openHalo(page, '&firstRun=1');
  const home = page.getByTestId('halo-home');
  await expect(home).toBeVisible();
  await expect(home).toContainText('Make, rig and animate 3D characters. Nothing is uploaded.');
  for (const id of ['halo-home-sample', 'halo-home-bring', 'halo-home-make', 'halo-home-autorig', 'halo-pro-layout']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // nothing to continue: Try a sample is the primary door (§4.2 A)
  await expect(page.getByTestId('halo-home-continue')).toHaveCount(0);
  await expect(page.getByTestId('halo-home-sample')).toHaveClass(/bg-accent/);
  await expect(home).toContainText('two-finger tap = undo');
  // no first-run dialog, no Recovery dialog (§17)
  await page.waitForTimeout(300);
  await expect(page.getByTestId('firstrun-dialog')).toHaveCount(0);
  await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
  expect((await call(page, 'state')).dialog).toBeNull();
  // every target is at least 44 pt
  for (const id of ['halo-home-sample', 'halo-home-bring', 'halo-home-make', 'halo-home-sample-more']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
  }
});

test('ha-01: Try a sample opens Polybot on the canvas in one touch', async ({ page }, info) => {
  test.setTimeout(120_000);
  await openHalo(page);
  await press(page, 'halo-home-sample', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await call(page, 'counts')).characters).toBe(1);
  expect(await touches(page)).toBe(1);
  await expect.poll(async () => (await halo(page)).stage).toBe('animate');
});

test('ha-01: Bring a model sniffs the bytes and routes a static model to Rig (J1 step 1: 2 touches)', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await openHalo(page);
  // iOS pickers carry no `accept` (S10): every file can be picked, the bytes decide
  const accept = await page.getByTestId('halo-home-file').getAttribute('accept');
  if (isWebkit(info)) expect(accept).toBeNull();
  else expect(accept).toContain('.vrm');
  // the picker: one tap on the door, the file chosen in Files (the second touch of J1 step 1)
  const chooser = page.waitForEvent('filechooser');
  await press(page, 'halo-home-bring', info);
  // a name that hides the kind: the bytes decide (S10)
  await (await chooser).setFiles([file('scan.bin', fixtureBytes('cube-lad.glb'))]);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await halo(page)).stage, { timeout: 30_000 }).toBe('rig');
  expect((await call(page, 'counts')).meshes).toBeGreaterThan(0);
  expect((await call(page, 'history')).undo).toEqual(['Import Static Model']);
  expect(await touches(page)).toBe(1);
  // the Next chip is the step after (J1 step 3)
  await expect.poll(async () => (await halo(page)).slices['t6b']).toMatchObject({ next: 'rigIt' });
});

test('ha-01: Bring a model — a VRM is a character to animate; an animation needs a model; unknown bytes say so', async ({
  page,
}, info) => {
  test.skip(isWebkit(info), 'the Files picker is a device check (D2)');
  test.setTimeout(120_000);
  await openHalo(page);
  const pick = async (files: ReturnType<typeof file>[]): Promise<void> => {
    const chooser = page.waitForEvent('filechooser');
    await press(page, 'halo-home-bring', info);
    await (await chooser).setFiles(files);
  };
  // an animation before any model
  await pick([file('dance.vrma', fixtureBytes('../../apps/web/public/library/animations/dance.vrma'))]);
  await expect(page.getByTestId('halo-toasts')).toContainText('This is an animation. Bring a model first');
  // bytes that are no model
  await pick([file('notes.vrm', Buffer.from('hello, this is not a model'))]);
  await expect(page.getByTestId('halo-toasts')).toContainText('This file is not a 3D model or an Ekza Studio project');
  await expect(page.getByTestId('halo-home')).toBeVisible();
  // a VRM (named without an extension): a character, in Animate
  await pick([file('Polybot', fixtureBytes('polybot.vrm'))]);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await call(page, 'counts')).characters).toBe(1);
  await expect.poll(async () => (await halo(page)).stage).toBe('animate');
});

test('ha-01: Make a character offers three starts; Smooth body opens in Make (J2 step 1: 2 touches)', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await openHalo(page);
  await press(page, 'halo-home-make', info);
  const starts = page.getByTestId('halo-home-starts');
  await expect(starts.getByRole('button')).toHaveCount(3);
  await press(page, 'halo-home-start-smooth', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await halo(page)).stage).toBe('make');
  await expect.poll(async () => (await call(page, 'counts')).meshes).toBe(1);
  expect(await touches(page)).toBe(2);
});

test('ha-01: the other samples — the Cube Lad is a model to rig, in Rig', async ({ page }, info) => {
  test.skip(isWebkit(info), 'one sample load on WebKit is enough (above)');
  test.setTimeout(120_000);
  await openHalo(page);
  await press(page, 'halo-home-sample-more', info);
  await expect(page.getByTestId('halo-home-samples').getByRole('button')).toHaveCount(3);
  await press(page, 'halo-home-sample-cube-lad', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await halo(page)).stage).toBe('rig');
  expect((await call(page, 'counts')).characters).toBe(0);
  expect((await call(page, 'counts')).meshes).toBeGreaterThan(0);
});

test('ha-01: with something in the project, Bring a model asks first (new project, or add to this one)', async ({
  page,
}, info) => {
  test.skip(isWebkit(info), 'the Files picker is a device check (D2)');
  test.setTimeout(120_000);
  await openHalo(page);
  await press(page, 'halo-home-sample', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  // back to Home through the project menu, then Bring a model
  await press(page, 'halo-project', info);
  await page.getByTestId('halo-project-menu').getByRole('menuitem', { name: 'Home', exact: true }).click();
  await expect(page.getByTestId('halo-home')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await press(page, 'halo-home-bring', info);
  await (await chooser).setFiles([file('cube-lad.glb', fixtureBytes('cube-lad.glb'))]);
  await expect(page.getByTestId('halo-home-question')).toBeVisible();
  await press(page, 'halo-home-add', info);
  await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
  // added: Polybot stays and the Cube Lad's meshes came in
  await expect.poll(async () => (await call(page, 'counts')).characters).toBe(1);
  expect((await call(page, 'counts')).meshes).toBeGreaterThan(0);
});
