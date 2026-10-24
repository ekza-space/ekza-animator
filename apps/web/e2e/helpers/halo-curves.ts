// Curves e2e helpers (STUDIO-TOUCH-SPEC §10.5, §20.7; T10): the `curves` part of `halo()`'s animate slice (the layer
// as drawn: its keys in page px, the chips, the time axis, the selected keys' numbers), the Thread's layer switch, the
// curve's petals, a marquee over a walk's contact keys, and one input (a finger or the Pencil) for the journeys.
import { expect, type Page } from '@playwright/test';
import { animate } from './halo-animate';
import { fingerDrag, fingerTap, penStroke, penTap, type Point } from './touch';

export interface CurvesSlice {
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly scale: number;
  readonly view: { readonly f0: number; readonly v0: number; readonly sx: number; readonly sy: number };
  readonly tool: string;
  readonly axis: string;
  readonly compare: boolean;
  readonly controls: readonly string[];
  readonly chips: readonly { readonly channel: string; readonly label: string; readonly chosen: boolean }[];
  readonly curves: readonly string[];
  readonly keys: readonly {
    readonly id: string;
    readonly curve: string;
    readonly frame: number;
    readonly value: number;
    readonly x: number;
    readonly y: number;
    readonly selected: boolean;
  }[];
  readonly empty: Point | null;
  readonly axisLabels: readonly { readonly frame: number; readonly text: string }[];
  readonly units: string;
  readonly fields: Record<string, number | null | boolean | string>;
  readonly buffered: readonly string[];
}

/** The Curves layer as drawn (throws while it is closed). */
export async function curves(page: Page): Promise<CurvesSlice> {
  const slice = (await animate(page)) as unknown as { readonly curves: CurvesSlice | null };
  if (slice.curves === null) throw new Error('the Curves layer is not open');
  return slice.curves;
}

/** Waits for the Curves layer's chunk and its first curves. */
export async function curvesReady(page: Page): Promise<void> {
  await expect(page.getByTestId('halo-curves-canvas')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => ((await animate(page)) as unknown as { curves: CurvesSlice | null }).curves?.curves.length ?? 0)
    .toBeGreaterThan(0);
}

/** The centre of a layer of the Thread's switch (Timeline, Keys, Curves). */
export async function layerRadio(page: Page, name: 'Timeline' | 'Keys' | 'Curves'): Promise<Point> {
  const box = await page.getByTestId('halo-thread-layer').getByRole('radio', { name }).boundingBox();
  if (box === null) throw new Error(`no ${name} layer`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A petal of the curve's docked Halo by its plain word. */
export async function curvePetal(page: Page, label: string): Promise<Point> {
  const box = await page
    .getByTestId('halo-curve-verbs')
    .getByRole('menuitem', { name: new RegExp(`^${label}`) })
    .first()
    .boundingBox();
  if (box === null) throw new Error(`no curve petal ${label}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** One input for a journey: taps and drags with a finger or the Pencil. */
export interface Input {
  readonly kind: 'finger' | 'pen';
  tap(at: Point): Promise<void>;
  drag(from: Point, to: Point): Promise<void>;
}

/** Fingers through CDP touch events. */
export function fingerInput(page: Page): Input {
  return {
    kind: 'finger',
    tap: (at) => fingerTap(page, at),
    drag: (from, to) => fingerDrag(page, from, to, 12),
  };
}

/** The Pencil through CDP pen events. */
export function penInput(page: Page): Input {
  return {
    kind: 'pen',
    tap: (at) => penTap(page, at),
    drag: (from, to) =>
      penStroke(
        page,
        Array.from({ length: 13 }, (_, i) => ({
          x: from.x + ((to.x - from.x) * i) / 12,
          y: from.y + ((to.y - from.y) * i) / 12,
        })),
      ),
  };
}

/**
 * A marquee over a walk's contact keys on the one shown curve (Move Y of a foot): the longest run of keys at the
 * curve's floor (within 12 % of its range from the lowest), dragged as a tall box from empty space above the run to
 * below it, half a frame wide on each side. Returns the ids of the keys it covers.
 */
export async function marqueeOverContact(page: Page, input: Input): Promise<string[]> {
  const slice = await curves(page);
  const keys = [...slice.keys].sort((a, b) => a.frame - b.frame);
  const values = keys.map((k) => k.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const floor = lo + (hi - lo) * 0.12;
  let best: (typeof keys)[number][] = [];
  let run: (typeof keys)[number][] = [];
  for (const key of keys) {
    if (key.value <= floor) run.push(key);
    else run = [];
    if (run.length > best.length) best = [...run];
  }
  const first = best[0];
  const last = best.at(-1);
  if (first === undefined || last === undefined) throw new Error('no contact keys');
  const spacing = keys.length > 1 ? (slice.rect.w / (keys.length + 2)) * 0.5 : 10;
  const from = { x: first.x - spacing, y: slice.rect.y + 6 };
  const to = { x: last.x + spacing, y: slice.rect.y + slice.rect.h - 6 };
  await input.drag(from, to);
  return best.map((k) => k.id);
}
