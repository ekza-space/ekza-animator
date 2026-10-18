// ARCHITECTURE §14 budgets measured in the production editor (e2e build, real Chrome): idle frames, open-to-
// interactive, scrub latency, playback CPU per frame with 4 panes, a 1,000-key Graph Editor drag, undo/redo of a
// gesture, bake + VRMA write of 10 s at 30 fps (with the first export's lazy chunk), an autosave write of Seed-san with
// 10 clips (M2A-SPEC §5.22), and the editor route's JS of a first and a later visit (cross-checked with `check:size`).
// Report-only (see playwright.config.ts here); results go to annotations, stdout and `.acceptance/budgets/<name>.json`.
// The package benches (vitest) cover the rest of §14; docs/wp-notes/wp-10-budgets.md and m2a-platform-perf.md record
// both.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { checkSize } from '../../scripts/check-size.mjs';
import { controlId, seedSample, seedWaveClip } from '../helpers/seed';
import { call, openEditor, runOk } from '../helpers/test-api';

const OUT = new URL('../../../../.acceptance/budgets/', import.meta.url);
const DEG = Math.PI / 180;

interface BenchProbe {
  canvas2d: number;
  measuring: boolean;
  /** rAF callback time per frame (ms), keyed by the frame's rAF timestamp, while `measuring`. */
  frames: Map<number, number>;
  /** rAF callback and pointermove listener time (ms) since the last read, while `measuring`. */
  busy: number;
}

declare global {
  interface Window {
    __EKZA_BENCH__?: BenchProbe;
  }
}

/**
 * Init script: counts Canvas 2D drawing calls, times every requestAnimationFrame callback per frame and every
 * pointermove listener (the editor's own work for a pointer frame: its handlers plus the frame it renders).
 */
function instrument(): void {
  const probe: BenchProbe = { canvas2d: 0, measuring: false, frames: new Map(), busy: 0 };
  window.__EKZA_BENCH__ = probe;
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of [
    'clearRect',
    'fillRect',
    'strokeRect',
    'fill',
    'stroke',
    'drawImage',
    'fillText',
    'putImageData',
  ]) {
    const original = proto[name];
    if (typeof original !== 'function') continue;
    proto[name] = function (this: unknown, ...args: unknown[]) {
      probe.canvas2d++;
      return original.apply(this, args);
    };
  }
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
        probe.frames.set(ts, (probe.frames.get(ts) ?? 0) + spent);
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
  const wrapperOf = (listener: EventListenerOrEventListenerObject): EventListener => {
    let wrapped = wrappers.get(listener);
    if (wrapped === undefined) {
      const call = (target: unknown, event: Event): unknown =>
        typeof listener === 'function' ? listener.call(target, event) : listener.handleEvent(event);
      wrapped = function (this: unknown, event: Event) {
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

/** The probe's busy time since the last call (ms), reset to 0. */
async function takeBusy(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = window.__EKZA_BENCH__;
    if (probe === undefined) throw new Error('no bench probe');
    const busy = probe.busy;
    probe.busy = 0;
    return busy;
  });
}

function record(name: string, data: Record<string, unknown>, summary: string): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    new URL(`${name}.json`, OUT),
    `${JSON.stringify({ name, at: new Date().toISOString(), summary, ...data }, null, 2)}\n`,
  );
  test.info().annotations.push({ type: 'budget', description: summary });
  console.warn(`[budget] ${summary}`);
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
/** Bytes as decimal kB and KiB (the budget's "kB" is ambiguous at the margin). */
const kb = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB / ${(bytes / 1024).toFixed(1)} KiB`;

async function counters(page: Page): Promise<{ gl: number; canvas2d: number }> {
  return page.evaluate(() => ({
    gl: window.__EKZA_ANIMATOR_TEST__?.renderedFrames() ?? Number.NaN,
    canvas2d: window.__EKZA_BENCH__?.canvas2d ?? Number.NaN,
  }));
}

/** Waits until the frame after the next one has run (lets one animation frame render). */
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

async function startFrameTiming(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.__EKZA_BENCH__;
    if (probe === undefined) throw new Error('no bench probe');
    probe.frames.clear();
    probe.busy = 0;
    probe.measuring = true;
  });
}

async function stopFrameTiming(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const probe = window.__EKZA_BENCH__;
    if (probe === undefined) throw new Error('no bench probe');
    probe.measuring = false;
    return [...probe.frames.values()];
  });
}

/** Main-thread task time (ms) so far, from the DevTools Performance domain. */
async function taskMs(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return (metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? Number.NaN) * 1000;
}

/** The WebGL renderer string and the device pixel ratio the page runs at. */
async function renderer(page: Page): Promise<string> {
  return page.evaluate(
    () => `${window.__EKZA_ANIMATOR_TEST__?.webgl.renderer ?? 'no WebGL'} at DPR ${window.devicePixelRatio}`,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(instrument);
});

test('idle editor: 0 WebGL frames, 0 canvas redraws', async ({ page }) => {
  await openEditor(page);
  const idle = async () => {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1500);
    const before = await counters(page);
    await page.waitForTimeout(2000);
    const after = await counters(page);
    return { webglFrames: after.gl - before.gl, canvas2dCalls: after.canvas2d - before.canvas2d };
  };
  const empty = await idle();
  const seed = await seedWaveClip(page, 'seed-san');
  await runOk(page, 'select.controls', { ids: [seed.control], mode: 'replace' });
  const loaded = await idle();
  await runOk(page, 'view.layout', { layout: 'quad' });
  const quad = await idle();
  record(
    'idle',
    { empty, seedSanWaveSplit: loaded, seedSanWaveQuad: quad, renderer: await renderer(page) },
    `idle 2 s: empty editor ${empty.webglFrames} GL frames / ${empty.canvas2dCalls} 2D calls; Seed-san + wave clip, ` +
      `Graph Editor showing the curve, split ${loaded.webglFrames} / ${loaded.canvas2dCalls}, quad ` +
      `${quad.webglFrames} / ${quad.canvas2dCalls} (budget 0 / 0)`,
  );
});

test('open Seed-san (10.9 MB VRM) to interactive', async ({ page }) => {
  const runs: number[] = [];
  const ready: number[] = [];
  for (let run = 0; run < 3; run++) {
    await openEditor(page);
    // Navigation start → editor ready (WebGL up, kernel started), polled per animation frame by openEditor.
    ready.push(await page.evaluate(() => performance.now()));
    await page.evaluate(() => {
      const w = window as unknown as { __t0?: number };
      addEventListener('pointerdown', () => (w.__t0 = performance.now()), { capture: true, once: true });
    });
    await page.getByTestId('sample-seed-san').click();
    const handle = await page.waitForFunction(
      () => {
        const api = window.__EKZA_ANIMATOR_TEST__;
        const t0 = (window as unknown as { __t0?: number }).__t0;
        if (api === undefined || t0 === undefined || api.counts()['characters'] !== 1) return false;
        try {
          if (api.screenOfControl('fk.head', 'pane-right') === null) return false;
        } catch {
          return false;
        }
        return performance.now() - t0;
      },
      null,
      { polling: 'raf', timeout: 60_000 },
    );
    runs.push((await handle.jsonValue()) as number);
  }
  const s = stats(runs);
  const r = stats(ready);
  record(
    'open-seed-san',
    { runsMs: runs, ...s, editorReadyMs: ready },
    `open Seed-san (sample button → rig on screen): runs ${runs.map(ms).join(', ')}; median ${ms(s.median)}; the ` +
      `editor page itself is ready ${ms(r.median)} after navigation (median) (budget 3,000 ms)`,
  );
});

test('scrub: pointer move → pose visible', async ({ page }) => {
  await openEditor(page);
  const seed = await seedWaveClip(page, 'seed-san');
  const lowerArm = await controlId(page, 'fk.lowerArm.L', seed.character);
  const xs: number[] = [];
  for (let frame = 0; frame <= 40; frame++) xs.push((await call(page, 'screenOfFrame', frame))?.x ?? Number.NaN);
  const y = (await call(page, 'screenOfFrame', 0))?.y ?? Number.NaN;
  await page.evaluate((frameXs) => {
    const api = window.__EKZA_ANIMATOR_TEST__;
    if (api === undefined) throw new Error('no test API');
    const out: { expected: number; frames: number }[] = [];
    (window as unknown as { __scrub?: typeof out }).__scrub = out;
    const frameAt = (x: number) => {
      let best = 0;
      frameXs.forEach((fx, f) => {
        if (Math.abs(fx - x) < Math.abs((frameXs[best] ?? 0) - x)) best = f;
      });
      return best;
    };
    addEventListener(
      'pointermove',
      (event) => {
        if (event.buttons === 0) return;
        const before = api.state().clipFrame;
        const expected = frameAt(event.clientX);
        if (expected === before) return;
        const rf0 = api.renderedFrames();
        let frames = 0;
        // After each animation frame (a task queued from rAF runs once that frame's callbacks are done): has a GL
        // frame been rendered with the new clip frame?
        const check = () =>
          requestAnimationFrame(() =>
            setTimeout(() => {
              if (api.renderedFrames() > rf0 && api.state().clipFrame === expected) {
                out.push({ expected, frames });
              } else if (++frames > 10) {
                out.push({ expected, frames: -1 });
              } else {
                check();
              }
            }, 0),
          );
        check();
      },
      { capture: true },
    );
  }, xs);
  await page.mouse.move(xs[0] ?? 0, y);
  await page.mouse.down();
  for (let frame = 1; frame <= 40; frame++) {
    await page.mouse.move(xs[frame] ?? 0, y);
    await nextFrame(page);
  }
  await page.mouse.up();
  await nextFrame(page);
  const results = await page.evaluate(
    () => (window as unknown as { __scrub?: { expected: number; frames: number }[] }).__scrub ?? [],
  );
  expect((await call(page, 'state')).clipFrame).toBe(40);
  expect((await call(page, 'channelValues', lowerArm, 15))['rz']).toBeCloseTo(-30 * DEG, 9);
  const same = results.filter((r) => r.frames === 0).length;
  const histogram: Record<string, number> = {};
  for (const r of results) histogram[String(r.frames)] = (histogram[String(r.frames)] ?? 0) + 1;
  record(
    'scrub',
    { moves: results.length, sameFrame: same, framesLateHistogram: histogram, renderer: await renderer(page) },
    `scrub (Seed-san + wave, 40 time-slider moves): ${same}/${results.length} poses rendered in the same animation ` +
      `frame; frames late histogram ${JSON.stringify(histogram)} (budget: same animation frame)`,
  );
});

test('playback: 1 VRM, 4 panes, shaded, 30 fps', async ({ page }) => {
  await openEditor(page);
  await seedWaveClip(page, 'seed-san');
  await runOk(page, 'clip.setSettings', { clip: (await call(page, 'state')).activeClip, loop: true });
  await runOk(page, 'view.layout', { layout: 'quad' });
  expect((await call(page, 'panes')).length).toBe(4);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const gl0 = (await counters(page)).gl;
  await startFrameTiming(page);
  const task0 = await taskMs(cdp);
  await runOk(page, 'time.play');
  await page.waitForTimeout(4000);
  const task1 = await taskMs(cdp);
  const frames = await stopFrameTiming(page);
  await runOk(page, 'time.stop');
  const gl = (await counters(page)).gl - gl0;
  const s = stats(frames.slice(5));
  const taskPerFrame = (task1 - task0) / Math.max(1, gl);
  record(
    'playback-quad',
    {
      renderedFrames: gl,
      seconds: 4,
      rafCallbackMs: s,
      mainThreadTaskMsPerRenderedFrame: taskPerFrame,
      renderer: await renderer(page),
    },
    `playback 4 s, Seed-san, quad, shaded: ${gl} GL frames; rAF callbacks per frame mean ${ms(s.mean)}, median ` +
      `${ms(s.median)}, p95 ${ms(s.p95)}; main-thread task time per rendered frame ${ms(taskPerFrame)} (budget ≤ 8 ms CPU/frame)`,
  );
});

test('Graph Editor: drag 1,000 selected keys; undo/redo the gesture', async ({ page }) => {
  await openEditor(page);
  const { clips } = await seedSample(page, 'quaternius-ual', { reduce: null });
  const clip = clips[0] ?? '';
  const graph = await call(page, 'graph');
  expect(graph?.visibleCurves.length ?? 0).toBeGreaterThan(20);
  const visible = new Set(graph?.visibleCurves ?? []);
  const curves = (await call(page, 'curves', clip)).filter((curve) => visible.has(curve.id));
  // 1,000 keys spread over the visible curves (every curve's keys in time order, curve after curve).
  const keys = curves.flatMap((curve) => curve.keys.map((key) => key.id)).slice(0, 1000);
  expect(keys).toHaveLength(1000);
  await runOk(page, 'select.keys', { items: keys.map((key) => ({ key })), mode: 'replace' });
  await runOk(page, 'graph.frame', { what: 'selection' }, { panel: 'graph' });
  await nextFrame(page);
  const rect = (await call(page, 'graph'))?.canvasRect ?? { x: 0, y: 0, w: 0, h: 0 };
  let grab: { x: number; y: number } | null = null;
  for (const key of keys) {
    const point = await call(page, 'screenOfKey', key);
    if (point !== null && point.x > rect.x + 20 && point.x < rect.x + rect.w - 200 && point.y > rect.y + 10) {
      grab = point;
      break;
    }
  }
  if (grab === null) throw new Error('no selected key on screen');
  const before = await call(page, 'curves', clip);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await nextFrame(page);
  await startFrameTiming(page);
  const task0 = await taskMs(cdp);
  const moves = 30;
  const perMove: number[] = [];
  await takeBusy(page);
  // Vertical: the values move (keys every frame on every curve leave no room to move a partial curve in time).
  for (let step = 1; step <= moves; step++) {
    await page.mouse.move(grab.x, grab.y - step * 3);
    await nextFrame(page);
    perMove.push(await takeBusy(page));
  }
  const task1 = await taskMs(cdp);
  const frames = await stopFrameTiming(page);
  await page.mouse.up();
  await nextFrame(page);
  const after = await call(page, 'curves', clip);
  const valueBefore = new Map(before.flatMap((c) => c.keys).map((k) => [k.id, k.v] as const));
  const moved = after.flatMap((c) => c.keys).filter((k) => k.v !== valueBefore.get(k.id)).length;
  expect(moved).toBe(1000);
  expect((await call(page, 'state')).history.undoLabel).not.toBeNull();
  const s = stats(frames);
  const move = stats(perMove);
  const taskPerMove = (task1 - task0) / moves;

  // Undo and redo that gesture (one history step) through the operator, timed in the page.
  const timings = await page.evaluate(async () => {
    const api = window.__EKZA_ANIMATOR_TEST__;
    if (api === undefined) throw new Error('no test API');
    const out: { undo: number[]; redo: number[] } = { undo: [], redo: [] };
    for (let i = 0; i < 5; i++) {
      let start = performance.now();
      await api.run('edit.undo');
      out.undo.push(performance.now() - start);
      start = performance.now();
      await api.run('edit.redo');
      out.redo.push(performance.now() - start);
    }
    return out;
  });
  const undo = stats(timings.undo);
  const redo = stats(timings.redo);
  expect(await call(page, 'curves', clip)).toEqual(after);
  record(
    'graph-drag-1000',
    {
      keys: 1000,
      curves: curves.length,
      moves,
      rafCallbackMs: s,
      pointerFrameMs: move,
      mainThreadTaskMsPerMove: taskPerMove,
      undoMs: undo,
      redoMs: redo,
    },
    `Graph Editor drag of 1,000 selected keys (UAL, ${curves.length} curves): pointermove handlers + rendered frame ` +
      `per move median ${ms(move.median)}, p95 ${ms(move.p95)} (budget ≤ 4 ms); main-thread task time per move incl. ` +
      `the harness ${ms(taskPerMove)}; ` +
      `undo of the gesture median ${ms(undo.median)}, redo ${ms(redo.median)} (budget ≤ 5 ms)`,
  );
});

test('undo/redo one manipulator gesture', async ({ page }) => {
  await openEditor(page);
  const seed = await seedWaveClip(page, 'seed-san');
  await runOk(page, 'time.setFrame', { frame: 15 });
  await runOk(page, 'select.controls', { ids: [seed.control], mode: 'replace' });
  const pane = (await call(page, 'panes')).find((candidate) => candidate.id === 'pane-right')?.rect;
  await page.mouse.move((pane?.x ?? 0) + 30, (pane?.y ?? 0) + 30);
  await page.keyboard.press('KeyE');
  let ring: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      ring = await call(page, 'screenOfManipulator', 'pane-right', 'rz');
      return ring !== null;
    })
    .toBe(true);
  const at = ring as unknown as { x: number; y: number };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(at.x + step * 10, at.y);
  await page.mouse.up();
  await page.mouse.move((pane?.x ?? 0) + 30, (pane?.y ?? 0) + 30);
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await call(page, 'state')).history.canUndo).toBe(true);
  const timings = await page.evaluate(async () => {
    const api = window.__EKZA_ANIMATOR_TEST__;
    if (api === undefined) throw new Error('no test API');
    const out: { undo: number[]; redo: number[] } = { undo: [], redo: [] };
    for (let i = 0; i < 10; i++) {
      let start = performance.now();
      await api.run('edit.undo');
      out.undo.push(performance.now() - start);
      start = performance.now();
      await api.run('edit.redo');
      out.redo.push(performance.now() - start);
    }
    return out;
  });
  const undo = stats(timings.undo);
  const redo = stats(timings.redo);
  record(
    'undo-gesture',
    { undoMs: undo, redoMs: redo },
    `undo/redo of a key step (Seed-san, rotate + S): undo median ${ms(undo.median)} (max ${ms(undo.max)}), redo ` +
      `median ${ms(redo.median)} (max ${ms(redo.max)}) (budget ≤ 5 ms)`,
  );
});

test('pose evaluation in the app, 1 humanoid with every control keyed', async ({ page }) => {
  await openEditor(page);
  const { character } = await seedSample(page, 'seed-san');
  await runOk(page, 'clip.new', { name: 'everything' });
  const controls = (await call(page, 'controls', character)).filter((control) => control.visible);
  await runOk(page, 'select.controls', { ids: controls.map((control) => control.id), mode: 'replace' });
  for (const [i, frame] of [0, 10, 20, 30].entries()) {
    await runOk(page, 'time.setFrame', { frame });
    const edits = controls.flatMap((control, c) =>
      (['rx', 'ry', 'rz'] as const).map((channel, a) => ({
        control: control.id,
        channel,
        value: Math.sin(i * 1.7 + c + a) * 10 * DEG,
      })),
    );
    await runOk(page, 'channel.setValues', { edits });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  const curves = (await call(page, 'curves', (await call(page, 'state')).activeClip ?? '')).length;
  // boneWorld() evaluates the whole pose (curves → channels → rig → bone worlds) into a freshly allocated pose and
  // decomposes one matrix: an upper bound of the per-frame evaluation the editor does into its reused buffers.
  const perCall = await page.evaluate(
    ([id]) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) throw new Error('no test API');
      for (let i = 0; i < 100; i++) api.boneWorld(id, 'hips', (i * 0.37) % 30);
      const runs = 500;
      const start = performance.now();
      for (let i = 0; i < runs; i++) api.boneWorld(id, 'hips', (i * 0.37) % 30);
      return (performance.now() - start) / runs;
    },
    [character] as const,
  );
  record(
    'pose-evaluation-app',
    { controls: controls.length, curves, msPerEvaluation: perCall },
    `pose evaluation in the app (Seed-san, ${controls.length} controls, ${curves} rotation curves keyed): ` +
      `${perCall.toFixed(3)} ms per boneWorld() (full pose incl. curve sampling and a pose allocation) (budget ≤ 0.5 ms)`,
  );
});

test('bake + write VRMA, 1 humanoid × 10 s @ 30 fps', async ({ page }) => {
  await openEditor(page);
  const { character } = await seedSample(page, 'seed-san');
  const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: 'bench' });
  await runOk(page, 'clip.setSettings', { clip, range: { start: 0, end: 300 } });
  const keyed = ['fk.spine', 'fk.chest', 'fk.neck', 'fk.head', 'fk.upperArm.L', 'fk.upperArm.R'];
  keyed.push('fk.lowerArm.L', 'fk.lowerArm.R', 'fk.upperLeg.L', 'fk.upperLeg.R', 'fk.lowerLeg.L', 'fk.lowerLeg.R');
  const ids: string[] = [];
  for (const key of keyed) ids.push(await controlId(page, key, character));
  await runOk(page, 'select.controls', { ids, mode: 'replace' });
  for (const [i, frame] of [0, 60, 120, 180, 240, 300].entries()) {
    await runOk(page, 'time.setFrame', { frame });
    const edits = ids.flatMap((control, c) => [
      { control, channel: 'rx', value: Math.sin(i + c) * 20 * DEG },
      { control, channel: 'rz', value: Math.cos(i * 1.3 + c) * 25 * DEG },
    ]);
    await runOk(page, 'channel.setValues', { edits });
    await runOk(page, 'key.set', { channels: 'rotate' });
  }
  const info = (await call(page, 'clips', character)).find((candidate) => candidate.id === clip);
  expect(info?.fps).toBe(30);
  const request = {
    kind: 'vrma',
    character,
    clips: [clip],
    fileNamePattern: '{character}_{clip}',
    closeLoop: false,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
  };
  const runs = await page.evaluate(async (args) => {
    const api = window.__EKZA_ANIMATOR_TEST__;
    if (api === undefined) throw new Error('no test API');
    const out: { ms: number; status: string; bytes: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const result = await api.run('file.export', args);
      const ms = performance.now() - start;
      const artifacts = result.value as { bytes: Uint8Array }[] | undefined;
      out.push({ ms, status: result.status, bytes: artifacts?.[0]?.bytes.byteLength ?? 0 });
    }
    return out;
  }, request);
  expect(runs.every((r) => r.status === 'finished')).toBe(true);
  // M-2: the first export loads the export path's chunk (@ekza-animator/io/write) unless the Export dialog prefetched
  // it; the later runs are the bake + write itself.
  const s = stats(runs.slice(1).map((r) => r.ms));
  const firstExtra = (runs[0]?.ms ?? Number.NaN) - s.median;
  record(
    'bake-vrma-10s',
    { runs, ...s, firstRunMs: runs[0]?.ms, firstRunExtraMs: firstExtra, frames: 301, controlsKeyed: keyed.length },
    `file.export vrma, Seed-san clip 0–300 @ 30 fps (${keyed.length} controls keyed; bake + write + lints + read-back, ` +
      `${Math.round((runs[0]?.bytes ?? 0) / 1024)} KiB): runs ${runs.map((r) => ms(r.ms)).join(', ')}; median of runs ` +
      `2–5 ${ms(s.median)} (budget ≤ 200 ms for bake + write); the first run loads the export chunk: +${ms(firstExtra)}`,
  );
});

test('autosave write, Seed-san × 10 clips (main thread)', async ({ page }) => {
  await openEditor(page);
  const { character } = await seedSample(page, 'seed-san');
  const keyed = ['fk.spine', 'fk.chest', 'fk.neck', 'fk.head', 'fk.upperArm.L', 'fk.upperArm.R', 'fk.lowerArm.L'];
  keyed.push('fk.lowerArm.R', 'fk.upperLeg.L', 'fk.upperLeg.R', 'fk.lowerLeg.L', 'fk.lowerLeg.R');
  const ids: string[] = [];
  for (const key of keyed) ids.push(await controlId(page, key, character));
  await runOk(page, 'select.controls', { ids, mode: 'replace' });
  for (let c = 0; c < 10; c++) {
    const { clip } = await runOk<{ clip: string }>(page, 'clip.new', { name: `clip${c}` });
    await runOk(page, 'clip.setSettings', { clip, range: { start: 0, end: 120 } });
    for (const [i, frame] of [0, 30, 60, 90, 120].entries()) {
      await runOk(page, 'time.setFrame', { frame });
      const edits = ids.flatMap((control, k) => [
        { control, channel: 'rx', value: Math.sin(i + k + c) * 20 * DEG },
        { control, channel: 'rz', value: Math.cos(i * 1.3 + k + c) * 25 * DEG },
      ]);
      await runOk(page, 'channel.setValues', { edits });
      await runOk(page, 'key.set', { channels: 'rotate' });
    }
  }
  const counts = await call(page, 'counts');
  // The first write stores the 10.9 MB model once (content-addressed); later writes rewrite the snapshot only.
  await page.evaluate(() => window.__EKZA_ANIMATOR_TEST__?.flushAutosave());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const writes: { taskMs: number; wallMs: number }[] = [];
  for (let i = 0; i < 5; i++) {
    await runOk(page, 'channel.setValues', { edits: [{ control: ids[0], channel: 'ry', value: i * 0.01 }] });
    await page.waitForTimeout(100);
    const task0 = await taskMs(cdp);
    const wall = await page.evaluate(async () => {
      const start = performance.now();
      await window.__EKZA_ANIMATOR_TEST__?.flushAutosave();
      return performance.now() - start;
    });
    const task1 = await taskMs(cdp);
    writes.push({ taskMs: task1 - task0, wallMs: wall });
  }
  const task = stats(writes.map((w) => w.taskMs));
  const wall = stats(writes.map((w) => w.wallMs));
  record(
    'autosave-write',
    { counts, writes, taskMs: task, wallMs: wall },
    `autosave write (Seed-san, 10 clips × 12 controls keyed, ${counts['keys']} keys; flushAutosave after one edit): ` +
      `main-thread task time median ${ms(task.median)}, max ${ms(task.max)} (incl. the harness call); wall time ` +
      `median ${ms(wall.median)} (budget ≤ 50 ms main thread)`,
  );
});

/** Script responses of one page load until the empty state shows and the network is idle (gzip -9 per file). */
async function captureRouteScripts(
  page: Page,
  origin: string,
): Promise<{ files: string[]; raw: number; gzip: number; gzip6: number }> {
  const scripts = new Map<string, Buffer>();
  page.on('response', async (response) => {
    if (response.request().resourceType() !== 'script' || !response.url().startsWith(origin)) return;
    try {
      scripts.set(response.url(), await response.body());
    } catch {
      // A redirect or an aborted request has no body.
    }
  });
  await page.goto('/editor');
  await expect(page.getByTestId('dropzone')).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  let raw = 0;
  let gzip = 0;
  let gzip6 = 0;
  for (const body of scripts.values()) {
    raw += body.byteLength;
    gzip += gzipSync(body, { level: 9 }).byteLength;
    gzip6 += gzipSync(body).byteLength;
  }
  const files = [...scripts.keys()].map((url) => new URL(url).pathname.replace(/^\/_next\//, '')).sort();
  return { files, raw, gzip, gzip6 };
}

test('editor route JS (gzip, no fixtures)', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  // First visit (fresh profile): the editor opens the First-run dialog, a lazy chunk, at start.
  const first = await captureRouteScripts(page, origin);
  await expect(page.getByTestId('firstrun-dialog')).toBeVisible();
  const isE2eBuild = await page.evaluate(() =>
    fetch('/e2e/vrma-check', { method: 'HEAD' }).then((response) => response.ok),
  );
  // A later visit: the welcome choices are stored, so the dialog stays closed; a new page of the same profile with
  // the HTTP cache off loads the eager scripts only.
  await page.getByTestId('firstrun-done').click();
  await expect(page.getByTestId('firstrun-dialog')).toBeHidden();
  const later = await page.context().newPage();
  const cdp = await page.context().newCDPSession(later);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const again = await captureRouteScripts(later, origin);
  await expect(later.getByTestId('firstrun-dialog')).toHaveCount(0);
  await later.close();
  // One measurement (M2A-SPEC §5.21.2): `check:size` reads the same sets from the build the server serves.
  const nextDir = fileURLToPath(new URL('../../.next', import.meta.url));
  const gate = existsSync(nextDir) ? checkSize(nextDir) : null;
  const eagerFiles = (gate?.initial.map((entry) => entry.file) ?? []).sort();
  const firstFiles = [...eagerFiles, ...(gate?.firstVisit.flatMap((group) => group.files) ?? [])].sort();
  const cross = (captured: { files: string[]; gzip: number }, files: string[], total: number) => ({
    total,
    files,
    sameFiles: captured.files.join() === files.join(),
    difference: (captured.gzip - total) / total,
  });
  const firstCheck = gate === null ? null : cross(first, firstFiles, gate.total);
  const againCheck = gate === null ? null : cross(again, eagerFiles, gate.eager);
  const verdict = (check: ReturnType<typeof cross> | null) =>
    check === null
      ? ''
      : ` (check:size ${kb(check.total)}, ${(check.difference * 100).toFixed(2)} %, ` +
        `${check.sameFiles ? 'same scripts' : 'different scripts'})`;
  record(
    'route-js',
    {
      e2eBuild: isE2eBuild,
      firstVisit: {
        scripts: first.files.length,
        rawBytes: first.raw,
        gzipBytes: first.gzip,
        gzipDefaultLevelBytes: first.gzip6,
        files: first.files,
        checkSize: firstCheck,
      },
      laterVisit: {
        scripts: again.files.length,
        rawBytes: again.raw,
        gzipBytes: again.gzip,
        gzipDefaultLevelBytes: again.gzip6,
        files: again.files,
        checkSize: againCheck,
      },
    },
    `/editor JS (${isE2eBuild ? 'e2e build' : 'production build'}), first visit: ${first.files.length} scripts, ` +
      `${kb(first.raw)} raw, ${kb(first.gzip)} gzip -9, ${kb(first.gzip6)} gzip -6${verdict(firstCheck)}; later ` +
      `visit: ${again.files.length} scripts, ${kb(again.gzip)} gzip -9${verdict(againCheck)} (budget ≤ 900 kB gzip; ` +
      `M2a target ≤ 800 kB for the first visit)`,
  );
});
