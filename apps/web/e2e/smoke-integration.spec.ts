// WP-10 integration smoke (MVP-SPEC §8.3 demo script, condensed): the production /editor boots the real editor and
// a user can load the bundled samples and their own files (button, picker path, real drag-and-drop), pose and key a
// control with the manipulator and the Channel Box, scrub and play, edit the curve in the Graph Editor, export all
// three kinds through the Export dialog, save the project, reload the page and reopen it. Every interaction is real
// pointer/keyboard input at coordinates from the §4.8 test API; assertions read state through the test API.
// Screenshots of each stage go to .acceptance/integration/ (git-ignored) for a human look.
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { validateBytes } from 'gltf-validator';
import { call, lastExport, loadFile, openEditor, runOk, waitForCount, waitForTestApi } from './helpers/test-api';

const SHOTS = new URL('../../../.acceptance/integration/', import.meta.url);
const DEG = Math.PI / 180;

type Curve = Awaited<ReturnType<typeof readCurves>>[number];

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: new URL(`${name}.png`, SHOTS).pathname });
}

async function readCurves(page: Page, clip: string, control: string) {
  return call(page, 'curves', clip, control);
}

function curveOf(curves: readonly Curve[], channel: string): Curve {
  const curve = curves.find((candidate) => candidate.channel === channel);
  if (curve === undefined) throw new Error(`no ${channel} curve`);
  return curve;
}

/** Polls a test-API point until the panel has drawn it. */
async function pointOf(page: Page, read: () => Promise<{ x: number; y: number } | null>, what: string) {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        point = await read();
        return point !== null;
      },
      { message: `${what} on screen`, timeout: 15_000 },
    )
    .toBe(true);
  return point as unknown as { x: number; y: number };
}

/** Errors in an exported file that its source does not have (MVP-SPEC §4.11.13 surgeon rule). */
async function newValidatorErrors(output: Uint8Array, source: Uint8Array | null): Promise<string[]> {
  const errors = async (bytes: Uint8Array) =>
    (await validateBytes(bytes, { maxIssues: 0, writeTimestamp: false })).issues.messages
      .filter((message) => message.severity === 0)
      .map((message) => `${message.code} ${message.pointer ?? ''}`);
  const before = new Set(source === null ? [] : await errors(source));
  return (await errors(output)).filter((error) => !before.has(error));
}

async function exportThroughDialog(page: Page, kind: string): Promise<{ name: string; bytes: Buffer }> {
  await page.keyboard.press('Meta+KeyE');
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId(`export-kind-${kind}`).click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-confirm').click();
  const file = await download;
  const bytes = readFileSync(await file.path());
  await expect(page.getByTestId('export-lints')).toBeVisible();
  return { name: file.suggestedFilename(), bytes };
}

test('integration smoke: samples, posing, keys, Graph Editor, playback, exports, project round trip', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });

  // ---------- boot: the real editor, WebGL, the empty state ----------
  await openEditor(page, '&platform=mac');
  expect(await page.evaluate(() => window.__EKZA_ANIMATOR_TEST__?.webgl.ok)).toBe(true);
  await expect(page.getByTestId('dropzone')).toBeVisible();
  await shot(page, '01-empty-editor');

  // ---------- sample button: Seed-san (VRM 1.0) in the split view ----------
  await page.getByTestId('sample-seed-san').click();
  await waitForCount(page, 'characters', 1);
  const seedSan = (await call(page, 'characters'))[0]?.id ?? '';
  const panes = [...(await call(page, 'panes'))].sort((a, b) => a.rect.x - b.rect.x);
  expect(panes.map((pane) => [pane.id, pane.camera, pane.locked])).toEqual([
    ['pane-left', 'shot', true],
    ['pane-right', 'persp', false],
  ]);
  expect((await call(page, 'controls')).filter((control) => control.visible).length).toBeGreaterThanOrEqual(50);
  const rightPane = panes[1]?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
  const overViewport = { x: rightPane.x + 40, y: rightPane.y + 40 };
  const elbow = await pointOf(page, () => call(page, 'screenOfControl', 'fk.lowerArm.L', 'pane-right'), 'elbow');
  await shot(page, '02-seed-san-loaded');

  // ---------- pick, rotate with the manipulator, key with S ----------
  const lowerArm = (await call(page, 'controls')).find((control) => control.key === 'fk.lowerArm.L')?.id ?? '';
  await page.mouse.click(elbow.x, elbow.y);
  expect((await call(page, 'state')).selection.controls).toEqual([lowerArm]);
  await page.keyboard.press('KeyE');
  expect((await call(page, 'state')).tool).toBe('rotate');
  const ring = await pointOf(page, () => call(page, 'screenOfManipulator', 'pane-right', 'rz'), 'rz ring');
  await page.mouse.move(ring.x, ring.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(ring.x + step * 10, ring.y);
  await page.mouse.up();
  const posed = (await call(page, 'channelValues', lowerArm)).rz ?? 0;
  expect(Math.abs(posed)).toBeGreaterThan(0.05);
  await page.mouse.move(overViewport.x, overViewport.y);
  await page.keyboard.press('KeyS');
  const clip = (await call(page, 'state')).activeClip ?? '';
  await expect.poll(async () => curveOf(await readCurves(page, clip, lowerArm), 'rz').keys.length).toBe(1);
  await shot(page, '03-posed-and-keyed');

  // ---------- scrub the time slider, type in the Channel Box, key again ----------
  const keyAt = async (frame: number, degrees: number) => {
    const at = await pointOf(page, () => call(page, 'screenOfFrame', frame), `frame ${frame}`);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(frame);
    const field = page.getByTestId('cb-field-rz');
    await field.fill(String(degrees));
    await field.press('Enter');
    await page.mouse.move(overViewport.x, overViewport.y);
    await page.keyboard.press('KeyS');
  };
  await keyAt(15, -40);
  await keyAt(30, 30);
  await expect
    .poll(async () => curveOf(await readCurves(page, clip, lowerArm), 'rz').keys.map((key) => key.t))
    .toEqual([0, 15, 30]);
  const rz = curveOf(await readCurves(page, clip, lowerArm), 'rz');
  expect(rz.keys[1]?.v).toBeCloseTo(-40 * DEG, 9);
  expect(await call(page, 'screenOfTick', 15)).not.toBeNull();
  await shot(page, '04-three-keys');

  // ---------- Graph Editor: double-click the curve, tangent types, break + pen handle, undo ----------
  const onCurve = await pointOf(page, () => call(page, 'screenOfCurve', rz.id, 7.5), 'rz curve');
  await page.mouse.move(onCurve.x, onCurve.y);
  await page.mouse.dblclick(onCurve.x, onCurve.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys.length).toBe(3);
  await page.keyboard.press('Digit4');
  const [v0, v15] = [rz.keys[0]?.v ?? 0, rz.keys[1]?.v ?? 0];
  await expect.poll(async () => call(page, 'curveValue', rz.id, 7.5)).toBeCloseTo((v0 + v15) / 2, 9);
  await page.keyboard.press('Digit1');
  await shot(page, '05-graph-curve-selected');

  const key15 = rz.keys[1]?.id ?? '';
  const keyPoint = await pointOf(page, () => call(page, 'screenOfKey', key15), 'key@15');
  await page.mouse.click(keyPoint.x, keyPoint.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys).toEqual([key15]);
  await page.keyboard.press('KeyB');
  const broken = curveOf(await readCurves(page, clip, lowerArm), 'rz');
  expect(broken.keys[1]?.broken).toBe(true);
  const handle = await pointOf(page, () => call(page, 'screenOfHandle', key15, 'out'), 'out handle of key@15');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let step = 1; step <= 4; step++) await page.mouse.move(handle.x, handle.y - step * 10);
  await page.mouse.up();
  const dragged = curveOf(await readCurves(page, clip, lowerArm), 'rz');
  expect(dragged.keys[1]?.outType).toBe('fixed');
  expect(dragged.keys[1]?.inType).toBe(broken.keys[1]?.inType);
  expect((await call(page, 'state')).history.undoLabel).toBe('Edit Tangent');
  await shot(page, '06-graph-pen-handle');
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => curveOf(await readCurves(page, clip, lowerArm), 'rz')).toEqual(broken);

  // ---------- playback: play, let it run, stop ----------
  const startFrame = (await call(page, 'state')).sceneFrame;
  await page.getByTestId('timeline-play').click();
  await expect.poll(async () => (await call(page, 'state')).playing).toBe(true);
  await page.waitForTimeout(500);
  await shot(page, '07-playing');
  await page.getByTestId('timeline-play').click();
  await expect.poll(async () => (await call(page, 'state')).playing).toBe(false);
  expect((await call(page, 'state')).sceneFrame).not.toBe(startFrame);

  // ---------- exports through the Export dialog (bake into VRM, VRMA, animation-only GLB) ----------
  const source = new Uint8Array(readFileSync(new URL('../public/samples/seed-san.vrm', import.meta.url)));
  const baked = await exportThroughDialog(page, 'bake-into-model');
  expect(baked.name).toMatch(/\.vrm$/);
  expect(baked.bytes.subarray(0, 4).toString('latin1')).toBe('glTF');
  expect(await newValidatorErrors(new Uint8Array(baked.bytes), source)).toEqual([]);
  await shot(page, '08-export-bake');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toBeHidden();

  const vrma = await exportThroughDialog(page, 'vrma');
  expect(vrma.name).toMatch(/\.vrma$/);
  expect(await newValidatorErrors(new Uint8Array(vrma.bytes), null)).toEqual([]);
  await page.keyboard.press('Escape');

  const animationGlb = await exportThroughDialog(page, 'animation-glb');
  expect(animationGlb.name).toMatch(/\.glb$/);
  expect(await newValidatorErrors(new Uint8Array(animationGlb.bytes), null)).toEqual([]);
  await page.keyboard.press('Escape');

  // ---------- save the project (Mod+S), reload the page, open it again ----------
  const before = { counts: await call(page, 'counts'), curves: await call(page, 'curves', clip) };
  const saving = page.waitForEvent('download');
  await page.keyboard.press('Meta+KeyS');
  const savedFile = await saving;
  expect(savedFile.suggestedFilename()).toMatch(/\.ekzanim$/);
  const saved = readFileSync(await savedFile.path());
  expect((await lastExport(page))?.bytes.equals(saved)).toBe(true);

  await page.reload();
  await waitForTestApi(page);
  expect((await call(page, 'counts'))['characters']).toBe(0);
  await loadFile(page, savedFile.suggestedFilename(), new Uint8Array(saved));
  await waitForCount(page, 'characters', 1);
  expect(await call(page, 'counts')).toEqual(before.counts);
  expect(await call(page, 'curves', clip)).toEqual(before.curves);
  await pointOf(page, () => call(page, 'screenOfControl', 'fk.lowerArm.L', 'pane-right'), 'reopened rig');
  await shot(page, '09-project-reopened');

  // ---------- the user's own files: UAL through the import dialog, Polybot by drag-and-drop ----------
  const ual = new Uint8Array(readFileSync(new URL('../public/samples/quaternius-ual.glb', import.meta.url)));
  await loadFile(page, 'quaternius-ual.glb', ual);
  const importDialog = page.getByTestId('import-dialog');
  await expect(importDialog).toBeVisible();
  await page.getByTestId('import-clips-none').click();
  const idle = page.getByRole('checkbox', { name: /^Idle_Loop / });
  await expect(idle).toHaveAttribute('data-testid', /^import-clip-\d+$/);
  await idle.check();
  await shot(page, '10-import-dialog-ual');
  await page.getByTestId('import-confirm').click();
  await waitForCount(page, 'characters', 2);
  const ualId = (await call(page, 'state')).activeCharacter ?? '';
  const ualClips = await call(page, 'clips', ualId);
  expect(ualClips.map((c) => [c.name, c.fps])).toEqual([['Idle_Loop', 24]]);

  const dataTransfer = await page.evaluateHandle(async () => {
    const bytes = await (await fetch('/samples/polybot.vrm')).arrayBuffer();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'polybot.vrm', { type: 'model/gltf-binary' }));
    return transfer;
  });
  await page.dispatchEvent('[data-testid="editor-root"]', 'dragenter', { dataTransfer });
  await page.dispatchEvent('[data-testid="editor-root"]', 'dragover', { dataTransfer });
  await page.dispatchEvent('[data-testid="editor-root"]', 'drop', { dataTransfer });
  await expect(page.getByTestId('import-format-badge')).toHaveText('VRM 0.x');
  await page.getByTestId('import-confirm').click();
  await waitForCount(page, 'characters', 3);
  const polybot = (await call(page, 'state')).activeCharacter ?? '';

  // The exported VRMA plays on Polybot (MVP-SPEC §8.3 item 10): dropped while Polybot is active, it becomes a clip.
  await loadFile(page, vrma.name, new Uint8Array(vrma.bytes));
  await expect.poll(async () => (await call(page, 'clips', polybot)).length).toBe(2);
  await runOk(page, 'view.frame', { what: 'all', paneId: 'pane-right' });
  await expect.poll(async () => (await call(page, 'characters')).map((c) => c.id)).toContain(seedSan);
  await shot(page, '11-three-characters');

  expect(problems).toEqual([]);
});
