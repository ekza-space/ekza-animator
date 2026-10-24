// Regressions of acceptance round 3 (the owner demo script, MVP-SPEC §8.3, re-run by an independent tester in real
// Chrome). Each test replays a reported problem with real pointer and keyboard input at coordinates from the §4.8
// test API and checks the fixed behaviour; DECISIONS-OPEN §E INT-50…INT-52 record the decisions.
import { expect, type Page, test } from '@playwright/test';
import { call, openEditor, runOk, waitForCount } from './helpers/test-api';

/** Polls a test-API point until the panel has drawn it. */
async function pointOf(page: Page, read: () => Promise<{ x: number; y: number } | null>, what: string) {
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        point = await read();
        return point !== null;
      },
      { message: `${what} on screen`, timeout: 15_000 },
    )
    .toBe(true);
  return point as unknown as { x: number; y: number };
}

async function loadSeedSan(page: Page): Promise<void> {
  await page.getByTestId('sample-seed-san').click();
  await waitForCount(page, 'characters', 1);
}

async function pane(page: Page, id: 'pane-left' | 'pane-right') {
  const found = (await call(page, 'panes')).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found.rect;
}

async function controlId(page: Page, key: string): Promise<string> {
  const id = (await call(page, 'controls')).find((control) => control.key === key)?.id;
  if (id === undefined) throw new Error(`no control ${key}`);
  return id;
}

/** Keys of one channel curve of a control in the active clip. */
async function keysOf(page: Page, control: string, channel: string) {
  const clipId = (await call(page, 'state')).activeClip ?? '';
  const curve = (await call(page, 'curves', clipId, control)).find((candidate) => candidate.channel === channel);
  return curve?.keys ?? [];
}

const focusedTestId = (page: Page): Promise<string | null> =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['testid'] ?? null);

/** Keys `control`'s rz at the given frames (typed in the Channels panel, keyed with S over the right pane). */
async function keyRz(page: Page, control: string, frames: readonly (readonly [number, number])[]): Promise<void> {
  const right = await pane(page, 'pane-right');
  await runOk(page, 'select.controls', { ids: [control], mode: 'replace' });
  for (const [frame, degrees] of frames) {
    await runOk(page, 'time.setFrame', { frame, unit: 'clip' });
    const field = page.getByTestId('cb-field-rz');
    await field.fill(String(degrees));
    await field.press('Enter');
    await page.mouse.move(right.x + 40, right.y + 40);
    await page.keyboard.press('KeyS');
  }
  await expect
    .poll(async () => (await keysOf(page, control, 'rz')).map((key) => key.t))
    .toEqual(frames.map(([t]) => t));
}

test('INT-50: after a menu bar or More ▾ menu, Space over the viewport maximizes and restores; no item runs', async ({
  page,
}) => {
  await openEditor(page, '&platform=mac');
  await loadSeedSan(page);
  const arm = await controlId(page, 'fk.upperArm.L');
  await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
  const right = await pane(page, 'pane-right');
  const overViewport = () => page.mouse.move(right.x + right.w / 2, right.y + right.h / 2);
  await overViewport();
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await keysOf(page, arm, 'rz')).length).toBe(1);
  const menus = page.locator('[role="menu"]');

  /** The tester's check: Space taps over the right pane maximize, then restore; nothing else changes. */
  const spaceTwice = async (what: string): Promise<void> => {
    const before = await call(page, 'state');
    await overViewport();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await call(page, 'state')).maximizedPane, { message: what }).toBe('pane-right');
    await expect(menus, what).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await call(page, 'state')).maximizedPane, { message: what }).toBeNull();
    await expect(menus, what).toHaveCount(0);
    const after = await call(page, 'state');
    expect(after.history.undoLabel, what).toBe(before.history.undoLabel);
    expect(after.activeClip, what).toBe(before.activeClip);
    expect(after.selection.controls, what).toEqual(before.selection.controls);
    expect((await call(page, 'clips')).length, what).toBe(1);
  };

  // 1. A menu-only command chosen with the pointer (Pose › Pin Feet).
  await page.getByTestId('menu-pose').click();
  await page.getByTestId('menu-item-builtin.pose.pinFeet').click();
  await expect(menus).toHaveCount(0);
  expect(await focusedTestId(page)).not.toBe('menu-pose');
  await spaceTwice('after Pose › Pin Feet');

  // 2. A menu opened and closed with its title: the first items are Undo, New Clip, Select All and New Project.
  for (const menu of ['edit', 'clip', 'select', 'file']) {
    await page.getByTestId(`menu-${menu}`).click();
    await expect(menus).toHaveCount(1);
    await page.getByTestId(`menu-${menu}`).click();
    await expect(menus).toHaveCount(0);
    await spaceTwice(`after opening and closing ${menu}`);
  }

  // 3. Opened with the pointer, closed with Esc.
  await page.getByTestId('menu-edit').click();
  await expect(menus).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menus).toHaveCount(0);
  await spaceTwice('after Edit, then Esc');
  expect(await keysOf(page, arm, 'rz')).toHaveLength(1); // Edit › Undo never ran

  // 4. Graph Editor More ▾ › Fixed on the selected key; its first item (Stepped Next) must not run.
  const key0 = (await keysOf(page, arm, 'rz'))[0]?.id ?? '';
  await runOk(page, 'select.keys', { items: [{ key: key0 }], mode: 'replace' });
  await page.getByTestId('ge-tangent-more').click();
  await page.getByTestId('ge-tangent-fixed').click();
  await expect.poll(async () => (await keysOf(page, arm, 'rz'))[0]?.outType).toBe('fixed');
  expect(await focusedTestId(page)).not.toBe('ge-tangent-more');
  await spaceTwice('after More ▾ › Fixed');
  expect((await keysOf(page, arm, 'rz'))[0]?.outType).toBe('fixed');

  // 5. Keyboard use: Enter on a focused title opens its menu and Esc returns the focus there (WAI-ARIA). Space over
  // the viewport still follows the hovered pane (§4.10) and the menu stays closed.
  await page.getByTestId('menu-edit').focus();
  await page.keyboard.press('Enter');
  await expect(menus).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menus).toHaveCount(0);
  await expect.poll(() => focusedTestId(page)).toBe('menu-edit');
  await spaceTwice('with the Edit title focused from the keyboard');
  expect(await keysOf(page, arm, 'rz')).toHaveLength(1);
});

test('INT-51: a click on a Graph Editor key and a quick press-drag on it moves the key', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await loadSeedSan(page);
  const lowerArm = await controlId(page, 'fk.lowerArm.L');
  await keyRz(page, lowerArm, [
    [0, 0],
    [15, -40],
    [30, 30],
  ]);
  const key15 = (await keysOf(page, lowerArm, 'rz'))[1]?.id ?? '';
  const k15 = await pointOf(page, () => call(page, 'screenOfKey', key15), 'key@15');
  const sx = (await call(page, 'graph'))?.view.sx ?? 0;
  await page.mouse.click(k15.x, k15.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys).toEqual([key15]);
  // The second press comes within the double-click time (the tester's 50–250 ms).
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) await page.mouse.move(k15.x + (step / 10) * 5 * sx, k15.y);
  await page.mouse.up();
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz')).map((key) => key.t)).toEqual([0, 20, 30]);
  expect((await call(page, 'state')).history.undoLabel).toBe('Move Keys');
  expect((await call(page, 'state')).selection.keys).toEqual([key15]);

  // A double-click without a drag still selects every key of the curve.
  const k20 = await pointOf(page, () => call(page, 'screenOfKey', key15), 'key@20');
  await page.mouse.dblclick(k20.x, k20.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys.length).toBe(3);
  expect((await keysOf(page, lowerArm, 'rz')).map((key) => key.t)).toEqual([0, 20, 30]);
});

test('INT-52: the time slider RMB menu without a band acts on the keys at the current frame', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await loadSeedSan(page);
  const lowerArm = await controlId(page, 'fk.lowerArm.L');
  await keyRz(page, lowerArm, [
    [0, 0],
    [15, -40],
    [30, 30],
  ]);
  await runOk(page, 'time.setFrame', { frame: 15, unit: 'clip' });
  expect((await call(page, 'state')).band).toBeNull();
  const at22 = await pointOf(page, () => call(page, 'screenOfFrame', 22), 'frame 22');
  await page.mouse.click(at22.x, at22.y, { button: 'right' });
  await expect(page.getByTestId('timeline-menu')).toBeVisible();
  expect((await call(page, 'state')).band).toEqual({ start: 15, end: 15 });
  await expect(page.getByTestId('timeline-menu-delete')).toBeEnabled();
  await page.getByTestId('timeline-menu-delete').click();
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz')).map((key) => key.t)).toEqual([0, 30]);
  expect((await call(page, 'state')).clipFrame).toBe(15);
  await page.mouse.move(at22.x, at22.y);
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz')).map((key) => key.t)).toEqual([0, 15, 30]);
});
