import { expect, test } from '@playwright/test';
import { DEG, hoverGraph, pointOf, readRz } from './helpers/g2-graph';
import { dragTo } from './helpers/m2a-a4';
import { seedWaveClip } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-17 (FR-GE-20, M2A-SPEC §5.15.3): the Scale tool's region box. The right edge dragged to frame 60 scales the
// times ×2 around the left edge (values unchanged); the top edge dragged down by half the box height scales the values
// around the bottom edge: v' = v_bottom + (v − v_bottom)·factor, factor = (y_bottom − y_release)/(y_bottom − y_top).
// Each drag is one history step.
test('E2E-M2A-17: scale tool and region', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  const seed = await seedWaveClip(page);
  // The `dcc` navigation profile: the wheel zooms the Graph Editor (so frame 60 fits on the canvas).
  await runOk(page, 'prefs.set', { patch: { navProfile: 'dcc' } });

  // Double-click the curve: all its keys.
  const on = await pointOf(page, () => call(page, 'screenOfCurve', seed.rz, 7.5), 'the rz curve at 7.5');
  await page.mouse.dblclick(on.x, on.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys.length).toBe(3);
  await hoverGraph(page);
  await page.keyboard.press('KeyR');
  await expect.poll(async () => (await call(page, 'state')).tool).toBeDefined();
  const right = await pointOf(page, () => call(page, 'screenOfRegionHandle', 'right'), 'the region’s right edge');

  // Zoom out around the left part of the canvas until frame 60 is on screen.
  const graph = await call(page, 'graph');
  if (graph === null) throw new Error('no Graph Editor');
  const frameX = (view: { f0: number; sx: number }, rect: { x: number }, frame: number) =>
    rect.x + (frame - view.f0) * view.sx;
  for (let i = 0; i < 6; i++) {
    const g = await call(page, 'graph');
    if (g !== null && frameX(g.view, g.canvasRect, 60) < g.canvasRect.x + g.canvasRect.w - 20) break;
    await page.mouse.move(graph.canvasRect.x + 40, graph.canvasRect.y + graph.canvasRect.h / 2);
    await page.mouse.wheel(0, 300);
  }
  const zoomed = await call(page, 'graph');
  if (zoomed === null) throw new Error('no Graph Editor');
  expect(frameX(zoomed.view, zoomed.canvasRect, 60)).toBeLessThan(zoomed.canvasRect.x + zoomed.canvasRect.w);
  const rightEdge = await pointOf(page, () => call(page, 'screenOfRegionHandle', 'right'), 'the right edge');
  expect(rightEdge.x).not.toBe(right.x);

  const before = await readRz(page, seed);
  await dragTo(page, rightEdge, { x: frameX(zoomed.view, zoomed.canvasRect, 60), y: rightEdge.y });
  await expect.poll(async () => (await readRz(page, seed)).keys.map((key) => key.t)).toEqual([0, 30, 60]);
  const timed = await readRz(page, seed);
  timed.keys.forEach((key, i) => expect(key.v).toBeCloseTo(before.keys[i]?.v ?? Number.NaN, 12));
  expect((await call(page, 'state')).history.undoLabel).toBe('Scale Keys');
  const stepsAfterTime = (await call(page, 'state')).history;
  expect(stepsAfterTime.canUndo).toBe(true);

  // The top edge down by half the box height. Chrome delivers pointer coordinates as float32 (Math.fround), so the
  // factor the editor computes uses those: factor = (y_bottom − y_release)/(y_bottom − y_top) with the delivered
  // press and release y; the box height comes from the keys (the probe's top and bottom).
  const top = await pointOf(page, () => call(page, 'screenOfRegionHandle', 'top'), 'the top edge');
  const bottom = await pointOf(page, () => call(page, 'screenOfRegionHandle', 'bottom'), 'the bottom edge');
  const release = top.y + (bottom.y - top.y) / 2;
  await dragTo(page, top, { x: top.x, y: release });
  const delivered = Math.fround(release) - Math.fround(top.y);
  const factor = (bottom.y - top.y - delivered) / (bottom.y - top.y);
  expect(factor).toBeCloseTo(0.5, 5);
  const expected = before.keys.map((key) => -30 * DEG + (key.v - -30 * DEG) * factor);
  await expect.poll(async () => (await readRz(page, seed)).keys.map((key) => key.t)).toEqual([0, 30, 60]);
  await expect
    .poll(async () => (await readRz(page, seed)).keys.map((key) => key.v))
    .toEqual(expected.map((v) => expect.closeTo(v, 9)));
  const scaled = await readRz(page, seed);
  expect(scaled.keys[1]?.v).toBeCloseTo(-30 * DEG, 9); // the bottom edge stays
  expect(scaled.keys[0]?.v).toBeCloseTo(0, 5); // 30° becomes 0° (to the delivered pointer precision)
  expect((await call(page, 'state')).history.undoLabel).toBe('Scale Keys');

  // One step each: one undo returns the values, a second the times.
  await hoverGraph(page);
  await page.keyboard.press('Meta+KeyZ');
  await expect
    .poll(async () => (await readRz(page, seed)).keys.map((key) => key.v))
    .toEqual(timed.keys.map((k) => k.v));
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => (await readRz(page, seed)).keys.map((key) => key.t)).toEqual([0, 15, 30]);
});
