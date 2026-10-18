import { expect, test } from '@playwright/test';
import { dragBy, hoverGraph } from './helpers/g2-graph';
import { keysOf, pointOf, pressOverPane } from './helpers/g3-input';
import { keyRotation } from './helpers/m2a-timing';
import { controlId, seedSample } from './helpers/seed';
import { call, expectKernelStarted, openEditor, runOk } from './helpers/test-api';

// E2E-M2A-14 (M2A-SPEC §5.12, FR-KEY-08): breakdown keys keep their time ratio between their anchors when an anchor
// moves; a key converted back no longer follows. `Alt+S` is `key.set {breakdown: true}`, A2's (M2A-SPEC §8: this
// was `test.fixme('A2')` until A2 merged; `key.convert` is A4's).

/**
 * Presses the key in the Graph Editor and drags it by `frames`: the press selects the key and the drag moves it
 * (MVP-SPEC §4.11.3). No separate click first: the steps of this scenario put keys at the same pixel within the
 * panel's 400 ms multi-click window, where a click would be the second press of a double-click and select the whole
 * curve (curve-editor `press.ts`); a press-drag on an unselected key moves that key alone either way.
 */
async function graphDrag(page: Parameters<typeof dragBy>[0], key: string, frames: number): Promise<void> {
  const graph = await call(page, 'graph');
  if (graph === null) throw new Error('the Graph Editor is hidden');
  // The panel draws the key on its next frame after the keying (MVP-SPEC §6.1: poll the probe until it answers).
  const at = await pointOf(page, () => call(page, 'screenOfKey', key), `key ${key} in the Graph Editor`);
  await dragBy(page, at, frames * graph.view.sx, 0);
}

test('E2E-M2A-14: breakdowns retime', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await expectKernelStarted(page);
  await seedSample(page, 'polybot');
  const control = await controlId(page, 'fk.lowerArm.L');
  await keyRotation(page, control, 0, { rz: 0 });
  await keyRotation(page, control, 20, { rz: 60 });
  await runOk(page, 'time.setFrame', { frame: 10 });
  await pressOverPane(page, 'Alt+KeyS');
  await expect
    .poll(async () => (await call(page, 'timelineTicks')).find((tick) => tick.frame === 10)?.breakdown)
    .toBe(true);
  await hoverGraph(page);
  const rz = await keysOf(page, control, 'rz');
  const value10 = rz.find((key) => key.t === 10)?.v ?? Number.NaN;
  await graphDrag(page, rz.find((key) => key.t === 20)?.id ?? '', 10);
  await expect.poll(async () => (await keysOf(page, control, 'rz')).map((key) => key.t)).toEqual([0, 15, 30]);
  expect((await keysOf(page, control, 'rz')).find((key) => key.t === 15)?.v).toBe(value10);
  // rx and ry: their anchors did not move, their breakdowns stay at 10.
  for (const channel of ['rx', 'ry']) {
    expect((await keysOf(page, control, channel)).map((key) => key.t)).toEqual([0, 10, 20]);
  }

  // A fresh setup: a breakdown at 7 between 0 and 20, 20 dragged to 30, lands at 11 (10.5 rounded half up).
  await runOk(page, 'file.new');
  await seedSample(page, 'polybot');
  const arm = await controlId(page, 'fk.lowerArm.L');
  await keyRotation(page, arm, 0, { rz: 0 });
  await keyRotation(page, arm, 20, { rz: 60 });
  await runOk(page, 'time.setFrame', { frame: 7 });
  await pressOverPane(page, 'Alt+KeyS');
  await hoverGraph(page);
  const keys = await keysOf(page, arm, 'rz');
  await graphDrag(page, keys.find((key) => key.t === 20)?.id ?? '', 10);
  await expect.poll(async () => (await keysOf(page, arm, 'rz')).map((key) => key.t)).toEqual([0, 11, 30]);
  // After key.convert {to: 'key'} the key no longer moves with its neighbours.
  const at11 = (await keysOf(page, arm, 'rz')).find((key) => key.t === 11)?.id ?? '';
  await runOk(page, 'select.keys', { items: [{ key: at11 }], mode: 'replace' });
  await runOk(page, 'key.convert', { to: 'key' });
  const at30 = (await keysOf(page, arm, 'rz')).find((key) => key.t === 30)?.id ?? '';
  // The drag left the key at 30 beyond the view: frame all (`A` over the Graph Editor, as E2E-12 does).
  await hoverGraph(page);
  await page.keyboard.press('KeyA');
  await graphDrag(page, at30, 10);
  await expect.poll(async () => (await keysOf(page, arm, 'rz')).map((key) => key.t)).toEqual([0, 11, 40]);
});
