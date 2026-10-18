import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { waitForTestApi } from './helpers/test-api';

// The whole editor shell in the production build, over the shared test kit's fake app (/dev/shell, MVP-SPEC §7
// WP-8): Animate workspace, menus, first-run dialog, window keyboard routing by physical key, Space tap, file drops,
// layout persistence across reloads and the test API. Operators other work packages own are stand-ins registered
// through `window.__EKZA_DEV_SHELL__`; the fake app records every run in `app.calls`.

interface DevShellWindow {
  __EKZA_DEV_SHELL__?: {
    readonly app: {
      readonly calls: readonly { readonly id: string; readonly args: unknown }[];
      contribute(contribution: unknown): () => void;
      readonly prefs: { getState(): Record<string, unknown> };
      readonly session: { getState(): Record<string, unknown> };
    };
    readonly shell: {
      readonly workspace: { kinds(): readonly string[]; readonly dockview: { getPanel(id: string): unknown } | null };
      readonly ui: { getState(): Record<string, unknown> };
    };
  };
}

// M2A-SPEC §4.8: the layout key carries the layout schema version (2 since M2a; literal update, §3 rule 8).
const LAYOUT_KEY = 'ekza-animator:layout:v2:animate';

async function openShell(page: Page, query = '?e2e=1'): Promise<void> {
  await page.goto(`/dev/shell${query}`);
  await page.waitForFunction(() => (window as DevShellWindow).__EKZA_DEV_SHELL__ !== undefined);
  await expect(page.getByTestId('workspace').locator('.dv-tab').first()).toBeVisible();
  if (query.includes('e2e=1')) await waitForTestApi(page);
}

const calls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as DevShellWindow).__EKZA_DEV_SHELL__?.app.calls.map((c) => c.id) ?? []);

const kinds = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...((window as DevShellWindow).__EKZA_DEV_SHELL__?.shell.workspace.kinds() ?? [])]);

async function boxOf(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`${testId} is not visible`);
  return box;
}

test('the Animate workspace: docks around the viewport, chrome above and below', async ({ page }) => {
  await openShell(page);
  for (const id of ['menubar', 'statusline', 'workspace', 'timeline-region', 'helpline']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // M2a: the Dope Sheet is an inactive tab beside the Graph Editor (literal update, M2A-SPEC §3 rule 8).
  expect(new Set(await kinds(page))).toEqual(
    new Set(['viewport', 'outliner', 'clips', 'channelBox', 'attributes', 'graph', 'dopeSheet']),
  );
  const viewport = await boxOf(page, 'panel-viewport');
  const left = await boxOf(page, 'panel-outliner');
  const right = await boxOf(page, 'panel-channelBox');
  const bottom = await boxOf(page, 'panel-graph');
  expect(left.x + left.width).toBeLessThanOrEqual(viewport.x + 1);
  expect(right.x).toBeGreaterThanOrEqual(viewport.x + viewport.width - 1);
  expect(bottom.y).toBeGreaterThanOrEqual(viewport.y + viewport.height - 1);
  const timeline = await boxOf(page, 'timeline-region');
  expect(timeline.y).toBeGreaterThanOrEqual(bottom.y + bottom.height - 1);
  // The viewport dock is transparent: the GL canvas behind it shows through.
  const background = await page
    .getByTestId('panel-viewport')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBe('rgba(0, 0, 0, 0)');
  // Status line controls of §4.8.
  for (const id of ['status-tool-select', 'status-rotate-space-gimbal', 'status-autokey', 'status-layout-quad']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
});

test('first run: the choices are saved and the Getting started card states the M1 scope (E2E-01, shell part)', async ({
  page,
}) => {
  await openShell(page, '?e2e=1&firstRun=1');
  const dialog = page.getByTestId('firstrun-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('firstrun-getting-started')).toContainText('Leg IK');
  await page.getByTestId('firstrun-nav-trackpad').click();
  await page.getByTestId('firstrun-nav-maya').click();
  await page.getByTestId('firstrun-space-play').click();
  await page.getByTestId('firstrun-space-maya').click();
  await page.getByTestId('firstrun-done').click();
  await expect(dialog).toBeHidden();
  const prefs = await page.evaluate(() => {
    const state = (window as DevShellWindow).__EKZA_DEV_SHELL__?.app.prefs.getState() ?? {};
    return { nav: state['navProfile'], space: state['spaceBehaviour'], done: state['firstRunDone'] };
  });
  expect(prefs).toEqual({ nav: 'maya', space: 'maya', done: true });
  expect(await page.evaluate(() => window.__EKZA_ANIMATOR_TEST__?.state().dialog)).toBeNull();
});

test('hotkeys follow the physical key and the panel under the pointer (E2E-20, shell part)', async ({ page }) => {
  await openShell(page, '?e2e=1&platform=mac');
  await page.evaluate(() => {
    const app = (window as DevShellWindow).__EKZA_DEV_SHELL__?.app;
    app?.contribute({
      kind: 'keymap',
      bindings: [
        { chord: { code: 'KeyS' }, op: 'key.set', args: { channels: 'all' }, scope: 'viewport' },
        { chord: { code: 'KeyS' }, op: 'graph.keys.keyCurves', scope: 'graph' },
        { chord: { code: 'KeyV', alt: true }, op: 'time.togglePlay', scope: 'global' },
      ],
    });
  });
  const viewport = await boxOf(page, 'panel-viewport');
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  const dispatch = (init: { readonly code: string; readonly key: string; readonly altKey?: boolean }) =>
    page.evaluate(({ code, key, altKey }) => {
      const options = { code, key, altKey: altKey === true, bubbles: true, cancelable: true };
      document.body.dispatchEvent(new KeyboardEvent('keydown', options));
      document.body.dispatchEvent(new KeyboardEvent('keyup', options));
    }, init);

  await dispatch({ code: 'KeyS', key: 'ы' });
  await expect.poll(() => calls(page)).toEqual(['key.set']);
  await dispatch({ code: 'KeyV', key: '√', altKey: true });
  await expect.poll(() => calls(page)).toEqual(['key.set', 'time.togglePlay']);

  // The same physical key over the Graph Editor resolves in its scope.
  const graph = await boxOf(page, 'panel-graph');
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.keyboard.press('KeyS');
  await expect.poll(() => calls(page)).toEqual(['key.set', 'time.togglePlay', 'graph.keys.keyCurves']);

  // Typing into a text field never triggers hotkeys.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'typing';
    document.querySelector('[data-testid="helpline"]')?.append(input);
  });
  await page.locator('#typing').focus();
  await page.keyboard.type('ss');
  await page.locator('#typing').blur();
  expect(await calls(page)).toEqual(['key.set', 'time.togglePlay', 'graph.keys.keyCurves']);
});

test('Space tap maximizes the panel under the pointer and restores it', async ({ page }) => {
  await openShell(page);
  // §4.10 row of MAYA_KEYMAP (contributed by WP-7b's registerBuiltins; the fake app has no preset).
  await page.evaluate(() => {
    (window as DevShellWindow).__EKZA_DEV_SHELL__?.app.contribute({
      kind: 'keymap',
      bindings: [{ chord: { code: 'Space' }, op: 'view.toggleMaximize', scope: 'global', trigger: 'tap' }],
    });
  });
  const graph = await boxOf(page, 'panel-graph');
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      page.evaluate(() => (window as DevShellWindow).__EKZA_DEV_SHELL__?.shell.ui.getState()['dockMaximized']),
    )
    .toBe(true);
  const maximized = await boxOf(page, 'panel-graph');
  expect(maximized.height).toBeGreaterThan(graph.height * 1.5);
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      page.evaluate(() => (window as DevShellWindow).__EKZA_DEV_SHELL__?.shell.ui.getState()['dockMaximized']),
    )
    .toBe(false);
});

test('a dropped file opens the import dialog; Import runs file.importModel with the options (E2E-03, shell part)', async ({
  page,
}) => {
  await openShell(page);
  await page.evaluate(() => {
    (window as DevShellWindow).__EKZA_DEV_SHELL__?.app.contribute({
      kind: 'importer',
      def: { id: 'gltf-model', label: 'glTF / VRM model', extensions: ['glb', 'vrm'], op: 'file.importModel' },
    });
  });
  const dataTransfer = await page.evaluateHandle(async () => {
    const bytes = await (await fetch('/samples/polybot.vrm')).arrayBuffer();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'polybot.vrm', { type: 'model/gltf-binary' }));
    return transfer;
  });
  await page.dispatchEvent('[data-testid="workspace"]', 'dragenter', { dataTransfer });
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await page.dispatchEvent('[data-testid="workspace"]', 'dragover', { dataTransfer });
  await page.dispatchEvent('[data-testid="workspace"]', 'drop', { dataTransfer });
  await expect(page.getByTestId('drop-overlay')).toBeHidden();
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await expect(page.getByTestId('import-dialog')).toContainText('polybot.vrm');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByTestId('import-dialog')).toBeHidden();
  const imported = await page.evaluate(() => {
    const call = (window as DevShellWindow).__EKZA_DEV_SHELL__?.app.calls.find((c) => c.id === 'file.importModel');
    const args = call?.args as { name?: string; bytes?: Uint8Array; options?: Record<string, unknown> } | undefined;
    return args === undefined ? null : { name: args.name, size: args.bytes?.byteLength, options: args.options };
  });
  expect(imported).toMatchObject({ name: 'polybot.vrm', options: { eulerFilter: true, secondaryControls: true } });
  expect(imported?.size).toBe(readFileSync(new URL('../public/samples/polybot.vrm', import.meta.url)).byteLength);
});

test('the import summary shows the VRM version and licence badges (E2E-03, summary part)', async ({ page }) => {
  await openShell(page);
  await page.evaluate(() => {
    (window as DevShellWindow).__EKZA_DEV_SHELL__?.app.contribute({
      kind: 'importer',
      def: { id: 'gltf-model', label: 'glTF / VRM model', extensions: ['glb', 'vrm'], op: 'file.importModel' },
    });
  });
  const dataTransfer = await page.evaluateHandle(async () => {
    const bytes = await (await fetch('/samples/polybot.vrm')).arrayBuffer();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'polybot.vrm'));
    return transfer;
  });
  await page.dispatchEvent('[data-testid="workspace"]', 'drop', { dataTransfer });
  await expect(page.getByTestId('import-dialog')).toBeVisible();
  await expect(page.getByTestId('import-summary-error')).toHaveCount(0);
  await expect(page.getByTestId('import-format-badge')).toHaveText('VRM 0.x');
  await expect(page.getByTestId('import-license-badge')).toContainText('CC0');
});

test('the layout survives a reload; Reset Workspace restores the default', async ({ page }) => {
  // Without ?e2e=1 the shell keeps its layout in localStorage.
  await page.goto('/dev/shell');
  await page.evaluate(() => localStorage.clear());
  await openShell(page, '');
  await page.evaluate(() => {
    const dockview = (window as DevShellWindow).__EKZA_DEV_SHELL__?.shell.workspace.dockview;
    (dockview?.getPanel('graph') as { api: { close(): void } } | undefined)?.api.close();
  });
  await expect.poll(() => kinds(page)).not.toContain('graph');
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '', LAYOUT_KEY))
    .toContain('"schemaVersion":2');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '', LAYOUT_KEY)).not.toContain('"graph"');

  await page.reload();
  await openShell(page, '');
  expect(await kinds(page)).not.toContain('graph');

  await page.getByTestId('menu-windows').click();
  await page.getByTestId('menu-item-shell.windows.reset').click();
  await expect.poll(() => kinds(page)).toContain('graph');
  await page.reload();
  await openShell(page, '');
  expect(await kinds(page)).toContain('graph');
  await page.evaluate(() => localStorage.clear());
});

test('menus open dialogs; About credits the samples and links the third-party notices', async ({ page }) => {
  await openShell(page);
  await page.getByTestId('menu-help').click();
  await page.getByTestId('menu-item-shell.help.about').click();
  const about = page.getByTestId('about-dialog');
  await expect(about).toBeVisible();
  await expect(page.getByTestId('about-credits')).toContainText('Polybot');
  const href = await page.getByTestId('about-notices').getAttribute('href');
  expect(href).toBe('/THIRD_PARTY_NOTICES.txt');
  const notices = await page.request.get(href ?? '');
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toContain('three');
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();

  await page.getByTestId('menubar-export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toBeHidden();
});

test('the test API reads the fake document', async ({ page }) => {
  await openShell(page);
  const read = await page.evaluate(() => {
    const api = window.__EKZA_ANIMATOR_TEST__;
    if (api === undefined) return null;
    const curves = api.curves('wave', 'fk.lowerArm.L');
    return {
      characters: api.counts()['characters'],
      keys: curves.flatMap((curve) => curve.keys.map((key) => key.t)),
      layout: api.state().layout,
      webgl: api.webgl.ok,
    };
  });
  expect(read).toEqual({ characters: 1, keys: [0, 15, 30], layout: 'split', webgl: true });
});
