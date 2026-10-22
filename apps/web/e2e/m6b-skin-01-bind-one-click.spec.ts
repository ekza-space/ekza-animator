import { readFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { buildCubeLad, cubeLadTruth } from './helpers/m6b-cube-lad';
import { enterRig, openRig } from './helpers/m6b-rig';
import { boxPoints } from './helpers/m6b-skin-ui';
import { call, openEditor, run, runOk } from './helpers/test-api';

// E2E-SKIN-01 "Bind Skin, one click" (M6B-SPEC §0.7, MVP cut of §10.1; C4). The Cube Lad made a character through
// Quick Rig's commit with its truth markers (`run`), then the Rig Toolkit's ③ Bind Skin: one undo step, every point
// weighted with ≤ 4 influences summing to 1 (1e-6), no weight on `root`, each forearm box on its lower arm; the bound
// manifest equals the same bind on the main thread (P-S5 through the UI: the skin worker = Chromium; Node =
// Chromium is mesh-core's browser goldens). Then the T-posed Polybot imported static (`mesh.importStatic`), Quick
// Rig's guess, Create Skeleton and Bind: no Validation error, every humanoid joint within 0.05 H of the truth.
//
// Gates (§0.7 Gates column, §3 rule 4): c1 (Create Skeleton makes a character), c2 (the Quick Rig fit), c3 (the
// Quick Rig UI), c6 (`weights()`), c7 (the Toolkit's checklist and Validation) — merged; INT runs it ungated.

const DEG = Math.PI / 180;

const fixture = (file: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../../../fixtures/models/${file}`, import.meta.url)));

/** `mesh.importStatic` of a fixture through the test API (the bytes as a Uint8Array in the page). */
async function importStatic(page: Page, file: string): Promise<{ meshes: string[] }> {
  const base64 = Buffer.from(fixture(file)).toString('base64');
  const result = await page.evaluate(
    async ([data, name]) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      return await window.__EKZA_STUDIO_TEST__?.run('mesh.importStatic', { bytes, name });
    },
    [base64, file] as const,
  );
  expect(result?.status, `mesh.importStatic: ${result?.reason ?? result?.error?.message ?? ''}`).toBe('finished');
  return result?.value as { meshes: string[] };
}

/** The Cube Lad as a character: built in Model, Quick Rig committed with the truth markers (Standard 33). */
async function cubeLadCharacter(page: Page): Promise<{ readonly mesh: string; readonly character: string }> {
  const mesh = await buildCubeLad(page);
  await enterRig(page);
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  const truth = cubeLadTruth();
  const result = await runOk<{ character: string }>(page, 'skel.quickRig.commit', {
    preset: 'standard33',
    markers: truth.markers,
    meshes: [mesh],
    flexion: 2 * DEG,
  });
  // The character adopted the scene mesh under a new id (§5.1 adoption).
  const adopted = (await call(page, 'meshes')).find((row) => row.owner === `char:${result.character}`)?.id ?? '';
  expect(adopted).not.toBe('');
  return { mesh: adopted, character: result.character };
}

/** The manifest of a mesh's current revision. */
async function manifestOf(page: Page, mesh: string): Promise<string | null> {
  return (await call(page, 'meshes')).find((row) => row.id === mesh)?.manifest ?? null;
}

/** The same flow on a page without workers (the skin service binds on the main thread). */
async function mainThreadManifest(browser: Browser): Promise<string | null> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    // biome-ignore lint/performance/noDelete: removing the constructor is the point (installSkinWorker checks it).
    delete (globalThis as { Worker?: unknown }).Worker;
  });
  try {
    await openRig(page);
    const { mesh } = await cubeLadCharacter(page);
    await runOk(page, 'skin.bind', {});
    return await manifestOf(page, mesh);
  } finally {
    await context.close();
  }
}

test.describe('E2E-SKIN-01 Bind Skin, one click', () => {
  test('the Cube Lad: Toolkit ③ binds every point in one step; the worker equals the main thread', async ({
    page,
    browser,
  }) => {
    await openRig(page);
    const { mesh } = await cubeLadCharacter(page);
    const before = (await call(page, 'history')).undo.length;
    await page.getByTestId('rtk-step-3-btn').click();
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(before + 1);
    expect((await call(page, 'history')).undo.at(-1)).toBe('Bind Skin');

    const skin = await call(page, 'skin', mesh);
    expect(skin?.bind).toMatchObject({ v: 1, method: 'auto-lowpoly', symmetrize: true });
    expect(skin?.palette.some((key) => key.endsWith(':root'))).toBe(false);
    const weights = await call(page, 'weights', mesh);
    const positions = await call(page, 'meshPositions', mesh, undefined, 'local');
    expect(weights.length).toBe(positions.length);
    const forearms = new Map<number, 'left' | 'right'>();
    for (const v of boxPoints(positions, 'forearm.L')) forearms.set(v, 'left');
    for (const v of boxPoints(positions, 'forearm.R')) forearms.set(v, 'right');
    expect(forearms.size).toBe(16);
    let forearm = 0;
    let onLowerArm = 0;
    weights.forEach((row, v) => {
      expect(row.joints.length).toBeGreaterThan(0);
      expect(row.joints.length).toBeLessThanOrEqual(4);
      expect(Math.abs(row.weights.reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(1e-6);
      expect(row.joints.some((key) => key.endsWith(':root'))).toBe(false);
      // The forearm boxes' own points (their corners, cube-lad-truth.json; the boxes are islands of 8 points each).
      const side = forearms.get(v);
      if (side !== undefined) {
        forearm++;
        if ((row.joints[0] ?? '').endsWith(`:${side}LowerArm`)) onLowerArm++;
      }
    });
    expect(forearm).toBeGreaterThan(0);
    expect(onLowerArm / forearm).toBeGreaterThanOrEqual(0.95);

    // P-S5 through the UI: the skin worker's result equals the main thread's on the same document.
    expect(await manifestOf(page, mesh)).toBe(await mainThreadManifest(browser));
  });

  test('Polybot (T-pose), imported static: Quick Rig guess, Create Skeleton, Bind — no error row', async ({ page }) => {
    await openEditor(page);
    // `mesh.importStatic` takes a Uint8Array: the bytes cross into the page as base64 (JSON would make them an array).
    const imported = await importStatic(page, 'polybot-unskinned-tpose.glb');
    await enterRig(page);
    await runOk(page, 'select.objects', { ids: imported.meshes, mode: 'replace' });
    await runOk(page, 'skel.quickRig.start');
    await runOk(page, 'skel.quickRig.guess');
    await page.getByTestId('quickrig-commit').click();
    await expect.poll(async () => (await call(page, 'rigState')).character).not.toBeNull();
    const character = (await call(page, 'rigState')).character as string;
    await runOk(page, 'skin.bind', {});
    for (const mesh of imported.meshes) {
      const skin = await call(page, 'skin', mesh);
      expect(skin?.skeleton).not.toBeNull();
    }
    // The VRM meta rows are export metadata, not rigging: set them, then no row is an error.
    await runOk(page, 'char.setVrmMeta', { character, patch: { authors: ['Tester'], licensePreset: 'cc0' } });
    expect((await call(page, 'validation')).filter((row) => row.severity === 'error')).toEqual([]);

    const truth = JSON.parse(
      readFileSync(new URL('../../../fixtures/models/polybot-truth.json', import.meta.url), 'utf8'),
    ) as {
      poses: { tpose: { height: number; humanoid: Record<string, number[]> } };
    };
    const { height, humanoid } = truth.poses.tpose;
    const skeleton = await call(page, 'skeleton', character);
    for (const joint of skeleton?.joints ?? []) {
      const target = joint.humanBone === null ? undefined : humanoid[joint.humanBone];
      if (target === undefined) continue;
      const d = Math.hypot(
        (joint.restPosition[0] as number) - (target[0] as number),
        (joint.restPosition[1] as number) - (target[1] as number),
        (joint.restPosition[2] as number) - (target[2] as number),
      );
      expect(d, joint.humanBone ?? joint.name).toBeLessThanOrEqual(0.05 * height);
    }
    const result = await run(page, 'skin.unbind', {});
    expect(result.status).toBe('cancelled'); // asks first (§5.9)
  });
});
