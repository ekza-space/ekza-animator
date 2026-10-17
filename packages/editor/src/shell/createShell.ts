// Creates the shell core for one editor (MVP-SPEC §7 WP-8): panel registry with the built-in panels, shell
// operators and menu items, frame hooks, probes, workspace adapter, keyboard adapter and the file pipeline.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, OperatorResult, PanelKind, PrefsStorage, RunContext } from '@ekza-animator/editor-core';
import { createStore } from 'zustand/vanilla';
import { createFallbackScheduler, createFrameHooks } from '../gl/frameLoop';
import { KeyboardAdapter } from '../input/keyboard';
import { scopeChainOf } from '../input/pointer';
import { registerBuiltinPanels } from '../panels';
import { graphTestHooks } from '../panels/graph/testHooks';
import { screenOfTimelineFrame, screenOfTimelineTick } from '../panels/timeline/host';
import { createPanelRegistry } from '../panels/registry';
import type { PanelRegistry } from '../panels/types';
import type { ToastNotifier } from '../services/notify';
import type { EditorParams } from '../test-api/params';
import { asArtifacts, createExportRecorder } from './exports';
import { createFilePipeline } from './files';
import { ANIMATE_SLOTS, FIXED_KINDS } from './layout';
import { registerShellMenuItems } from './menuItems';
import { registerShellOperators } from './operators';
import { createProbeRegistry } from './probes';
import { type Summarizer, summarizeModel } from './summary';
import type { ConfirmRequest, HelpMessage, Shell, ShellUiState } from './types';
import { createWorkspaceController } from './workspace';

export interface CreateShellOptions {
  readonly app: EditorApp;
  readonly params: EditorParams;
  readonly storage: PrefsStorage | null;
  /** The toast queue the shell renders (null: toasts go to `app.services.notify` only). */
  readonly toasts?: ToastNotifier | null;
  /** Panels to show; default: a registry with `registerBuiltinPanels`. */
  readonly panels?: PanelRegistry;
  /** Model summary for the import dialog; default: @ekza-animator/io. */
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
    console.error('Ekza Animator: a per-frame callback failed', error);
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

  const notifyError = (text: string): void => app.services.notify.toast({ kind: 'error', text });

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
      notifyError(`${label} failed: ${message}`);
    } else if (result.status === 'cancelled') {
      help(result.reason, 'warning');
    } else if (op === 'file.export') {
      const artifacts = asArtifacts(result.value);
      if (artifacts !== null) exports.recordArtifacts(artifacts);
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

  const keyboard = new KeyboardAdapter({
    keymap: app.keymap,
    scopeChain: () => {
      const hover = ui.getState().hover;
      return { scopes: scopeChainOf(hover), panel: hover?.kind ?? null, paneId: hover?.paneId ?? null };
    },
    blocked: () => app.session.getState().dialog !== null || ui.getState().confirm !== null,
    spaceBehaviour: () => app.prefs.getState().spaceBehaviour,
    dispatch: ({ op, args, ctx }) => void runFromUi(op, args, ctx),
  });

  disposers.push(registerShellOperators(app, { workspace, onImportClosed: () => files.cancelImport() }));
  const extraPanels: { kind: PanelKind; title: string }[] = [];
  for (const def of registry.list()) {
    if (FIXED_KINDS.has(def.kind) || ANIMATE_SLOTS.some((slot) => slot.kind === def.kind)) continue;
    if (extraPanels.some((panel) => panel.kind === def.kind)) continue;
    extraPanels.push({ kind: def.kind, title: def.title });
  }
  disposers.push(registerShellMenuItems(app, extraPanels));

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
    files,
    exports,
    keyboard,
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
