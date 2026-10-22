import { expect, test } from '@playwright/test';
import {
  displayed,
  documentMarks,
  firstPane,
  hoverViewport,
  libraryRequests,
  openClipLibrary,
  POLYBOT_NODE,
  previewClip,
  samePosition,
} from './helpers/m6b-clip-library';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-LIB-01 (M6B-SPEC §0.7, §0.4.7; C12): preview on an imported VRM. Polybot in Animate; Windows › Clip Library
// fetches only the manifest; play Walk (badge `PREVIEW Walk`), then Death, then Stop → bone worlds change while playing
// and return to the Animate pose after Stop; the history, the keys hash, the record counts and the dirty flag stay
// unchanged; Esc stops; a keying attempt (S) stops the preview first and keys the Animate value, not the preview's.

test('E2E-LIB-01: preview on an imported VRM', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  expect((await call(page, 'state')).workspace).toBe('animate');
  const requests = libraryRequests(page);

  // Opening the library fetches the manifest only (no clip file).
  await openClipLibrary(page);
  await expect.poll(() => requests.paths).toEqual(['/library/animations/starter-pack.json']);
  await expect.poll(async () => (await call(page, 'library'))?.clips.length ?? 0).toBe(14);
  await expect(page.getByTestId('clip-library-character')).toContainText('Character:');

  const marks = await documentMarks(page);
  const pane = await firstPane(page);
  // The displayed model (what the viewport draws): the preview drives it, the document does not change.
  const hand = () => displayed(page, character, POLYBOT_NODE.leftHand);
  const rest = await hand();

  // Play Walk: the badge shows in Animate, the arm moves and keeps moving.
  await page.getByTestId('clip-play-walk').click();
  await expect.poll(() => previewClip(page)).toBe('walk');
  await expect(page.getByTestId(`hud-badge-preview-${pane}`)).toHaveText('PREVIEW Walk');
  await expect.poll(async () => samePosition(await hand(), rest)).toBe(false);
  const first = await hand();
  await expect.poll(async () => samePosition(await hand(), first)).toBe(false);
  expect(requests.paths).toEqual(['/library/animations/starter-pack.json', '/library/animations/walk.vrma']);

  // Death: the card switches the preview; the hips go down.
  const hips = () => displayed(page, character, POLYBOT_NODE.hips);
  const hipsRest = await displayed(page, character, POLYBOT_NODE.hips);
  await page.getByTestId('clip-play-death').click();
  await expect.poll(() => previewClip(page)).toBe('death');
  await expect(page.getByTestId(`hud-badge-preview-${pane}`)).toHaveText('PREVIEW Death');
  await expect.poll(async () => (await hips())[1] < hipsRest[1] - 0.1, { timeout: 10_000 }).toBe(true);

  // Stop (a second click on the playing card): the Animate pose is back, the badge is gone.
  await page.getByTestId('clip-play-death').click();
  await expect.poll(() => previewClip(page)).toBeNull();
  await expect(page.getByTestId(`hud-badge-preview-${pane}`)).toHaveCount(0);
  await expect.poll(async () => samePosition(await hand(), rest)).toBe(true);
  expect(await documentMarks(page)).toEqual(marks);

  // Esc stops.
  await page.getByTestId('clip-play-idle').click();
  await expect.poll(() => previewClip(page)).toBe('idle');
  await hoverViewport(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => previewClip(page)).toBeNull();
  expect(await documentMarks(page)).toEqual(marks);

  // A keying attempt during a preview: the preview stops first and S keys the Animate value.
  // Keys need a clip: Polybot comes without one, so make an empty one first (an edit, before the preview).
  await runOk(page, 'clip.new', { character });
  const elbow = await controlId(page, 'fk.lowerArm.L');
  await runOk(page, 'select.controls', { ids: [elbow], mode: 'replace' });
  const animate = await call(page, 'channelValues', elbow);
  await page.getByTestId('clip-play-walk').click();
  await expect.poll(() => previewClip(page)).toBe('walk');
  await expect.poll(async () => samePosition(await hand(), rest)).toBe(false);
  await hoverViewport(page);
  await page.keyboard.press('KeyS');
  await expect.poll(() => previewClip(page)).toBeNull();
  const clip = (await call(page, 'state')).activeClip ?? '';
  await expect
    .poll(async () => (await call(page, 'curves', clip, elbow)).filter((c) => c.keys.length > 0).length)
    .toBeGreaterThan(0);
  const keyed = await call(page, 'curves', clip, elbow);
  for (const curve of keyed) {
    for (const key of curve.keys) {
      expect(key.v, `${curve.channel} keyed from the Animate pose`).toBeCloseTo(animate[curve.channel] ?? 0, 9);
    }
  }
  expect((await call(page, 'history')).undo.at(-1)).toBe('Set Key');
});
