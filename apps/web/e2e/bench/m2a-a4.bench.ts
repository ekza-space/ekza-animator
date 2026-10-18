// M2A-SPEC §5.21.1 (M-1, A4) and §5.22: the Graph Editor drag of 1,000 selected keys with its frame split, and the
// tween slider drag on 60 channels. Report-only like `budgets.bench.ts` (A5's file): results go to annotations,
// stdout and `.acceptance/budgets/<name>.json`. The M-1 gate (p95 ≤ 4.0 ms on the measuring machine) is recorded in
// docs/wp-notes/m2a-graph-posing.md from these numbers.
//
// The frame split comes from a CPU profile of a second, identical drag (DevTools Profiler, 100 µs sampling): each
// sample is attributed to the first matching category on its stack, from the innermost frame outwards. Class methods
// and object-literal properties keep their names in the production build, so the categories are method names.
// Run: `EKZA_E2E_PORT=<port> pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts m2a-a4`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { seedSample } from '../helpers/seed';
import { call, openEditor, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);
const DEG = Math.PI / 180;

interface BenchProbe {
  measuring: boolean;
  /** rAF callback and pointermove listener time (ms) since the last read, while `measuring`. */
  busy: number;
}

declare global {
  interface Window {
    __EKZA_A4_BENCH__?: BenchProbe;
  }
}

/** Init script: times every requestAnimationFrame callback and every pointermove listener while measuring. */
function instrument(): void {
  const probe: BenchProbe = { measuring: false, busy: 0 };
  window.__EKZA_A4_BENCH__ = probe;
  const raf = window.requestAnimationFrame.bind(window);
  // Named wrappers: the profile attribution counts only samples under them (the editor's own work).
  window.requestAnimationFrame = (callback) =>
    raf(function a4BenchFrame(ts) {
      if (!probe.measuring) {
        callback(ts);
        return;
      }
      const start = performance.now();
      try {
        callback(ts);
      } finally {
        probe.busy += performance.now() - start;
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
  const wrapperOf = (listener: EventListenerOrEventListenerObject): EventListener => {
    let wrapped = wrappers.get(listener);
    if (wrapped === undefined) {
      const call = (target: unknown, event: Event): unknown =>
        typeof listener === 'function' ? listener.call(target, event) : listener.handleEvent(event);
      wrapped = function a4BenchPointerMove(this: unknown, event: Event) {
        if (!probe.measuring) return call(this, event);
        const start = performance.now();
        try {
          return call(this, event);
        } finally {
          probe.busy += performance.now() - start;
        }
      };
      wrappers.set(listener, wrapped);
    }
    return wrapped;
  };
  EventTarget.prototype.addEventListener = function (this: EventTarget, type, listener, options) {
    const timed = type === 'pointermove' && listener !== null;
    return add.call(this, type, timed ? wrapperOf(listener) : listener, options);
  };
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type, listener, options) {
    const timed = type === 'pointermove' && listener !== null;
    return remove.call(this, type, timed ? (wrappers.get(listener) ?? listener) : listener, options);
  };
}

async function setMeasuring(page: Page, on: boolean): Promise<void> {
  await page.evaluate((value) => {
    const probe = window.__EKZA_A4_BENCH__;
    if (probe === undefined) throw new Error('no bench probe');
    probe.measuring = value;
    probe.busy = 0;
  }, on);
}

async function takeBusy(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = window.__EKZA_A4_BENCH__;
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

function stats(samples: readonly number[]): { n: number; mean: number; median: number; p95: number; max: number } {
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

// ---------- CPU profile attribution ----------

interface ProfileNode {
  readonly id: number;
  readonly callFrame: {
    readonly functionName: string;
    readonly url: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
  };
  readonly children?: readonly number[];
}
interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

/**
 * Categories of the frame split, matched on function names from the innermost stack frame outwards (the first
 * category found wins). The names are methods and properties that survive minification.
 */
const CATEGORIES: readonly (readonly [string, ReadonlySet<string>])[] = [
  ['curve compile', new Set(['compile'])],
  ['store preview update', new Set(['previewUpdate', 'previewCommit'])],
  ['Graph Editor redraw', new Set(['renderBase', 'renderOverlay'])],
  ['Graph Editor curve set', new Set(['curveSet', 'scene'])],
  ['viewport GL render', new Set(['renderPane'])],
  ['viewport pose sync', new Set(['prepareFrame'])],
  ['pose evaluation', new Set(['tick', 'sample', 'evaluate'])],
  ['coalesced updates', new Set(['flushScheduled'])],
];

function attribute(profile: CpuProfile): {
  readonly totalMs: number;
  readonly byCategory: Record<string, number>;
  readonly topSelf: readonly { readonly name: string; readonly ms: number }[];
} {
  const parent = new Map<number, number>();
  const byId = new Map<number, ProfileNode>();
  for (const node of profile.nodes) {
    byId.set(node.id, node);
    for (const child of node.children ?? []) parent.set(child, node.id);
  }
  const categoryOf = new Map<number, string>();
  /** The sample's category, or null outside the editor's frame callbacks and pointermove listeners. */
  const resolve = (id: number): string | null => {
    const cached = categoryOf.get(id);
    if (cached !== undefined) return cached === '' ? null : cached;
    let found: string | null = null;
    let inEditor = false;
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
      const name = byId.get(at)?.callFrame.functionName ?? '';
      if (found === null) found = CATEGORIES.find(([, names]) => names.has(name))?.[0] ?? null;
      if (name === 'a4BenchFrame' || name === 'a4BenchPointerMove') {
        inEditor = true;
        break;
      }
    }
    const category = inEditor ? (found ?? 'other') : null;
    categoryOf.set(id, category ?? '');
    return category;
  };
  const byCategory: Record<string, number> = {};
  const self = new Map<string, number>();
  let totalMs = 0;
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i] as number;
    const dt = ((deltas[i + 1] ?? deltas[i] ?? 0) as number) / 1000;
    const category = resolve(id);
    if (category === null) continue;
    totalMs += dt;
    byCategory[category] = (byCategory[category] ?? 0) + dt;
    const node = byId.get(id);
    const frame = node?.callFrame;
    const name = `${frame?.functionName || '(anonymous)'} ${frame?.url.split('/').at(-1) ?? ''}:${frame?.lineNumber ?? 0}:${frame?.columnNumber ?? 0}`;
    self.set(name, (self.get(name) ?? 0) + dt);
  }
  const topSelf = [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, value]) => ({ name, ms: value }));
  return { totalMs, byCategory, topSelf };
}

// ---------- the 1,000-key drag (M-1) ----------

interface DragSetup {
  readonly clip: string;
  readonly keys: readonly string[];
  readonly curves: number;
  readonly grab: { readonly x: number; readonly y: number };
}

async function setupThousandKeys(page: Page): Promise<DragSetup> {
  const { clips } = await seedSample(page, 'quaternius-ual', { reduce: null });
  const clip = clips[0] ?? '';
  const graph = await call(page, 'graph');
  expect(graph?.visibleCurves.length ?? 0).toBeGreaterThan(20);
  const visible = new Set(graph?.visibleCurves ?? []);
  const curves = (await call(page, 'curves', clip)).filter((curve) => visible.has(curve.id));
  // The budgets.bench.ts selection: 1,000 keys, every curve's keys in time order, curve after curve.
  const keys = curves.flatMap((curve) => curve.keys.map((key) => key.id)).slice(0, 1000);
  expect(keys).toHaveLength(1000);
  await runOk(page, 'select.keys', { items: keys.map((key) => ({ key })), mode: 'replace' });
  await runOk(page, 'graph.frame', { what: 'selection' }, { panel: 'graph' });
  await nextFrame(page);
  const rect = (await call(page, 'graph'))?.canvasRect ?? { x: 0, y: 0, w: 0, h: 0 };
  for (const key of keys) {
    const point = await call(page, 'screenOfKey', key);
    if (point !== null && point.x > rect.x + 20 && point.x < rect.x + rect.w - 200 && point.y > rect.y + 60) {
      return { clip, keys, curves: curves.filter((c) => c.keys.some((k) => keys.includes(k.id))).length, grab: point };
    }
  }
  throw new Error('no selected key on screen');
}

/** One vertical drag of `moves` pointer moves, one per animation frame; per-move handler + frame times (ms). */
async function drag(page: Page, grab: { readonly x: number; readonly y: number }, moves: number): Promise<number[]> {
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await nextFrame(page);
  await setMeasuring(page, true);
  const perMove: number[] = [];
  for (let step = 1; step <= moves; step++) {
    await page.mouse.move(grab.x, grab.y - step * 2);
    await nextFrame(page);
    perMove.push(await takeBusy(page));
  }
  await setMeasuring(page, false);
  await page.mouse.up();
  await nextFrame(page);
  return perMove;
}

async function profiled<T>(
  cdp: CDPSession,
  fn: () => Promise<T>,
): Promise<{ readonly value: T; readonly profile: CpuProfile }> {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const value = await fn();
  const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile };
  await cdp.send('Profiler.disable');
  return { value, profile };
}

async function loadAverage(): Promise<string> {
  const os = await import('node:os');
  return os
    .loadavg()
    .map((v) => v.toFixed(1))
    .join(' / ');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(instrument);
});

test('M-1: Graph Editor drag of 1,000 selected keys, with the frame split', async ({ page }) => {
  await openEditor(page);
  const setup = await setupThousandKeys(page);
  const before = await call(page, 'curves', setup.clip);
  const valueBefore = new Map(before.flatMap((c) => c.keys).map((k) => [k.id, k.v] as const));
  const load = await loadAverage();

  // Warm-up drag (JIT, caches), undone; then the timed drags.
  await drag(page, setup.grab, 10);
  await runOk(page, 'edit.undo');
  const timed: number[] = [];
  for (let round = 0; round < 3; round++) {
    timed.push(...(await drag(page, setup.grab, 40)));
    if (round === 0) {
      const after = await call(page, 'curves', setup.clip);
      const moved = after.flatMap((c) => c.keys).filter((k) => k.v !== valueBefore.get(k.id)).length;
      expect(moved).toBe(1000);
    }
    await runOk(page, 'edit.undo');
  }
  const move = stats(timed);

  // The frame split: the same drag under the CPU profiler.
  const cdp = await page.context().newCDPSession(page);
  const { value: profiledMoves, profile } = await profiled(cdp, () => drag(page, setup.grab, 40));
  await runOk(page, 'edit.undo');
  const split = attribute(profile);
  const perMoveSplit = Object.fromEntries(
    Object.entries(split.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([category, total]) => [category, total / profiledMoves.length]),
  );
  record(
    'm2a-graph-drag-1000',
    {
      keys: setup.keys.length,
      curves: setup.curves,
      loadAverage: load,
      pointerFrameMs: move,
      profiledPointerFrameMs: stats(profiledMoves),
      splitMsPerMove: perMoveSplit,
      topSelfMs: split.topSelf,
    },
    `M-1 Graph Editor drag of 1,000 selected keys (UAL, ${setup.curves} curves, ${timed.length} moves, load ${load}): ` +
      `handlers + rendered frame per move median ${ms(move.median)}, p95 ${ms(move.p95)} (gate p95 ≤ 4.0 ms); ` +
      `split per move (profiled): ${Object.entries(perMoveSplit)
        .map(([k, v]) => `${k} ${ms(v)}`)
        .join(', ')}`,
  );
});

test('tween slider drag on 60 channels (status-line bar)', async ({ page }) => {
  await openEditor(page);
  const { character } = await seedSample(page, 'seed-san');
  await runOk(page, 'clip.new', { name: 'tween60' });
  // 20 FK controls × rx/ry/rz = 60 channels.
  const controls = (await call(page, 'controls', character))
    .filter((control) => control.visible && control.key.startsWith('fk.'))
    .slice(0, 20)
    .map((control) => control.id);
  expect(controls).toHaveLength(20);
  await runOk(page, 'select.controls', { ids: controls, mode: 'replace' });
  for (const [frame, sign] of [
    [0, 1],
    [20, -1],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame });
    const edits = controls.flatMap((control, c) =>
      (['rx', 'ry', 'rz'] as const).map((channel, a) => ({ control, channel, value: sign * (10 + c + a) * DEG })),
    );
    await runOk(page, 'channel.setValues', { edits });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  await runOk(page, 'time.setFrame', { frame: 10 });
  const from = await call(page, 'screenOfTween', 'status', 0);
  const to = await call(page, 'screenOfTween', 'status', 100);
  if (from === null || to === null) throw new Error('no status-line Tween bar');
  const load = await loadAverage();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await nextFrame(page);
  await setMeasuring(page, true);
  const perMove: number[] = [];
  const moves = 40;
  for (let step = 1; step <= moves; step++) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / moves, from.y);
    await nextFrame(page);
    perMove.push(await takeBusy(page));
  }
  await setMeasuring(page, false);
  await page.mouse.up();
  await nextFrame(page);
  const curves = await call(page, 'curves', (await call(page, 'state')).activeClip ?? '');
  const tweened = curves.filter((curve) => curve.keys.some((key) => key.t === 10 && key.breakdown)).length;
  expect(tweened).toBe(60);
  const s = stats(perMove);
  record(
    'm2a-tween-drag-60',
    { channels: 60, moves, loadAverage: load, pointerFrameMs: s },
    `Tween slider drag on 60 channels (Seed-san, status-line bar, load ${load}): handlers + rendered frame per move ` +
      `median ${ms(s.median)}, p95 ${ms(s.p95)} (budget ≤ 4 ms)`,
  );
});
