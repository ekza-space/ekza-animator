// Graph Editor helpers of the e2e-g2 scenarios (MVP-SPEC §6.2 E2E-08…E2E-13): real pointer and keyboard input at
// coordinates from the §4.8 test API, and readers of the wave curve's state through the test API.
import { expect, type Page } from '@playwright/test';
import type { WaveSeed } from './seed';
import { call } from './test-api';

export const DEG = Math.PI / 180;
/** Display scale of rotation channels (MVP-SPEC §4.11.4 `k`). */
export const K_ROT = 180 / Math.PI;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Curve = Awaited<ReturnType<typeof readRz>>;
export type Key = Curve['keys'][number];

/** Polls a test-API point until the panel has drawn it. */
export async function pointOf(page: Page, read: () => Promise<Point | null>, what: string): Promise<Point> {
  let point: Point | null = null;
  await expect
    .poll(
      async () => {
        point = await read();
        return point !== null;
      },
      { message: `${what} on screen`, timeout: 15_000 },
    )
    .toBe(true);
  return point as unknown as Point;
}

/** The wave's rz curve as `curves()` reports it. */
export async function readRz(page: Page, seed: WaveSeed) {
  const curve = (await call(page, 'curves', seed.clip, seed.control)).find((candidate) => candidate.id === seed.rz);
  if (curve === undefined) throw new Error(`no curve ${seed.rz}`);
  return curve;
}

/** The key of the rz curve at `frame` (exact frame match). */
export async function rzKeyAt(page: Page, seed: WaveSeed, frame: number): Promise<Key> {
  const key = (await readRz(page, seed)).keys.find((candidate) => candidate.t === frame);
  if (key === undefined) throw new Error(`no rz key at frame ${frame}`);
  return key;
}

/** `curveValue(curve, f)` for f = from, from + step, …, to. */
export async function sampleCurve(page: Page, curve: string, from: number, to: number, step: number) {
  return page.evaluate(
    ([id, a, b, h]) => {
      const api = window.__EKZA_ANIMATOR_TEST__;
      if (api === undefined) throw new Error('no test API');
      const samples: { frame: number; value: number }[] = [];
      const count = Math.round((b - a) / h);
      for (let i = 0; i <= count; i++) {
        const frame = a + i * h;
        samples.push({ frame, value: api.curveValue(id, frame) });
      }
      return samples;
    },
    [curve, from, to, step] as const,
  );
}

/**
 * One-sided slopes of the evaluated curve at a key (value units per frame), second-order differences of `curveValue`
 * (error ~h²·f‴, far below 1e-9 rad/frame on the wave). The test API reports stored handles only; a computed
 * (auto, spline, …) side's resolved slope is read off the evaluated curve.
 */
export async function slopesAt(page: Page, curve: string, frame: number, h = 1e-4) {
  const [m2, m1, c, p1, p2] = await Promise.all(
    [-2 * h, -h, 0, h, 2 * h].map((d) => call(page, 'curveValue', curve, frame + d)),
  );
  return {
    in: (3 * c - 4 * m1 + m2) / (2 * h),
    out: (-3 * c + 4 * p1 - p2) / (2 * h),
  };
}

/** Maya tangent weight of a stored handle (MVP-SPEC §4.11.4): 3·hypot(|dt|/fps, dv·k). */
export function weightOf(handle: { readonly dt: number; readonly dv: number }, fps: number, k = K_ROT): number {
  return 3 * Math.hypot(Math.abs(handle.dt) / fps, handle.dv * k);
}

/** A real LMB drag: press at `from`, move in `steps` equal increments by (dx, dy), release. */
export async function dragBy(page: Page, from: Point, dx: number, dy: number, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(from.x + (dx * step) / steps, from.y + (dy * step) / steps);
  }
  await page.mouse.up();
}

/** Clicks a Graph Editor key and waits until it is the only selected key. */
export async function clickKey(page: Page, key: string, what: string): Promise<Point> {
  const at = await pointOf(page, () => call(page, 'screenOfKey', key), what);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys).toEqual([key]);
  return at;
}

/** Moves the pointer over the Graph Editor canvas (keys follow the hovered panel, §4.10), away from the curves. */
export async function hoverGraph(page: Page): Promise<void> {
  const graph = await call(page, 'graph');
  if (graph === null) throw new Error('no Graph Editor');
  const { x, y, w } = graph.canvasRect;
  await page.mouse.move(x + w - 12, y + 12);
}

/** Types into a numeric field and commits it with Enter (the field gives the focus back, INT-40). */
export async function typeField(page: Page, testId: string, text: string): Promise<void> {
  const field = page.getByTestId(testId);
  await expect(field).toBeEnabled();
  await field.fill(text);
  await field.press('Enter');
  await expect(field).not.toBeFocused();
}

/**
 * E2E-09's steps (shared with E2E-13): click key@15, press `B`, drag its out handle 40 px up. Returns the curve after
 * the break (before the drag) and after the drag.
 */
export async function breakAndPenDrag(page: Page, seed: WaveSeed): Promise<{ broken: Curve; dragged: Curve }> {
  const key15 = (await rzKeyAt(page, seed, 15)).id;
  await clickKey(page, key15, 'key@15');
  await page.keyboard.press('KeyB');
  await expect.poll(async () => (await rzKeyAt(page, seed, 15)).broken).toBe(true);
  const broken = await readRz(page, seed);
  const handle = await pointOf(page, () => call(page, 'screenOfHandle', key15, 'out'), 'out handle of key@15');
  await dragBy(page, handle, 0, -40);
  await expect.poll(async () => (await rzKeyAt(page, seed, 15)).outType).toBe('fixed');
  return { broken, dragged: await readRz(page, seed) };
}
