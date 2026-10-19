// M6A-SPEC §5.27 (B6 rows) through the editor: entering component mode on a 50k-triangle mesh (edit links, caches,
// overlays, BVH) ≤ 40 ms, hover picking ≤ 0.5 ms, a 10k-vertex marquee with occlusion ≤ 16 ms, and idle in face mode
// at 0 frames. Report-only like `budgets.bench.ts`: results go to annotations, stdout and
// `.acceptance/budgets/m6a-mesh-view.json`. The package-level numbers come from `packages/mesh-view/test/bench.test.ts`
// (recorded in docs/wp-notes/m6a-mesh-view.md); this file re-measures the path through the editor once the packages
// that wire it have merged: B7 (`mesh.create.*`, runtimes), B9 (the Model workspace, `addMeshLayer`) and B10 (modes,
// hilite, the select tool's picking). Gated by `test.fixme` with those ids until then (§3 rule 4; INT turns them on).
// Run: `EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m6a-mesh-view`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, MODEL_PANE, openModel, selectedComponents, setMode } from '../helpers/m6a-model';
import { call, renderedFrames, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);

interface MeshViewProbe {
  measuring: boolean;
  /** pointermove listener time (ms) per event while `measuring`. */
  moves: number[];
}

declare global {
  interface Window {
    __EKZA_MESH_VIEW_BENCH__?: MeshViewProbe;
  }
}

/** Init script: times every pointermove listener (the select tool's hover pick) while measuring. */
function instrument(): void {
  const probe: MeshViewProbe = { measuring: false, moves: [] };
  window.__EKZA_MESH_VIEW_BENCH__ = probe;
  type ListenerMethod = (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  const add: ListenerMethod = Reflect.get(EventTarget.prototype, 'addEventListener');
  EventTarget.prototype.addEventListener = function (this: EventTarget, type, listener, options) {
    if (type !== 'pointermove' || listener === null) return add.call(this, type, listener, options);
    const call = (target: unknown, event: Event): unknown =>
      typeof listener === 'function' ? listener.call(target, event) : listener.handleEvent(event);
    return add.call(
      this,
      type,
      function meshViewBenchMove(this: unknown, event: Event) {
        if (!probe.measuring) return call(this, event);
        const start = performance.now();
        try {
          return call(this, event);
        } finally {
          probe.moves.push(performance.now() - start);
        }
      },
      options,
    );
  };
}

function stats(samples: readonly number[]): { n: number; mean: number; median: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? Number.NaN;
  return {
    n: sorted.length,
    mean: sorted.reduce((sum, v) => sum + v, 0) / Math.max(1, sorted.length),
    median: at(0.5),
    p95: at(0.95),
  };
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

function record(data: Record<string, unknown>, summary: string): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    new URL('m6a-mesh-view.json', OUT),
    `${JSON.stringify({ name: 'm6a-mesh-view', at: new Date().toISOString(), summary, ...data }, null, 2)}\n`,
  );
  test.info().annotations.push({ type: 'budget', description: summary });
  console.warn(`[budget] ${summary}`);
}

test.fixme('b7, b9, b10: mesh-view budgets in the editor at 50k triangles', async ({ page }) => {
  await page.addInitScript(instrument);
  await openModel(page);
  // 158 × 158 quads = 49,928 triangles (research 13 §8.1's workload).
  const mesh = await createPrimitive(page, 'plane', {
    width: 10,
    height: 10,
    subdivisionsWidth: 158,
    subdivisionsHeight: 158,
  });
  expect((await call(page, 'meshInfo', mesh))?.counts.tris).toBe(49_928);
  await runOk(page, 'select.objects', { ids: [mesh], mode: 'replace' });
  await frames(page);

  // Enter component mode: the operator, the overlays' first frame and the BVH (built on the first pick).
  const entered = await page.evaluate(async () => {
    const api = window.__EKZA_ANIMATOR_TEST__;
    if (api === undefined) throw new Error('no test API');
    const start = performance.now();
    await api.run('select.mode', { mode: 'face' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - start;
  });
  await setMode(page, 'face');

  // Hover: pointer moves across the pane (the select tool's pre-selection pick per event).
  const pane = page.getByTestId(`pane-${MODEL_PANE}`);
  const box = await pane.boundingBox();
  if (box === null) throw new Error('no pane');
  await page.evaluate(() => {
    const probe = window.__EKZA_MESH_VIEW_BENCH__;
    if (probe !== undefined) {
      probe.measuring = true;
      probe.moves = [];
    }
  });
  for (let i = 0; i < 200; i++) {
    await page.mouse.move(
      box.x + box.width * (0.2 + (0.6 * ((i * 37) % 200)) / 200),
      box.y + box.height * (0.3 + (0.4 * ((i * 53) % 200)) / 200),
    );
  }
  const moves = await page.evaluate(() => {
    const probe = window.__EKZA_MESH_VIEW_BENCH__;
    if (probe === undefined) return [];
    probe.measuring = false;
    return probe.moves;
  });

  // Marquee about 10k vertices in vertex mode (occlusion on: shaded pane).
  await setMode(page, 'vertex');
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 4 });
  const marqueeStart = Date.now();
  await page.mouse.up();
  await frames(page);
  const marqueeMs = Date.now() - marqueeStart;
  const selected = (await call(page, 'model')).selected[mesh]?.vertex.length ?? 0;

  // Idle in face mode with a face selected: no WebGL frame over 2 s (E2E-MOD-16's gate shape).
  await setMode(page, 'face');
  await runOk(page, 'select.components', { mesh, kind: 'face', indices: [0], mode: 'replace' });
  expect(await selectedComponents(page, mesh, 'face')).toEqual([0]);
  await frames(page, 4);
  const before = await renderedFrames(page);
  await page.waitForTimeout(2000);
  const idleFrames = (await renderedFrames(page)) - before;

  const hover = stats(moves);
  const summary =
    `enter face mode ${entered.toFixed(1)} ms (budget ≤ 40), hover median ${hover.median.toFixed(3)} ms p95 ` +
    `${hover.p95.toFixed(3)} ms (≤ 0.5), marquee ${selected} vertices ${marqueeMs} ms incl. a frame (≤ 16 for 10k), ` +
    `idle ${idleFrames} frames in 2 s (0)`;
  record({ enterMs: entered, hover, marqueeMs, selected, idleFrames }, summary);
  expect(idleFrames).toBe(0);
});
