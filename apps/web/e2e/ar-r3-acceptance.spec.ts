// Auto-Rig acceptance fix round 3 (D10; DECISIONS-OPEN §M AR-D10-*): a tester ran Auto-Rig on a real 35-part
// low-poly character. Each test replays a reported problem with the UI (drops, clicks, keys) and checks the fix:
// - AR-D10-1/2/8: a 16-part Cube Lad (Maya default names, 5.1 m tall) keeps every part, hands and feet included; an
//   unticked part is hidden and marked, follows *Set height*, and is in place when ticked again; the project, header
//   and VRM are named after the file; ① frames the whole 5 m model (AR-D10-6); ⑤ shows no rig controls (AR-D10-4)
//   and its VRM holds all 16 parts.
// - AR-D10-3: a model whose arms the guess cannot find waits on ② until the arm markers were placed by hand.
// - AR-D10-5: Esc in ③ review turns the motion test off (one click starts it again); an Esc that closes the ⋯ menu
//   leaves the motion test playing.
import { expect, type Page, test } from '@playwright/test';
import { dropModel, exportMeta, nextToMarkers, onStep, primary } from './helpers/ar-as';
import { download, keepExport } from './helpers/ar-export';
import { openAutoRigReady } from './helpers/ar-host';
import { FRONT, hoverPane, quickRig, sampleAtMarkers, selectMarker, wizard } from './helpers/ar-markers';
import { checkRow, report, splitCubeLad } from './helpers/ar-model';
import { autoRig, nudge } from './helpers/ar-rig';
import { glbJson } from './helpers/g1-viewport';
import { validatorErrors } from './helpers/m6b-mvp-script';
import { call } from './helpers/test-api';

const part = (page: Page, id: string) => page.locator(`[data-testid="ar-parts"] [data-part="${id}"]`);
const hiddenObjects = async (page: Page): Promise<string[]> => (await call(page, 'model')).hiddenObjects;

test('AR-D10-1/2/4/8: a 16-part character keeps every part; an unticked part follows the fixes; a clean ⑤', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openAutoRigReady(page);
  await dropModel(page, 'split-lad.glb', new Uint8Array(splitCubeLad({ scale: 3 })));
  const state = await wizard(page);
  const found = (state.intake as { meshes: string[] }).meshes;
  expect(found).toHaveLength(16);
  // AR-D10-1: every part ticked — forearms, hands, shins and feet touch the body through other parts
  expect(state.subject.meshes).toEqual(found);
  await expect(page.getByTestId('ar-parts')).not.toContainText('Looks separate');
  await expect(page.getByTestId('ar-parts-all')).toBeDisabled();
  // AR-D10-8: Maya's default names give way to the file's
  await expect(page.getByTestId('ar-subject-name')).toHaveText('split-lad');
  // AR-D10-6: ①'s view frames the 5.1 m model: the camera looks at its middle from far enough to see all of it (it
  // kept the 1.8 m person's view, showing the shins)
  const framed = async (): Promise<{ distance: number; off: number }> => {
    const camera = await call(page, 'cameraOf', 'pane-persp');
    const [x, y, z, w] = camera.quaternion;
    // the view direction: the camera's −Z turned by its quaternion
    const forward = [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
    const centre = [0, 5.1 / 2, 0];
    const to = centre.map((c, k) => c - (camera.position[k] ?? 0));
    const distance = Math.hypot(...to);
    const cos = to.reduce((sum, v, k) => sum + v * (forward[k] ?? 0), 0) / distance;
    return { distance, off: (Math.acos(Math.min(1, cos)) * 180) / Math.PI };
  };
  await expect.poll(async () => (await framed()).distance, { timeout: 10_000 }).toBeGreaterThan(5.1);
  expect((await framed()).off).toBeLessThan(10);

  // an unticked hand is hidden, marked and left out of the subject
  const hand = (await call(page, 'meshes')).find((mesh) => mesh.name.endsWith(':pCube8'))?.id as string;
  expect(found).toContain(hand);
  await part(page, hand).locator('input').uncheck();
  await expect(part(page, hand)).toHaveAttribute('data-ticked', 'false');
  await expect(part(page, hand)).toContainText('Left out');
  await expect.poll(() => hiddenObjects(page)).toEqual([hand]);
  expect((await wizard(page)).subject.meshes).not.toContain(hand);
  await expect(page.getByTestId('ar-parts-all')).toBeEnabled();

  // AR-D10-2: Set height (5.1 m → 1.70 m) measures the ticked parts and moves the hand with them
  expect((await report(page))?.checks['scale']).toBe('huge');
  await checkRow(page, 'size').locator('[data-fix="scale"]').click();
  await expect.poll(async () => (await report(page))?.checks['scale']).toBe('ok');
  // ticked again (Tick all), the hand is where it belongs: the model is still 1.70 m and every check passes
  await page.getByTestId('ar-parts-all').click();
  await expect.poll(async () => (await wizard(page)).subject.meshes.length).toBe(16);
  await expect.poll(async () => Math.round(((await report(page))?.height ?? 0) * 100)).toBe(170);
  // the scale was measured without the right hand (the bounds' centre a little to the left): centre once more
  await expect.poll(async () => (await report(page))?.checks['centred']).toBe(false);
  await checkRow(page, 'centred').locator('[data-fix="center"]').click();
  await expect.poll(async () => Math.round(((await report(page))?.height ?? 0) * 100)).toBe(170);
  await expect
    .poll(async () => (await report(page))?.checks)
    .toEqual({ centred: true, grounded: true, facing: true, upright: true, scale: 'ok' });
  await expect.poll(() => hiddenObjects(page)).toEqual([]);

  // rigged and exported: the VRM holds all 16 parts; ⑤ draws no rig controls (AR-D10-4)
  await nextToMarkers(page);
  await autoRig(page);
  await primary(page, /Animations/);
  await onStep(page, 'animations');
  await primary(page, /Export|Skip/);
  await onStep(page, 'export');
  const neck = (await call(page, 'controls')).find((control) => control.key === 'fk.neck')?.id as string;
  expect(neck).toBeDefined();
  await expect.poll(() => call(page, 'screenOfControl', neck, 'pane-persp')).toBeNull();
  await exportMeta(page);
  const file = await download(page);
  keepExport('ar-d10-split-lad.vrm', file.bytes);
  expect(file.name).toBe('split-lad.vrm');
  expect(await validatorErrors(file.bytes)).toEqual({ gltf: [], vrm: [] });
  const json = glbJson(file.bytes) as unknown as { meshes: unknown[] };
  expect(json.meshes).toHaveLength(16);
});

test('AR-D10-3: arms the guess cannot find — ① says so, ② waits for the arm markers placed by hand', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openAutoRigReady(page);
  // an armless Cube Lad: it stands, faces +Z and has legs, but there are no arms to find
  await dropModel(page, 'armless.glb', new Uint8Array(splitCubeLad({ omit: [4, 5, 6, 7, 8, 9] })));
  await expect(checkRow(page, 'pose')).toHaveAttribute('data-pose', 'no-arms');
  await expect(checkRow(page, 'pose')).toContainText('Arms not found');
  await nextToMarkers(page);
  await expect(page.getByTestId('ar-markers-notice-humanoid')).toContainText('could not find the arms');
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  await expect(page.getByTestId('ar-status')).toContainText('could not find the arms');
  // Mod+Enter does not rig either
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForTimeout(300);
  expect((await wizard(page)).step).toBe('markers');
  // the shoulder, elbow and wrist placed by hand (a nudge each): Auto-rig is offered
  for (const name of ['shoulder', 'elbow', 'wrist']) {
    await selectMarker(page, name);
    await hoverPane(page, FRONT);
    await nudge(page, 'ArrowDown', 1);
    await expect.poll(async () => (await quickRig(page))?.moved ?? []).toContain(name);
    if (name !== 'wrist') await expect(page.getByTestId('ar-primary')).toBeDisabled();
  }
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
});

test('AR-D10-5: Esc in ③ turns the motion test off; one click starts it; Esc on the ⋯ menu closes only the menu', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await sampleAtMarkers(page, 'cube-lad');
  await autoRig(page);
  const toggle = page.getByTestId('ar-rig-motion-toggle');
  const playing = async (): Promise<string | null> => (await call(page, 'library'))?.preview?.clip ?? null;
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect.poll(playing).not.toBeNull();
  // Esc on the ⋯ menu closes the menu and nothing else
  await page.getByTestId('ar-more').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await playing()).not.toBeNull();
  // Esc stops the preview and turns the test off
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await expect.poll(playing).toBeNull();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle).toContainText('off');
  // one click plays again
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(playing).not.toBeNull();
});
