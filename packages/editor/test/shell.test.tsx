// The whole shell over the fake app (EditorRoot as the /dev/shell harness mounts it): menus, status line, first-run
// dialog, window keyboard routing, toasts, drag-and-drop, the GL host's demand rendering and the "no per-frame
// React renders" rule.
import { DEG2RAD } from '@ekza-animator/anim-core';
import type { DocSnapshot } from '@ekza-animator/doc';
import { GLOBAL_SCOPE, type EditorApp, type OperatorDef } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { Profiler } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EditorRoot } from '../src/shell/EditorRoot';
import { createSyntheticModelLoader } from '../src/testing/syntheticModels';
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
  // No Tailwind in unit tests: give the editor and the GL host a size.
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
/** Interactions run plainly here (no act environment); state settles through waitFor. */
const update = async (fn: () => unknown): Promise<void> => {
  await fn();
  await settle(0);
};

/**
 * Registers stand-ins for operators other work packages own, so the shell's controls have something to call. Runs
 * once the GL host has settled and skips operators that are already registered (WP-5's viewport contributions and,
 * after integration, the real catalog).
 */
function stubOperators(app: EditorApp): void {
  const op = (id: string, apply: OperatorDef<Record<string, unknown> | undefined>['apply']): void => {
    if (app.operators.get(id) !== undefined) return;
    app.contribute({
      kind: 'operator',
      def: { id: id as `${string}.${string}`, label: id, category: 'test', scope: GLOBAL_SCOPE, apply },
    });
  };
  op('view.tool', (_ctx, args) => {
    const tools = app.session.getState().tools;
    app.session.setState({ tools: { ...tools, viewport: String(args?.['tool']) } });
  });
  op('view.setManipSpace', (_ctx, args) => {
    const key = args?.['tool'] === 'move' ? 'moveSpace' : 'rotateSpace';
    app.prefs.setState({ [key]: args?.['space'] } as never);
  });
  op('key.toggleAutoKey', () => app.prefs.setState({ autoKey: !app.prefs.getState().autoKey }));
  op('view.layout', (_ctx, args) => app.session.setState({ viewportLayout: args?.['layout'] as never }));
  op('key.set', () => {});
  op('time.togglePlay', () => {
    const time = app.session.getState().time;
    app.session.setState({ time: { ...time, playing: !time.playing } });
  });
}

async function mount(params: Partial<EditorParams> = {}): Promise<{ view: Rendered; app: FakeEditorApp }> {
  let app: FakeEditorApp | null = null;
  const view = mountLive(
    <EditorRoot
      params={{ ...DEFAULT_PARAMS, e2e: true, ...params }}
      createApp={({ services, platform }) => {
        app = createFakeEditorApp({
          snapshot,
          skeleton,
          services: { ...services, models: createSyntheticModelLoader() },
          platform,
        });
        return app;
      }}
    />,
  );
  await waitFor(() => app !== null && document.querySelector('[data-testid="editor-shell"]') !== null);
  if (app === null) throw new Error('the editor did not create its app');
  await window.__EKZA_ANIMATOR_TEST__?.ready;
  stubOperators(app);
  return { view, app };
}

const testId = (view: Rendered, id: string): HTMLElement => byTestId(document.body, id);

describe('editor shell', () => {
  it('mounts the chrome, installs the test API and settles WebGL', async () => {
    const { view } = await mount();
    for (const id of ['menubar', 'statusline', 'workspace', 'timeline-region', 'helpline']) {
      expect(testId(view, id)).toBeTruthy();
    }
    const api = window.__EKZA_ANIMATOR_TEST__;
    expect(api).toBeDefined();
    await api?.ready;
    expect(api?.webgl.ok).toBe(true);
    await waitFor(() => (api?.renderedFrames() ?? 0) > 0);
    // Render on demand: an idle editor renders no frames.
    const idle = api?.renderedFrames() ?? 0;
    await settle(300);
    expect(api?.renderedFrames()).toBe(idle);
    await view.unmount();
    expect(window.__EKZA_ANIMATOR_TEST__).toBeUndefined();
  });

  it('status line: tools, rotate space (gimbal also picks the rotate tool), mask, auto-key and layout', async () => {
    const { view, app } = await mount();
    expect(testId(view, 'status-tool-select').getAttribute('aria-checked')).toBe('true');
    await update(() => testId(view, 'status-rotate-space-gimbal').click());
    await waitFor(() => app.session.getState().tools.viewport === 'rotate');
    expect(app.prefs.getState().rotateSpace).toBe('gimbal');
    expect(testId(view, 'status-rotate-space-gimbal').getAttribute('aria-checked')).toBe('true');
    expect(testId(view, 'status-tool-rotate').getAttribute('aria-checked')).toBe('true');

    await update(() => testId(view, 'status-mask-joints').click());
    await waitFor(() => app.session.getState().tools.selectionMask.joints);

    await update(() => testId(view, 'status-autokey').click());
    await waitFor(() => app.prefs.getState().autoKey);
    expect(testId(view, 'status-autokey').getAttribute('aria-pressed')).toBe('true');

    await update(() => testId(view, 'status-layout-quad').click());
    await waitFor(() => app.session.getState().viewportLayout === 'quad');
    await view.unmount();
  });

  it('first run: navigation and Space choices are saved and the dialog closes', async () => {
    const { view, app } = await mount({ firstRun: true });
    await waitFor(() => document.querySelector('[data-testid="firstrun-dialog"]') !== null);
    expect(testId(view, 'firstrun-getting-started').textContent).toContain('Plant Feet');
    await update(() => testId(view, 'firstrun-nav-trackpad').click());
    await update(() => testId(view, 'firstrun-space-play').click());
    await update(() => testId(view, 'firstrun-done').click());
    await waitFor(() => app.session.getState().dialog === null);
    expect(app.prefs.getState()).toMatchObject({ navProfile: 'trackpad', spaceBehaviour: 'play', firstRunDone: true });
    expect(document.querySelector('[data-testid="firstrun-dialog"]')).toBeNull();
    await view.unmount();
  });

  it('routes window keys by physical code to the panel under the pointer', async () => {
    const { view, app } = await mount();
    app.contribute({
      kind: 'keymap',
      bindings: [
        { chord: { code: 'KeyS' }, op: 'key.set', args: { channels: 'all' }, scope: 'viewport' },
        { chord: { code: 'KeyV', alt: true }, op: 'time.togglePlay', scope: GLOBAL_SCOPE },
      ],
    });
    await waitFor(() => document.querySelector('[data-testid="panel-viewport"]') !== null);
    const viewport = byTestId(document.body, 'panel-viewport');
    viewport.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 700, clientY: 300 }));
    await waitFor(() => app.session.getState().hoveredPanel?.kind === 'viewport');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 'ы', bubbles: true, cancelable: true }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyV', key: '√', altKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => app.calls.some((call) => call.id === 'time.togglePlay'));
    expect(app.calls.find((call) => call.id === 'key.set')?.args).toEqual({ channels: 'all' });
    expect(app.session.getState().time.playing).toBe(true);
    await view.unmount();
  });

  it('shows toasts with an Undo action that runs its operator', async () => {
    const { view, app } = await mount();
    await update(() =>
      app.services.notify.toast({ kind: 'success', text: 'Deleted 9 keys', action: { label: 'Undo', op: 'key.set' } }),
    );
    await waitFor(() => document.querySelector('[data-testid="toast"]') !== null);
    expect(testId(view, 'toast').textContent).toContain('Deleted 9 keys');
    const before = app.calls.length;
    await update(() => testId(view, 'toast-action').click());
    await waitFor(() => app.calls.length > before);
    expect(app.calls.at(-1)?.id).toBe('key.set');
    await view.unmount();
  });

  it('accepts files dropped anywhere on the window', async () => {
    const { view, app } = await mount();
    const imported: unknown[] = [];
    app.contribute({
      kind: 'operator',
      def: {
        id: 'file.importAnimation',
        label: 'Import',
        category: 'file',
        scope: GLOBAL_SCOPE,
        apply: (_c, a) => imported.push(a),
      },
    });
    app.contribute({
      kind: 'importer',
      def: { id: 'vrma', label: 'VRMA', extensions: ['vrma'], op: 'file.importAnimation' },
    });
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([7, 8])], 'wave.vrma'));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector('[data-testid="drop-overlay"]') !== null);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    await waitFor(() => imported.length === 1);
    expect(imported[0]).toEqual({ name: 'wave.vrma', bytes: new Uint8Array([7, 8]) });
    expect(document.querySelector('[data-testid="drop-overlay"]')).toBeNull();
    await view.unmount();
  });

  it('opens several dropped files one after another, each model through its own import dialog', async () => {
    const { view, app } = await mount();
    const runs: { id: string; name: unknown }[] = [];
    for (const id of ['file.importModel', 'file.importAnimation'] as const) {
      app.contribute({
        kind: 'operator',
        def: {
          id,
          label: id,
          category: 'file',
          scope: GLOBAL_SCOPE,
          apply: (_c, a) => runs.push({ id, name: (a as { readonly name?: unknown }).name }),
        },
      });
    }
    app.contribute({
      kind: 'importer',
      def: { id: 'gltf-model', label: 'glTF / VRM', extensions: ['glb', 'vrm'], op: 'file.importModel' },
    });
    app.contribute({
      kind: 'importer',
      def: { id: 'vrma', label: 'VRMA', extensions: ['vrma'], op: 'file.importAnimation' },
    });
    const fileName = (): string | null =>
      document.querySelector('[data-testid="import-file-name"]')?.textContent ?? null;

    const transfer = new DataTransfer();
    for (const name of ['walk.vrma', 'polybot.vrm', 'seed-san.vrm'])
      transfer.items.add(new File([new Uint8Array([1, 2, 3])], name));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));

    // The model opens first (the animation needs it); nothing else runs while its dialog shows.
    await waitFor(() => fileName() === 'polybot.vrm');
    await settle(50);
    expect(runs).toEqual([]);
    await update(() => testId(view, 'import-confirm').click());
    await waitFor(() => fileName() === 'seed-san.vrm');
    expect(runs).toEqual([{ id: 'file.importModel', name: 'polybot.vrm' }]);
    // Cancelling the second model moves on to the animation.
    await update(() => testId(view, 'import-cancel').click());
    await waitFor(() => runs.length === 2);
    expect(runs).toEqual([
      { id: 'file.importModel', name: 'polybot.vrm' },
      { id: 'file.importAnimation', name: 'walk.vrma' },
    ]);
    expect(app.session.getState().dialog).toBeNull();
    expect(document.querySelector('[data-testid="import-dialog"]')).toBeNull();
    await view.unmount();
  });

  it('opens dialogs from the menu bar and closes them with Escape', async () => {
    const { view, app } = await mount();
    await update(() =>
      testId(view, 'menu-help').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
    );
    await waitFor(() => document.querySelector('[data-testid="menu-item-shell.help.about"]') !== null);
    await update(() => testId(view, 'menu-item-shell.help.about').click());
    await waitFor(() => app.session.getState().dialog === 'about');
    expect(testId(view, 'about-credits').textContent).toContain('Seed-san');
    expect(testId(view, 'about-notices').getAttribute('href')).toBe('/THIRD_PARTY_NOTICES.txt');
    const dialog = testId(view, 'about-dialog');
    await update(() =>
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
    );
    await waitFor(() => app.session.getState().dialog === null);
    await view.unmount();
  });

  it('drives playback through the demand frame loop and goes idle when stopped', async () => {
    const { view, app } = await mount();
    const api = window.__EKZA_ANIMATOR_TEST__;
    await api?.ready;
    await settle(100);
    const before = api?.renderedFrames() ?? 0;
    const time = app.session.getState().time;
    app.session.setState({ time: { ...time, playing: true } });
    app.requestFrame();
    await waitFor(() => app.session.getState().time.sceneFrame > 3, 3000);
    expect((api?.renderedFrames() ?? 0) - before).toBeGreaterThan(3);
    app.session.setState({ time: { ...app.session.getState().time, playing: false } });
    await settle(100);
    const stopped = api?.renderedFrames() ?? 0;
    await settle(200);
    expect(api?.renderedFrames()).toBe(stopped);
    await view.unmount();
  });

  it('suppresses browser defaults inside the editor and guards unsaved work on unload', async () => {
    const { view, app } = await mount({ e2e: false });
    const inside = testId(view, 'statusline');
    const fire = (target: EventTarget, event: Event): boolean => {
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const mouse = (type: string, init: MouseEventInit = {}) =>
      new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    // Context menu: suppressed in the editor, kept in text fields and outside the editor.
    expect(fire(inside, mouse('contextmenu'))).toBe(true);
    const field = document.createElement('input');
    inside.append(field);
    expect(fire(field, mouse('contextmenu'))).toBe(false);
    field.remove();
    const outside = document.createElement('div');
    document.body.append(outside);
    expect(fire(outside, mouse('contextmenu'))).toBe(false);
    // Middle button: no autoscroll, no primary-selection paste.
    expect(fire(inside, mouse('mousedown', { button: 1 }))).toBe(true);
    expect(fire(inside, mouse('auxclick', { button: 1 }))).toBe(true);
    expect(fire(inside, mouse('mousedown', { button: 0 }))).toBe(false);
    expect(fire(outside, mouse('mousedown', { button: 1 }))).toBe(false);
    outside.remove();
    // Trackpad pinch (Ctrl+wheel) never zooms the page; a plain wheel is left alone.
    expect(fire(inside, new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 4 }))).toBe(
      true,
    );
    expect(fire(inside, new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 4 }))).toBe(false);
    // Unload guard: only with unsaved changes.
    expect(fire(window, new Event('beforeunload', { cancelable: true }))).toBe(false);
    app.session.setState({ dirty: true });
    expect(fire(window, new Event('beforeunload', { cancelable: true }))).toBe(true);
    app.session.setState({ dirty: false });
    await view.unmount();
    // e2e mode never prompts (reloads are part of the scenarios).
    const e2e = await mount();
    e2e.app.session.setState({ dirty: true });
    expect(fire(window, new Event('beforeunload', { cancelable: true }))).toBe(false);
    await e2e.view.unmount();
  });

  it('reports a lost WebGL context and recovers when it is restored', async () => {
    const { view } = await mount();
    await window.__EKZA_ANIMATOR_TEST__?.ready;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="gl-host"] canvas');
    const gl = canvas?.getContext('webgl2');
    const lose = gl?.getExtension('WEBGL_lose_context');
    if (lose === undefined || lose === null) throw new Error('WEBGL_lose_context is not available');
    lose.loseContext();
    await waitFor(() => (testId(view, 'helpline').textContent ?? '').includes('Graphics context lost'));
    await waitFor(() => document.querySelector('[data-testid="toast"][data-kind="warning"]') !== null);
    lose.restoreContext();
    await waitFor(() => !(testId(view, 'helpline').textContent ?? '').includes('Graphics context lost'), 3000);
    expect(window.__EKZA_ANIMATOR_TEST__?.webgl.ok).toBe(true);
    await view.unmount();
  });

  it('commits no React renders while the scene clock advances (playback, scrubbing)', async () => {
    let commits = 0;
    let app: FakeEditorApp | null = null;
    const view = mountLive(
      <Profiler
        id="shell"
        onRender={() => {
          commits++;
        }}
      >
        <EditorRoot
          params={{ ...DEFAULT_PARAMS, e2e: true }}
          createApp={({ services, platform }) => {
            app = createFakeEditorApp({
              snapshot,
              skeleton,
              services: { ...services, models: createSyntheticModelLoader() },
              platform,
            });
            return app;
          }}
        />
      </Profiler>,
    );
    await waitFor(() => window.__EKZA_ANIMATOR_TEST__ !== undefined);
    const fake = app as FakeEditorApp | null;
    if (fake === null) throw new Error('no app');
    await window.__EKZA_ANIMATOR_TEST__?.ready;
    await settle(200);
    const settled = commits;
    for (let frame = 1; frame <= 30; frame++) {
      await update(() => {
        const time = fake.session.getState().time;
        fake.session.setState({ time: { ...time, sceneFrame: frame } });
      });
    }
    expect(fake.evaluation.channelValues('rig_SyntheticWave001:fk.lowerArm.L' as never).rz).toBeCloseTo(
      30 * DEG2RAD,
      9,
    );
    expect(commits - settled).toBe(0);
    await view.unmount();
  });
});
