import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { animate, centreOf, loadSample } from './helpers/halo-animate';
import { curvePetal, curves, curvesReady, layerRadio } from './helpers/halo-curves';
import { halo, openHalo, openSheetFromShell } from './helpers/halo';
import { call, runOk } from './helpers/test-api';
import { cdp, fingerDrag, fingerHold, fingerTap, touchEvent, twoFingers } from './helpers/touch';

// ha-07 Curves (STUDIO-TOUCH-SPEC §10.5, §5.2.1, §4.2 wireframe D, §20.3 items 8 and 18; T10), `chrome-touch`: Pro's
// Graph Editor behind the touch adapter in the Thread's layer 2, on the library's Walk of Seed-san —
// - the layer: the listed part, its channel chips (one tap: that channel alone; with the Thumb key's *Select more*:
//   one more), the time axis in frames by default and in seconds under Settings › Time, the shared focus registry
//   (`graph.frame` and `graph.view.setMode` act on it);
// - gestures: a key drag keeps one axis (time) and is one undo step, two fingers pinch time, a double-tap frames, a
//   long-press docks the key's Halo in the header, the Insert tool's tap inserts a key, the axis strip moves the
//   playhead;
// - the curve's Halo: Fix flips (one step), Fewer keys (its pre-run form), Cycle ▾, ⋯ More over the curve; ⇆ Before
//   shows the snapshot while held.
// `webkit-ipad` boots the layer and taps a chip (compatibility only).

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

/** Seed-san with the Walk active and the L foot's IK goal selected (setup through the test API, not counted). */
async function walkOnFoot(page: Page): Promise<{ readonly walk: string; readonly goal: string }> {
  await openHalo(page);
  await loadSample(page, 'seed-san');
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await runOk(page, 'library.useClip', { character, clip: 'walk' });
  const walk = (await call(page, 'clips')).find((clip) => clip.name === 'Walk')?.id ?? '';
  await runOk(page, 'clip.setActive', { clip: walk });
  const goal = (await call(page, 'controls')).find((c) => c.name === 'L Leg IK')?.id ?? '';
  await runOk(page, 'select.controls', { ids: [goal], mode: 'replace' }, { panel: 'viewport', paneId: 'pane-single' });
  await expect.poll(async () => (await animate(page)).active).toBe('Walk');
  return { walk, goal };
}

/** A sparse curve to drag on (setup): a 60 f animation with Move X and Move Y keys of the L foot's goal every 10 f. */
async function sparseOnFoot(page: Page): Promise<{ readonly clip: string; readonly goal: string }> {
  await openHalo(page);
  await loadSample(page, 'seed-san');
  const character = (await call(page, 'characters'))[0]?.id ?? '';
  await runOk(page, 'clip.new', { character, name: 'Steps', range: { start: 0, end: 60 } });
  const clip = (await call(page, 'clips')).find((c) => c.name === 'Steps')?.id ?? '';
  const goal = (await call(page, 'controls')).find((c) => c.name === 'L Leg IK')?.id ?? '';
  const values = [0, 0.1, 0.3, 0.1, 0, 0.1, 0];
  await runOk(page, 'key.write', {
    clip,
    keys: values.flatMap((value, i) => [
      { control: goal, channel: 'ty', frame: i * 10, value },
      { control: goal, channel: 'tx', frame: i * 10, value: value / 2 },
    ]),
  });
  await runOk(page, 'select.controls', { ids: [goal], mode: 'replace' }, { panel: 'viewport', paneId: 'pane-single' });
  await expect.poll(async () => (await animate(page)).active).toBe('Steps');
  return { clip, goal };
}

/** The page point of a curve at a frame (its exact value, through the layer's view). */
async function curvePoint(page: Page, curve: string, frame: number): Promise<{ x: number; y: number }> {
  const slice = await curves(page);
  const value = await call(page, 'curveValue', curve, frame);
  const height = slice.rect.h / slice.scale;
  return {
    x: slice.rect.x + (frame - slice.view.f0) * slice.view.sx * slice.scale,
    y: slice.rect.y + (height - (value - slice.view.v0) * slice.view.sy) * slice.scale,
  };
}

async function openCurves(page: Page): Promise<void> {
  await fingerTap(page, await layerRadio(page, 'Curves'));
  await curvesReady(page);
  expect((await halo(page)).threadLayer).toBe(2);
}

async function onlyMoveY(page: Page): Promise<void> {
  await fingerTap(page, await centreOf(page, 'halo-curves-chip-Move Y'));
  await expect.poll(async () => (await curves(page)).curves.length).toBe(1);
}

test.describe('ha-07: Curves', () => {
  test('the layer: chips, Select more, the time axis in frames, the focus registry', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(120_000);
    await walkOnFoot(page);
    await openCurves(page);
    const slice = await curves(page);
    expect(slice.controls).toEqual(['L Leg IK']);
    expect(slice.chips.map((c) => c.label)).toEqual(['Move X', 'Move Y', 'Move Z', 'Bend', 'Twist', 'Side']);
    expect(slice.curves).toHaveLength(6);
    // the time axis reads frames (ST-T7-UNIT), the controller's own frame numbers are off (one axis)
    expect(slice.units).toBe('frames');
    expect(slice.axisLabels.map((l) => l.text)).toEqual(expect.arrayContaining(['0', '10', '20', '30', '40']));
    // one tap: Move Y alone; Select more (the Thumb key) + Move Z: both
    await onlyMoveY(page);
    expect((await curves(page)).chips.filter((c) => c.chosen).map((c) => c.label)).toEqual(['Move Y']);
    await fingerTap(page, await centreOf(page, 'halo-thumb'));
    await fingerTap(page, await centreOf(page, 'halo-curves-chip-Move Z'));
    await expect.poll(async () => (await curves(page)).curves.length).toBe(2);
    // the Thumb key's one-shot meaning is used up
    await expect.poll(async () => (await halo(page)).thumb.mode).not.toBe('once');
    // the same chip alone again: back to one
    await fingerTap(page, await centreOf(page, 'halo-curves-chip-Move Y'));
    await expect.poll(async () => (await curves(page)).curves.length).toBe(1);
    // the shared focus registry: Pro's graph operators act on this layer
    await runOk(page, 'graph.view.setMode', { mode: 'normalized' });
    await runOk(page, 'graph.view.setMode', { mode: 'absolute' });
    await runOk(page, 'graph.frame', { what: 'all' });
    // the axis strip moves the playhead
    const axis = await page.getByTestId('halo-curves-axis-strip').boundingBox();
    if (axis === null) throw new Error('no axis');
    const view = (await curves(page)).view;
    const x = axis.x + (20 - view.f0) * view.sx * (await curves(page)).scale;
    await fingerTap(page, { x, y: axis.y + axis.height / 2 });
    await expect.poll(async () => (await animate(page)).thread.frame).toBe(20);
  });

  test('gestures: a key drag keeps time, pinch, double-tap, long-press, the Insert tool', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(120_000);
    const { clip, goal } = await sparseOnFoot(page);
    await openCurves(page);
    await onlyMoveY(page);
    const slice = await curves(page);
    const key = [...slice.keys].sort((a, b) => a.frame - b.frame)[2];
    if (key === undefined) throw new Error('no key');
    const before = (await call(page, 'history')).undo.length;
    // a drag of a key, a little off horizontal: the axis locks to time, the value stays (one step)
    const perFrame = slice.view.sx * slice.scale;
    await fingerDrag(page, { x: key.x, y: key.y }, { x: key.x + perFrame * 3.2, y: key.y + 7 }, 10);
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(before + 1);
    expect((await call(page, 'history')).undo.at(-1)).toBe('Move Keys');
    const moved = (await call(page, 'curves', clip, goal)).flatMap((c) => c.keys).find((k) => k.id === key.id);
    expect(moved?.v).toBeCloseTo(key.value, 9);
    expect(moved?.t).not.toBe(key.frame);
    // the moved key is selected: its Halo docks in the layer's header
    await expect(page.getByTestId('halo-curves-docked').getByTestId('halo-docked')).toHaveAttribute(
      'data-noun',
      'keyDot',
    );
    await runOk(page, 'edit.undo');
    // two fingers: a horizontal pinch zooms time
    const rect = (await curves(page)).rect;
    const y = rect.y + rect.h / 2;
    const mid = rect.x + rect.w / 2;
    const sx = (await curves(page)).view.sx;
    await twoFingers(
      page,
      [
        { x: mid - 60, y },
        { x: mid + 60, y },
      ],
      [
        { x: mid - 200, y },
        { x: mid + 200, y },
      ],
    );
    await expect.poll(async () => (await curves(page)).view.sx).toBeGreaterThan(sx * 1.5);
    // a double-tap on empty space frames everything again
    const empty = (await curves(page)).empty;
    if (empty === null) throw new Error('no empty space');
    await fingerTap(page, empty);
    await fingerTap(page, empty);
    await expect.poll(async () => (await curves(page)).view.sx).toBeLessThan(sx * 1.2);
    // a long-press on a key docks its Halo
    await runOk(page, 'select.keys', { items: [], mode: 'replace' });
    await expect(page.getByTestId('halo-curves-docked').getByTestId('halo-docked')).toHaveCount(0);
    const target = [...(await curves(page)).keys].sort((a, b) => a.frame - b.frame)[4];
    if (target === undefined) throw new Error('no key');
    await fingerHold(page, { x: target.x, y: target.y }, 650);
    await expect.poll(async () => (await curves(page)).fields['count']).toBe(1);
    await expect(page.getByTestId('halo-curves-docked').getByTestId('halo-docked')).toHaveAttribute(
      'data-noun',
      'keyDot',
    );
    // the Insert tool: a tap on the curve between two keys inserts one (one step)
    await page.getByTestId('halo-curves-tool').getByRole('radio', { name: 'Insert' }).tap();
    await expect.poll(async () => (await curves(page)).tool).toBe('insert');
    const count = (await curves(page)).keys.length;
    const ty = (await curves(page)).curves[0] ?? '';
    // a tap on the curve between the keys at 20 and 30 f
    await fingerTap(page, await curvePoint(page, ty, 25));
    await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBe('Insert Key');
    await expect.poll(async () => (await curves(page)).keys.length).toBeGreaterThanOrEqual(count + 1);
  });

  test('the curve’s Halo: Fix flips, Fewer keys, Cycle, More; ⇆ Before while held', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(120_000);
    const { walk, goal } = await walkOnFoot(page);
    await openCurves(page);
    // Bend (rx) alone: a turn curve for the flips
    await fingerTap(page, await centreOf(page, 'halo-curves-chip-Bend'));
    await expect.poll(async () => (await curves(page)).curves.length).toBe(1);
    await fingerTap(page, await curvePetal(page, 'Fix flips'));
    // the walk's turns have no flips: the toast says so (a run that changes nothing leaves no step)
    await expect(page.getByTestId('halo-toasts')).toContainText(/No flips to fix|Fixed flips/);
    // Fewer keys: its pre-run form (§5.6), no run yet
    await fingerTap(page, await curvePetal(page, 'Fewer keys'));
    await expect
      .poll(async () => (await halo(page)).slices['grammar'])
      .toMatchObject({ form: 'graph.curves.simplify' });
    await page.keyboard.press('Escape');
    // Cycle ▾ › Ping-pong: pre and post
    await fingerTap(page, await curvePetal(page, 'Cycle'));
    await fingerTap(page, await centreOf(page, 'halo-curve-choice-Ping-pong'));
    const rx = (await curves(page)).curves[0];
    await expect
      .poll(async () => (await call(page, 'curves', walk, goal)).find((c) => c.id === rx)?.post)
      .toBe('oscillate');
    // ⇆ Before: the snapshot taken when Curves opened shows while held
    expect((await curves(page)).buffered).toContain(rx);
    const before = await centreOf(page, 'halo-curves-before');
    const s = await cdp(page);
    await touchEvent(s, 'touchStart', [before]);
    await expect.poll(async () => (await curves(page)).compare).toBe(true);
    await touchEvent(s, 'touchEnd', []);
    await s.detach();
    await expect.poll(async () => (await curves(page)).compare).toBe(false);
    // ⋯ More over the curve: the More sheet of the curve noun
    const more = page.getByTestId('halo-curve-verbs').getByRole('menuitem', { name: /^More/ });
    const box = await more.boundingBox();
    if (box === null) throw new Error('no More');
    await fingerTap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect.poll(async () => (await halo(page)).sheet).toBe('more');
    await expect(page.getByTestId('halo-sheet-more')).toContainText('Snapshot');
    // leaving Curves forgets the automatic snapshots (Pro's Graph Editor would draw them)
    await page.keyboard.press('Escape');
    await fingerTap(page, await layerRadio(page, 'Timeline'));
    // (Clear has nothing left to clear)
    await expect
      .poll(async () => (await page.evaluate(() => window.__EKZA_STUDIO_TEST__?.run('graph.buffer.clear')))?.reason)
      .toBe('There are no buffer curves');
  });

  test('Settings › Time on Seconds: the curves’ axis and the Time chip read seconds', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    test.setTimeout(120_000);
    await walkOnFoot(page);
    await openSheetFromShell(page, 'settings', true);
    const time = page.getByTestId('halo-settings-time');
    await time.scrollIntoViewIfNeeded();
    await time.getByRole('radio', { name: 'Seconds' }).tap();
    await page.keyboard.press('Escape');
    await openCurves(page);
    await onlyMoveY(page);
    expect((await curves(page)).units).toBe('seconds');
    // the end of the animation (40 f = 1.33 s) carries the unit; the numbers are seconds on whole frames
    expect((await curves(page)).axisLabels.map((l) => l.text)).toContain('1.33 s');
    expect((await curves(page)).axisLabels.every((l) => /^-?\d+(\.\d+)?( s)?$/.test(l.text))).toBe(true);
    const key = [...(await curves(page)).keys].sort((a, b) => a.frame - b.frame)[15];
    if (key === undefined) throw new Error('no key');
    await fingerTap(page, { x: key.x, y: key.y });
    await expect.poll(async () => (await curves(page)).fields['count']).toBe(1);
    // the key's frame at 30 fps, in seconds
    await expect(page.getByTestId('halo-curves-time')).toHaveAttribute(
      'aria-valuetext',
      new RegExp(`^${(key.frame / 30).toFixed(2)} s`),
    );
  });

  test('webkit-ipad boots Curves and taps a channel chip', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'webkit-ipad', 'webkit-ipad only');
    await walkOnFoot(page);
    const radio = page.getByTestId('halo-thread-layer').getByRole('radio', { name: 'Curves' });
    const box = await radio.boundingBox();
    if (box === null) throw new Error('no Curves layer');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId('halo-curves-canvas')).toBeVisible({ timeout: 30_000 });
    const chip = await centreOf(page, 'halo-curves-chip-Move Y');
    await page.touchscreen.tap(chip.x, chip.y);
    await expect.poll(async () => (await curves(page)).curves.length).toBe(1);
  });
});
