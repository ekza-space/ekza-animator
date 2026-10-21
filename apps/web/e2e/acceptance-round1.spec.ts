// Regressions of acceptance round 1 (the owner demo script, MVP-SPEC §8.3, run by an independent tester in real
// Chrome). Each test replays a reported problem with real pointer and keyboard input at coordinates from the §4.8
// test API and checks the fixed behaviour; DECISIONS-OPEN §E INT-32…INT-38 record the decisions.
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

async function rightPane(page: Page) {
  const pane = (await call(page, 'panes')).find((candidate) => candidate.id === 'pane-right');
  if (pane === undefined) throw new Error('no right pane');
  return pane.rect;
}

/** Keys of one channel curve of a control in the active clip ([] when the curve does not exist). */
async function keysOf(page: Page, control: string, channel: string) {
  const clip = (await call(page, 'state')).activeClip ?? '';
  const curve = (await call(page, 'curves', clip, control)).find((candidate) => candidate.channel === channel);
  return curve?.keys ?? [];
}

test('§8.3-12: keying a typed edit keeps its undo step; undo walks back key, edit, older key', async ({ page }) => {
  await openEditor(page, '&platform=mac');
  await loadSample(page, 'polybot');
  const upperArm = (await call(page, 'controls')).find((control) => control.key === 'fk.upperArm.L')?.id ?? '';
  const pane = await rightPane(page);
  const overViewport = { x: pane.x + 40, y: pane.y + 40 };

  await page.getByTestId(`outliner-row-${upperArm}`).click();
  expect((await call(page, 'state')).selection.controls).toEqual([upperArm]);
  await page.mouse.move(overViewport.x, overViewport.y);
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await keysOf(page, upperArm, 'rx')).map((key) => [key.t, key.v])).toEqual([[0, 0]]);

  const field = page.getByTestId('cb-field-rx');
  await field.fill('15');
  await field.press('Enter');
  await expect.poll(async () => (await call(page, 'overrides', upperArm)).rx ?? 0).toBeCloseTo(15 * DEG, 9);
  await page.mouse.move(overViewport.x, overViewport.y);
  await page.keyboard.press('KeyS');
  await expect.poll(async () => (await keysOf(page, upperArm, 'rx'))[0]?.v ?? 0).toBeCloseTo(15 * DEG, 9);
  expect(await call(page, 'overrides', upperArm)).toEqual({});

  // 1st undo: the key is gone, the typed value is back as an unkeyed (pink) override.
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => (await keysOf(page, upperArm, 'rx'))[0]?.v ?? Number.NaN).toBe(0);
  expect((await call(page, 'overrides', upperArm)).rx).toBeCloseTo(15 * DEG, 9);
  // 2nd undo: the typed edit itself (it used to be skipped, leaving an override no step owned).
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => call(page, 'overrides', upperArm)).toEqual({});
  expect((await call(page, 'channelValues', upperArm)).rx).toBe(0);
  expect((await keysOf(page, upperArm, 'rx')).map((key) => key.t)).toEqual([0]);
  // 3rd undo: the first key.
  await page.keyboard.press('Meta+KeyZ');
  await expect.poll(async () => (await keysOf(page, upperArm, 'rx')).length).toBe(0);
  expect(await call(page, 'overrides', upperArm)).toEqual({});
  expect((await call(page, 'counts'))['characters']).toBe(1);

  // Redo returns to the end state.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+Shift+KeyZ');
  await expect.poll(async () => (await keysOf(page, upperArm, 'rx'))[0]?.v ?? 0).toBeCloseTo(15 * DEG, 9);
  expect(await call(page, 'overrides', upperArm)).toEqual({});
});

test('Graph Editor: More menu closes, Simplify reports, Shift-drags a selected key, Insert+Q is no double-click', async ({
  page,
}) => {
  await openEditor(page, '&platform=mac');
  await loadSample(page, 'seed-san');
  const pane = await rightPane(page);
  const overViewport = { x: pane.x + 40, y: pane.y + 40 };
  const lowerArm = (await call(page, 'controls')).find((control) => control.key === 'fk.lowerArm.L')?.id ?? '';
  await runOk(page, 'select.controls', { ids: [lowerArm], mode: 'replace' });
  for (const [frame, degrees] of [
    [0, 0],
    [15, -40],
    [30, 30],
  ] as const) {
    const at = await pointOf(page, () => call(page, 'screenOfFrame', frame), `frame ${frame}`);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await call(page, 'state')).clipFrame).toBe(frame);
    const field = page.getByTestId('cb-field-rz');
    await field.fill(String(degrees));
    await field.press('Enter');
    await page.mouse.move(overViewport.x, overViewport.y);
    await page.keyboard.press('KeyS');
  }
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz')).map((key) => key.t)).toEqual([0, 15, 30]);
  const clip = (await call(page, 'state')).activeClip ?? '';
  const rz = (await call(page, 'curves', clip, lowerArm)).find((curve) => curve.channel === 'rz');
  if (rz === undefined) throw new Error('no rz curve');

  // ---------- More ▾: one line per label; closes on a choice, Esc and an outside click ----------
  const onCurve = await pointOf(page, () => call(page, 'screenOfCurve', rz.id, 7.5), 'rz curve');
  await page.mouse.move(onCurve.x, onCurve.y);
  await page.mouse.dblclick(onCurve.x, onCurve.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys.length).toBe(3);
  const menu = page.getByTestId('ge-tangent-more-menu');
  await page.getByTestId('ge-tangent-more').click();
  await expect(menu).toBeVisible();
  const lines = await menu.locator('[role="menuitem"]').evaluateAll((items) =>
    items.map((item) => {
      const range = document.createRange();
      range.selectNodeContents(item);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    }),
  );
  // Five tangent items plus M2a's Convert to Breakdown / Convert to Key (M2A-SPEC §7, §3 rule 8 literal).
  expect(lines).toEqual([1, 1, 1, 1, 1, 1, 1]);
  await page.getByTestId('ge-tangent-stepNext').click();
  await expect(menu).toBeHidden();
  await expect
    .poll(async () => (await keysOf(page, lowerArm, 'rz')).map((key) => key.outType))
    .toEqual(['stepNext', 'stepNext', 'stepNext']);
  await page.keyboard.press('Meta+KeyZ');
  await page.getByTestId('ge-tangent-more').click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.getByTestId('ge-tangent-more').click();
  await expect(menu).toBeVisible();
  const graph = await call(page, 'graph');
  const canvas = graph?.canvasRect ?? { x: 0, y: 0, w: 0, h: 0 };
  // Radix arms the outside-click listener in a 0 ms timer after the menu opens. Input runs ahead of timers, so on a busy
  // main thread (SwiftShader) a synthetic click could land before the listener exists; let pending timers run first.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await page.mouse.click(canvas.x + canvas.w - 20, canvas.y + 20);
  await expect(menu).toBeHidden();
  expect((await call(page, 'state')).selection.keys.length).toBe(3);

  // ---------- Shift+LMB drag on a selected key: axis-locked move, the key stays selected ----------
  const key15 = rz.keys[1]?.id ?? '';
  const k15 = await pointOf(page, () => call(page, 'screenOfKey', key15), 'key@15');
  await page.mouse.click(k15.x, k15.y);
  await expect.poll(async () => (await call(page, 'state')).selection.keys).toEqual([key15]);
  const sx = (await call(page, 'graph'))?.view.sx ?? 0;
  await page.waitForTimeout(500); // past the double-click time: a second press at once would select the curve
  await page.keyboard.down('Shift');
  await page.mouse.move(k15.x, k15.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) await page.mouse.move(k15.x + (step / 6) * 3 * sx, k15.y + step * 2);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await keysOf(page, lowerArm, 'rz'))[1]?.t).toBe(18);
  expect((await keysOf(page, lowerArm, 'rz'))[1]?.v).toBeCloseTo(-40 * DEG, 12);
  expect((await call(page, 'state')).selection.keys).toEqual([key15]);
  expect((await call(page, 'state')).history.undoLabel).toBe('Move Keys');

  // ---------- Insert click, Q, click the new key at once: selects that key only ----------
  await page.evaluate(() => {
    const holder = window as unknown as { __ekzaPresses?: number[] };
    holder.__ekzaPresses = [];
    document.querySelector('[data-testid="ge-canvas"]')?.addEventListener('pointerdown', (event) => {
      holder.__ekzaPresses?.push(event.timeStamp);
    });
  });
  const at22 = await pointOf(page, () => call(page, 'screenOfCurve', rz.id, 22), 'rz curve at 22');
  await page.mouse.move(at22.x, at22.y);
  await page.keyboard.press('KeyI');
  await expect(page.getByTestId('ge-tool-insert')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(at22.x, at22.y);
  await page.waitForFunction(
    ([clipId, controlId]) => {
      const api = window.__EKZA_STUDIO_TEST__;
      const curve = api?.curves(clipId, controlId).find((candidate) => candidate.channel === 'rz');
      return curve?.keys.length === 4;
    },
    [clip, lowerArm] as const,
    { polling: 'raf' },
  );
  await page.keyboard.press('KeyQ');
  await page.mouse.click(at22.x, at22.y);
  const presses = await page.evaluate(() => (window as unknown as { __ekzaPresses?: number[] }).__ekzaPresses ?? []);
  expect(presses).toHaveLength(2);
  // The two presses fell inside the double-click window, so the old behaviour would have selected all keys.
  expect((presses[1] ?? 0) - (presses[0] ?? 0)).toBeLessThan(400);
  const inserted = (await keysOf(page, lowerArm, 'rz')).find((key) => Math.abs(key.t - 22) < 0.5);
  await expect.poll(async () => (await call(page, 'state')).selection.keys).toEqual([inserted?.id ?? '']);

  // ---------- Simplify says what it did (last: its toast covers the canvas's lower right) ----------
  const keyCount = (await keysOf(page, lowerArm, 'rz')).length;
  await page.getByTestId('ge-simplify').click();
  const report = page.getByTestId('toast').filter({ hasText: /^Simplify: / });
  await expect(report).toBeVisible();
  const after = (await keysOf(page, lowerArm, 'rz')).length;
  await expect(report).toHaveText(
    after === keyCount
      ? `Simplify: nothing to remove within 0.1° (${keyCount} keys); choose a larger tolerance`
      : `Simplify: ${keyCount} → ${after} keys (${keyCount - after} removed within 0.1°)`,
  );
});

test('a corrupt .glb is refused with a toast, without an import dialog', async ({ page }) => {
  await openEditor(page);
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    const bytes = new TextEncoder().encode('glTFxxxxgarbage');
    transfer.items.add(new File([bytes], 'broken.glb', { type: 'model/gltf-binary' }));
    return transfer;
  });
  await page.dispatchEvent('[data-testid="editor-root"]', 'dragenter', { dataTransfer });
  await page.dispatchEvent('[data-testid="editor-root"]', 'drop', { dataTransfer });
  const toast = page
    .locator('[data-testid="toast"][data-kind="error"]')
    .filter({ hasText: 'Cannot import broken.glb' });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Unsupported GLB version');
  await expect(page.getByTestId('import-dialog')).toHaveCount(0);
  expect((await call(page, 'counts'))['characters']).toBe(0);
});

test('WebGL context loss in /editor: the help line says so; restored dismisses the warning', async ({ page }) => {
  await openEditor(page);
  await loadSample(page, 'seed-san');
  const lose = (method: 'loseContext' | 'restoreContext') =>
    page.evaluate((fn) => {
      const holder = window as unknown as { __ekzaLoseContext?: WEBGL_lose_context | null };
      if (holder.__ekzaLoseContext === undefined) {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="gl-host"] canvas');
        holder.__ekzaLoseContext = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null;
      }
      if (holder.__ekzaLoseContext === null) throw new Error('WEBGL_lose_context is not available');
      holder.__ekzaLoseContext[fn]();
    }, method);
  const warning = page.locator('[data-testid="toast"][data-kind="warning"]').filter({ hasText: 'context was lost' });
  await lose('loseContext');
  await expect(page.getByTestId('helpline-text')).toContainText('Graphics context lost');
  await expect(warning).toBeVisible();
  await lose('restoreContext');
  await expect(page.getByTestId('helpline-text')).not.toContainText('Graphics context lost');
  await expect(warning).toHaveCount(0);
  await expect(page.locator('[data-testid="toast"][data-kind="success"]')).toContainText('The 3D view was restored.');
});

test('F on a selected hand frames its fingers; the Clips panel reads at the default dock width', async ({ page }) => {
  await openEditor(page);
  await loadSample(page, 'seed-san');
  const controls = await call(page, 'controls');
  const hand = controls.find((control) => control.key === 'fk.hand.L')?.id ?? '';
  const fingers = controls.filter(
    (control) => control.visible && control.side === 'L' && /^fk\.(thumb|index|middle|ring|little)/.test(control.key),
  );
  expect(fingers.length).toBeGreaterThanOrEqual(10);
  await runOk(page, 'select.controls', { ids: [hand], mode: 'replace' });
  const pane = await rightPane(page);
  await page.mouse.move(pane.x + pane.w / 2, pane.y + pane.h / 2);
  await page.keyboard.press('KeyF');
  const inside = (point: { x: number; y: number } | null) =>
    point !== null &&
    point.x >= pane.x &&
    point.x <= pane.x + pane.w &&
    point.y >= pane.y &&
    point.y <= pane.y + pane.h;
  await expect
    .poll(async () => {
      const missing: string[] = [];
      for (const finger of fingers) {
        if (!inside(await call(page, 'screenOfControl', finger.id, 'pane-right'))) missing.push(finger.key);
      }
      return missing;
    })
    .toEqual([]);

  // Clips panel at the default dock width: "Name" and "Range" are apart and the clip name is not cut.
  await runOk(page, 'workspace.showPanel', { panel: 'clips' });
  const clip = (await call(page, 'state')).activeClip ?? '';
  const name = page.getByTestId(`clips-name-${clip}`);
  await expect(name).toBeVisible();
  const layout = await page.getByTestId('clips-panel').evaluate((panel) => {
    const textRect = (element: Element | null) => {
      const range = document.createRange();
      if (element !== null) range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const headers = [...panel.querySelectorAll('thead th')].filter((th) => getComputedStyle(th).display !== 'none');
    const nameHeader = headers.find((th) => th.textContent?.trim() === 'Name') ?? null;
    const rangeHeader = headers.find((th) => th.textContent?.trim() === 'Range') ?? null;
    const radio = panel.querySelector('input[type="radio"]');
    const label = panel.querySelector('[data-testid^="clips-name-"]');
    return {
      headerGap: textRect(rangeHeader).left - textRect(nameHeader).right,
      radioGap: textRect(label).left - (radio?.getBoundingClientRect().right ?? 0),
      truncated: label === null ? true : label.scrollWidth > label.clientWidth,
    };
  });
  expect(layout.headerGap).toBeGreaterThanOrEqual(6);
  expect(layout.radioGap).toBeGreaterThanOrEqual(4);
  expect(layout.truncated).toBe(false);
});
