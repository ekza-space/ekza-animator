import { expect, type Page, type TestInfo, test } from '@playwright/test';
import {
  camera,
  controlId,
  controlPoint,
  emptyPoint,
  meshPoint,
  grammar,
  halo,
  haloMenu,
  loadCubeLadInMake,
  loadPolybot,
  near,
  openHalo,
  petal,
  selectedControls,
} from './helpers/halo';
import { call, runOk } from './helpers/test-api';
import { cdp, fingerDrag, fingerHold, fingerTap, touchEvent, twoFingers } from './helpers/touch';

// ha-02 Halo grammar (STUDIO-TOUCH-SPEC §5.2, §5.3, §6.1–§6.5, §4.8; T6a exit test): on `chrome-touch` with real touch
// (CDP) — a tap selects a thing and opens its Halo beside it, its petals run operators, ⋯ More opens the More sheet;
// a tap on empty space clears (Reselect in Animate); a long-press opens the ring and a flick runs a slot; a double-tap
// frames; a one-finger drag on empty space orbits; two fingers undo with a toast that names the step and offers Redo;
// a quick pinch frames everything; the visible-target budget holds (≤ 22 at rest, ≤ 36 with a Halo). On `chrome` the
// mouse: a click selects (⋯ Verbs on the breadcrumb), right-click opens the ring, a right drag flicks. On
// `webkit-ipad` (compatibility only): /app boots, Home's sample loads, the Path switches by touch.

const touchOnly = (info: TestInfo): void => test.skip(info.project.name !== 'chrome-touch', 'chrome-touch only (CDP)');

async function tapControl(page: Page, name: string): Promise<string> {
  const id = await controlId(page, name);
  await fingerTap(page, await controlPoint(page, name));
  await expect.poll(() => selectedControls(page)).toContain(id);
  return id;
}

test.describe('ha-02: touch grammar', () => {
  test('a tap selects and opens the Halo; petals run; More lists the rest; the budget holds', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadPolybot(page);
    // at rest: top bar, tray, ↶ and the puck — within §4.8's 22
    const rest = (await halo(page)).visibleTargets;
    expect(rest).toBeGreaterThan(6);
    expect(rest).toBeLessThanOrEqual(22);

    const id = await tapControl(page, 'L Upper Arm');
    await expect(haloMenu(page)).toBeVisible();
    await expect(haloMenu(page)).toHaveAttribute('data-mode', 'arc');
    const state = await halo(page);
    expect(state.noun).toEqual({ kind: 'control', id });
    expect(state.petals.length).toBeGreaterThanOrEqual(3);
    expect(state.petals.length).toBeLessThanOrEqual(6);
    expect(state.visibleTargets).toBeLessThanOrEqual(36);
    // the breadcrumb names the selection; the Thumb key appears with a selection (§5.5)
    await expect(page.getByTestId('halo-breadcrumb')).toContainText('L Upper Arm');
    expect(state.thumb).toMatchObject({ mode: 'off', tap: 'selectMore', drag: 'fine' });
    // no floater over the selection (AS-ST-18): the petals sit beside the control's point
    const at = await controlPoint(page, 'L Upper Arm');
    for (const box of await haloMenu(page)
      .getByRole('menuitem')
      .evaluateAll((els) =>
        els.map(
          (el) => el.getBoundingClientRect().toJSON() as { left: number; right: number; top: number; bottom: number },
        ),
      )) {
      expect(at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom).toBe(false);
    }

    // a petal runs its operator (Key): one undo step
    const before = (await call(page, 'history')).undo.length;
    await fingerTap(page, await petalCenter(page, 'Key'));
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(before + 1);
    expect(await selectedControls(page)).toEqual([id]);

    // ⋯ More opens the More sheet for the noun
    await fingerTap(page, await petalCenter(page, 'More'));
    await expect.poll(async () => (await halo(page)).sheet).toBe('more');
    await expect(page.getByTestId('halo-sheet-more')).toBeVisible();
  });

  test('a tap on empty space clears; Animate offers Reselect; a selected thing reopens its Halo', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadPolybot(page);
    const id = await tapControl(page, 'L Upper Arm');
    await fingerTap(page, await emptyPoint(page));
    await expect.poll(() => selectedControls(page)).toEqual([]);
    await expect(haloMenu(page)).toHaveCount(0);
    await expect(page.getByTestId('halo-reselect')).toBeVisible();
    await page.getByTestId('halo-reselect').tap();
    await expect.poll(() => selectedControls(page)).toEqual([id]);
    await expect(haloMenu(page)).toBeVisible();
    // a tap on the selected thing reopens its Halo after it was closed
    await page.keyboard.press('Escape');
    await expect(haloMenu(page)).toHaveCount(0);
    await fingerTap(page, await controlPoint(page, 'L Upper Arm'));
    await expect(haloMenu(page)).toBeVisible();
    expect(await selectedControls(page)).toEqual([id]);
  });

  test('a long-press opens the ring at the finger; a flick runs a slot', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadPolybot(page);
    const at = await emptyPoint(page);
    await fingerHold(page, at, 600);
    await expect(haloMenu(page)).toHaveAttribute('data-mode', 'ring');
    expect((await halo(page)).noun?.kind).toBe('empty');
    await page.keyboard.press('Escape');
    // press, flick up (N = New animation) and lift: its form opens (clip.new has a pre-run form, §5.6)
    const s = await cdp(page);
    await touchEvent(s, 'touchStart', [at]);
    await page.waitForTimeout(600);
    await touchEvent(s, 'touchMove', [{ x: at.x, y: at.y - 30 }]);
    await touchEvent(s, 'touchMove', [{ x: at.x, y: at.y - 70 }]);
    await touchEvent(s, 'touchEnd', []);
    await s.detach();
    await expect(page.getByTestId('halo-form')).toBeVisible();
    await expect(page.getByTestId('halo-form')).toHaveAttribute('data-op', 'clip.new');
  });

  test('double-tap frames, a drag on empty space orbits, two fingers undo with a toast and Redo', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadPolybot(page);
    // one finger on empty space orbits: the camera moves, the selection stays empty
    const start = await camera(page);
    const at = await emptyPoint(page);
    await fingerDrag(page, at, { x: at.x - 140, y: at.y + 30 });
    await expect.poll(async () => near(await camera(page), start)).toBe(false);
    expect(await selectedControls(page)).toEqual([]);
    // double-tap on empty space frames everything (as view.frame all does): from a hand's close-up
    await runOk(page, 'select.controls', { ids: [await controlId(page, 'L Hand')], mode: 'replace' });
    await runOk(page, 'view.frame', { what: 'selection', paneId: 'pane-single' });
    await runOk(page, 'select.none');
    const orbited = await camera(page);
    await fingerTap(page, at);
    await page.waitForTimeout(60);
    await fingerTap(page, at);
    await expect.poll(async () => near(await camera(page), orbited)).toBe(false);
    expect((await halo(page)).noun).toBeNull();
    // taps right after a double-tap are absorbed (C17): wait out the multi-tap window
    await page.waitForTimeout(500);

    // two fingers undo one step; the toast names it and offers Redo
    await tapControl(page, 'L Upper Arm');
    await fingerTap(page, await petalCenter(page, 'Key'));
    await expect.poll(async () => (await call(page, 'history')).undo.at(-1)).toBeTruthy();
    const label = (await call(page, 'history')).undo.at(-1) ?? '';
    const p = await emptyPoint(page);
    await twoFingers(page, [p, { x: p.x + 80, y: p.y }], [p, { x: p.x + 80, y: p.y }], 0);
    await expect.poll(async () => (await call(page, 'history')).redo).toEqual([label]);
    const toast = page.getByTestId('halo-toasts').getByText(`Undid: ${label}`);
    await expect(toast).toBeVisible();
    await page.getByTestId('halo-toasts').getByRole('button', { name: 'Redo' }).tap();
    await expect.poll(async () => (await call(page, 'history')).redo).toEqual([]);
  });

  test('a quick pinch frames everything (C5)', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadPolybot(page);
    const at = await emptyPoint(page);
    await fingerDrag(page, at, { x: at.x - 200, y: at.y + 60 }, 4);
    // a quick pinch-in, released: frame all — the camera ends where `view.frame all` puts it from here (a plain
    // dolly would leave it nearer or farther)
    const c = { x: 600, y: 420 };
    await twoFingers(
      page,
      [
        { x: c.x - 160, y: c.y },
        { x: c.x + 160, y: c.y },
      ],
      [
        { x: c.x - 40, y: c.y },
        { x: c.x + 40, y: c.y },
      ],
      2,
    );
    await page.waitForTimeout(150);
    const pinched = await camera(page);
    await runOk(page, 'view.frame', { what: 'all', paneId: 'pane-single' });
    expect(near(await camera(page), pinched, 0.02)).toBe(true);
  });

  test('Make: a tap on a mesh selects the object and opens its verbs', async ({ page }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    await loadCubeLadInMake(page);
    // the import selected the mesh: clear it, then a tap on it selects it again and opens its Halo
    const on = await meshPoint(page);
    await fingerTap(page, await emptyPoint(page));
    await expect.poll(async () => (await halo(page)).noun).toBeNull();
    await fingerTap(page, on);
    await expect.poll(async () => (await halo(page)).noun?.kind).toBe('mesh');
    await expect(haloMenu(page)).toBeVisible();
    await expect(petal(page, 'Duplicate')).toBeVisible();
    expect((await grammar(page))['halo']).toEqual({ mode: 'arc', reduced: false });
  });
  test('verb → target: Parent to… (More) waits for a tap on the target, then parents the subject (§6.4)', async ({
    page,
  }, testInfo) => {
    touchOnly(testInfo);
    await openHalo(page);
    // two shapes (imported meshes keep their place, so the subject and the target are primitives), the target
    // framed in the middle of the pane and the subject selected
    await runOk(page, 'workspace.set', { workspace: 'model' });
    const a = (await runOk<{ mesh: string }>(page, 'mesh.create.cube')).mesh;
    const b = (await runOk<{ mesh: string }>(page, 'mesh.create.cube')).mesh;
    await expect.poll(async () => (await halo(page)).stage).toBe('make');
    await runOk(page, 'scene.object.transform', {
      ids: [b],
      placements: [{ t: [6, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }],
    });
    await runOk(page, 'select.objects', { ids: [b], mode: 'replace' });
    await runOk(page, 'view.frame', { what: 'selection', paneId: 'pane-single' });
    await runOk(page, 'select.objects', { ids: [a], mode: 'replace' });
    // a selection made elsewhere shows its breadcrumb; the Halo opens from its ⋯ Verbs; Parent to… is in its More
    // (§6.2's mesh row), and the More row waits for the target like a petal would (§6.4)
    await page.getByTestId('halo-verbs').tap();
    await expect.poll(async () => (await halo(page)).noun).toEqual({ kind: 'mesh', id: a });
    await fingerTap(page, await petalCenter(page, 'More'));
    await expect(page.getByTestId('halo-sheet-more')).toBeVisible();
    await page.getByTestId('halo-sheet-more').locator('[data-op="scene.parent"] button').first().tap();
    await expect(page.getByTestId('halo-target')).toBeVisible();
    await expect(page.getByTestId('halo-sheet-more')).toHaveCount(0);
    const pane = (await call(page, 'panes')).find((p) => p.id === 'pane-single');
    if (pane === undefined) throw new Error('no pane');
    await fingerTap(page, { x: pane.rect.x + pane.rect.w / 2, y: pane.rect.y + pane.rect.h / 2 });
    await expect.poll(async () => (await call(page, 'meshes')).find((m) => m.id === a)?.parent).toBe(b);
    await expect(page.getByTestId('halo-target')).toHaveCount(0);
    // the subject keeps its selection and its Halo
    await expect.poll(async () => (await halo(page)).noun?.id).toBe(a);
  });
});

/** The centre of a petal (page px), for a finger tap. */
async function petalCenter(page: Page, label: string): Promise<{ x: number; y: number }> {
  const box = await petal(page, label).boundingBox();
  if (box === null) throw new Error(`no petal ${label}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('ha-02: mouse grammar', () => {
  test('a click selects (⋯ Verbs on the breadcrumb); right-click opens the ring; a right drag flicks', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chrome', 'chrome (mouse) only');
    await openHalo(page);
    await loadPolybot(page);
    const id = await controlId(page, 'L Upper Arm');
    const at = await controlPoint(page, 'L Upper Arm');
    await page.mouse.click(at.x, at.y);
    await expect.poll(() => selectedControls(page)).toEqual([id]);
    // §4.5 (ST-11): a mouse click selects; the Halo opens on right-click or ⋯ Verbs
    await expect(haloMenu(page)).toHaveCount(0);
    await page.getByTestId('halo-verbs').click();
    await expect(haloMenu(page)).toHaveAttribute('data-mode', 'arc');
    await page.keyboard.press('Escape');
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(haloMenu(page)).toHaveAttribute('data-mode', 'ring');
    expect((await halo(page)).noun).toEqual({ kind: 'control', id });
    await page.keyboard.press('Escape');
    // right drag toward N (Key) and release: runs it
    const before = (await call(page, 'history')).undo.length;
    await page.mouse.move(at.x, at.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(at.x, at.y - 40, { steps: 3 });
    await page.mouse.move(at.x, at.y - 80, { steps: 3 });
    await page.mouse.up({ button: 'right' });
    await expect.poll(async () => (await call(page, 'history')).undo.length).toBe(before + 1);
    // a still click on empty space clears the selection; a left drag there orbits
    const empty = await emptyPoint(page);
    await page.mouse.click(empty.x, empty.y);
    await expect.poll(() => selectedControls(page)).toEqual([]);
    const start = await camera(page);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x - 120, empty.y + 20, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => near(await camera(page), start)).toBe(false);
  });
});

test.describe('ha-02: WebKit iPad boot', () => {
  test('/app boots, Home’s sample loads, a touch on the Path switches the stage', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'webkit-ipad', 'WebKit iPad only');
    await openHalo(page);
    await expect(page.getByTestId('halo-home')).toBeVisible();
    expect((await halo(page)).slices['grammar']).toMatchObject({ home: true });
    await page.getByTestId('halo-home-sample').tap();
    await expect(page.getByTestId('halo-home')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId('halo-path')).toBeVisible();
    await page.getByTestId('halo-path').getByRole('tab', { name: 'Rig' }).tap();
    await expect.poll(async () => (await halo(page)).stage).toBe('rig');
    await expect.poll(async () => (await call(page, 'state')).workspace).toBe('rig');
    expect((await halo(page)).visibleTargets).toBeLessThanOrEqual(22);
  });
});
