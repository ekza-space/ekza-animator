// M6A-SPEC §5.27 (B12a rows) through the editor: dragging 1,000 vertices (positions, dirty normals, GPU upload)
// ≤ 4 ms per frame, and a soft-selection drag over 10k vertices ≤ 8 ms per frame. Report-only like `budgets.bench.ts`:
// results go to annotations, stdout and `.acceptance/budgets/m6a-transform.json`. "Per frame" is the work a drag
// frame costs: the pointer-move handlers (the MeshOpSession update of `mesh.transformComponents`) plus the animation
// frame that draws it (the incremental view update and its upload). The kernel's own number (one transform with soft
// selection and symmetry on 10k vertices, with its undo) is `packages/mesh-core/bench/select.bench.ts` (B2).
// Run: `EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m6a-transform`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, MODEL_PANE, openModel, setMode } from '../helpers/m6a-model';
import { call, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);

interface TransformProbe {
  measuring: boolean;
  moves: number[];
  frames: number[];
}

declare global {
  interface Window {
    __EKZA_TRANSFORM_BENCH__?: TransformProbe;
  }
}

/** Init script: times pointermove listeners and animation-frame callbacks while measuring. */
function instrument(): void {
  const probe: TransformProbe = { measuring: false, moves: [], frames: [] };
  window.__EKZA_TRANSFORM_BENCH__ = probe;
  type ListenerMethod = (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  const add: ListenerMethod = Reflect.get(EventTarget.prototype, 'addEventListener');
  EventTarget.prototype.addEventListener = function (this: EventTarget, type, listener, options) {
    if (type !== 'pointermove' || listener === null) return add.call(this, type, listener, options);
    const invoke = (target: unknown, event: Event): unknown =>
      typeof listener === 'function' ? listener.call(target, event) : listener.handleEvent(event);
    return add.call(
      this,
      type,
      function transformBenchMove(this: unknown, event: Event) {
        if (!probe.measuring) return invoke(this, event);
        const start = performance.now();
        try {
          return invoke(this, event);
        } finally {
          probe.moves.push(performance.now() - start);
        }
      },
      options,
    );
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
    raf((time) => {
      if (!probe.measuring) return callback(time);
      const start = performance.now();
      try {
        return callback(time);
      } finally {
        probe.frames.push(performance.now() - start);
      }
    });
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

/** Drags the `ty` handle up in steps of 2 px, one frame per step, measuring the moves and the frames. */
async function measuredDrag(page: Page, steps = 40): Promise<{ moves: number[]; frames: number[] }> {
  await expect.poll(() => call(page, 'screenOfManipulator', MODEL_PANE, 'ty')).not.toBeNull();
  const ty = await call(page, 'screenOfManipulator', MODEL_PANE, 'ty');
  if (ty === null) throw new Error('no ty handle');
  const before = (await call(page, 'history')).undo.length;
  await page.mouse.move(ty.x, ty.y);
  await page.mouse.down();
  await page.mouse.move(ty.x, ty.y - 4);
  await page.evaluate(() => {
    const probe = window.__EKZA_TRANSFORM_BENCH__;
    if (probe === undefined) return;
    probe.measuring = true;
    probe.moves = [];
    probe.frames = [];
  });
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(ty.x, ty.y - 4 - 2 * i);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  const probe = await page.evaluate(() => {
    const p = window.__EKZA_TRANSFORM_BENCH__;
    if (p !== undefined) p.measuring = false;
    return { moves: p?.moves ?? [], frames: p?.frames ?? [] };
  });
  await page.mouse.up();
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(before + 1);
  return probe;
}

/** Per-frame cost: the frame callbacks plus the move handlers that fed them (one move per frame here). */
function perFrame(probe: { moves: number[]; frames: number[] }): {
  moves: ReturnType<typeof stats>;
  frames: ReturnType<typeof stats>;
  total: ReturnType<typeof stats>;
} {
  const n = Math.min(probe.moves.length, probe.frames.length);
  const totals = Array.from({ length: n }, (_, i) => (probe.moves[i] ?? 0) + (probe.frames[i] ?? 0));
  return { moves: stats(probe.moves), frames: stats(probe.frames), total: stats(totals) };
}

test('transform drag budgets in the editor (1,000 vertices; soft selection over 10k vertices)', async ({ page }) => {
  await page.addInitScript(instrument);
  await openModel(page);

  // 1,024 vertices moved together (a 31 × 31 plane, every vertex selected).
  const small = await createPrimitive(page, 'plane', {
    width: 4,
    height: 4,
    subdivisionsWidth: 31,
    subdivisionsHeight: 31,
  });
  await runOk(page, 'select.objects', { ids: [small], mode: 'replace' });
  await setMode(page, 'vertex');
  await runOk(page, 'select.mesh.all');
  expect((await call(page, 'model')).selected[small]?.vertex.length).toBe(1024);
  await runOk(page, 'view.tool', { panel: 'viewport', tool: 'move' });
  const thousand = perFrame(await measuredDrag(page));
  await setMode(page, 'object');

  // Soft selection over 10,000 vertices (E2E-MOD-10's workload: the centre vertex, r = 1.8 m).
  const big = await createPrimitive(page, 'plane', {
    width: 10,
    height: 10,
    subdivisionsWidth: 99,
    subdivisionsHeight: 99,
  });
  await runOk(page, 'select.objects', { ids: [big], mode: 'replace' });
  await setMode(page, 'vertex');
  const points = (await call(page, 'meshPositions', big)) as unknown as [number, number, number][];
  let centre = 0;
  points.forEach((p, v) => {
    const q = points[centre] as [number, number, number];
    if (Math.hypot(...p) < Math.hypot(...q) - 1e-12) centre = v;
  });
  await runOk(page, 'select.components', { mesh: big, kind: 'vertex', indices: [centre], mode: 'replace' });
  await runOk(page, 'model.softSelect.set', { on: true, radius: 1.8 });
  const soft = perFrame(await measuredDrag(page));

  const summary =
    `drag 1,024 vertices: per frame mean ${thousand.total.mean.toFixed(2)} ms p95 ${thousand.total.p95.toFixed(2)} ms ` +
    `(moves ${thousand.moves.mean.toFixed(2)} ms, frames ${thousand.frames.mean.toFixed(2)} ms; budget ≤ 4); ` +
    `soft drag over 10k vertices: per frame mean ${soft.total.mean.toFixed(2)} ms p95 ${soft.total.p95.toFixed(2)} ms ` +
    `(moves ${soft.moves.mean.toFixed(2)} ms, frames ${soft.frames.mean.toFixed(2)} ms; budget ≤ 8)`;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    new URL('m6a-transform.json', OUT),
    `${JSON.stringify({ name: 'm6a-transform', at: new Date().toISOString(), summary, thousand, soft }, null, 2)}\n`,
  );
  test.info().annotations.push({ type: 'budget', description: summary });
  console.warn(`[budget] ${summary}`);
});
