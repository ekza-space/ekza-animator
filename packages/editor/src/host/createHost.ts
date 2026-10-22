// Creates the HostShell of one page (AUTORIG-SPEC §4.4, D1): the UI store, the frame hooks and the fallback frame
// scheduler, the help line, the confirm prompt, the operator runner for UI surfaces, the file pipeline, the export
// recorder, the keyboard adapter, the probes, autosave, the command palette behind the overlay port, the host's
// operators (`ui.open`, `ui.close`, `prefs.set`, `view.selectionMask`, `view.toggleFullscreen`) and the navigation
// port. Both shells sit on top of it; it outlives every switch between them.
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type EditorApp,
  type OperatorAction,
  type OperatorResult,
  type PrefsStorage,
  provideNavigation,
  provideShellOverlays,
  type RunContext,
} from '@ekza-studio/editor-core';
import { createStore } from 'zustand/vanilla';
import { createFallbackScheduler, createFrameHooks } from '../gl/frameLoop';
import { KeyboardAdapter, scopeChain, viewportToolTarget } from '../input/keyboard';
import { createCommandPalette } from '../overlays/CommandPalette';
import { simplifyMessage, toleranceOfArgs } from '../panels/graph/simplify';
import type { ToastNotifier } from '../services/notify';
import { startShellAutosave } from '../shell/autosave';
import { asArtifacts, createExportRecorder } from '../shell/exports';
import { createFilePipeline } from '../shell/files';
import { shellOperatorDefs, type ShellOperatorDeps } from '../shell/operators';
import { createProbeRegistry } from '../shell/probes';
import { type Summarizer, summarizeModel } from '../shell/summary';
import type { ConfirmRequest, HelpMessage, ShellUiState } from '../shell/types';
import type { EditorParams } from '../test-api/params';
import { createNavigation, type NavigationOptions } from './navigation';
import type { HostShell, MountedShell } from './types';

/** The shell operators the host registers on every route (§4.4); Studio registers the rest of `shellOperatorDefs`. */
export const HOST_OPERATOR_IDS: ReadonlySet<string> = new Set([
  'ui.open',
  'ui.close',
  'prefs.set',
  'view.selectionMask',
  'view.toggleFullscreen',
]);

export interface CreateHostOptions {
  readonly app: EditorApp;
  readonly params: EditorParams;
  readonly storage: PrefsStorage | null;
  /** The toast queue the page renders (null: toasts go to `app.services.notify` only). */
  readonly toasts?: ToastNotifier | null;
  /** Model summary for the import dialog; default: @ekza-studio/io. */
  readonly summarize?: Summarizer;
  /** How long a help-line message stays, ms. */
  readonly helpMs?: number;
  /** Same-page navigation between the shells (Next's `router.push`) and the navigation seams. */
  readonly navigation?: NavigationOptions;
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

export function createHostShell(opts: CreateHostOptions): HostShell {
  const { app, params } = opts;
  const disposers: Disposer[] = [];
  const ui = createStore<ShellUiState>()(() => INITIAL_UI);
  const mounted = createStore<MountedShell | null>()(() => null);

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
    } else if (op === 'file.export' || op === 'file.exportModel' || op === 'file.exportCharacter') {
      // M6a (§4.8): lastExport() reports static-model exports too (contract note, M6A-B8 wp-notes); M6b (C10, §4.8):
      // and character exports (their readBack carries kind 'character').
      const artifacts = asArtifacts(result.value);
      if (artifacts !== null) exports.recordArtifacts(artifacts);
    } else if (op === 'graph.curves.simplify') {
      // Menus, palette and keymap say what Simplify did, like the Graph Editor's button (acceptance round 1).
      const text = simplifyMessage(result.value, toleranceOfArgs(args));
      if (text !== null) help(text, 'info');
    }
    return result;
  };

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

  // The host's shell operators (dialogs and preferences exist on every route); the workspace and preset deps of
  // `shellOperatorDefs` belong to the Studio shell's operators and are never read by these.
  const hostDeps = { ui, onImportClosed: () => files.cancelImport() } as Partial<ShellOperatorDeps>;
  for (const contribution of shellOperatorDefs(app, hostDeps as ShellOperatorDeps)) {
    if (contribution.kind === 'operator' && HOST_OPERATOR_IDS.has(contribution.def.id)) {
      disposers.push(app.contribute(contribution));
    }
  }

  // M6A-SPEC §5.18 (B9): the command palette (`Mod+K`); AUTORIG-SPEC §4.4: the overlay port is the host's on every
  // route (its chunk loads on first use); marking menus come from the mounted shell (Studio).
  const commandPalette = createCommandPalette({
    app,
    run: (op, args, ctx) => runFromUi(op, args, ctx),
    context: () => {
      const last = ui.getState().lastPanel;
      return {
        ...(last === null ? {} : { panel: last.kind }),
        ...(last === null || last.paneId === null ? {} : { paneId: last.paneId }),
      };
    },
    help,
  });
  disposers.push(
    provideShellOverlays(app, {
      openCommandPalette: () => commandPalette.open(),
      openMarkingMenu: (def, ctx) => mounted.getState()?.openMarkingMenu?.(def, ctx),
    }),
  );

  // M2A-SPEC §5.20: autosave (browser services only); the Recovery prompt is the Studio shell's (§4.4).
  disposers.push(startShellAutosave({ app, runFromUi: (op, args) => runFromUi(op, args), prompt: false }));

  // AUTORIG-SPEC §3.4, §4.4: the navigation port (eager; the handoff record behind it is a lazy chunk).
  const navigation = createNavigation({ app, ui, mounted, commandPalette, keyboard, runFromUi }, opts.navigation);
  disposers.push(provideNavigation(app, navigation));

  let glFrames = 0;
  const probes = createProbeRegistry();

  const host: HostShell = {
    app,
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
    files,
    exports,
    keyboard,
    commandPalette,
    navigation,
    mounted,
    mount(shell: MountedShell): Disposer {
      mounted.setState(shell, true);
      return () => {
        if (mounted.getState() === shell) mounted.setState(null, true);
      };
    },
    help,
    confirm,
    runFromUi,
    dispose(): void {
      keyboard.reset();
      ui.getState().confirm?.resolve(false);
      mounted.setState(null, true);
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
  return host;
}
