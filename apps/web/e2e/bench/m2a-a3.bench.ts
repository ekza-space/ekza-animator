// M2A-SPEC §5.10 / §5.22 budgets of the Dope Sheet (A3, report only): redraw of a dense character (every control
// keyed on every keyable channel at 200 frames) and a drag of 1,000 selected keys, in the production editor (e2e
// build, real Chrome, DPR 2). Results go to annotations, stdout and `.acceptance/budgets/<name>.json`, like
// budgets.bench.ts. Run: `pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m2a-a3`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { seedSample } from '../helpers/seed';
import { call, openEditor, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);
const FRAMES = 200;

interface Probe {
  measuring: boolean;
  busy: number;
  frames: number[];
}

declare global {
  interface Window {
    __EKZA_A3_BENCH__?: Probe;
  }
}

/** Times every requestAnimationFrame callback and pointermove/wheel listener while measuring. */
function instrument(): void {
  const probe: Probe = { measuring: false, busy: 0, frames: [] };
  window.__EKZA_A3_BENCH__ = probe;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((ts) => {
      if (!probe.measuring) {
        callback(ts);
        return;
      }
      const start = performance.now();
      try {
        callback(ts);
      } finally {
        const spent = performance.now() - start;
        probe.frames.push(spent);
        probe.busy += spent;
      }
    });
  type ListenerMethod = (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  const add: ListenerMethod = Reflect.get(EventTarget.prototype, 'addEventListener');
  const remove: ListenerMethod = Reflect.get(EventTarget.prototype, 'removeEventListener');
  const wrappers = new WeakMap<object, EventListener>();
  const timedTypes = new Set(['pointermove', 'wheel']);
  const wrapperOf = (listener: EventListenerOrEventListenerObject): EventListener => {
    let wrapped = wrappers.get(listener);
    if (wrapped === undefined) {
      const invoke = (target: unknown, event: Event): unknown =>
        typeof listener === 'function' ? listener.call(target, event) : listener.handleEvent(event);
      wrapped = function (this: unknown, event: Event) {
        if (!probe.measuring) return invoke(this, event);
        const start = performance.now();
        try {
          return invoke(this, event);
        } finally {
          probe.busy += performance.now() - start;
        }
      };
      wrappers.set(listener, wrapped);
    }
    return wrapped;
  };
  EventTarget.prototype.addEventListener = function (this: EventTarget, type, listener, options) {
    const timed = timedTypes.has(type) && listener !== null;
    return add.call(this, type, timed ? wrapperOf(listener) : listener, options);
  };
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type, listener, options) {
    const timed = timedTypes.has(type) && listener !== null;
    return remove.call(this, type, timed ? (wrappers.get(listener) ?? listener) : listener, options);
  };
}

async function measuring(page: Page, on: boolean): Promise<number[]> {
  return page.evaluate((value) => {
    const probe = window.__EKZA_A3_BENCH__;
    if (probe === undefined) throw new Error('no bench probe');
    probe.measuring = value;
    const frames = probe.frames;
    probe.frames = [];
    probe.busy = 0;
    return frames;
  }, on);
}

async function takeBusy(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = window.__EKZA_A3_BENCH__;
    if (probe === undefined) throw new Error('no bench probe');
    const busy = probe.busy;
    probe.busy = 0;
    return busy;
  });
}

async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

function stats(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? Number.NaN;
  return {
    n: sorted.length,
    mean: sorted.reduce((sum, v) => sum + v, 0) / Math.max(1, sorted.length),
    median: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1) ?? Number.NaN,
  };
}

const ms = (value: number) => `${value.toFixed(2)} ms`;

function record(name: string, data: Record<string, unknown>, summary: string): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    new URL(`${name}.json`, OUT),
    `${JSON.stringify({ name, at: new Date().toISOString(), summary, ...data }, null, 2)}\n`,
  );
  test.info().annotations.push({ type: 'budget', description: summary });
  console.warn(`[budget] ${summary}`);
}

/**
 * Seed-san with every control of the character keyed on every keyable channel at frames 0…199 (values vary with
 * the frame, so spans move and holds are computed for real), the Dope Sheet showing the whole character.
 */
async function denseCharacter(page: Page): Promise<{ clip: string; curves: number; keys: number }> {
  await seedSample(page, 'seed-san');
  const clip = (await call(page, 'state')).activeClip ?? '';
  await runOk(page, 'clip.setSettings', { clip, range: { start: 0, end: FRAMES - 1 } });
  const controls = (await call(page, 'controls')).filter((control) => control.visible).map((control) => control.id);
  await page.evaluate(
    async ({ ids, frames }) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) throw new Error('no test API');
      for (let frame = 0; frame < frames; frame++) {
        await api.run('time.setFrame', { frame });
        const value = Math.sin(frame / 7) * 0.3;
        await api.run('channel.setValues', {
          edits: ids.flatMap((control) => [
            { control, channel: 'rx', value },
            { control, channel: 'ry', value: value / 2 },
          ]),
          key: 'none',
        });
        await api.run('key.set', { target: 'character', channels: 'all' });
      }
    },
    { ids: controls, frames: FRAMES },
  );
  const curves = (await call(page, 'curves', clip)).filter((curve) => curve.keys.length > 0);
  return { clip, curves: curves.length, keys: curves.reduce((n, curve) => n + curve.keys.length, 0) };
}

async function showCharacter(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  await runOk(page, 'workspace.showPanel', { panel: 'dopeSheet' });
  await expect(page.getByTestId('ds-show')).toBeVisible();
  await page.getByTestId('ds-show').selectOption('character');
  await expect.poll(async () => (await call(page, 'dopeSheet'))?.rows.length ?? 0).toBeGreaterThan(10);
  const sheet = await call(page, 'dopeSheet');
  if (sheet === null) throw new Error('the Dope Sheet is hidden');
  return sheet.canvasRect;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(instrument);
});

test('Dope Sheet: redraw of a dense character', async ({ page }) => {
  await openEditor(page);
  const dense = await denseCharacter(page);
  const rect = await showCharacter(page);
  const rows = (await call(page, 'dopeSheet'))?.rows.length ?? 0;
  await page.mouse.move(rect.x + rect.w / 2, rect.y + rect.h / 2);
  await nextFrame(page);

  // Warm redraws: wheel zooms repaint the whole sheet from cached row data.
  await measuring(page, true);
  const zoom: number[] = [];
  await takeBusy(page);
  for (let step = 0; step < 30; step++) {
    await page.mouse.wheel(0, step % 2 === 0 ? -40 : 40);
    await nextFrame(page);
    zoom.push(await takeBusy(page));
  }
  await measuring(page, false);

  // Cold redraws: a key selection change re-aggregates the visible rows' glyphs.
  const keys = (await call(page, 'curves', dense.clip)).flatMap((curve) => curve.keys.map((key) => key.id));
  const select: number[] = [];
  for (let step = 0; step < 10; step++) {
    const items = keys.slice(step * 100, step * 100 + 100).map((key) => ({ key }));
    await measuring(page, true);
    await runOk(page, 'select.keys', { items, mode: 'replace' });
    await nextFrame(page);
    select.push((await measuring(page, false)).reduce((sum, v) => sum + v, 0));
  }
  const warm = stats(zoom);
  const cold = stats(select);
  record(
    'dope-sheet-redraw',
    { ...dense, rows, warmFrameMs: warm, selectionFrameMs: cold },
    `Dope Sheet redraw (Seed-san, ${dense.curves} keyed curves, ${dense.keys} keys, ${rows} rows): wheel zoom frame ` +
      `median ${ms(warm.median)}, p95 ${ms(warm.p95)}; selection change frame median ${ms(cold.median)}, p95 ` +
      `${ms(cold.p95)} (budget ≤ 4 ms)`,
  );
});

test('Dope Sheet: drag 1,000 selected keys', async ({ page }) => {
  await openEditor(page);
  const dense = await denseCharacter(page);
  await showCharacter(page);
  // The last frames' keys of every curve (≈ 1,000): moved later, nothing stops them.
  const curves = await call(page, 'curves', dense.clip);
  const keys = curves
    .flatMap((curve) => curve.keys)
    .sort((a, b) => b.t - a.t)
    .slice(0, 1000);
  const first = Math.min(...keys.map((key) => key.t));
  await runOk(page, 'select.keys', { items: keys.map((key) => ({ key: key.id })), mode: 'replace' });
  await runOk(page, 'dopeSheet.frame', { what: 'all' }, { panel: 'dopeSheet' });
  await nextFrame(page);
  const grab = await call(page, 'screenOfDopeRegion', 'middle');
  if (grab === null) throw new Error('no region bar');
  const sheet = await call(page, 'dopeSheet');
  const sx = sheet?.view.sx ?? 1;
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await nextFrame(page);
  await measuring(page, true);
  await takeBusy(page);
  const perMove: number[] = [];
  for (let step = 1; step <= 30; step++) {
    await page.mouse.move(grab.x + step * Math.max(sx, 2), grab.y);
    await nextFrame(page);
    perMove.push(await takeBusy(page));
  }
  await measuring(page, false);
  await page.mouse.up();
  await nextFrame(page);
  const moved = (await call(page, 'curves', dense.clip))
    .flatMap((curve) => curve.keys)
    .filter((key) => keys.some((selected) => selected.id === key.id) && key.t > first).length;
  expect(moved).toBe(1000);
  const drag = stats(perMove);
  record(
    'dope-sheet-drag-1000',
    { ...dense, selected: keys.length, moves: perMove.length, pointerFrameMs: drag },
    `Dope Sheet drag of 1,000 selected keys (${dense.curves} curves, ${dense.keys} keys): pointermove handlers + ` +
      `rendered frame per move median ${ms(drag.median)}, p95 ${ms(drag.p95)} (budget ≤ 4 ms)`,
  );
});
