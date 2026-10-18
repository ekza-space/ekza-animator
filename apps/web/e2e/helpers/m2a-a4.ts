// Helpers of the A4 scenarios (M2A-SPEC §9, E2E-M2A-13 and 15…17): keying through operators, linear tangents, the
// Tween bar's thumb, the Scale tool's region handles and curve content without key IDs (buffer swaps and mirrors
// write new keys).
import { expect, type Page } from '@playwright/test';
import { pointOf } from './g2-graph';
import { call, runOk } from './test-api';

export const DEG = Math.PI / 180;

export type CurveRow = Awaited<ReturnType<typeof readCurves>>[number];

export function readCurves(page: Page, clip: string, control?: string) {
  return control === undefined ? call(page, 'curves', clip) : call(page, 'curves', clip, control);
}

/** The curve of `channel` on `control` in `clip`, or a test failure. */
export async function curveOf(page: Page, clip: string, control: string, channel: string): Promise<CurveRow> {
  const curve = (await readCurves(page, clip, control)).find((candidate) => candidate.channel === channel);
  if (curve === undefined) throw new Error(`no ${channel} curve on ${control}`);
  return curve;
}

/** A curve's keys without their IDs (values, times, tangents, flags). */
export function keyContent(curve: CurveRow): unknown[] {
  return curve.keys.map(({ id: _id, ...rest }) => rest);
}

/**
 * Keys `channel` of `control` at the given (frame, value) pairs with `channel.setValues` + `key.set` (the selection
 * becomes `control`), then sets linear tangents on those keys (`graph.tangent.set` on the selected keys).
 */
export async function keyLinear(
  page: Page,
  clip: string,
  control: string,
  channel: string,
  keys: readonly (readonly [frame: number, value: number])[],
): Promise<CurveRow> {
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  for (const [frame, value] of keys) {
    await runOk(page, 'time.setFrame', { frame });
    await runOk(page, 'channel.setValues', { edits: [{ control, channel, value }], key: 'force' });
  }
  const curve = await curveOf(page, clip, control, channel);
  await runOk(page, 'select.keys', { items: curve.keys.map((key) => ({ key: key.id })), mode: 'replace' });
  await runOk(page, 'graph.tangent.set', { type: 'linear' });
  await runOk(page, 'select.keys', { items: [], mode: 'replace' });
  return curveOf(page, clip, control, channel);
}

/** Real LMB drag of a Tween bar's thumb from one slider amount to another (both positions from the probe). */
export async function dragTween(page: Page, panel: 'graph' | 'dopeSheet' | 'status', from: number, to: number) {
  const start = await pointOf(page, () => call(page, 'screenOfTween', panel, from), `tween ${panel} ${from}`);
  const end = await pointOf(page, () => call(page, 'screenOfTween', panel, to), `tween ${panel} ${to}`);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 6;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(start.x + ((end.x - start.x) * step) / steps, start.y);
  }
  await page.mouse.up();
}

/** Real LMB drag between two page points in `steps` moves. */
export async function dragTo(
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  steps = 8,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
  }
  await page.mouse.up();
}

/** The undo label of the newest history step. */
export async function undoLabel(page: Page): Promise<string | null> {
  return (await call(page, 'state')).history.undoLabel;
}

/** Waits for the number of history steps to settle after an interaction, then returns the top label. */
export async function expectUndoLabel(page: Page, label: string): Promise<void> {
  await expect.poll(() => undoLabel(page)).toBe(label);
}
