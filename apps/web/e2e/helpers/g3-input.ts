// Real-input helpers of the e2e-g3 scenarios (E2E-07, -14, -15, -21, -23, -24, -27): pointer and keyboard input at
// coordinates from the §4.8 test API (MVP-SPEC §6.1); state is read back through the test API.
import { expect, type Page } from '@playwright/test';
import { call } from './test-api';

export const DEG = Math.PI / 180;

export type PaneId = 'pane-left' | 'pane-right';
export type Point = { readonly x: number; readonly y: number };

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

export async function paneRect(page: Page, id: PaneId) {
  const pane = (await call(page, 'panes')).find((candidate) => candidate.id === id);
  if (pane === undefined) throw new Error(`no ${id}`);
  return pane.rect;
}

/** Moves the pointer over an empty corner of a viewport pane, so hotkeys go to scope V (§4.10 keyboard focus). */
export async function hoverPane(page: Page, id: PaneId = 'pane-right'): Promise<void> {
  const rect = await paneRect(page, id);
  await page.mouse.move(rect.x + 40, rect.y + 40);
}

/** Presses a chord over a viewport pane. */
export async function pressOverPane(page: Page, chord: string, id: PaneId = 'pane-right'): Promise<void> {
  await hoverPane(page, id);
  await page.keyboard.press(chord);
}

/** Keys of one channel curve of a control in a clip (the active clip by default); [] when there is no curve. */
export async function keysOf(page: Page, control: string, channel: string, clip?: string) {
  const clipId = clip ?? (await call(page, 'state')).activeClip ?? '';
  const curve = (await call(page, 'curves', clipId, control)).find((candidate) => candidate.channel === channel);
  return curve?.keys ?? [];
}

/** Clicks the time slider at an active-clip frame (a scrub) and waits for the clock to show it. */
export async function clickFrame(page: Page, frame: number): Promise<void> {
  const at = await pointOf(page, () => call(page, 'screenOfFrame', frame), `frame ${frame}`);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await call(page, 'state')).clipFrame, { message: `frame ${frame}` }).toBe(frame);
}

/** Types a value (display units: degrees for rotations) into a Channel Box field and commits it with Enter. */
export async function typeChannel(page: Page, channel: string, value: number): Promise<void> {
  const field = page.getByTestId(`cb-field-${channel}`);
  await field.fill(String(value));
  await field.press('Enter');
}

/**
 * Clicks a control's Outliner row (plain click: replace; Shift: toggle, §4.10 selection modifiers). The tree is
 * virtualized: a row far from the view is not rendered, so the wheel scrolls the tree (up, then down) until it is.
 */
export async function clickOutlinerRow(page: Page, control: string, modifiers: ('Shift' | 'Meta')[] = []) {
  const row = page.getByTestId(`outliner-row-${control}`);
  const tree = page.getByTestId('outliner-tree');
  // The Outliner scrolls the selection's lead into view after a selection change, over a few frames (the
  // virtualizer measures as it goes; slow under SwiftShader): let it settle, or the rows found below can be swapped
  // out mid-scroll ("Element is not attached to the DOM").
  await settleScroll(tree);
  const box = await tree.boundingBox();
  if (box === null) throw new Error('the Outliner is not visible');
  for (const direction of [-1, 1]) {
    for (let turn = 0; turn < 100 && (await row.count()) === 0; turn++) {
      const top = await tree.evaluate((element) => element.scrollTop);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, direction * box.height * 0.8);
      const moved = await expect
        .poll(() => tree.evaluate((element) => element.scrollTop), { timeout: 1_000 })
        .not.toBe(top)
        .then(
          () => true,
          () => false,
        );
      if (!moved) break; // the end of the tree in this direction
    }
  }
  // A row swapped out by a late reveal scroll is found again (the click itself never repeats: it is the last step).
  for (let attempt = 0; ; attempt++) {
    try {
      await row.scrollIntoViewIfNeeded({ timeout: 5_000 });
      break;
    } catch (error) {
      if (attempt >= 2 || !String(error).includes('not attached')) throw error;
      await settleScroll(tree);
    }
  }
  await row.click({ modifiers });
}

/** Waits until an element's scroll position has not changed for three consecutive animation frames. */
async function settleScroll(element: ReturnType<Page['getByTestId']>): Promise<void> {
  await element.evaluate(
    (node) =>
      new Promise<void>((resolve) => {
        let last = node.scrollTop;
        let still = 0;
        let frames = 0;
        const tick = () => {
          frames++;
          still = node.scrollTop === last ? still + 1 : 0;
          last = node.scrollTop;
          if (still >= 3 || frames > 120) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/**
 * Drags a manipulator handle of the selected controls in a pane: presses on its grab point and moves the pointer
 * `dx`, `dy` CSS px in `steps` moves. The rotate tool must be active for ring handles.
 */
export async function dragManipulator(
  page: Page,
  handle: 'rx' | 'ry' | 'rz' | 'rview',
  delta: { readonly dx: number; readonly dy: number },
  id: PaneId = 'pane-right',
  steps = 8,
): Promise<void> {
  const grab = await pointOf(page, () => call(page, 'screenOfManipulator', id, handle), `${handle} ring`);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(grab.x + (step / steps) * delta.dx, grab.y + (step / steps) * delta.dy);
  }
  await page.mouse.up();
}

/** Asserts two channel maps hold the same channels with values within `tolerance`. */
export function expectChannelsClose(
  actual: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
  tolerance: number,
  what: string,
): void {
  expect(Object.keys(actual).sort(), what).toEqual(Object.keys(expected).sort());
  for (const [channel, value] of Object.entries(expected)) {
    const got = actual[channel] ?? Number.NaN;
    expect(Math.abs(got - value), `${what}: ${channel} = ${got}, expected ${value}`).toBeLessThanOrEqual(tolerance);
  }
}
