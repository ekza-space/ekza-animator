// Animate-stage e2e helpers (STUDIO-TOUCH-SPEC §10, §20.7; T7): the `animate` slice of `halo()`, points on the
// Thread's ruler for a frame, the docked Halo's petals, a manipulator handle clear of the chrome, the journeys'
// touch counter, and the operator log Halo emits (for the byte-equal export check of §22, AS-ST-5).
import { expect, type Page } from '@playwright/test';
import { halo, PANE } from './halo';
import { call, runOk } from './test-api';
import type { Point } from './touch';

export interface AnimateSlice {
  readonly thread: {
    readonly layer: number;
    readonly ruler: {
      readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
      readonly x0: number;
      readonly x1: number;
      readonly start: number;
      readonly end: number;
    } | null;
    readonly clip: string | null;
    readonly range: { readonly start: number; readonly end: number } | null;
    readonly frame: number | null;
    readonly playing: boolean;
    readonly band: { readonly start: number; readonly end: number } | null;
    readonly dots: readonly { readonly frame: number; readonly selected: boolean; readonly inBetween: boolean }[];
    readonly faint: boolean;
    readonly rec: boolean;
    readonly autoKey: boolean;
    readonly autoKeyMode: string;
  };
  readonly animations: readonly string[];
  readonly active: string | null;
  readonly docked: { readonly kind: string } | null;
  readonly newCard: boolean;
  readonly transport: boolean;
  readonly preview: string | null;
}

/** The Animate stage's slice of `halo()`. */
export async function animate(page: Page): Promise<AnimateSlice> {
  return (await halo(page)).slices['animate'] as AnimateSlice;
}

/** Touches counted since the shell mounted (AS-ST-4). */
export async function touches(page: Page): Promise<number> {
  return (await halo(page)).touches;
}

/** Seed-san or Polybot through `file.loadSample` (setup, not a counted touch); the stage settles on Animate. */
export async function loadSample(page: Page, sample: 'seed-san' | 'polybot'): Promise<void> {
  await runOk(page, 'file.loadSample', { sample });
  await expect(page.getByTestId('halo-home')).toHaveCount(0);
  await expect.poll(async () => (await halo(page)).stage).toBe('animate');
  await expect(page.getByTestId('halo-thread')).toBeVisible();
  await page.waitForTimeout(300);
}

/** The page point of a frame on the Thread's ruler (its vertical middle). */
export async function rulerPoint(page: Page, frame: number): Promise<Point> {
  await expect.poll(async () => (await animate(page)).thread.ruler).not.toBeNull();
  const ruler = (await animate(page)).thread.ruler;
  if (ruler === null) throw new Error('no ruler');
  const x = ruler.rect.x + ruler.x0 + ((frame - ruler.start) / (ruler.end - ruler.start)) * (ruler.x1 - ruler.x0);
  return { x, y: ruler.rect.y + ruler.rect.h / 2 };
}

/** The centre of an element by its test id. */
export async function centreOf(page: Page, testId: string): Promise<Point> {
  const box = await page.getByTestId(testId).first().boundingBox();
  if (box === null) throw new Error(`no ${testId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A docked-Halo petal by its plain word. */
export async function dockedPetal(page: Page, label: string): Promise<Point> {
  const box = await page
    .getByTestId('halo-docked-verbs')
    .getByRole('menuitem', { name: new RegExp(`^${label}`) })
    .first()
    .boundingBox();
  if (box === null) throw new Error(`no docked petal ${label}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** True when nothing of the chrome covers the page point (the pane gets it). */
export async function onPane(page: Page, at: Point): Promise<boolean> {
  return page.evaluate(
    ([p, pane]) =>
      document.elementFromPoint(p.x, p.y)?.closest('[data-ekza-pane]')?.getAttribute('data-ekza-pane') === pane,
    [at, PANE] as const,
  );
}

/** A grab point of a rotate ring of the manipulator in the single pane that no chrome covers. */
export async function ringPoint(page: Page): Promise<Point> {
  for (const handle of ['rz', 'rx', 'ry'] as const) {
    let point: Point | null = null;
    await expect
      .poll(async () => {
        point = await call(page, 'screenOfManipulator', PANE, handle);
        return point !== null;
      })
      .toBe(true)
      .catch(() => undefined);
    if (point !== null && (await onPane(page, point))) return point;
  }
  throw new Error('no free ring of the manipulator');
}

/** A point on a control that no chrome covers (the control's pick point, nudged along its shape if covered). */
export async function controlFree(page: Page, name: string): Promise<Point> {
  const control = (await call(page, 'controls')).find((c) => c.name === name);
  if (control === undefined) throw new Error(`no control ${name}`);
  const point = await call(page, 'screenOfControl', control.id, PANE);
  if (point === null) throw new Error(`${name} is off screen`);
  if (await onPane(page, point)) return point;
  throw new Error(`${name} is covered by chrome`);
}
