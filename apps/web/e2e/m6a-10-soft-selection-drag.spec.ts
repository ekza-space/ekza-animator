import { expect, type Page, test } from '@playwright/test';
import { createPrimitive, MODEL_PANE, openModel } from './helpers/m6a-model';
import { pressOver } from './helpers/m6a-model-select-ui';
import { call, runOk } from './helpers/test-api';

// E2E-MOD-10 "Soft selection drag" (M6A-SPEC §10.1, §5.15; owner B12a; Gates "—"). A 10,000-vertex plane, the centre
// vertex selected in vertex mode, soft select on (`B` tap) with a 1.8 m radius, the Move tool's `ty` handle dragged
// 50 px up: the centre vertex rises by Δy, every vertex within 1.8 m by w(d/r)·Δy (the smooth preset, Volume falloff:
// d the world distance to the selected vertex), every other vertex is bit-equal; between 900 and 1,100 vertices move;
// one history step. The drag's frame times are recorded (report; budget ≤ 8 ms per frame, §5.27).

type Vec3 = readonly [number, number, number];

interface DragProbe {
  measuring: boolean;
  /** pointermove listener time (ms) per event. */
  moves: number[];
  /** requestAnimationFrame callback time (ms) per frame (the viewport's render with the GPU upload). */
  frames: number[];
}

declare global {
  interface Window {
    __EKZA_SOFT_DRAG__?: DragProbe;
  }
}

/** Init script: times pointermove listeners and animation-frame callbacks while measuring. */
function instrument(): void {
  const probe: DragProbe = { measuring: false, moves: [], frames: [] };
  window.__EKZA_SOFT_DRAG__ = probe;
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
      function softDragMove(this: unknown, event: Event) {
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

function stats(samples: readonly number[]): { n: number; mean: number; p95: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    mean: sorted.reduce((sum, v) => sum + v, 0) / Math.max(1, sorted.length),
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? Number.NaN,
    max: sorted.at(-1) ?? Number.NaN,
  };
}

/** The smooth falloff preset (§5.15): 1 − (3x² − 2x³), x clamped to [0, 1]. */
function smooth(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return 1 - (3 * c * c - 2 * c * c * c);
}

async function positions(page: Page, mesh: string): Promise<Vec3[]> {
  return (await call(page, 'meshPositions', mesh)) as unknown as Vec3[];
}

test('E2E-MOD-10 — soft selection drag', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(instrument);
  await openModel(page);
  const plane = await createPrimitive(page, 'plane', {
    width: 10,
    height: 10,
    subdivisionsWidth: 99,
    subdivisionsHeight: 99,
  });
  expect((await call(page, 'meshInfo', plane))?.counts.v).toBe(10_000);
  await runOk(page, 'select.objects', { ids: [plane], mode: 'replace' });
  await pressOver(page, 'Digit1');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('vertex');
  // The centre vertex: the one nearest the origin (lowest index on ties).
  const before = await positions(page, plane);
  let centre = 0;
  let best = Number.POSITIVE_INFINITY;
  before.forEach((p, v) => {
    const d = Math.hypot(p[0], p[1], p[2]);
    if (d < best - 1e-12) {
      best = d;
      centre = v;
    }
  });
  await runOk(page, 'select.components', { mesh: plane, kind: 'vertex', indices: [centre], mode: 'replace' });
  // `B` (tap) turns soft selection on.
  expect(await call(page, 'softWeights', plane)).toBeNull();
  await pressOver(page, 'KeyB');
  await expect.poll(async () => (await call(page, 'softWeights', plane)) !== null).toBe(true);
  await runOk(page, 'model.softSelect.set', { radius: 1.8 });
  await pressOver(page, 'KeyW');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('move');
  await expect.poll(() => call(page, 'screenOfManipulator', MODEL_PANE, 'ty')).not.toBeNull();
  const ty = await call(page, 'screenOfManipulator', MODEL_PANE, 'ty');
  if (ty === null) throw new Error('no ty handle');
  const steps = (await call(page, 'history')).undo.length;

  // Drag the ty handle 50 px up, measuring the move handlers and the frames in between.
  await page.mouse.move(ty.x, ty.y);
  await page.mouse.down();
  await page.evaluate(() => {
    const probe = window.__EKZA_SOFT_DRAG__;
    if (probe !== undefined) probe.measuring = true;
  });
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(ty.x, ty.y - 2 * i);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  const probe = await page.evaluate(() => {
    const p = window.__EKZA_SOFT_DRAG__;
    if (p !== undefined) p.measuring = false;
    return { moves: p?.moves ?? [], frames: p?.frames ?? [] };
  });
  await page.mouse.up();
  await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + 1);
  expect((await call(page, 'history')).undo.at(-1)).toBe('Move');

  const moves = stats(probe.moves);
  const frames = stats(probe.frames);
  const report = `soft drag over 10k vertices: move handler mean ${moves.mean.toFixed(2)} ms, p95 ${moves.p95.toFixed(2)} ms (n ${moves.n}); frame mean ${frames.mean.toFixed(2)} ms, p95 ${frames.p95.toFixed(2)} ms (n ${frames.n}); budget ≤ 8 ms per frame`;
  test.info().annotations.push({ type: 'budget', description: report });
  console.warn(`[budget] ${report}`);

  const after = await positions(page, plane);
  const c0 = before[centre] as Vec3;
  const dy = (after[centre]?.[1] ?? 0) - c0[1];
  expect(dy).toBeGreaterThan(0);
  let moved = 0;
  before.forEach((p, v) => {
    const q = after[v] as Vec3;
    const d = Math.hypot(p[0] - c0[0], p[1] - c0[1], p[2] - c0[2]);
    if (d < 1.8) {
      expect(q[0]).toBe(p[0]);
      expect(q[2]).toBe(p[2]);
      expect(Math.abs(q[1] - (p[1] + smooth(d / 1.8) * dy))).toBeLessThanOrEqual(1e-6);
    } else {
      expect(q).toEqual(p);
    }
    if (q[0] !== p[0] || q[1] !== p[1] || q[2] !== p[2]) moved++;
  });
  expect(moved).toBeGreaterThanOrEqual(900);
  expect(moved).toBeLessThanOrEqual(1100);
});

// B12a (§5.6, §5.10, §5.15) in the real app: under Object X two drags of one vertex keep the pick ("1 (+1 sym)") and
// the manipulator on it; a value typed during a drag is announced on the help line (the polite live region) once the
// drag commits; Esc cancels the drag and its entry prompt leaves the help line.
test('B12a — symmetric drags keep the pick; typed values are announced; Esc clears the entry', async ({ page }) => {
  await openModel(page);
  const cube = await createPrimitive(page, 'cube');
  await runOk(page, 'select.objects', { ids: [cube], mode: 'replace' });
  await runOk(page, 'model.symmetry.set', { mode: 'object-x' });
  await pressOver(page, 'Digit1');
  await expect.poll(async () => (await call(page, 'state')).mode).toBe('vertex');
  const rest = await positions(page, cube);
  const find = (x: number, y: number, z: number): number =>
    rest.findIndex((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6 && Math.abs(p[2] - z) < 1e-6);
  const v = find(0.5, 0.5, 0.5);
  const mirror = find(-0.5, 0.5, 0.5);
  expect(v).toBeGreaterThanOrEqual(0);
  expect(mirror).toBeGreaterThanOrEqual(0);
  await runOk(page, 'select.components', { mesh: cube, kind: 'vertex', indices: [v], mode: 'replace' });
  await pressOver(page, 'KeyW');
  await expect.poll(async () => (await call(page, 'state')).tool).toBe('move');
  const steps = (await call(page, 'history')).undo.length;

  /** Presses the ty handle and drags it 20 px up (the capture window arms for the drag). */
  async function startDrag(): Promise<void> {
    await expect.poll(() => call(page, 'screenOfManipulator', MODEL_PANE, 'ty')).not.toBeNull();
    const ty = await call(page, 'screenOfManipulator', MODEL_PANE, 'ty');
    if (ty === null) throw new Error('no ty handle');
    await page.mouse.move(ty.x, ty.y);
    await page.mouse.down();
    await page.mouse.move(ty.x, ty.y - 20, { steps: 4 });
    await expect.poll(async () => (await call(page, 'state')).capture.armed).toBe('drag');
  }

  for (const [n, value] of [
    [1, '0.5'],
    [2, '0.25'],
  ] as const) {
    await startDrag();
    await page.keyboard.type(value);
    await expect.poll(() => call(page, 'helpLine')).toContain(`Translate Y ${value}_`);
    await page.keyboard.press('Enter');
    await page.mouse.up();
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(steps + n);
    expect((await call(page, 'history')).undo.at(-1)).toBe('Move');
    await expect.poll(() => call(page, 'helpLine')).toBe(`Move Translate Y ${Number(value).toFixed(3)} m`);
    const model = await call(page, 'model');
    expect(model.selected[cube]?.vertex).toEqual([v]);
    expect([...(model.expanded[cube]?.vertex ?? [])].sort((a, b) => a - b)).toEqual([v, mirror].sort((a, b) => a - b));
    // The manipulator sits on the moved pick (not on the mirror plane between the pick and its partner).
    await expect
      .poll(async () => {
        const at = await call(page, 'screenOfVertex', cube, v, MODEL_PANE);
        const grab = await call(page, 'screenOfManipulator', MODEL_PANE, 'tview');
        return at === null || grab === null ? Number.POSITIVE_INFINITY : Math.hypot(at.x - grab.x, at.y - grab.y);
      })
      .toBeLessThanOrEqual(1);
  }
  const after = await positions(page, cube);
  for (const w of [v, mirror]) {
    expect(after[w]?.[1]).toBeCloseTo(1.25, 6);
    expect(after[w]?.[0]).toBe(rest[w]?.[0]);
    expect(after[w]?.[2]).toBe(rest[w]?.[2]);
  }

  // Esc cancels the drag with its entry: no step, the prompt leaves the help line.
  await startDrag();
  await page.keyboard.type('0.3');
  await expect.poll(() => call(page, 'helpLine')).toContain('Translate Y 0.3_');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  // At once, not when the help line's message times out (4 s).
  await expect.poll(() => call(page, 'helpLine'), { timeout: 1_000 }).not.toContain('0.3_');
  expect((await call(page, 'history')).undo).toHaveLength(steps + 2);
  expect(await positions(page, cube)).toEqual(after);
});
