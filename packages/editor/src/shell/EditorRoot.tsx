// The editor root shared by the production `Editor` and the dev/e2e shell harness: creates the browser services and
// the EditorApp, the shell core, the providers, the GL host and the workspace chrome; installs the window input
// adapter, the first-run dialog and (e2e builds with ?e2e=1) the test API.
import { seededIdSource, type IdSource } from '@ekza-studio/doc';
import { type EditorApp, type EditorServices, switchWorkspace } from '@ekza-studio/editor-core';
import { ToastProvider, TooltipProvider } from '@ekza-studio/ui';
import { type JSX, useEffect, useRef } from 'react';
import { GLHost } from '../gl/GLHost';
import { EditorAppProvider } from '../hooks';
import type { PanelRegistry } from '../panels/types';
import { createShellServices } from '../services/browser';
import type { ToastNotifier } from '../services/notify';
import { detectPlatform, type EditorParams, parseEditorParams } from '../test-api/params';
import { ShellProvider } from './context';
import { createShell } from './createShell';
import { EditorShell } from './EditorShell';
import { KernelUnavailable } from './KernelUnavailable';
import type { Summarizer } from './summary';
import type { Shell } from './types';
import { useConstant } from './useConstant';
import { useWindowInput } from './useWindowInput';

export interface CreateAppArgs {
  readonly services: EditorServices;
  readonly platform: 'mac' | 'other';
  /** Seeded in e2e mode (`seededIdSource(1)`, MVP-SPEC §4.8). */
  readonly idSource?: IdSource;
}

export interface EditorRootProps {
  readonly createApp: (args: CreateAppArgs) => EditorApp;
  readonly decoderPath?: string;
  /** Base URL of the bundled samples; default '/samples/'. */
  readonly samplesPath?: string;
  /** The build allows e2e mode (NEXT_PUBLIC_EKZA_E2E=1); e2e mode itself needs `?e2e=1` as well. */
  readonly e2e?: boolean;
  /** M6a (§3 rule 8): the mesh kernel validates after every commit (development builds; e2e mode turns it on too). */
  readonly kernelDebug?: boolean;
  /** Overrides the URL parameters (harnesses and tests). */
  readonly params?: EditorParams;
  readonly panels?: PanelRegistry;
  readonly summarize?: Summarizer;
  readonly createValidatorWorker?: () => Worker;
  /** Called once the shell is mounted, with its disposer-free handle (harnesses expose it to specs). */
  readonly onShell?: (shell: Shell) => (() => void) | undefined;
}

type Boot =
  | { readonly kind: 'ready'; readonly shell: Shell; readonly toasts: ToastNotifier }
  | { readonly kind: 'unavailable'; readonly error: unknown; readonly params: EditorParams };

function boot(props: EditorRootProps): Boot {
  const params = props.params ?? parseEditorParams(window.location.search, props.e2e === true);
  const platform = params.platform ?? detectPlatform();
  let shell: Shell | null = null;
  const { services, toasts } = createShellServices({
    decoderPath: props.decoderPath ?? '/decoders/',
    samplesPath: props.samplesPath ?? '/samples/',
    // e2e: a fresh in-memory namespace per page load (M1), or a named one that survives reloads (M2a `ns=`).
    storage: params.e2e && params.ns === null ? 'memory' : 'local',
    ...(params.ns === null ? {} : { storageNamespace: params.ns }),
    ...(params.storageBlocked ? { storageBlocked: true } : {}),
    pointerLock: params.pointerLock,
    kernelDebug: props.kernelDebug === true || params.e2e,
    onDownload: (record) => shell?.exports.recordDownload(record),
    ...(props.createValidatorWorker === undefined ? {} : { createValidatorWorker: props.createValidatorWorker }),
  });
  let app: EditorApp;
  try {
    app = props.createApp({ services, platform, ...(params.e2e ? { idSource: seededIdSource(1) } : {}) });
  } catch (error) {
    console.error('Ekza Animator: the editor kernel could not start', error);
    return { kind: 'unavailable', error, params };
  }
  // M6a (M6A-SPEC §4.8, §5.17): the workspace opens as `ws=<id>` asks (any build), else as the user left it
  // (`prefs.lastWorkspace`), through the switching rules of `workspace.set` (layout, tool, pick mask, pane memory).
  const startIn = params.ws ?? app.prefs.getState().lastWorkspace;
  if (app.workspaces.get(startIn)?.enabled === true && startIn !== app.session.getState().workspace) {
    switchWorkspace(app, startIn);
  }
  if (params.e2e) {
    app.prefs.setState({
      firstRunDone: !params.firstRun,
      navProfile: params.nav ?? 'maya',
      spaceBehaviour: params.space ?? 'maya',
    });
  }
  shell = createShell({
    app,
    params,
    storage: services.storage,
    toasts,
    ...(props.panels === undefined ? {} : { panels: props.panels }),
    ...(props.summarize === undefined ? {} : { summarize: props.summarize }),
  });
  return { kind: 'ready', shell, toasts };
}

function ReadyEditor(props: {
  readonly shell: Shell;
  readonly toasts: ToastNotifier;
  readonly onShell: EditorRootProps['onShell'];
}): JSX.Element {
  const { shell, onShell } = props;
  const root = useRef<HTMLDivElement>(null);
  useWindowInput(shell, root);

  // Dispose on a real unmount only: StrictMode's effect replay re-runs the setup immediately and cancels it.
  useEffect(() => {
    const pending = disposals.get(shell);
    if (pending !== undefined) {
      clearTimeout(pending);
      disposals.delete(shell);
    }
    return () => {
      disposals.set(
        shell,
        setTimeout(() => {
          disposals.delete(shell);
          shell.dispose();
          shell.app.dispose();
        }, 0),
      );
    };
  }, [shell]);

  // The e2e test API is a lazy chunk (M2A-SPEC §5.21.2): production pages never load it. Specs wait for the global.
  useEffect(() => {
    if (!shell.params.e2e) return undefined;
    let cancelled = false;
    let uninstall: (() => void) | null = null;
    import('../test-api/createTestApi')
      .then(({ createTestApi }) => {
        if (cancelled) return;
        const handle = createTestApi(shell);
        window.__EKZA_ANIMATOR_TEST__ = handle.api;
        uninstall = () => {
          if (window.__EKZA_ANIMATOR_TEST__ === handle.api) delete window.__EKZA_ANIMATOR_TEST__;
          handle.dispose();
        };
      })
      // The editor keeps working without it; the spec waiting for the global fails with this message in its log.
      .catch((error: unknown) => console.error('Ekza Animator: the e2e test API could not be loaded', error));
    return () => {
      cancelled = true;
      uninstall?.();
    };
  }, [shell]);

  useEffect(() => onShell?.(shell), [shell, onShell]);

  // `?e2e=1` turns UI transitions off everywhere, including the dialogs, menus and tooltips Radix portals to <body>.
  useDocumentAttribute('data-ekza-motion', shell.params.e2e ? 'off' : null);

  useEffect(() => {
    if (!shell.app.prefs.getState().firstRunDone && shell.app.session.getState().dialog === null) {
      void shell.runFromUi('ui.open', { dialog: 'firstRun' });
    }
  }, [shell]);

  return (
    <ShellProvider shell={shell}>
      <EditorAppProvider app={shell.app}>
        <TooltipProvider>
          <ToastProvider swipeDirection="right" label="Notifications">
            <div
              ref={root}
              className="ekza-editor relative h-dvh w-dvw overflow-hidden text-fg [--ekza-tailwind-smoke:editor]"
              data-testid="editor-root"
              data-ekza-motion={shell.params.e2e ? 'off' : undefined}
            >
              <GLHost />
              <EditorShell toasts={props.toasts} />
            </div>
          </ToastProvider>
        </TooltipProvider>
      </EditorAppProvider>
    </ShellProvider>
  );
}

const disposals = new Map<Shell, ReturnType<typeof setTimeout>>();

/** Sets an attribute on <html> while mounted (null: leaves it alone), for styles that must reach portalled content. */
function useDocumentAttribute(name: string, value: string | null): void {
  useEffect(() => {
    if (value === null) return undefined;
    const html = document.documentElement;
    html.setAttribute(name, value);
    return () => html.removeAttribute(name);
  }, [name, value]);
}

export function EditorRoot(props: EditorRootProps): JSX.Element {
  const booted = useConstant(() => boot(props));
  // The editor's scrollbar and reduced-motion styles also apply to what it portals to <body>.
  useDocumentAttribute('data-ekza-editor', '');
  if (booted.kind === 'ready')
    return <ReadyEditor shell={booted.shell} toasts={booted.toasts} onShell={props.onShell} />;
  return (
    <div
      className="ekza-editor relative h-dvh w-dvw overflow-hidden text-fg [--ekza-tailwind-smoke:editor]"
      data-testid="editor-root"
    >
      <KernelUnavailable error={booted.error} e2e={booted.params.e2e} />
    </div>
  );
}
