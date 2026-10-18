// Renders the dialog named by `session.dialog` (opened and closed through `ui.open` / `ui.close`) and the shell's
// confirmation prompt. Every dialog is a `React.lazy` chunk (M2A-SPEC §5.21.2, M-2): none is part of the editor's
// initial route; `preloadDialog` fetches one on intent (a menu opening, a file drag) before it is shown.
import type { UiDialog } from '@ekza-animator/editor-core';
import { type ComponentType, type JSX, lazy, Suspense } from 'react';
import { useSession } from '../hooks';
import { useShellUi } from '../shell/context';

type DialogModule = { readonly default: ComponentType };

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
};

const loaded = new Map<UiDialog, Promise<DialogModule>>();

/** Starts loading a dialog's chunk (idempotent; a failed load is retried by the next call). */
export function preloadDialog(dialog: UiDialog): Promise<DialogModule> {
  let promise = loaded.get(dialog);
  if (promise === undefined) {
    promise = LOADERS[dialog]();
    loaded.set(dialog, promise);
    promise.catch(() => loaded.delete(dialog));
  }
  return promise;
}

const LAZY: Readonly<Record<UiDialog, ComponentType>> = {
  firstRun: lazy(() => preloadDialog('firstRun')),
  open: lazy(() => preloadDialog('open')),
  import: lazy(() => preloadDialog('import')),
  export: lazy(() => preloadDialog('export')),
  about: lazy(() => preloadDialog('about')),
  shortcuts: lazy(() => preloadDialog('shortcuts')),
  preferences: lazy(() => preloadDialog('preferences')),
  recovery: lazy(() => preloadDialog('recovery')),
};

function CurrentDialog(): JSX.Element | null {
  const dialog = useSession((s) => s.dialog);
  if (dialog === null) return null;
  const Lazy = LAZY[dialog];
  if (Lazy === undefined) return null;
  // No fallback: the dialog appears when its chunk has arrived (a few ms; prefetched on intent).
  return (
    <Suspense fallback={null}>
      <Lazy key={dialog} />
    </Suspense>
  );
}

const ConfirmDialog = lazy(() => import('./ConfirmDialog').then((m) => ({ default: m.ConfirmDialog })));

/** The shell's confirmation prompt (`shell.confirm`), a lazy chunk like the dialogs. */
function ConfirmPrompt(): JSX.Element | null {
  const request = useShellUi((s) => s.confirm);
  if (request === null) return null;
  return (
    <Suspense fallback={null}>
      <ConfirmDialog request={request} />
    </Suspense>
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
