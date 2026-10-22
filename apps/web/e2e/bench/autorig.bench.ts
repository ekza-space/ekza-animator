// AUTORIG-SPEC §7.2 (per-step lazy loads, "dockview is never fetched") and §7.3 (runtime budgets; D7): AS-AR-1's flow
// on the Cube Lad through the UI with every response recorded — the bytes each step fetches (encoded body sizes, JS
// and other), the marker check that no response of `/autorig` carries dockview until *Open in Studio* — and the §7.3
// rows: first visit to an interactive ①, ② first entry, *Auto-rig* (commit + bind) on the Cube Lad and on a ≈ 10k
// triangle body, the first motion-test frame after Checking, the Cube Lad VRM export, *Straighten to T-Pose* on the
// A-posed Polybot, and the idle row (0 frames over 2 s, the E2E-AR-10 gate). Report-only except the dockview check and
// the idle row; results go to annotations, stdout and `.acceptance/budgets/autorig.json`.
// Run: `EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts autorig`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { addClip, dropModel, exportMeta, idleFrames, nextToMarkers, onStep, primary } from '../helpers/ar-as';
import { download } from '../helpers/ar-export';
import { fixtureBytes } from '../helpers/ar-model';
import { subdividedCubeLad, subjectCharacter } from '../helpers/ar-rig';
import { call, runOk, waitForTestApi } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);
const DOCKVIEW_MARKER = 'dv-dockview';

const results: Record<string, unknown> = {};
const lines: string[] = [];

function report(key: string, value: Record<string, unknown>, line: string): void {
  results[key] = value;
  lines.push(line);
  test.info().annotations.push({ type: 'budget', description: line });
  console.warn(`[budget] ${line}`);
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    new URL('autorig.json', OUT),
    `${JSON.stringify({ name: 'autorig', at: new Date().toISOString(), summary: lines, ...results }, null, 2)}\n`,
  );
});

test.describe.configure({ mode: 'serial' });

/** Every response of a page, tagged with the phase the script is in; JS bodies kept for the marker check. */
function recorder(page: Page) {
  const state = { phase: 'first visit' };
  const rows: { phase: string; url: string; bytes: number; js: boolean; dockview: boolean }[] = [];
  const pending: Promise<void>[] = [];
  page.on('requestfinished', (request) => {
    const phase = state.phase;
    pending.push(
      (async () => {
        const response = await request.response();
        if (response === null) return;
        const sizes = await request.sizes().catch(() => ({ responseBodySize: 0 }));
        const url = request.url().split('?')[0] ?? '';
        const js = url.endsWith('.js');
        const text = js ? await response.text().catch(() => '') : '';
        const bytes = Math.max(0, sizes.responseBodySize);
        rows.push({ phase, url, bytes, js, dockview: text.includes(DOCKVIEW_MARKER) });
      })(),
    );
  });
  return {
    state,
    rows,
    settle: async () => {
      await Promise.all(pending);
    },
  };
}

/** Clicks the primary button in the page and returns the milliseconds until ③ is done and nothing is busy. */
async function autoRigMs(page: Page): Promise<number> {
  await expect(page.getByTestId('ar-primary')).toHaveText(/Auto-rig/);
  await expect(page.getByTestId('ar-primary')).toBeEnabled();
  return page.evaluate(async () => {
    const api = window.__EKZA_STUDIO_TEST__;
    const button = document.querySelector<HTMLButtonElement>('[data-testid="ar-primary"]');
    if (button === null) throw new Error('no primary button');
    const start = performance.now();
    button.click();
    for (;;) {
      const state = api?.autorig();
      if (state !== null && state !== undefined && state.busy === null && state.done['rig'] === true) break;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return performance.now() - start;
  });
}

test('AS-AR-1 on the Cube Lad: bytes per step, dockview never fetched, the §7.3 rows', async ({ page }) => {
  test.setTimeout(300_000);
  const net = recorder(page);

  // first visit to an interactive ①
  const visitStart = Date.now();
  await page.goto('/autorig?e2e=1');
  await waitForTestApi(page);
  await expect(page.getByTestId('ar-drop-zone')).toBeVisible();
  const interactive = await page.evaluate(() => performance.now());
  report(
    'firstVisit',
    { navigationToInteractiveMs: interactive, wallMs: Date.now() - visitStart },
    `/autorig first visit to an interactive ①: ${interactive.toFixed(0)} ms (budget ≤ 1,500 ms)`,
  );

  net.state.phase = '① model';
  await dropModel(page, 'cube-lad.glb', new Uint8Array(fixtureBytes('cube-lad.glb')));

  net.state.phase = '② markers';
  const t0 = Date.now();
  await nextToMarkers(page);
  const markersMs = Date.now() - t0;
  report(
    'markersEntry',
    { ms: markersMs },
    `② first entry (chunks + guess), Cube Lad: ${markersMs} ms (budget ≤ 1,000 ms)`,
  );

  net.state.phase = '③ rig';
  const rigMs = await autoRigMs(page);
  const previewMs = await page.evaluate(async () => {
    const start = performance.now();
    while (
      window.__EKZA_STUDIO_TEST__?.library()?.preview === null ||
      window.__EKZA_STUDIO_TEST__?.library()?.preview === undefined
    )
      await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - start;
  });
  report(
    'autoRigCubeLad',
    { ms: rigMs },
    `Auto-rig (commit + bind) on the Cube Lad: ${rigMs.toFixed(0)} ms (budget ≤ 1,000 ms)`,
  );
  report(
    'firstMotionFrame',
    { ms: previewMs },
    `first motion-test frame after Checking: ${previewMs.toFixed(0)} ms (budget ≤ 300 ms)`,
  );
  const { character } = await subjectCharacter(page);

  net.state.phase = '④ animations';
  await primary(page, /Animations/);
  await onStep(page, 'animations');
  await addClip(page, { id: 'walk', name: 'Walk', search: 'walk' });

  net.state.phase = '⑤ export';
  await primary(page, /Export/);
  await onStep(page, 'export');
  await exportMeta(page);
  const exportStart = Date.now();
  await download(page);
  const exportMs = Date.now() - exportStart;
  const opMs = await page.evaluate(async (id) => {
    const start = performance.now();
    await window.__EKZA_STUDIO_TEST__?.run('autorig.export', { character: id, target: 'ekza-vrm', fileName: 'bench' });
    return performance.now() - start;
  }, character);
  report(
    'exportCubeLad',
    { downloadMs: exportMs, operatorMs: opMs },
    `Export of the Cube Lad VRM: autorig.export ${opMs.toFixed(0)} ms, Download click to saved ${exportMs} ms (budget ≤ 500 ms)`,
  );

  // the idle row (gate): ⑤, no preview
  const idle = await idleFrames(page);
  report('idle', { frames: idle }, `idle on ⑤: ${idle} frames over 2 s (gate 0)`);

  // bytes per phase, and dockview: never on /autorig before Open in Studio
  await net.settle();
  const byPhase: Record<string, { js: number; other: number; files: number }> = {};
  for (const row of net.rows) {
    const entry = (byPhase[row.phase] ??= { js: 0, other: 0, files: 0 });
    entry[row.js ? 'js' : 'other'] += row.bytes;
    entry.files += 1;
  }
  for (const [phase, entry] of Object.entries(byPhase)) {
    report(
      `bytes ${phase}`,
      entry,
      `${phase}: ${entry.files} responses, JS ${(entry.js / 1024).toFixed(1)} KiB, other ${(entry.other / 1024).toFixed(1)} KiB (encoded)`,
    );
  }
  const dockviewBefore = net.rows.filter((row) => row.dockview).map((row) => `${row.phase} ${row.url}`);
  report(
    'dockviewOnAutorig',
    { files: dockviewBefore },
    `dockview fetched on /autorig: ${dockviewBefore.length} files (gate 0)`,
  );

  // Open in Studio: now the Studio shell (and dockview) loads
  net.state.phase = 'Open in Studio';
  await page.getByTestId('ar-open-studio').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await net.settle();
  const dockviewAfter = net.rows.filter((row) => row.dockview && row.phase === 'Open in Studio').length;
  report('dockviewAfterStudio', { files: dockviewAfter }, `dockview after Open in Studio: ${dockviewAfter} files`);

  expect(dockviewBefore).toEqual([]);
  expect(dockviewAfter).toBeGreaterThan(0);
  expect(idle).toBe(0);
});

test('Auto-rig on a ≈ 10k-triangle body; Straighten to T-Pose on the A-posed Polybot', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/autorig?e2e=1');
  await waitForTestApi(page);
  // the Cube Lad's boxes as 7 × 7 grids: 9,408 triangles
  await dropModel(page, 'cube-lad-10k.glb', new Uint8Array(subdividedCubeLad(7)));
  await nextToMarkers(page);
  const rigMs = await autoRigMs(page);
  report(
    'autoRig10k',
    { ms: rigMs, triangles: 9408 },
    `Auto-rig on a 9,408-triangle body: ${rigMs.toFixed(0)} ms (budget ≤ 2,500 ms)`,
  );

  // A-posed Polybot: commit and bind without the straighten, then time the straighten alone (median of 3)
  await page.goto('/autorig?e2e=1');
  await waitForTestApi(page);
  await dropModel(page, 'polybot-unskinned.glb', new Uint8Array(fixtureBytes('polybot-unskinned.glb')));
  await nextToMarkers(page);
  await runOk(page, 'autorig.rig', { straighten: false });
  const record = (await call(page, 'characters')).find((row) => row.source === 'model');
  const character = record?.id ?? '';
  const mesh = record?.meshes[0] ?? '';
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    samples.push(
      await page.evaluate(async (id) => {
        const api = window.__EKZA_STUDIO_TEST__;
        const start = performance.now();
        const result = await api?.run('skel.pose.applyAsRest', { character: id, pose: 'tStance' });
        const ms = performance.now() - start;
        if (result?.status !== 'finished') throw new Error(JSON.stringify(result));
        await api?.run('edit.undo');
        return ms;
      }, character),
    );
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const points = (await call(page, 'meshPositions', mesh, undefined, 'local')).length;
  report(
    'straighten',
    { ms: samples, points },
    `Straighten to T-Pose on the A-posed Polybot (${points} points): ${(sorted[1] ?? 0).toFixed(0)} ms median of 3 (budget ≤ 200 ms)`,
  );
});
