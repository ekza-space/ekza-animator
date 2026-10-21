// M6A-SPEC §5.17, §8.1, §8.2, §8.10 (B9): the whole shell with the workspaces — tabs and glyphs, the dock layout and
// viewport layout per workspace (Animate's untouched by Model), the hidden time slider, Model's status-line groups,
// help line and pane header, the overlay slots, `ws=` and `prefs.lastWorkspace` at start, and Mod+K.
import type { DocSnapshot } from '@ekza-studio/doc';
import {
  animateStatus,
  BUILTIN_MENU_ITEMS,
  MODEL_MENU_ITEMS,
  type EditorApp,
  registerBuiltinOperators,
  registerBuiltinWorkspaces,
} from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { viewportManagerOf } from '@ekza-studio/viewport';
import type { JSX } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { registerPaneOverlay } from '../src/overlays/slots';
import { EditorRoot } from '../src/shell/EditorRoot';
import { layoutStorageKey } from '../src/shell/layout';
import { STATUS_SETTLE_MS } from '../src/shell/statusSchedule';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
import type { Shell } from '../src/shell/types';
import { DEFAULT_PARAMS, type EditorParams } from '../src/test-api/params';
import { byTestId } from './render';
import { liveEnvironment, mountLive, settle, waitFor, waveFixtures } from './shell-helpers';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
let style: HTMLStyleElement;
let restoreAct: () => void = () => {};
beforeAll(async () => {
  restoreAct = liveEnvironment();
  ({ snapshot, skeleton } = await waveFixtures());
  style = document.createElement('style');
  style.textContent =
    '.ekza-editor{position:relative;width:1440px;height:900px;display:block}' +
    '[data-testid="gl-host"]{position:fixed;inset:0;pointer-events:none}' +
    '[data-testid="editor-shell"]{display:flex;flex-direction:column;height:100%}' +
    '[data-testid="editor-shell"]>main{flex:1;min-height:0}';
  document.head.append(style);
});
afterAll(() => {
  style.remove();
  restoreAct();
});

type Rendered = ReturnType<typeof mountLive>;
const testId = (id: string): HTMLElement => byTestId(document.body, id);
const query = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`);

/** The built-in operators, workspaces and menus on the fake app (the editor's `createEditorApp` registers them). */
function withBuiltins(app: EditorApp): void {
  registerBuiltinOperators(app);
  registerBuiltinWorkspaces(app);
  // The Model menu items come with the Model operators chunk in the editor (M6A-INT-13): both lists here.
  for (const def of [...BUILTIN_MENU_ITEMS, ...MODEL_MENU_ITEMS]) {
    if (app.menus.get(def.id) === undefined) app.contribute({ kind: 'menu', def });
  }
}

let shell: Shell | null = null;
let mounted: Rendered | null = null;
afterEach(async () => {
  // A failed test still unmounts its editor, so the next one starts from an empty page.
  if (mounted !== null && document.body.contains(mounted.container)) await mounted.unmount();
  mounted = null;
});

async function mount(
  params: Partial<EditorParams> = {},
  opts: { readonly lastWorkspace?: string } = {},
): Promise<{ view: Rendered; app: FakeEditorApp; shell: Shell }> {
  let app: FakeEditorApp | null = null;
  shell = null;
  const view = mountLive(
    <EditorRoot
      params={{ ...DEFAULT_PARAMS, e2e: true, ...params }}
      onShell={(mounted) => {
        shell = mounted;
        return undefined;
      }}
      createApp={({ services, platform }) => {
        app = createFakeEditorApp({
          snapshot,
          skeleton,
          services: { ...services, models: createSyntheticModelLoader() },
          platform,
        });
        withBuiltins(app);
        if (opts.lastWorkspace !== undefined) app.prefs.setState({ lastWorkspace: opts.lastWorkspace });
        return app;
      }}
    />,
  );
  mounted = view;
  await waitFor(() => app !== null && shell !== null && query('editor-shell') !== null);
  if (app === null || shell === null) throw new Error('the editor did not start');
  await waitFor(() => window.__EKZA_STUDIO_TEST__ !== undefined);
  await window.__EKZA_STUDIO_TEST__?.ready;
  return { view, app, shell };
}

/** The panel kinds in the dock layout (inactive tabs included). */
const kinds = (): string[] => [...(shell?.workspace.kinds() ?? [])].sort();

describe('workspace tabs (§5.17, §8.1)', () => {
  it('shows Model › Rig & Skin › Animate › Review with glyphs; disabled tabs do nothing; a click switches', async () => {
    const { view, app } = await mount();
    const tabs = testId('ws-tabs');
    expect(tabs.getAttribute('role')).toBe('tablist');
    expect([...tabs.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('data-testid'))).toEqual([
      'ws-tab-model',
      'ws-tab-rig',
      'ws-tab-animate',
      'ws-tab-review',
    ]);
    expect(testId('ws-tab-animate').getAttribute('aria-selected')).toBe('true');
    // M6B-SPEC §3 rule 9 literal update: Rig & Skin is enabled; Review is the disabled tab.
    expect(testId('ws-tab-rig').getAttribute('aria-disabled')).not.toBe('true');
    expect(testId('ws-tab-review').getAttribute('aria-disabled')).toBe('true');
    expect(testId('ws-glyph-model').textContent).toBe('○');
    expect(testId('ws-glyph-animate').textContent).toBe('●'); // the wave clip has keys
    expect(query('ws-glyph-review')).toBeNull();
    testId('ws-tab-review').click();
    await settle(30);
    expect(app.session.getState().workspace).toBe('animate');
    // Animate shows its menus; Model its own (no Key or Pose menu there).
    expect(query('menu-key')).not.toBeNull();
    testId('ws-tab-model').click();
    await waitFor(() => app.session.getState().workspace === 'model');
    await waitFor(() => query('menu-create') !== null);
    expect(query('menu-key')).toBeNull();
    expect(query('menu-mesh')).not.toBeNull();
    expect(testId('ws-tab-model').getAttribute('aria-selected')).toBe('true');
    expect(app.prefs.getState().lastWorkspace).toBe('model');
    await view.unmount();
  });

  it('re-reads the statuses at human speed: after committed changes, not per preview frame of a drag (§4.6)', async () => {
    const { view, app } = await mount();
    const animate = app.workspaces.get('animate');
    if (animate === undefined) throw new Error('no Animate workspace');
    let reads = 0;
    const dispose = app.contribute({
      kind: 'workspace',
      def: {
        ...animate,
        id: 'probe',
        label: 'Probe',
        shortLabel: 'Prb',
        order: 99,
        status: (a) => {
          reads += 1;
          return animateStatus(a);
        },
      },
    });
    await waitFor(() => query('ws-glyph-probe') !== null);
    expect(testId('ws-glyph-probe').textContent).toBe('●');
    await settle(2 * STATUS_SETTLE_MS);
    const key = app.store.list('keys')[0];
    if (key === undefined) throw new Error('the wave clip has no keys');
    // A 600 ms key drag: one preview batch every 20 ms. Every frame used to re-render the tabs and re-read every
    // status; now the drag reads none (one read may slip through a browser stall longer than the settle window).
    const before = reads;
    const preview = app.store.beginPreview('Move Keys');
    for (let frame = 1; frame <= 30; frame += 1) {
      preview.update((tx) => tx.patch('keys', key.id, { v: key.v + frame / 100 }));
      await settle(20);
    }
    expect(reads - before).toBeLessThanOrEqual(1);
    const during = reads;
    // A cancelled drag leaves no committed batch: the statuses are read once the previews are quiet.
    preview.cancel();
    await waitFor(() => reads > during);
    await settle(3 * STATUS_SETTLE_MS);
    expect(reads).toBe(during + 1);
    // A committed change shows within the settle window: without keys Animate's glyph is ○.
    app.store.transact({ label: 'Delete Keys' }, (tx) => {
      for (const k of tx.list('keys')) tx.remove('keys', k.id);
    });
    await waitFor(() => testId('ws-glyph-probe').textContent === '○');
    expect(testId('ws-glyph-animate').textContent).toBe('○');
    dispose();
    await view.unmount();
  });
});

describe('layouts per workspace (§4.8, §5.17, §8.2)', () => {
  it('swaps the dock layout; Animate’s v2 layout and viewport layout are untouched by Model', async () => {
    const { view, app, shell: mounted } = await mount();
    const storage = mounted.storage;
    if (storage === null) throw new Error('no storage');
    await waitFor(() => kinds().includes('viewport'));
    expect(kinds()).toEqual(['attributes', 'channelBox', 'clips', 'dopeSheet', 'graph', 'outliner', 'viewport']);
    expect(query('timeline-region')).not.toBeNull();
    expect(app.session.getState().viewportLayout).toBe('split');

    await app.runUntyped('workspace.set', { workspace: 'model' });
    await waitFor(() => kinds().includes('toolkit'));
    // Leaving Animate stored its layout under its own key (v2); Model must never change it.
    const animateLayout = storage.getItem(layoutStorageKey('animate'));
    expect(JSON.parse(animateLayout ?? '{}')).toMatchObject({ schemaVersion: 2, workspace: 'animate' });
    expect(kinds()).toEqual(['attributes', 'channelBox', 'meshCheck', 'outliner', 'palette', 'toolkit', 'viewport']);
    // The Model-only panels are placeholders until their owners land; the time slider is hidden (§8.2).
    expect(query('placeholder-toolkit') ?? query('panel-toolkit')).not.toBeNull();
    expect(query('timeline-region')).toBeNull();
    // M-Quad with the persp pane maximized; Model's display flags in it.
    await waitFor(() => query('viewport-panel')?.getAttribute('data-layout') === 'quad');
    await waitFor(() => query('pane-pane-persp') !== null);
    expect(query('pane-pane-top')).toBeNull();
    const vm = viewportManagerOf(app);
    await waitFor(() => vm?.paneState('pane-persp') !== null);
    expect(vm?.paneState('pane-persp')?.display.shading).toBe('colours');

    // Windows › Timeline shows the time slider in Model (only there).
    await app.runUntyped('workspace.toggleTimeline');
    await waitFor(() => query('timeline-region') !== null);
    await app.runUntyped('workspace.set', { workspace: 'animate' });
    await waitFor(() => kinds().includes('graph'));
    expect(kinds()).toEqual(['attributes', 'channelBox', 'clips', 'dopeSheet', 'graph', 'outliner', 'viewport']);
    await settle(400); // the layout save debounce
    // The same panels in the same groups as when Animate was left (sizes are dockview's to recompute).
    const panelsOf = (text: string | null): string[] =>
      Object.entries((JSON.parse(text ?? '{}') as { dockview: { panels: Record<string, unknown> } }).dockview.panels)
        .map(([id, panel]) => `${id}:${JSON.stringify((panel as { params: unknown }).params)}`)
        .sort((a, b) => a.localeCompare(b));
    expect(panelsOf(storage.getItem(layoutStorageKey('animate')))).toEqual(panelsOf(animateLayout));
    expect(storage.getItem(layoutStorageKey('model', 1))).not.toBeNull();
    expect(
      (JSON.parse(storage.getItem(layoutStorageKey('model', 1)) ?? '{}') as { schemaVersion?: number }).schemaVersion,
    ).toBe(1);
    await waitFor(() => query('viewport-panel')?.getAttribute('data-layout') === 'split');
    await waitFor(() => viewportManagerOf(app)?.paneState('pane-right') !== null);
    expect(viewportManagerOf(app)?.paneState('pane-right')?.display.shading).toBe('lit');
    expect(query('timeline-region')).not.toBeNull();

    // Back in Model: the timeline is still shown there (Windows › Timeline toggled it), the layout is Model's.
    await app.runUntyped('workspace.set', { workspace: 'model' });
    await waitFor(() => kinds().includes('toolkit'));
    expect(query('timeline-region')).not.toBeNull();
    await view.unmount();
  });

  it('opens the workspace ws= asks for, else the one the user left (prefs.lastWorkspace)', async () => {
    const first = await mount({ ws: 'model' });
    expect(first.app.session.getState()).toMatchObject({ workspace: 'model', viewportLayout: 'quad' });
    await waitFor(() => kinds().includes('toolkit'));
    await first.view.unmount();
    const second = await mount({}, { lastWorkspace: 'model' });
    expect(second.app.session.getState().workspace).toBe('model');
    await second.view.unmount();
    const third = await mount({ ws: 'animate' }, { lastWorkspace: 'model' });
    expect(third.app.session.getState().workspace).toBe('animate');
    await third.view.unmount();
    // A disabled workspace is never opened (M6B-SPEC §3 rule 9: Review; Rig & Skin is enabled).
    const fourth = await mount({ ws: 'review' });
    expect(fourth.app.session.getState().workspace).toBe('animate');
    await fourth.view.unmount();
  });
});

describe("Model's status line, help line and pane header (§8.2, §8.10)", () => {
  it('shows the Model groups in Model and the shipped groups in Animate', async () => {
    const { view, app } = await mount();
    expect(query('status-keytarget-selected')).not.toBeNull();
    expect(query('status-mode-object')).toBeNull();
    expect(query('status-tool-scale')).not.toBeNull(); // R: the Scale tool (§3 rule 10)
    await app.runUntyped('workspace.set', { workspace: 'model' });
    await waitFor(() => query('status-mode-object') !== null);
    for (const id of [
      'status-mode-object',
      'status-mode-vertex',
      'status-mode-edge',
      'status-mode-face',
      'status-sym',
      'status-soft',
      'status-snap-grid',
      'status-snap-vertex',
      'status-snap-increment',
      'status-pivot',
      'status-tool-select',
      'status-layout-quad',
    ]) {
      expect(query(id), `${id}`).not.toBeNull();
    }
    expect(query('status-keytarget-selected')).toBeNull();
    expect(testId('status-mode-object').getAttribute('aria-checked')).toBe('true');
    // B12a landed `model.softSelect.toggle` (literal update): the Soft body runs it in Model.
    expect((testId('status-soft') as HTMLButtonElement).disabled).toBe(false);
    await view.unmount();
  });

  it('the help line names the mode and the modeling keys under the pointer (Ctrl+E Extrude)', async () => {
    const { view, app } = await mount({ ws: 'model', platform: 'other' });
    await waitFor(() => query('pane-pane-persp') !== null);
    const pane = testId('pane-pane-persp');
    const rect = pane.getBoundingClientRect();
    pane.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.x + 50, clientY: rect.y + 50 }));
    await waitFor(() => app.session.getState().hoveredPanel?.paneId === 'pane-persp');
    await waitFor(() => (query('helpline-text')?.textContent ?? '').includes('Object mode'));
    expect(testId('helpline-text').textContent).toContain('Ctrl+E Extrude');
    expect(testId('helpline-selection').textContent).toBe('Nothing selected');
    await view.unmount();
  });

  it('Model panes have Shading ▾, Show ▾ and the Wire, Flat, X-ray and Cull toggles', async () => {
    const { view, app } = await mount({ ws: 'model' });
    await waitFor(() => query('pane-shading-pane-persp') !== null);
    const vm = viewportManagerOf(app);
    testId('pane-shading-pane-persp').click();
    await waitFor(() => query('pane-shading-pane-persp-wire') !== null);
    testId('pane-shading-pane-persp-wire').click();
    await waitFor(() => vm?.paneState('pane-persp')?.display.shading === 'wire');
    testId('pane-show-pane-persp').click();
    await waitFor(() => query('pane-show-pane-persp-normals') !== null);
    testId('pane-show-pane-persp-normals').click();
    await waitFor(() => vm?.paneState('pane-persp')?.display.normals === 'both');
    for (const flag of ['wireOnShaded', 'flat', 'xray', 'cull']) {
      expect(query(`pane-display-${flag}-pane-persp`), `${flag}`).not.toBeNull();
    }
    expect(testId('pane-display-flat-pane-persp').getAttribute('aria-pressed')).toBe('true');
    testId('pane-display-cull-pane-persp').click();
    await waitFor(() => vm?.paneState('pane-persp')?.display.cull === true);
    // `6` over the pane: the shading key (view.shading through the keymap, scope `viewport`).
    const pane = testId('pane-pane-persp');
    const rect = pane.getBoundingClientRect();
    pane.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.x + 40, clientY: rect.y + 40 }));
    await waitFor(() => app.session.getState().hoveredPanel?.paneId === 'pane-persp');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit6', key: '6', bubbles: true, cancelable: true }));
    await waitFor(() => vm?.paneState('pane-persp')?.display.shading === 'colours');
    await view.unmount();
  });
});

describe('overlay slots (§4.8)', () => {
  it('draws a registered pane overlay in every pane, and removes it with its disposer', async () => {
    function Hud(props: { readonly paneId: string }): JSX.Element {
      return <span data-testid={`test-hud-${props.paneId}`}>HUD</span>;
    }
    // B10's shell registers the Poly Count HUD when it is created: the test overlay registers after it (the latest
    // registration of a slot draws).
    const { view } = await mount({ ws: 'model' });
    const dispose = registerPaneOverlay('hud', Hud);
    await waitFor(() => query('test-hud-pane-persp') !== null);
    expect(testId('pane-slot-hud-pane-persp').contains(testId('test-hud-pane-persp'))).toBe(true);
    dispose();
    // B10's Poly Count HUD (registered by the shell) owns the slot afterwards: the test overlay is gone from it.
    await waitFor(() => query('test-hud-pane-persp') === null);
    await view.unmount();
  });
});

describe('command palette (§5.18)', () => {
  it('Mod+K opens it; typing filters; Enter runs; the test API reports it', async () => {
    const { view, app } = await mount({ platform: 'other' });
    await waitFor(() => query('panel-viewport') !== null);
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => query('cmdk-input') !== null);
    expect(window.__EKZA_STUDIO_TEST__?.commandPalette()?.open).toBe(true);
    const shellApi = window.__EKZA_STUDIO_TEST__;
    expect(shellApi?.commandPalette()?.items.some((item) => item.label === 'Workspace: Model')).toBe(true);
    const input = testId('cmdk-input') as HTMLInputElement;
    input.focus();
    // React reads the value through its own setter.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, 'workspace: model');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => shellApi?.commandPalette()?.query === 'workspace: model');
    expect(shellApi?.commandPalette()?.items[0]).toEqual({
      op: 'workspace.set',
      label: 'Workspace: Model',
      enabled: true,
    });
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => app.session.getState().workspace === 'model');
    expect(query('cmdk')).toBeNull();
    await view.unmount();
  });
});
