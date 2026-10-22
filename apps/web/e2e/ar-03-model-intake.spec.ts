// E2E-AR-03 (AUTORIG-SPEC §10 D3, §5.2, §6.1, §6.2): ① Model through the UI. AS-AR-5 — a Z-up, ×100, off-centre
// Cube Lad fails Upright, Size and Centred; three one-click fixes are three undo steps; then C2's guess on the fixed
// model lies within 0.05 H of the truth; the ① half of AS-AR-7 — a 250,000-triangle file is refused with the
// decimation hint, an 80,000-triangle one warns and Next asks once; the ① half of AS-AR-6 — a sword lying beside a
// textured Polybot is unticked ("Looks separate") and left out of the subject; the ① part of AS-AR-4 — a VRM goes
// straight to ④ and ②/③ say it is already rigged; samples, animations and unsupported files.
import { expect, type Page, test } from '@playwright/test';
import {
  badCubeLad,
  checkRow,
  chooseFile,
  claimedTriangles,
  fixtureBytes,
  gridGlb,
  polybotWithSword,
  report,
  waitForReport,
} from './helpers/ar-model';
import { openAutoRigReady } from './helpers/ar-host';
import { autorig, history } from './helpers/autorig';
import { cubeLadTruth } from './helpers/m6b-cube-lad';
import { call, runOk } from './helpers/test-api';

const fixButton = (page: Page, fix: string) =>
  page.locator(`[data-testid="ar-model-report"] [data-fix="${fix}"]`).first();

test('a sample loads in one undo step; the report, the stepper and the footer follow', async ({ page }) => {
  await openAutoRigReady(page);
  await expect(page.getByTestId('ar-drop-zone')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Model/);
  await expect(page.getByTestId('ar-primary')).toBeDisabled();
  await expect(page.getByTestId('ar-status')).toHaveText('Load a model to begin.');
  expect((await autorig(page))?.reachable).toEqual({
    model: true,
    markers: false,
    rig: false,
    animations: false,
    export: false,
  });

  await page.locator('[data-sample="cube-lad"]').click();
  const state = await waitForReport(page, 'cube-lad.glb');
  expect(state.intake).toMatchObject({
    kind: 'static',
    triangles: 192,
    weight: 'light',
    checks: { centred: true, grounded: true, facing: true, upright: true, scale: 'ok' },
    pose: { kind: 't' },
  });
  expect(state.startPose).toMatchObject({ kind: 't' });
  expect(state.subject.meshes).toHaveLength(1);
  expect(state.done.model).toBe(true);
  expect(state.reachable.markers).toBe(true);
  expect(await history(page)).toEqual({ undo: ['Import Static Model'], redo: [] });
  await expect(page.getByTestId('ar-drop-strip')).toBeVisible();
  await expect(page.getByTestId('ar-subject-name')).toHaveText('Cube Lad');
  // the header renames the subject (a scene mesh before Create Skeleton: `scene.rename`, one undo step)
  await page.getByTestId('ar-subject-name').click();
  const field = page.getByRole('textbox', { name: 'Character name' });
  await expect(field).toBeFocused();
  await field.fill('Lad');
  await field.press('Enter');
  await expect(page.getByTestId('ar-subject-name')).toHaveText('Lad');
  expect((await history(page)).undo).toHaveLength(2);
  await page.getByTestId('ar-undo').click();
  await expect(page.getByTestId('ar-subject-name')).toHaveText('Cube Lad');
  for (const check of ['centred', 'grounded', 'facing', 'upright', 'size']) {
    await expect(checkRow(page, check)).toHaveAttribute('data-ok', 'true');
  }
  await expect(checkRow(page, 'pose')).toContainText('T-pose');
  await expect(page.getByTestId('ar-status')).toHaveText('The model is ready for the markers.');
  // ① works in Rig & Skin (§4.2), Object mode
  expect((await call(page, 'state')).workspace).toBe('rig');

  // Next goes to ② (a placeholder until D4 lands it); Back returns; the stepper marks ① done
  await page.getByTestId('ar-primary').click();
  await expect.poll(async () => (await autorig(page))?.step).toBe('markers');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Markers/);
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page.locator('[data-step="model"]')).toHaveAttribute('data-done', 'true');
  await page.getByRole('button', { name: /Back/ }).click();
  await expect.poll(async () => (await autorig(page))?.step).toBe('model');
  // stepping never undoes anything (§4.3)
  expect((await history(page)).undo).toEqual(['Import Static Model']);
});

test('AS-AR-5: bad placement — three fixes, three undo steps, then the guess is within 0.05 H', async ({ page }) => {
  await openAutoRigReady(page);
  await chooseFile(page, 'lad-zup.glb', badCubeLad());
  const before = await waitForReport(page, 'lad-zup.glb');
  expect(before.intake).toMatchObject({ checks: { upright: false, centred: false, scale: 'huge' }, pose: null });
  expect(before.startPose).toBeNull();
  for (const check of ['upright', 'size', 'centred'])
    await expect(checkRow(page, check)).toHaveAttribute('data-ok', 'false');
  await expect(checkRow(page, 'pose')).toContainText('Unknown');
  await expect(page.getByTestId('ar-status')).toContainText('Stand up');
  // failed checks never block ① (② keeps Create Skeleton disabled until they pass, M6b)
  await expect(page.getByTestId('ar-primary')).toBeEnabled();

  await fixButton(page, 'standUp').click();
  await expect(checkRow(page, 'upright')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('ar-status')).toContainText('Set height');
  await fixButton(page, 'scale').click();
  await expect(checkRow(page, 'size')).toHaveAttribute('data-ok', 'true');
  await fixButton(page, 'center').click();
  await expect(checkRow(page, 'centred')).toHaveAttribute('data-ok', 'true');
  await expect(checkRow(page, 'grounded')).toHaveAttribute('data-ok', 'true');
  await expect(page.getByTestId('ar-status')).toHaveText('The model is ready for the markers.');
  const after = await report(page);
  expect(after?.height).toBeCloseTo(1.7, 4);
  expect(after?.pose?.kind).toBe('t');
  expect((await autorig(page))?.startPose?.kind).toBe('t');
  const steps = (await history(page)).undo;
  expect(steps).toHaveLength(4); // the import and one step per fix
  expect(steps[0]).toBe('Import Static Model');
  expect(steps[3]).toBe('Center and Ground');

  // ② would guess within 0.05 H: C2's guess (Quick Rig's start) on the fixed meshes, against the truth at 1.70 m
  const meshes = (await autorig(page))?.subject.meshes ?? [];
  await runOk(page, 'skel.quickRig.start', { meshes });
  const quick = await call(page, 'quickRig');
  const truth = cubeLadTruth();
  const k = 1.7 / truth.height;
  const box = await page.evaluate(
    (ids) => ids.map((id) => window.__EKZA_STUDIO_TEST__?.meshPositions(id, undefined, 'world') ?? []),
    meshes,
  );
  const zs = box.flat().map((p) => p[2] ?? 0);
  const z = (Math.min(...zs) + Math.max(...zs)) / 2; // Center and Ground centres z too (AR-D7-14)
  expect(Math.abs(z)).toBeLessThan(1e-6);
  const off = Object.entries(truth.markers).filter(([name, t]) => {
    const g = quick?.markers[name];
    if (g === undefined) return true;
    const d = Math.hypot((g[0] ?? 0) - t[0] * k, (g[1] ?? 0) - t[1] * k, (g[2] ?? 0) - (t[2] * k + z));
    return d / 1.7 > 0.05;
  });
  expect(off).toEqual([]);
  await runOk(page, 'skel.quickRig.cancel');

  // the header's Undo undoes the last fix alone; the report follows the document
  await page.getByTestId('ar-undo').click();
  await expect(checkRow(page, 'centred')).toHaveAttribute('data-ok', 'false');
  expect((await history(page)).undo).toHaveLength(3);
  await page.getByTestId('ar-redo').click();
  await expect(checkRow(page, 'centred')).toHaveAttribute('data-ok', 'true');
});

test('AS-AR-7 (① half): 250k triangles are refused with the decimation hint; 80k warns and Next asks once', async ({
  page,
}) => {
  await openAutoRigReady(page);
  await chooseFile(page, 'huge.glb', claimedTriangles(250_000));
  await expect(page.getByTestId('ar-status')).toContainText(
    'Reduce it to under 200,000 triangles (Blender: Decimate modifier) and try again.',
  );
  await expect(page.getByTestId('ar-status')).toHaveAttribute('role', 'alert');
  expect(await history(page)).toEqual({ undo: [], redo: [] });
  expect((await call(page, 'counts'))['meshes'] ?? 0).toBe(0);

  await chooseFile(page, 'detailed.glb', gridGlb(80_000));
  const state = await waitForReport(page, 'detailed.glb');
  expect(state.intake).toMatchObject({ weight: 'heavy' });
  expect((state.intake as { triangles: number }).triangles).toBeGreaterThanOrEqual(80_000);
  await expect(page.getByTestId('ar-heavy')).toContainText('Very detailed model');
  expect(state.slices['model']).toMatchObject({ heavyConfirmed: false });
  await page.getByTestId('ar-primary').click(); // e2e mode answers the confirm at once
  await expect.poll(async () => (await autorig(page))?.step).toBe('markers');
  expect((await autorig(page))?.slices['model']).toMatchObject({ heavyConfirmed: true });
});

test('AS-AR-6 (① half): a sword beside the body is unticked and left out of the subject', async ({ page }) => {
  await openAutoRigReady(page);
  await chooseFile(page, 'polybot-sword.glb', polybotWithSword());
  const state = await waitForReport(page, 'polybot-sword.glb');
  const found = (state.intake as { meshes: string[]; textured: boolean }).meshes;
  expect(found).toHaveLength(2);
  expect((state.intake as { textured: boolean }).textured).toBe(true);
  const parts = page.getByTestId('ar-parts');
  await expect(parts).toBeVisible();
  const names = await page.evaluate(
    (ids) => ids.map((id) => window.__EKZA_STUDIO_TEST__?.meshes().find((m) => m.id === id)?.name),
    found,
  );
  const sword = found[names.indexOf('Sword')] as string;
  const body = found[names.indexOf('Sword') === 0 ? 1 : 0] as string;
  await expect(parts.locator(`[data-part="${sword}"]`)).toContainText('Looks separate');
  await expect(parts.locator(`[data-part="${sword}"] input`)).not.toBeChecked();
  await expect(parts.locator(`[data-part="${body}"] input`)).toBeChecked();
  expect((await autorig(page))?.subject.meshes).toEqual([body]);
  // the checks are the body's: centred although the sword lies off to one side
  await expect(checkRow(page, 'centred')).toHaveAttribute('data-ok', 'true');
  // the sword stays in the scene, visible and untouched
  const swordMesh = (await call(page, 'meshes')).find((m) => m.id === sword);
  expect(swordMesh).toBeDefined();
  // ticking it makes it part of the character
  await parts.locator(`[data-part="${sword}"] input`).check();
  await expect.poll(async () => (await autorig(page))?.subject.meshes).toEqual(found);
  expect((await history(page)).undo).toEqual(['Import Static Model']);
});

test('AS-AR-4 (① part): a VRM goes straight to ④; ② and ③ say it is already rigged', async ({ page }) => {
  await openAutoRigReady(page);
  await chooseFile(page, 'polybot.vrm', fixtureBytes('polybot.vrm'));
  await expect.poll(async () => (await autorig(page))?.step, { timeout: 30_000 }).toBe('animations');
  const state = await autorig(page);
  expect(state?.intake).toMatchObject({ kind: 'vrm', fileName: 'polybot.vrm', meshes: [] });
  expect(state?.subject.character).not.toBeNull();
  expect(state?.reachable).toMatchObject({ model: true, markers: false, rig: false, animations: true, export: true });
  const notice = /This avatar is already rigged/;
  for (const step of ['markers', 'rig']) {
    const button = page.locator(`[data-step="${step}"] button`);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', notice);
  }
  expect((await history(page)).undo).toEqual(['Import polybot.vrm']);
  // back on ①, Next leads to Animations
  await page.locator('[data-step="model"] button').click();
  await expect(page.getByTestId('ar-primary')).toHaveText(/Next: Animations/);
  await expect(page.getByTestId('ar-kind-note')).toContainText('Already rigged (VRM)');
});

test('an animation or an unsupported file is refused on ① with its hint, nothing imported', async ({ page }) => {
  await openAutoRigReady(page);
  await chooseFile(page, 'walk.vrma', fixtureBytes('cube-lad.glb'));
  await expect(page.getByTestId('ar-status')).toHaveText(
    'This is an animation. Rig a model first, then add it in step 4.',
  );
  await chooseFile(page, 'model.fbx', Buffer.from('Kaydara FBX Binary  \0'));
  await expect(page.getByTestId('ar-status')).toHaveText(
    'Auto-Rig reads GLB and VRM. In Blender: File › Export › glTF 2.0 (.glb).',
  );
  expect(await history(page)).toEqual({ undo: [], redo: [] });
  await expect(page.getByTestId('ar-drop-zone')).toBeVisible();
});
