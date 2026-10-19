import { expect, type Page, test } from '@playwright/test';
import { clickComponent, MODEL_PANE, openModel, screenOf } from './helpers/m6a-model';
import {
  areaOf,
  centroidOf,
  faceCorners,
  hoverPane,
  markingMenuSlot,
  mode,
  paneRect,
  pressOver,
  setLastOpField,
  undoLabels,
  undoOver,
} from './helpers/m6a-model-select-ui';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-02 "Mac without F-keys" (M6A-SPEC §10.1; owner B10): E2E-MOD-01 on `platform=mac` with the trackpad
// navigation profile — modes by the RMB mode menu and the digits (no F-key is pressed), Extrude through ⌘E, key
// labels in ⌘ form. Gates (§3 rule 4): b3 (extrude), b7 (primitives, runtimes), b11 (the primitives menu, numeric
// capture, the Last-op card).

/** The face whose centroid is highest (+Y): the cube's top. */
async function topFace(page: Page, mesh: string): Promise<number> {
  const faces = await call(page, 'meshFaces', mesh);
  const positions = await call(page, 'meshPositions', mesh);
  let best = -1;
  let bestY = Number.NEGATIVE_INFINITY;
  faces.forEach((verts, f) => {
    const y = verts.reduce((sum, v) => sum + (positions[v]?.[1] ?? 0), 0) / verts.length;
    if (y > bestY) {
      bestY = y;
      best = f;
    }
  });
  return best;
}

test.fixme('b3, b7, b11: E2E-MOD-02 — modes by RMB and digits, Extrude through ⌘E (platform=mac, trackpad)', async ({
  page,
}) => {
  await openModel(page, '&platform=mac&nav=trackpad');
  // Shift+RMB on empty space → the primitives menu's N slot (Cube).
  const rect = await paneRect(page, MODEL_PANE);
  const empty = { x: rect.x + 60, y: rect.y + rect.h - 60 };
  await page.keyboard.down('Shift');
  await markingMenuSlot(page, empty, 'model.primitives', 'N');
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await call(page, 'meshes')).length).toBe(1);
  const cube = (await call(page, 'meshes'))[0]?.id as string;
  await expect.poll(async () => (await call(page, 'meshInfo', cube))?.counts).toMatchObject({ v: 8, e: 12, f: 6 });

  // RMB on the cube → the mode menu's S slot (Face).
  await pressOver(page, 'KeyF'); // frame the (selected) cube at the pane centre
  await markingMenuSlot(page, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, 'model.modes', 'S');
  await expect.poll(() => mode(page)).toBe('face');

  // The digits: 1 vertex, 2 edge, 3 face, 3 again → object (no F-key is pressed in this test).
  for (const [key, expected] of [
    ['Digit1', 'vertex'],
    ['Digit2', 'edge'],
    ['Digit3', 'face'],
    ['Digit3', 'object'],
  ] as const) {
    await pressOver(page, key);
    await expect.poll(() => mode(page)).toBe(expected);
  }

  // E2E-MOD-01 through ⌘E: face mode, the top face, ⌘E, 0.5, Enter; Divisions 2; one undo.
  await pressOver(page, 'Digit3');
  await expect.poll(() => mode(page)).toBe('face');
  const manifest = (await call(page, 'meshInfo', cube))?.manifest;
  const top = await topFace(page, cube);
  const before = centroidOf(await faceCorners(page, cube, top));
  await screenOf(page, cube, 'face', top);
  await clickComponent(page, cube, 'face', top);
  await hoverPane(page);
  await expect(page.getByTestId('helpline-text')).toContainText('⌘E');
  await page.keyboard.press('Meta+KeyE');
  await page.keyboard.type('0.5');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await call(page, 'meshInfo', cube))?.counts).toMatchObject({ v: 12, e: 20, f: 10 });
  // The extrude results of E2E-MOD-01: the top face (same index) at y = 1.0, moved by (0, 0.5, 0), area 1.0 (1e-6:
  // float32 positions).
  const corners = await faceCorners(page, cube, top);
  expect(corners).toHaveLength(4);
  for (const [, y] of corners) expect(y).toBeCloseTo(1, 6);
  const after = centroidOf(corners);
  expect(after.map((value, k) => value - (before[k] as number))).toEqual([
    expect.closeTo(0, 6),
    expect.closeTo(0.5, 6),
    expect.closeTo(0, 6),
  ]);
  expect(areaOf(corners)).toBeCloseTo(1, 6);
  const card = await call(page, 'lastOpCard');
  expect(card?.title).toBe('Extrude');
  // The card names its shortcut in the platform's labels (§10.1: "the card and help line show ⌘E"), as text or as
  // the tooltip of one of its parts. Soft: it still fails the test, and the rest of the scenario still reports.
  const cardLabels = (): Promise<string> =>
    page
      .getByTestId(`lastop-card-${MODEL_PANE}`)
      .evaluate((el) =>
        [
          el.textContent ?? '',
          ...[el, ...el.querySelectorAll('[title]')].map((e) => e.getAttribute('title') ?? ''),
        ].join(' '),
      );
  await expect.configure({ soft: true }).poll(cardLabels, { message: 'the Last-op card shows ⌘E' }).toContain('⌘E');
  expect(card?.fields.find((field) => field.name === 'localTranslateZ')?.text).toBe('0.500 m');
  const steps = (await undoLabels(page)).length;
  // Divisions 2 through the card (expanded from its pill); the field gives the keyboard back before the undo.
  await setLastOpField(page, 'divisions', '2');
  await expect.poll(async () => (await call(page, 'meshInfo', cube))?.counts).toMatchObject({ v: 16, e: 28, f: 14 });
  expect((await undoLabels(page)).length).toBe(steps);
  await undoOver(page);
  await expect.poll(async () => (await call(page, 'meshInfo', cube))?.counts).toMatchObject({ v: 8, e: 12, f: 6 });
  expect((await call(page, 'meshInfo', cube))?.manifest).toBe(manifest);
  await runOk(page, 'select.mode', { mode: 'object' });
});
