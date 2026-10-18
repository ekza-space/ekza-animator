// Helpers of the A3 scenarios (M2A-SPEC §9: E2E-M2A-08…12, 14): seeding keys, real pointer input on the time slider
// and the Dope Sheet at test-API coordinates, and reading curves back.
import { expect, type Page } from '@playwright/test';
import { DEG, pointOf, type Point } from './g3-input';
import { controlId, seedSample } from './seed';
import { call, runOk } from './test-api';

export { DEG, type Point } from './g3-input';

/** The three arm controls of E2E-M2A-08/10 (keyed rz 0°/30°/60° at 0/10/20). */
export const ARM = ['fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L'] as const;

/** Sets the rotation of `control` at `frame` and keys its rotation channels (rx, ry, rz together, §4.11.1). */
export async function keyRotation(
  page: Page,
  control: string,
  frame: number,
  values: Partial<Record<'rx' | 'ry' | 'rz', number>>,
): Promise<void> {
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  await runOk(page, 'time.setFrame', { frame });
  await runOk(page, 'channel.setValues', {
    edits: Object.entries(values).map(([channel, degrees]) => ({ control, channel, value: (degrees ?? 0) * DEG })),
  });
  await runOk(page, 'key.set', { channels: 'rotate' });
}

/** Polybot with the three arm controls keyed rz 0°/30°/60° at 0/10/20; returns their ids and the active clip. */
export async function seedArmKeys(page: Page): Promise<{ readonly arm: string[]; readonly clip: string }> {
  await seedSample(page, 'polybot');
  const arm = await Promise.all(ARM.map((key) => controlId(page, key)));
  for (const [frame, degrees] of [
    [0, 0],
    [10, 30],
    [20, 60],
  ] as const) {
    for (const control of arm) await keyRotation(page, control, frame, { rz: degrees });
  }
  await runOk(page, 'time.setFrame', { frame: 0 });
  const clip = (await call(page, 'state')).activeClip ?? '';
  return { arm, clip };
}

export type Curves = Awaited<ReturnType<typeof curvesOf>>;

/** The curves of a clip (all controls). */
export function curvesOf(page: Page, clip: string) {
  return call(page, 'curves', clip);
}

/** Key times of every curve of `controls` (control → channel → times). */
export async function keyTimes(
  page: Page,
  clip: string,
  controls: readonly string[],
  channel = 'rz',
): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  for (const curve of await curvesOf(page, clip)) {
    if (!controls.includes(curve.control) || curve.channel !== channel) continue;
    out[curve.control] = curve.keys.map((key) => key.t);
  }
  return out;
}

/** Presses at `from`, moves to `to` in `steps` and releases (left button unless given). */
export async function drag(
  page: Page,
  from: Point,
  to: Point,
  opts: { readonly button?: 'left' | 'middle' | 'right'; readonly steps?: number } = {},
): Promise<void> {
  const steps = opts.steps ?? 8;
  const button = opts.button ?? 'left';
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(from.x + (step / steps) * (to.x - from.x), from.y + (step / steps) * (to.y - from.y));
  }
  await page.mouse.up({ button });
}

/** Shift+click on the time slider's key tick at `frame` (a 1-frame band with the targets' keys). */
export async function shiftClickTick(page: Page, frame: number): Promise<void> {
  const tick = await pointOf(page, () => call(page, 'screenOfTick', frame), `key tick at ${frame}`);
  await page.keyboard.down('Shift');
  await page.mouse.click(tick.x, tick.y);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await call(page, 'state')).band).toEqual({ start: frame, end: frame });
}

/** The time slider's point of an active-clip frame. */
export function sliderPoint(page: Page, frame: number): Promise<Point> {
  return pointOf(page, () => call(page, 'screenOfFrame', frame), `frame ${frame} on the time slider`);
}

/** Shows the Dope Sheet (its dock tab) and waits until its probe answers. */
export async function showDopeSheet(page: Page): Promise<void> {
  await runOk(page, 'workspace.showPanel', { panel: 'dopeSheet' });
  await expect(page.getByTestId('ds-canvas')).toBeVisible();
  await expect.poll(async () => (await call(page, 'dopeSheet'))?.canvasRect.w ?? 0).toBeGreaterThan(0);
}

/** Page point of the Dope Sheet glyph of `row` at `frame`. */
export function dopeKey(page: Page, row: string, frame: number): Promise<Point> {
  return pointOf(page, () => call(page, 'screenOfDopeKey', row, frame), `Dope Sheet ${row} glyph at ${frame}`);
}

/** Page x of an active-clip frame in the Dope Sheet's view. */
export async function dopeX(page: Page, frame: number): Promise<number> {
  const sheet = await call(page, 'dopeSheet');
  if (sheet === null) throw new Error('the Dope Sheet is not visible');
  return sheet.canvasRect.x + (frame - sheet.view.f0) * sheet.view.sx;
}

/** The Dope Sheet's rows by id. */
export async function dopeRows(page: Page) {
  const sheet = await call(page, 'dopeSheet');
  if (sheet === null) throw new Error('the Dope Sheet is not visible');
  return sheet.rows;
}

/** Clicks a Dope Sheet glyph (Shift with `shift`). */
export async function clickDopeKey(page: Page, row: string, frame: number, shift = false): Promise<void> {
  const at = await dopeKey(page, row, frame);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  if (shift) await page.keyboard.up('Shift');
}

/** The ids of the selected keys, sorted. */
export async function selectedKeyIds(page: Page): Promise<string[]> {
  return [...(await call(page, 'state')).selection.keys].sort();
}

/** Ids of the keys at `frame` on the given controls' rotation curves, sorted. */
export async function keysAt(page: Page, clip: string, controls: readonly string[], frame: number): Promise<string[]> {
  const ids: string[] = [];
  for (const curve of await curvesOf(page, clip)) {
    if (!controls.includes(curve.control)) continue;
    for (const key of curve.keys) if (Math.abs(key.t - frame) < 1e-6) ids.push(key.id);
  }
  return ids.sort();
}
