// StudioHost (AUTORIG-SPEC §4.4, D1): the `(studio)` layout's island. Once per page load it creates the browser
// services, the EditorApp and the HostShell, and mounts what both shells share — the GL host (one R3F canvas), the
// window input adapter, the dialog host, the command palette, the toasts, the drop overlay and (e2e builds with
// ?e2e=1) the test API. The route's shell renders as its child: Studio's dockview shell on `/editor`, the Auto-Rig
// wizard on `/autorig`. A client navigation between the two keeps this component — and with it the document, the undo
// history, the selection, the cameras, autosave and the WebGL context — mounted.
import { seededIdSource, type IdSource } from '@ekza-studio/doc';
import { createEditorApp, type EditorApp, type EditorServices } from '@ekza-studio/editor-core';
import { ToastProvider } from '@ekza-studio/ui';
import { type JSX, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { DialogHost } from '../dialogs/DialogHost';
import { GLHost } from '../gl/GLHost';
import { EditorAppProvider } from '../hooks';
import { CommandPaletteHost } from '../overlays/CommandPalette';
import { createShellServices } from '../services/browser';
import type { ToastNotifier } from '../services/notify';
import { installIntakeWorker } from '../services/intakeWorker';
import { installSkinWorker } from '../services/skinWorker';
import type { Summarizer } from '../shell/summary';
import { Toaster } from '../shell/Toaster';
import { useConstant } from '../shell/useConstant';
import { useWindowInput } from '../shell/useWindowInput';
import { detectPlatform, type EditorParams, parseEditorParams } from '../test-api/params';
import { HostProvider, useHostUi } from './context';
import { createHostShell } from './createHost';
import type { HostShell } from './types';

/** Shown only when the kernel cannot start: its own chunk (AR-D1-2), never part of a working page's route. */
const KernelUnavailable = lazy(() =>
  import('../shell/KernelUnavailable').then((m) => ({ default: m.KernelUnavailable })),
);

/** `check-size` marker of the StudioHost entry (§7.2 rule 4): counted as initial on `/editor` and `/autorig`. */
export const STUDIO_HOST_MARKER = 'ekza-studio-host' as const;

export interface CreateAppArgs {
  readonly services: EditorServices;
  readonly platform: 'mac' | 'other';
  /** Seeded in e2e mode (`seededIdSource(1)`, MVP-SPEC §4.8). */
  readonly idSource?: IdSource;
}

export interface StudioHostProps {
  /** Default: the production kernel (`createEditorApp`). */
  readonly createApp?: (args: CreateAppArgs) => EditorApp;
  /** Default '/decoders/'. */
  readonly decoderPath?: string;
  /** Base URL of the bundled samples; default '/samples/'. */
  readonly samplesPath?: string;
  /** M6b (§0.4.7): base URL of the clip library; default '/library/'. */
  readonly libraryPath?: string;
  /** The build allows e2e mode (NEXT_PUBLIC_EKZA_E2E=1); e2e mode itself needs `?e2e=1` as well. */
  readonly e2e?: boolean;
  /** M6a (§3 rule 8): the mesh kernel validates after every commit (development builds; e2e mode turns it on too). */
  readonly kernelDebug?: boolean;
  /** Overrides the URL parameters (harnesses and tests). */
  readonly params?: EditorParams;
  readonly summarize?: Summarizer;
  readonly createValidatorWorker?: () => Worker;
  /** A same-page navigation between the shells (Next's `router.push`); without it a switch reloads the page with a
   *  handoff record (§4.4 fallback). */
  readonly navigate?: (href: string) => void;
  /** Called once the host is mounted. */
  readonly onHost?: (host: HostShell) => (() => void) | undefined;
  /** The route's shell. */
  readonly children?: ReactNode;
}

type Boot =
  | { readonly kind: 'ready'; readonly host: HostShell; readonly toasts: ToastNotifier }
  | { readonly kind: 'unavailable'; readonly error: unknown; readonly params: EditorParams };

const createProductionApp = (args: CreateAppArgs): EditorApp =>
  createEditorApp({
    services: args.services,
    platform: args.platform,
    ...(args.idSource === undefined ? {} : { idSource: args.idSource }),
  });

function boot(props: StudioHostProps, push: (href: string) => void): Boot {
  const params = props.params ?? parseEditorParams(window.location.search, props.e2e === true);
  const platform = params.platform ?? detectPlatform();
  let host: HostShell | null = null;
  const { services, toasts } = createShellServices({
    decoderPath: props.decoderPath ?? '/decoders/',
    samplesPath: props.samplesPath ?? '/samples/',
    libraryPath: props.libraryPath ?? '/library/',
    // e2e: a fresh in-memory namespace per page load (M1), or a named one that survives reloads (M2a `ns=`).
    storage: params.e2e && params.ns === null ? 'memory' : 'local',
    ...(params.ns === null ? {} : { storageNamespace: params.ns }),
    ...(params.storageBlocked ? { storageBlocked: true } : {}),
    pointerLock: params.pointerLock,
    kernelDebug: props.kernelDebug === true || params.e2e,
    onDownload: (record) => host?.exports.recordDownload(record),
    ...(props.createValidatorWorker === undefined ? {} : { createValidatorWorker: props.createValidatorWorker }),
  });
  let app: EditorApp;
  try {
    app = (props.createApp ?? createProductionApp)({
      services,
      platform,
      ...(params.e2e ? { idSource: seededIdSource(1) } : {}),
    });
  } catch (error) {
    console.error('Ekza Studio: the editor kernel could not start', error);
    return { kind: 'unavailable', error, params };
  }
  // M6b C4: Bind Skin solves in the skin worker (its code is a lazy entry of its own).
  installSkinWorker(app);
  // M7 G-a: the intake operators (normalize, reduce, palette bake) run their chain in the intake worker.
  installIntakeWorker(app);
  if (params.e2e) {
    app.prefs.setState({
      firstRunDone: !params.firstRun,
      navProfile: params.nav ?? 'dcc',
      spaceBehaviour: params.space ?? 'maximize',
    });
  }
  host = createHostShell({
    app,
    params,
    storage: services.storage,
    toasts,
    ...(props.summarize === undefined ? {} : { summarize: props.summarize }),
    navigation: { push: props.navigate === undefined ? undefined : push },
  });
  // AUTORIG-SPEC §4.4: a page opened with `?handoff=<id>` takes that record (a lazy chunk) and drops the parameter.
  const handoff = params.handoff;
  if (handoff !== null) {
    const ready = host;
    const url = new URL(window.location.href);
    url.searchParams.delete('handoff');
    window.history.replaceState(window.history.state, '', url);
    void import('./handoff')
      .then((m) => m.receiveHandoff(ready, handoff))
      .catch((error: unknown) => console.error('Ekza Studio: the hand-over could not be opened', error));
  }
  return { kind: 'ready', host, toasts };
}

/** Sets an attribute on <html> while mounted (null: leaves it alone), for styles that must reach portalled content. */
function useDocumentAttribute(name: string, value: string | null): void {
  useEffect(() => {
    if (value === null) return undefined;
    const html = document.documentElement;
    html.setAttribute(name, value);
    return () => html.removeAttribute(name);
  }, [name, value]);
}

function DropOverlay(): JSX.Element | null {
  const dragOver = useHostUi((s) => s.dragOver);
  if (!dragOver) return null;
  return (
    <div
      className="pointer-events-none fixed inset-1 z-(--z-ghost) grid place-items-center rounded-dialog border-2 border-dashed border-accent bg-drop-overlay"
      data-testid="drop-overlay"
    >
      <span className="rounded-popover bg-popover px-4 py-2 text-dialog font-semibold text-fg shadow-popover">
        Drop to import
      </span>
    </div>
  );
}

/** Hosts that have shown a route shell: a Studio shell mounting later arrives by a switch (it keeps the workspace). */
export const shellShown = new WeakSet<HostShell>();

/** Rendered after the route's shell inside its Suspense boundary: mounts once the shell has (its chunk arrived). */
function ShellReady(props: { readonly onReady: () => void }): null {
  const { onReady } = props;
  useEffect(onReady, [onReady]);
  return null;
}

const disposals = new Map<HostShell, ReturnType<typeof setTimeout>>();

function ReadyHost(props: {
  readonly host: HostShell;
  readonly toasts: ToastNotifier;
  readonly onHost: StudioHostProps['onHost'];
  readonly children?: ReactNode;
}): JSX.Element {
  const { host, onHost } = props;
  const root = useRef<HTMLDivElement>(null);
  const [shellReady, setShellReady] = useState(false);
  const [onReady] = useState(() => () => {
    shellShown.add(host);
    setShellReady(true);
  });
  useWindowInput(host, root);

  // Dispose on a real unmount only: StrictMode's effect replay re-runs the setup immediately and cancels it. The host
  // goes one task after the shells' own deferred disposals (they unregister from the app first).
  useEffect(() => {
    const pending = disposals.get(host);
    if (pending !== undefined) {
      clearTimeout(pending);
      disposals.delete(host);
    }
    return () => {
      disposals.set(
        host,
        setTimeout(() => {
          disposals.set(
            host,
            setTimeout(() => {
              disposals.delete(host);
              host.dispose();
              host.app.dispose();
            }, 0),
          );
        }, 0),
      );
    };
  }, [host]);

  // The e2e test API is a lazy chunk (M2A-SPEC §5.21.2): production pages never load it. Installed by the host on both
  // routes once the route's shell has mounted; specs wait for the global.
  useEffect(() => {
    if (!host.params.e2e || !shellReady) return undefined;
    let cancelled = false;
    let uninstall: (() => void) | null = null;
    import('../test-api/createTestApi')
      .then(({ createTestApi }) => {
        if (cancelled) return;
        const handle = createTestApi(host);
        window.__EKZA_STUDIO_TEST__ = handle.api;
        uninstall = () => {
          if (window.__EKZA_STUDIO_TEST__ === handle.api) delete window.__EKZA_STUDIO_TEST__;
          handle.dispose();
        };
      })
      // The editor keeps working without it; the spec waiting for the global fails with this message in its log.
      .catch((error: unknown) => console.error('Ekza Studio: the e2e test API could not be loaded', error));
    return () => {
      cancelled = true;
      uninstall?.();
    };
  }, [host, shellReady]);

  useEffect(() => onHost?.(host), [host, onHost]);

  // `?e2e=1` turns UI transitions off everywhere, including the dialogs, menus and tooltips Radix portals to <body>.
  useDocumentAttribute('data-ekza-motion', host.params.e2e ? 'off' : null);

  return (
    <HostProvider host={host}>
      <EditorAppProvider app={host.app}>
        <ToastProvider swipeDirection="right" label="Notifications">
          <div
            ref={root}
            className="ekza-editor relative h-dvh w-dvw overflow-hidden text-fg [--ekza-tailwind-smoke:editor]"
            data-testid="editor-root"
            data-host={STUDIO_HOST_MARKER}
            data-ekza-motion={host.params.e2e ? 'off' : undefined}
          >
            <GLHost />
            <Suspense fallback={null}>
              {props.children}
              <ShellReady onReady={onReady} />
            </Suspense>
            <DialogHost />
            <CommandPaletteHost palette={host.commandPalette} />
            <Toaster notifier={props.toasts} />
            <DropOverlay />
          </div>
        </ToastProvider>
      </EditorAppProvider>
    </HostProvider>
  );
}

export function StudioHost(props: StudioHostProps): JSX.Element {
  // The latest `navigate` (Next's router can change identity between renders); the port is created once.
  const navigate = useRef(props.navigate);
  useEffect(() => {
    navigate.current = props.navigate;
  });
  const booted = useConstant(() => boot(props, (href) => navigate.current?.(href)));
  // The editor's scrollbar and reduced-motion styles also apply to what it portals to <body>.
  useDocumentAttribute('data-ekza-editor', '');
  if (booted.kind === 'ready') {
    return (
      <ReadyHost host={booted.host} toasts={booted.toasts} onHost={props.onHost}>
        {props.children}
      </ReadyHost>
    );
  }
  return (
    <div
      className="ekza-editor relative h-dvh w-dvw overflow-hidden text-fg [--ekza-tailwind-smoke:editor]"
      data-testid="editor-root"
    >
      <Suspense fallback={null}>
        <KernelUnavailable error={booted.error} e2e={booted.params.e2e} />
      </Suspense>
    </div>
  );
}
