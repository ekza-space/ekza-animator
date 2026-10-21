// Creates the shell core for one editor (MVP-SPEC §7 WP-8): panel registry with the built-in panels, shell
// operators and menu items, frame hooks, probes, workspace adapter, keyboard adapter and the file pipeline.
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type EditorApp,
  type OperatorAction,
  type OperatorResult,
  type PanelKind,
  type PrefsStorage,
  provideShellOverlays,
  type RunContext,
} from '@ekza-studio/editor-core';
import { createStore } from 'zustand/vanilla';
import { createFallbackScheduler, createFrameHooks } from '../gl/frameLoop';
import { KeyboardAdapter, scopeChain, viewportToolTarget } from '../input/keyboard';
import { createCommandPalette } from '../overlays/CommandPalette';
import { createMarkingMenus, marksMenus, prefetchMarkingMenu } from '../overlays/MarkingMenu';
import { registerBuiltinPanels } from '../panels';
import { registerModelSelectUi } from '../panels/viewport/hud';
import { registerModelTransformUi } from '../panels/viewport/ModalReadout';
import { simplifyMessage, toleranceOfArgs } from '../panels/graph/simplify';
import { graphTestHooks } from '../panels/graph/testHooks';
import { screenOfTimelineFrame, screenOfTimelineTick } from '../panels/timeline/host';
import { createPanelRegistry } from '../panels/registry';
import type { PanelRegistry } from '../panels/types';
import type { ToastNotifier } from '../services/notify';
import type { EditorParams } from '../test-api/params';
import { startShellAutosave } from './autosave';
import { asArtifacts, createExportRecorder } from './exports';
import { createFilePipeline } from './files';
import { ALL_SLOTS, FIXED_KINDS } from './layout';
import { registerShellMenuItems, registerUserPresetMenuItems } from './menuItems';
import { registerShellOperators } from './operators';
import { createLayoutPresetStore } from './presets';
import { createProbeRegistry } from './probes';
import { type Summarizer, summarizeModel } from './summary';
import type { ConfirmRequest, HelpMessage, Shell, ShellUiState } from './types';
import { registerRigShell } from './rig';
import { createWorkspaceController } from './workspace';

export interface CreateShellOptions {
  readonly app: EditorApp;
  readonly params: EditorParams;
  readonly storage: PrefsStorage | null;
  /** The toast queue the shell renders (null: toasts go to `app.services.notify` only). */
  readonly toasts?: ToastNotifier | null;
  /** Panels to show; default: a registry with `registerBuiltinPanels`. */
  readonly panels?: PanelRegistry;
  /** Model summary for the import dialog; default: @ekza-studio/io. */
  readonly summarize?: Summarizer;
  /** How long a help-line message stays, ms. */
  readonly helpMs?: number;
}

export const INITIAL_UI: ShellUiState = {
  viewport: null,
  gl: { status: 'pending', renderer: null },
  hover: null,
  lastPanel: null,
  pendingImport: null,
  dragOver: false,
  help: null,
  busy: null,
  dockMaximized: false,
  confirm: null,
  chrome: {},
  focus: {},
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createShell(opts: CreateShellOptions): Shell {
  const { app, params } = opts;
  const disposers: Disposer[] = [];
  const ui = createStore<ShellUiState>()(() => INITIAL_UI);

  let panels = opts.panels;
  if (panels === undefined) {
    panels = createPanelRegistry();
    disposers.push(registerBuiltinPanels(panels));
  }
  const registry = panels;

  let reportedFrameError = false;
  const frame = createFrameHooks(app, (error) => {
    if (reportedFrameError) return;
    reportedFrameError = true;
    console.error('Ekza Studio: a per-frame callback failed', error);
  });
  const fallback = createFallbackScheduler(frame);
  app.setFrameRequester(() => fallback.request());
  disposers.push(() => fallback.dispose());

  let helpId = 0;
  let helpTimer: ReturnType<typeof setTimeout> | null = null;
  const help = (text: string, tone: HelpMessage['tone'] = 'info'): void => {
    helpId += 1;
    ui.setState({ help: { id: helpId, text, tone } });
    if (helpTimer !== null) clearTimeout(helpTimer);
    const id = helpId;
    helpTimer = setTimeout(() => {
      if (ui.getState().help?.id === id) ui.setState({ help: null });
    }, opts.helpMs ?? 4000);
  };
  disposers.push(() => {
    if (helpTimer !== null) clearTimeout(helpTimer);
  });

  const notifyError = (text: string, action?: OperatorAction): void =>
    app.services.notify.toast({ kind: 'error', text, ...(action === undefined ? {} : { action }) });

  const confirm = (request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> => {
    if (params.e2e) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      ui.getState().confirm?.resolve(false);
      ui.setState({
        confirm: {
          ...request,
          resolve: (confirmed) => {
            ui.setState({ confirm: null });
            resolve(confirmed);
          },
        },
      });
    });
  };

  const exports = createExportRecorder(params.e2e);

  const runFromUi = async (op: string, args?: unknown, ctx?: RunContext): Promise<OperatorResult<unknown>> => {
    // `file.new` discards without asking (WP-7b B7-1): every UI path (menu, keymap, palette) confirms unsaved work
    // here first, like opening a project does (v0.3 integration).
    if (op === 'file.new' && app.session.getState().dirty) {
      const discard = await confirm({
        title: 'New project',
        text: 'The current project has unsaved changes. Starting a new project discards them.',
        confirmLabel: 'Discard and start new',
      });
      if (!discard) return { status: 'cancelled', reason: 'New project cancelled: unsaved changes kept' };
    }
    let result: OperatorResult<unknown>;
    try {
      result = await app.runUntyped(op, args, ctx);
    } catch (error) {
      result = { status: 'failed', error: { code: 'internal', message: messageOf(error) } };
    }
    if (result.status === 'failed') {
      const label = app.operators.get(op)?.label ?? op;
      // A stub of a work package that has not landed reports the symbol it stands for; say so plainly.
      const message =
        result.error.code === 'not-implemented'
          ? `${result.error.message} is not implemented in this build`
          : result.error.message;
      notifyError(`${label} failed: ${message}`, result.error.action);
    } else if (result.status === 'cancelled') {
      help(result.reason, 'warning');
    } else if (op === 'file.export' || op === 'file.exportModel') {
      // M6a (§4.8): lastExport() reports static-model exports too (contract note, M6A-B8 wp-notes).
      const artifacts = asArtifacts(result.value);
      if (artifacts !== null) exports.recordArtifacts(artifacts);
    } else if (op === 'graph.curves.simplify') {
      // Menus, palette and keymap say what Simplify did, like the Graph Editor's button (acceptance round 1).
      const text = simplifyMessage(result.value, toleranceOfArgs(args));
      if (text !== null) help(text, 'info');
    }
    return result;
  };

  const workspace = createWorkspaceController({
    app,
    panels: registry,
    storage: opts.storage,
    ui,
    notify: (text) => app.services.notify.toast({ kind: 'info', text }),
  });

  const files = createFilePipeline({
    app,
    ui,
    summarize: opts.summarize ?? summarizeModel,
    confirm,
    runFromUi: (op, args) => runFromUi(op, args),
    toastError: notifyError,
  });
  disposers.push(() => files.dispose());

  // M6A-SPEC §5.17 (B0b): the hierarchical scope chain, the capture window and the viewport tool-key bridge.
  const keyboard = new KeyboardAdapter({
    keymap: app.keymap,
    scopeChain: () => scopeChain(app, ui.getState().hover),
    blocked: () => app.session.getState().dialog !== null || ui.getState().confirm !== null,
    spaceBehaviour: () => app.prefs.getState().spaceBehaviour,
    dispatch: ({ op, args, ctx }) => void runFromUi(op, args, ctx),
    capture: (e) => app.capture.state.armed !== null && app.capture.key(e),
    viewportTool: () => {
      const vm = ui.getState().viewport;
      return vm === null ? null : viewportToolTarget(app, () => vm.activeTool());
    },
  });

  // Layout presets (docs/LAYOUT-PRESETS.md): the user's presets live beside the layouts, in the same storage.
  const presets = createLayoutPresetStore(opts.storage);
  disposers.push(registerShellOperators(app, { workspace, ui, presets, onImportClosed: () => files.cancelImport() }));

  // M6A-SPEC §5.18 (B9): marking menus (the viewport's press hook, `ui.markingMenu`) and the command palette.
  const lastContext = (): RunContext => {
    const last = ui.getState().lastPanel;
    return {
      ...(last === null ? {} : { panel: last.kind }),
      ...(last === null || last.paneId === null ? {} : { paneId: last.paneId }),
    };
  };
  const markingMenus = createMarkingMenus({ app, run: (op, args, ctx) => runFromUi(op, args, ctx), help });
  disposers.push(() => markingMenus.dispose());
  const commandPalette = createCommandPalette({
    app,
    run: (op, args, ctx) => runFromUi(op, args, ctx),
    context: lastContext,
    help,
  });
  disposers.push(
    provideShellOverlays(app, {
      openCommandPalette: () => commandPalette.open(),
      openMarkingMenu: (def, ctx) => markingMenus.openByCommand(def, ctx),
    }),
  );
  const pointerMenus = (press: Parameters<typeof markingMenus.handlePress>[0]): boolean =>
    markingMenus.handlePress(press);
  /** Hooks the presses of a viewport (null unhooks); test fakes without the hook are left alone. */
  const hookMenus = (vm: ShellUiState['viewport'], handler: typeof pointerMenus | null): void => {
    if (typeof vm?.setPointerMenus === 'function') vm.setPointerMenus(handler);
  };
  hookMenus(ui.getState().viewport, pointerMenus);
  disposers.push(
    ui.subscribe((state, previous) => {
      if (state.viewport === previous.viewport) return;
      hookMenus(previous.viewport, null);
      hookMenus(state.viewport, pointerMenus);
    }),
    () => hookMenus(ui.getState().viewport, null),
  );
  // The marking menus (controller and drawing) load before the first menu opens: when a workspace that has marking
  // menus is entered (Model), or when one is registered for the active workspace. Animate never loads them.
  const prefetchMenus = (): void => {
    if (typeof window === 'undefined' || markingMenus.controller() !== null) return;
    if (marksMenus(app)) prefetchMarkingMenu(markingMenus);
  };
  prefetchMenus();
  disposers.push(
    app.session.subscribe((state, previous) => {
      if (state.workspace === previous.workspace) return;
      markingMenus.close();
      prefetchMenus();
    }),
    app.markingMenus.subscribe(prefetchMenus),
  );
  // M2A-SPEC §5.20: autosave and the Recovery prompt (browser services only).
  disposers.push(startShellAutosave({ app, runFromUi: (op, args) => runFromUi(op, args) }));
  const extraPanels: { kind: PanelKind; title: string }[] = [];
  for (const def of registry.list()) {
    if (FIXED_KINDS.has(def.kind) || ALL_SLOTS.some((slot) => slot.kind === def.kind)) continue;
    if (extraPanels.some((panel) => panel.kind === def.kind)) continue;
    extraPanels.push({ kind: def.kind, title: def.title });
  }
  disposers.push(
    registerShellMenuItems(app, extraPanels, {
      chromeShown: (part) => workspace.chrome()[part],
      focused: () => workspace.focused(),
      fullscreen: () => typeof document !== 'undefined' && document.fullscreenElement !== null,
    }),
  );
  disposers.push(registerUserPresetMenuItems(app, presets));
  // M6a (B10): the Poly Count HUD and BIND POSE overlays, the RMB mode and Ctrl+RMB convert marking menus.
  disposers.push(registerModelSelectUi(app));
  // M6b (C7): the Rig & Skin shell UI, loaded on the first entry.
  disposers.push(
    registerRigShell(app, { showPanel: (kind) => workspace.showPanel(kind), dockview: () => workspace.dockview }),
  );
  disposers.push(registerModelTransformUi(app));

  let glFrames = 0;

  // The Graph Editor and time-slider slices of the e2e test API (MVP-SPEC §4.8) follow the focused panel of each
  // kind, so one registration per shell serves every mounted instance (null while none is mounted).
  const probes = createProbeRegistry();
  disposers.push(probes.set('graph', graphTestHooks(app)));
  disposers.push(
    probes.set('timeline', {
      screenOfFrame: (frame) => screenOfTimelineFrame(app, frame),
      screenOfTick: (frame) => screenOfTimelineTick(app, frame),
    }),
  );

  return {
    app,
    panels: registry,
    toasts: opts.toasts ?? null,
    storage: opts.storage,
    params,
    ui,
    frame,
    renderedFrames: () => glFrames,
    countFrame: () => {
      glFrames += 1;
    },
    restoreFallbackFrames: () => app.setFrameRequester(() => fallback.request()),
    probes,
    workspace,
    presets,
    files,
    exports,
    keyboard,
    markingMenus,
    commandPalette,
    attachWorkspace: (api) => workspace.attach(api),
    help,
    confirm,
    runFromUi,
    dispose(): void {
      keyboard.reset();
      ui.getState().confirm?.resolve(false);
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}
