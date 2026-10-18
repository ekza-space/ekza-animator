// Regressions of acceptance round 2 (the owner demo script, MVP-SPEC §8.3, re-run by an independent tester in real
// Chrome). Each test replays a reported problem with real pointer and keyboard input at coordinates from the §4.8
// test API and checks the fixed behaviour; DECISIONS-OPEN §E INT-39…INT-47 record the decisions.
import { expect, type Page, test } from '@playwright/test';
import { call, openEditor, runOk, waitForCount } from './helpers/test-api';

const DEG = Math.PI / 180;

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

async function loadSample(page: Page, sample: 'seed-san' | 'polybot'): Promise<void> {
  await page.getByTestId(`sample-${sample}`).click();
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

/** Keys of one channel curve of a control in a clip (the active clip by default). */
async function keysOf(page: Page, control: string, channel: string, clip?: string) {
  const clipId = clip ?? (await call(page, 'state')).activeClip ?? '';
  const curve = (await call(page, 'curves', clipId, control)).find((candidate) => candidate.channel === channel);
  return curve?.keys ?? [];
}

const focusedTestId = (page: Page): Promise<string | null> =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['testid'] ?? null);

test('INT-39: dropdowns hand the keyboard back; hotkeys never type ahead into a focused dropdown', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await loadSample(page, 'seed-san');
  const arm = await controlId(page, 'fk.upperArm.L');
  await runOk(page, 'select.controls', { ids: [arm], mode: 'replace' });
  const right = await pane(page, 'pane-right');
  const overViewport = async () => page.mouse.move(right.x + right.w / 2, right.y + right.h - 40);
  await overViewport();
  await page.keyboard.press('KeyS');
  await runOk(page, 'clip.new', { name: 'idle' });
  await runOk(page, 'clip.new', { name: 'swing' });
  const clips = await call(page, 'clips');
  const clip1 = clips.find((clip) => clip.name === 'clip1')?.id ?? '';
  expect(clips.map((clip) => clip.name)).toEqual(['clip1', 'idle', 'swing']);

  // 1. A clip chosen with the pointer: the dropdown gives the focus back; S over the viewport keys clip1.
  const clipSelect = page.getByTestId('timeline-clip-select');
  await clipSelect.click();
  await clipSelect.selectOption(clip1);
  await expect.poll(async () => (await call(page, 'state')).activeClip).toBe(clip1);
  await expect.poll(() => focusedTestId(page)).not.toBe('timeline-clip-select');
  await runOk(page, 'time.setFrame', { frame: 10, unit: 'clip' });
  await overViewport();
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await keysOf(page, arm, 'rx', clip1)).map((key) => key.t)).toEqual([0, 10]);
  expect((await call(page, 'state')).activeClip).toBe(clip1);

  // 2. A dropdown that still has the focus (opened, then closed without a change): S over the viewport keys and
  // does not type ahead to 'swing'; W picks the Move tool.
  await clipSelect.focus();
  await runOk(page, 'time.setFrame', { frame: 12, unit: 'clip' });
  await overViewport();
  await page.keyboard.press('KeyS');
  await page.keyboard.press('KeyW');
  await expect.poll(async () => (await keysOf(page, arm, 'rx', clip1)).map((key) => key.t)).toEqual([0, 10, 12]);
  expect((await call(page, 'state')).activeClip).toBe(clip1);
  expect((await call(page, 'state')).tool).toBe('move');
  await expect(clipSelect).toHaveValue(clip1);

  // 3. Rotate order chosen with the pointer, then Mod+Z over the viewport undoes it; Z never types ahead to 'zyx'.
  await page.getByRole('tab', { name: 'Attributes' }).click();
  const order = page.getByTestId('attr-rotate-order');
  const before = await order.inputValue();
  const next = before === 'zxy' ? 'yzx' : 'zxy';
  await order.click();
  await order.selectOption(next);
  await expect(order).toHaveValue(next);
  await overViewport();
  await page.keyboard.press('Meta+KeyZ');
  await expect(order).toHaveValue(before);
  await order.focus();
  await overViewport();
  await page.keyboard.press('KeyZ'); // undoes the key at 12
  await expect.poll(async () => (await keysOf(page, arm, 'rx', clip1)).map((key) => key.t)).toEqual([0, 10]);
  await expect(order).toHaveValue(before);
  expect((await call(page, 'state')).history.undoLabel).not.toBe('Rotate Order');

  // 4. A focused fps dropdown: 2 over the Graph Editor is a tangent hotkey, not "fps 24" (no fps dialog).
  const fps = page.getByTestId('timeline-fps');
  const fpsBefore = await fps.inputValue();
  await fps.focus();
  const graph = await call(page, 'graph');
  const canvas = graph?.canvasRect ?? { x: 0, y: 0, w: 0, h: 0 };
  await page.mouse.move(canvas.x + canvas.w - 20, canvas.y + 20);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(200);
  await expect(fps).toHaveValue(fpsBefore);
  expect((await call(page, 'state')).dialog).toBeNull();
});

test('INT-40/44: a Graph Editor field gives the keyboard back on Enter; a snapped drag stops short of a key', async ({
  page,
}) => {
  await openEditor(page, '&platform=mac');
  await loadSample(page, 'seed-san');
  const right = await pane(page, 'pane-right');
  const lowerArm = await controlId(page, 'fk.lowerArm.L');
  await runOk(page, 'select.controls', { ids: [lowerArm], mode: 'replace' });
  for (const [frame, degrees] of [
    [0, 0],
    [15, -40],
    [30, 30],
  ] as const) {
    await runOk(page, 'time.setFrame', { frame, unit: 'clip' });
    const field = page.getByTestId('cb-field-rz');
    await field.fill(String(degrees));
    await field.press('Enter');
    await page.mouse.move(right.x + 40, right.y + 40);
    await page.keyboard.press('KeyS');
  }
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz')).map((key) => key.t)).toEqual([0, 15, 30]);
  const key15 = (await keysOf(page, lowerArm, 'rz'))[1]?.id ?? '';
  const k15 = await pointOf(page, () => call(page, 'screenOfKey', key15), 'key@15');
  await page.mouse.click(k15.x, k15.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys).toEqual([key15]);

  const value = page.getByTestId('ge-field-value');
  await value.fill('-10');
  await value.press('Enter');
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz'))[1]?.v ?? 0).toBeCloseTo(-10 * DEG, 9);
  expect(await focusedTestId(page)).not.toBe('ge-field-value');
  const graph = await call(page, 'graph');
  const canvas = graph?.canvasRect ?? { x: 0, y: 0, w: 0, h: 0 };
  await page.mouse.move(canvas.x + canvas.w - 30, canvas.y + 30);
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz'))[1]?.v ?? 0).toBeCloseTo(-40 * DEG, 9);
  await page.keyboard.press('Digit4');
  await expect
    .poll(async () => {
      const key = (await keysOf(page, lowerArm, 'rz'))[1];
      return [key?.inType, key?.outType];
    })
    .toEqual(['linear', 'linear']);
  await expect(value).not.toHaveValue(/^4/);
  await page.mouse.click(right.x + right.w - 20, right.y + right.h - 20); // blur anything, as the tester did
  await page.waitForTimeout(200);
  expect((await keysOf(page, lowerArm, 'rz'))[1]?.v ?? 0).toBeCloseTo(-40 * DEG, 9);

  // INT-44: an MMB drag of key 15 past key 30 (snapping on) stops at 29; key 30 survives.
  await runOk(page, 'select.keys', { items: [{ key: key15 }], mode: 'replace' });
  const from = await pointOf(page, () => call(page, 'screenOfKey', key15), 'key@15');
  const sx = (await call(page, 'graph'))?.view.sx ?? 0;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'middle' });
  for (let step = 1; step <= 10; step++) await page.mouse.move(from.x + (step / 10) * 22 * sx, from.y);
  await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz')).map((key) => key.t)).toEqual([0, 29, 30]);
});

test('INT-41/45: after an Outliner click, F frames the hovered pane and Home/End set the time', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await loadSample(page, 'seed-san');
  const hand = await controlId(page, 'fk.hand.L');
  const row = page.getByTestId(`outliner-row-${hand}`);
  await runOk(page, 'select.controls', { ids: [hand], mode: 'replace' }); // reveals the row
  await expect(row).toBeVisible();
  await row.getByText('L Hand', { exact: false }).first().click();
  expect((await call(page, 'state')).selection.controls).toEqual([hand]);
  const right = await pane(page, 'pane-right');
  await page.mouse.move(right.x + right.w / 2, right.y + right.h / 2);
  const before = await call(page, 'cameraOf', 'pane-right');
  await page.keyboard.press('KeyF');
  await expect.poll(async () => (await call(page, 'cameraOf', 'pane-right')).position).not.toEqual(before.position);

  // Home/End over the time slider (the tree still has the DOM focus).
  await runOk(page, 'time.setFrame', { frame: 20, unit: 'clip' });
  const at20 = await pointOf(page, () => call(page, 'screenOfFrame', 20), 'frame 20');
  await page.mouse.move(at20.x, at20.y);
  const end = (await call(page, 'clips'))[0]?.end ?? 0;
  await page.keyboard.press('End');
  await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(end);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(0);

  // INT-45: a click inside a selected band sets the time there and drops the band.
  const at13 = await pointOf(page, () => call(page, 'screenOfFrame', 13), 'frame 13');
  const at17 = await pointOf(page, () => call(page, 'screenOfFrame', 17), 'frame 17');
  await page.keyboard.down('Shift');
  await page.mouse.move(at13.x, at13.y);
  await page.mouse.down();
  await page.mouse.move(at17.x, at17.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await call(page, 'state')).band).toEqual({ start: 13, end: 17 });
  const at15 = await pointOf(page, () => call(page, 'screenOfFrame', 15), 'frame 15');
  await page.mouse.click(at15.x, at15.y);
  await expect.poll(async () => (await call(page, 'state')).band).toBeNull();
  expect((await call(page, 'state')).clipFrame).toBe(15);
});

test('INT-42: at the default framing a click on a control’s own pick point selects that control', async ({ page }) => {
  for (const [sample, keys] of [
    ['polybot', ['fk.upperArm.R', 'fk.shoulder.L', 'fk.upperChest', 'fk.hips']],
    ['seed-san', ['fk.neck', 'fk.shoulder.R', 'fk.hand.L']],
  ] as const) {
    await openEditor(page, '&platform=mac');
    await loadSample(page, sample);
    for (const key of keys) {
      const id = await controlId(page, key);
      await runOk(page, 'select.controls', { ids: [], mode: 'replace' });
      const at = await pointOf(page, () => call(page, 'screenOfControl', id, 'pane-right'), key);
      await page.mouse.click(at.x, at.y);
      await expect.poll(async () => (await call(page, 'state')).selection.controls, { message: key }).toEqual([id]);
    }
  }
});

test('INT-38 leftover: the Clips panel shows "Idle_Loop" uncut at the default dock width', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('sample-quaternius-ual').click();
  const confirm = page.getByTestId('import-confirm');
  await expect
    .poll(async () => (await confirm.count()) > 0 || (await call(page, 'counts'))['characters'] === 1)
    .toBe(true);
  if ((await confirm.count()) > 0) await confirm.click();
  await waitForCount(page, 'characters', 1);
  await runOk(page, 'workspace.showPanel', { panel: 'clips' });
  const clip = (await call(page, 'clips')).find((candidate) => candidate.name === 'Idle_Loop')?.id ?? '';
  const name = page.getByTestId(`clips-name-${clip}`);
  await expect(name).toHaveText('Idle_Loop');
  expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
});

test('pane headers at 1024 px: display toggles never wrap or get cut; the rest are in the » menu', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await openEditor(page, '&platform=mac');
  await loadSample(page, 'seed-san');
  for (const id of ['pane-left', 'pane-right'] as const) {
    const report = await page.getByTestId(`pane-display-mesh-${id}`).evaluate((mesh) => {
      const header = mesh.closest('header') as HTMLElement;
      const bounds = header.getBoundingClientRect();
      const toggles = [...header.querySelectorAll<HTMLElement>('[data-testid^="pane-display-"][aria-pressed]')];
      return {
        headerHeight: Math.round(bounds.height),
        shown: toggles
          .filter((toggle) => toggle.dataset['overflow'] === undefined)
          .map((toggle) => {
            const rect = toggle.getBoundingClientRect();
            return { id: toggle.dataset['testid'], cut: rect.right > bounds.right + 0.5, wrapped: rect.height > 21 };
          }),
        hidden: toggles
          .filter((toggle) => toggle.dataset['overflow'] === 'true')
          .map((toggle) => getComputedStyle(toggle).visibility),
      };
    });
    expect(report.headerHeight).toBeLessThanOrEqual(23);
    expect(report.shown.filter((toggle) => toggle.cut || toggle.wrapped)).toEqual([]);
    expect(report.shown.length + report.hidden.length).toBe(7);
    expect(report.hidden.every((visibility) => visibility === 'hidden')).toBe(true);
    if (report.hidden.length > 0) {
      const more = page.getByTestId(`pane-display-more-${id}`);
      await more.click();
      await expect(page.locator(`[data-testid^="pane-display-more-${id}-"]`)).toHaveCount(report.hidden.length);
      await page.keyboard.press('Escape');
    }
  }
  // At least the right pane overflows at this width (the tester saw "X-ray" wrap and "Springs" cut).
  await expect(page.getByTestId('pane-display-more-pane-right')).toBeVisible();
  const springs = page.getByTestId('pane-display-more-pane-right-springBones');
  await page.getByTestId('pane-display-more-pane-right').click();
  const checked = await springs.getAttribute('aria-checked');
  await springs.click();
  await page.getByTestId('pane-display-more-pane-right').click();
  await expect(springs).toHaveAttribute('aria-checked', checked === 'true' ? 'false' : 'true');
});
