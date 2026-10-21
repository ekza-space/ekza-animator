// Renders the dialog named by `session.dialog` (opened and closed through `ui.open` / `ui.close`) and the shell's
// confirmation prompt. Every dialog is a `React.lazy` chunk (M2A-SPEC §5.21.2, M-2): none is part of the editor's
// initial route; `preloadDialog` fetches one on intent (a menu opening, a file drag) before it is shown.
//
// A chunk can fail to arrive (a network blip, offline use after the page loaded, a redeploy that replaced the chunk
// hashes). Each dialog and the prompt sit in an error boundary: a failure closes that dialog (the prompt answers
// Cancel), says so in a toast and leaves the editor running; the next open loads the chunk again (`React.lazy` keeps a
// rejected load for good, so a failed attempt's lazy component is replaced).
import type { UiDialog } from '@ekza-studio/editor-core';
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type JSX,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
} from 'react';
import { useSession } from '../hooks';
import { useShell, useShellUi } from '../shell/context';
import type { ConfirmRequest } from '../shell/types';

/** A dialog chunk's module: the component as its default export. */
type Module<P extends object> = { readonly default: ComponentType<P> };
type DialogModule = Module<object>;
type ConfirmProps = { readonly request: ConfirmRequest };
type ChunkKey = UiDialog | 'confirm';

/** The chunk of each dialog (one dynamic import each, so a dialog loads only its own code). */
const LOADERS: Readonly<Record<UiDialog, () => Promise<DialogModule>>> = {
  firstRun: () => import('./FirstRunDialog').then((m) => ({ default: m.FirstRunDialog })),
  open: () => import('./OpenDialog').then((m) => ({ default: () => <m.FilePickerDialog mode="open" /> })),
  import: () => import('./ImportDialog').then((m) => ({ default: m.ImportDialog })),
  export: () => import('./ExportDialog').then((m) => ({ default: m.ExportDialog })),
  about: () => import('./AboutDialog').then((m) => ({ default: m.AboutDialog })),
  shortcuts: () => import('./ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })),
  preferences: () => import('./PreferencesDialog').then((m) => ({ default: m.PreferencesDialog })),
  recovery: () => import('./RecoveryDialog').then((m) => ({ default: m.RecoveryDialog })),
  // M6a (B13)
  makeEditableReport: () => import('./MakeEditableReport').then((m) => ({ default: m.MakeEditableReportDialog })),
  imagePlaneImport: () => import('./ImagePlaneImport').then((m) => ({ default: m.ImagePlaneImportDialog })),
  layoutPresets: () => import('./LayoutPresetsDialog').then((m) => ({ default: m.LayoutPresetsDialog })),
};

const loadConfirm = (): Promise<Module<ConfirmProps>> =>
  import('./ConfirmDialog').then((m) => ({ default: m.ConfirmDialog }));

/** What the failure toast calls each dialog. */
export const DIALOG_NAMES: Readonly<Record<ChunkKey, string>> = {
  firstRun: 'Welcome dialog',
  open: 'Open dialog',
  import: 'Import dialog',
  export: 'Export dialog',
  about: 'About dialog',
  shortcuts: 'Keyboard shortcuts',
  preferences: 'Preferences dialog',
  recovery: 'Recovery dialog',
  makeEditableReport: 'Make editable report',
  imagePlaneImport: 'Image plane import dialog',
  layoutPresets: 'Layout presets dialog',
  confirm: 'confirmation prompt',
};

/** A dialog's chunk did not arrive. */
export class DialogLoadError extends Error {
  readonly dialog: ChunkKey;

  constructor(dialog: ChunkKey, cause: unknown) {
    super(
      `The ${DIALOG_NAMES[dialog]} could not be loaded: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    );
    this.name = 'DialogLoadError';
    this.dialog = dialog;
  }
}

/** The toast after a dialog failed to open (its chunk missing, or the dialog failing as it rendered). */
export function dialogFailureText(dialog: ChunkKey, error: unknown): string {
  if (error instanceof DialogLoadError) {
    return `Couldn't load the ${DIALOG_NAMES[dialog]}. Check the connection and try again.`;
  }
  return `The ${DIALOG_NAMES[dialog]} failed: ${error instanceof Error ? error.message : String(error)}`;
}

interface Chunk<P extends object> {
  /** Starts loading (shared while it loads and after it arrived; a failed load is forgotten: the next call retries). */
  preload(): Promise<Module<P>>;
  /** The lazy component of the current attempt; a new one once that attempt failed. */
  component(): LazyExoticComponent<ComponentType<P>>;
  /** Drops the loaded module and the lazy component (the test seam swaps loaders). */
  forget(): void;
}

/** A test loader's module (any component: the seam does not check props). */
type TestModule = { readonly default: unknown };

const overrides = new Map<ChunkKey, () => Promise<TestModule>>();

function chunkOf<P extends object>(key: ChunkKey, load: () => Promise<Module<P>>): Chunk<P> {
  let loading: Promise<Module<P>> | null = null;
  let current: { readonly component: LazyExoticComponent<ComponentType<P>>; readonly failed: () => boolean } | null =
    null;
  const preload = (): Promise<Module<P>> => {
    if (loading === null) {
      const override = overrides.get(key) as (() => Promise<Module<P>>) | undefined; // test seam
      const attempt = Promise.resolve()
        .then(override ?? load)
        .catch((cause: unknown) => {
          throw new DialogLoadError(key, cause);
        });
      loading = attempt;
      attempt.catch(() => {
        if (loading === attempt) loading = null;
      });
    }
    return loading;
  };
  return {
    preload,
    component() {
      if (current === null || current.failed()) {
        let failed = false;
        const component = lazy(() =>
          preload().catch((error: unknown) => {
            failed = true;
            throw error;
          }),
        );
        current = { component, failed: () => failed };
      }
      return current.component;
    },
    forget(): void {
      loading = null;
      current = null;
    },
  };
}

const dialogChunks = new Map<UiDialog, Chunk<object>>();
let confirmChunkOf: Chunk<ConfirmProps> | null = null;

function dialogChunk(dialog: UiDialog): Chunk<object> | null {
  let chunk = dialogChunks.get(dialog);
  if (chunk === undefined) {
    const load = LOADERS[dialog] as (() => Promise<DialogModule>) | undefined;
    if (load === undefined) return null;
    chunk = chunkOf(dialog, load);
    dialogChunks.set(dialog, chunk);
  }
  return chunk;
}

function confirmChunk(): Chunk<ConfirmProps> {
  confirmChunkOf ??= chunkOf('confirm', loadConfirm);
  return confirmChunkOf;
}

/**
 * Test seam: replaces the chunk loader of one dialog (or of the confirm prompt); `null` restores the bundled one.
 * Not part of the package API (component tests make a chunk fail without a network).
 */
export function setDialogLoaderForTests(dialog: ChunkKey, loader: (() => Promise<TestModule>) | null): void {
  if (loader === null) overrides.delete(dialog);
  else overrides.set(dialog, loader);
  if (dialog === 'confirm') confirmChunkOf?.forget();
  else dialogChunks.get(dialog)?.forget();
}

/** Starts loading a dialog's chunk (idempotent; a failed load is retried by the next call). */
export function preloadDialog(dialog: UiDialog): Promise<DialogModule> {
  const chunk = dialogChunk(dialog);
  return chunk === null ? Promise.reject(new Error(`Unknown dialog ${String(dialog)}`)) : chunk.preload();
}

interface BoundaryProps {
  readonly name: ChunkKey;
  readonly onError: (error: unknown) => void;
  readonly children: ReactNode;
}

/** Turns a dialog that failed (its chunk, or its first render) into a closed dialog instead of a crashed editor. */
class DialogBoundary extends Component<BoundaryProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (error instanceof DialogLoadError) console.warn(`Ekza Studio: ${error.message}`);
    else console.error(`Ekza Studio: the ${DIALOG_NAMES[this.props.name]} failed`, error, info.componentStack);
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function CurrentDialog(): JSX.Element | null {
  const shell = useShell();
  const dialog = useSession((s) => s.dialog);
  if (dialog === null) return null;
  const Lazy = dialogChunk(dialog)?.component();
  if (Lazy === undefined) return null;
  const onError = (error: unknown): void => {
    shell.app.services.notify.toast({ kind: 'error', text: dialogFailureText(dialog, error) });
    // Close it only if it is still the open one (`ui.close` also drops a file waiting in the Import dialog).
    if (shell.app.session.getState().dialog === dialog) void shell.runFromUi('ui.close');
  };
  // No fallback: the dialog appears when its chunk has arrived (a few ms; prefetched on intent).
  return (
    <DialogBoundary key={dialog} name={dialog} onError={onError}>
      <Suspense fallback={null}>
        {/* oxlint-disable-next-line react/static-components -- one lazy component per load attempt, made by the module-level chunk, stable across renders */}
        <Lazy />
      </Suspense>
    </DialogBoundary>
  );
}

/** One boundary per request: a new prompt never inherits the failed state of the one before. */
const requestKeys = new WeakMap<ConfirmRequest, number>();
let nextRequestKey = 0;
function requestKey(request: ConfirmRequest): number {
  let key = requestKeys.get(request);
  if (key === undefined) {
    key = ++nextRequestKey;
    requestKeys.set(request, key);
  }
  return key;
}

/** The shell's confirmation prompt (`shell.confirm`), a lazy chunk like the dialogs; a failure answers Cancel. */
function ConfirmPrompt(): JSX.Element | null {
  const shell = useShell();
  const request = useShellUi((s) => s.confirm);
  if (request === null) return null;
  const ConfirmDialog = confirmChunk().component();
  const onError = (error: unknown): void => {
    shell.app.services.notify.toast({ kind: 'error', text: dialogFailureText('confirm', error) });
    request.resolve(false);
  };
  return (
    <DialogBoundary key={requestKey(request)} name="confirm" onError={onError}>
      <Suspense fallback={null}>
        {/* oxlint-disable-next-line react/static-components -- one lazy component per load attempt, made by the module-level chunk, stable across renders */}
        <ConfirmDialog request={request} />
      </Suspense>
    </DialogBoundary>
  );
}

export function DialogHost(): JSX.Element {
  return (
    <>
      <CurrentDialog />
      <ConfirmPrompt />
    </>
  );
}
