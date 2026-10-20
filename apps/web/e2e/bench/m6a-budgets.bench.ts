// M6A-SPEC §5.27 (INT): the end-to-end rows of the budget table through the editor, after every package merged.
// The package rows are measured by their own benches (`m6a-mesh-view.bench.ts` for B6, `m6a-transform.bench.ts` for
// B12a, `packages/mesh-core/bench` for the kernel, B7's and B8's package benches); this file re-measures the rows
// that only the merged editor has: a typical topology op end to end (extrude 100 faces; a loop on a 200-quad ring:
// op + caches + the next frame) and its undo, Make editable and the export of one edited mesh, leaving Model with
// an edited character (Seed-san's rebuild) and idle in Model. Report-only like `budgets.bench.ts`: results go to
// annotations, stdout and `.acceptance/budgets/m6a-budgets.json`; only the idle row repeats its gate (E2E-MOD-16).
// Run: `EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m6a-`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, enterModel, openModel, setMode } from '../helpers/m6a-model';
import { seedSample } from '../helpers/seed';
import { call, expectKernelStarted, openEditor, renderedFrames, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);

/** Runs an operator in the page and times it up to the next animation frame (the GPU upload of its result). */
async function timedRun(page: Page, op: string, args?: unknown): Promise<number> {
  return page.evaluate(
    async ({ op, args }) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) throw new Error('no test API');
      const start = performance.now();
      const result = await api.run(op, args);
      if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return performance.now() - start;
    },
    { op, args },
  );
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );
}

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
    new URL('m6a-budgets.json', OUT),
    `${JSON.stringify({ name: 'm6a-budgets', at: new Date().toISOString(), summary: lines, ...results }, null, 2)}\n`,
  );
});

test.describe.configure({ mode: 'serial' });

test('typical topology ops end to end: extrude 100 faces, a loop on a 200-quad ring, undo', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  // A 10 × 10 plane: 100 quads, extruded as one region.
  const plane = await createPrimitive(page, 'plane', { subdivisionsWidth: 10, subdivisionsHeight: 10 });
  await runOk(page, 'select.objects', { ids: [plane], mode: 'replace' });
  await setMode(page, 'face');
  const extrude: number[] = [];
  const undo: number[] = [];
  for (let i = 0; i < 5; i++) {
    await runOk(page, 'select.components', {
      mesh: plane,
      kind: 'face',
      indices: Array.from({ length: 100 }, (_, f) => f),
      mode: 'replace',
    });
    await frames(page);
    extrude.push(await timedRun(page, 'mesh.extrude', { meshes: [plane], kind: 'face', localTranslateZ: 0.2 }));
    await runOk(page, 'select.mode', { mode: 'face' }); // ends the extrude session (§5.8) before the undo
    await frames(page);
    undo.push(await timedRun(page, 'edit.undo'));
    await frames(page);
  }
  // A 200-sided cylinder: its middle ring of 200 quads (a vertical edge's ring), one loop.
  await setMode(page, 'object');
  const cylinder = await createPrimitive(page, 'cylinder', { subdivisionsAxis: 200, subdivisionsHeight: 1 });
  await runOk(page, 'select.objects', { ids: [cylinder], mode: 'replace' });
  await setMode(page, 'edge');
  const positions = (await call(page, 'meshPositions', cylinder)) as unknown as (readonly number[])[];
  const edges = await call(page, 'meshEdges', cylinder);
  const vertical = edges.findIndex(
    ({ v: [a, b] }) =>
      Math.abs((positions[a]?.[0] ?? 0) - (positions[b]?.[0] ?? 0)) < 1e-9 &&
      Math.abs((positions[a]?.[2] ?? 0) - (positions[b]?.[2] ?? 0)) < 1e-9,
  );
  expect(vertical).toBeGreaterThanOrEqual(0);
  const loop: number[] = [];
  for (let i = 0; i < 5; i++) {
    await runOk(page, 'select.components', { mesh: cylinder, kind: 'edge', indices: [vertical], mode: 'replace' });
    await frames(page);
    loop.push(
      await timedRun(page, 'mesh.insertLoop', { meshes: [cylinder], kind: 'edge', seedEdge: vertical, weight: 0.5 }),
    );
    await runOk(page, 'edit.undo');
    await frames(page);
  }
  report(
    'topology',
    { extrudeMs: extrude, loopMs: loop, undoMs: undo },
    `extrude 100 faces ${median(extrude).toFixed(1)} ms, loop on a 200-quad ring ${median(loop).toFixed(1)} ms ` +
      `(op + caches + next frame, budget ≤ 16), undo of the extrude ${median(undo).toFixed(1)} ms (journal ≤ 5, ` +
      'rebuild ≤ 40; medians of 5)',
  );
});

test('Make editable (Polybot) and the static export of one edited mesh', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'polybot');
  await enterModel(page);
  const made = await timedRun(page, 'mesh.makeEditable', { character, meshIndex: 0 });
  await setMode(page, 'object');
  const cube = await createPrimitive(page, 'cube', { subdivisionsWidth: 20, subdivisionsHeight: 20 });
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  const exported: number[] = [];
  for (let i = 0; i < 3; i++) {
    exported.push(
      await timedRun(page, 'file.exportModel', { objects: [cube], fileName: 'cube.glb', profile: 'local/generic' }),
    );
  }
  report(
    'meshIo',
    { makeEditableMs: made, exportMs: exported },
    `Make editable Polybot ${made.toFixed(0)} ms (≤ 150), static export of one edited mesh ` +
      `${median(exported).toFixed(0)} ms incl. validation and the three.js read-back (≤ 50 for the writer alone)`,
  );
});

test('leaving Model with an edited character: Seed-san display rebuild', async ({ page }) => {
  await openEditor(page);
  await expectKernelStarted(page);
  const { character } = await seedSample(page, 'seed-san');
  await expect.poll(async () => await call(page, 'displayModel', character), { timeout: 30_000 }).not.toBeNull();
  const before = (await call(page, 'displayModel', character))?.vertices;
  await enterModel(page);
  const rows = (await call(page, 'meshes')).filter((row) => row.owner === `char:${character}`);
  const meshIndex = rows.findIndex((row) => row.name === 'head');
  const { mesh } = await runOk<{ mesh: string }>(page, 'mesh.makeEditable', { character, meshIndex });
  await expect.poll(async () => (await call(page, 'meshes')).find((row) => row.id === mesh)?.runtime).toBe('ready');
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await setMode(page, 'edge');
  await runOk(page, 'mesh.insertLoop', { meshes: [mesh], kind: 'edge', seedEdge: 0, weight: 0.5 });
  await setMode(page, 'object');
  const rebuild = await page.evaluate(
    async ({ character, before }) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) throw new Error('no test API');
      const start = performance.now();
      await api.run('workspace.set', { workspace: 'animate' });
      while (api.displayModel(character)?.vertices === before) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (performance.now() - start > 10_000) throw new Error('no rebuild');
      }
      return performance.now() - start;
    },
    { character, before },
  );
  report('rebuild', { rebuildMs: rebuild }, `leaving Model rebuilds Seed-san in ${rebuild.toFixed(0)} ms (≤ 300)`);
});

test('idle in Model: a 20,000-triangle sphere in face mode renders nothing for 2 s (gate)', async ({ page }) => {
  await openModel(page);
  await expectKernelStarted(page);
  const sphere = await createPrimitive(page, 'sphere', { subdivisionsAxis: 100, subdivisionsHeight: 101 });
  await runOk(page, 'select.objects', { ids: [sphere], mode: 'replace' });
  await setMode(page, 'face');
  await runOk(page, 'select.components', { mesh: sphere, kind: 'face', indices: [0], mode: 'replace' });
  await frames(page, 4);
  await page.waitForTimeout(500);
  const before = await renderedFrames(page);
  await page.waitForTimeout(2000);
  const idle = (await renderedFrames(page)) - before;
  report('idle', { frames: idle }, `idle in Model ${idle} WebGL frames in 2 s (gate 0)`);
  expect(idle).toBe(0);
});
