// The file pipeline shared by drag-and-drop, the file pickers and the test API's `loadFile` (MVP-SPEC §4.8: "same
// path as drag-and-drop"): importer resolution, the import dialog for models, confirmation before replacing a
// dirty project, and error reporting.
//
// Several files (one drop, one picker selection, or drops in quick succession) open strictly one after another: a
// model's import dialog must close before the next file opens, otherwise the next model would replace the pending
// one and an animation would run before its character exists.
import type { EditorApp, OperatorResult } from '@ekza-studio/editor-core';
import type { StoreApi } from 'zustand/vanilla';
import { nameForKind, sniffFileKind, UNSUPPORTED_FILE_TEXT } from '../services/fileTypes';
import { MODEL_IMPORT_OP, openOrderRank, PROJECT_OPEN_OP, resolveImporter } from './importers';
import type { Summarizer } from './summary';
import type { FilePipeline, OpenFileOptions, PendingImport, ShellUiState } from './types';

export interface FilePipelineDeps {
  readonly app: EditorApp;
  readonly ui: StoreApi<ShellUiState>;
  readonly summarize: Summarizer;
  readonly confirm: (request: {
    readonly title: string;
    readonly text: string;
    readonly confirmLabel: string;
  }) => Promise<boolean>;
  readonly runFromUi: (op: string, args?: unknown) => Promise<OperatorResult<unknown>>;
  readonly toastError: (text: string) => void;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

const errorCode = (error: unknown): string | null => {
  const code = typeof error === 'object' && error !== null ? (error as { readonly code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : null;
};

/** An operator run that did not finish; `runFromUi` has already shown it (toast or help line). */
class ReportedFailure extends Error {
  override readonly name = 'ReportedFailure';
}

/**
 * Summary errors that mean the model cannot be imported at all (the import operator reads the file the same way and
 * would fail with the same error): the file is refused with an error toast instead of an import dialog whose Import
 * button can only fail (acceptance round 1).
 */
export const UNREADABLE_MODEL_CODES: ReadonlySet<string> = new Set([
  'not-glb',
  'malformed-gltf',
  'vrm-both',
  'budget-exceeded',
]);

export function createFilePipeline(deps: FilePipelineDeps): FilePipeline {
  const { app, ui } = deps;
  /** Resolves the waiter of each pending import once its dialog has closed (imported, cancelled or replaced). */
  const settlers = new Map<PendingImport, () => void>();
  /** The import being confirmed: its dialog closes before the import runs, and its waiter waits for the import. */
  let confirming: PendingImport | null = null;
  /** Drops and picker selections queue behind each other. */
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  const settle = (pending: PendingImport): void => {
    const resolve = settlers.get(pending);
    settlers.delete(pending);
    resolve?.();
  };

  /** Forgets the pending model; its waiter is released unless the model is being imported right now. */
  const dropPending = (): void => {
    const pending = ui.getState().pendingImport;
    if (pending === null) return;
    ui.setState({ pendingImport: null });
    if (pending !== confirming) settle(pending);
  };

  // The import dialog can also go away without `ui.close` (another dialog replacing it, a direct session write);
  // a pending model must never outlive its dialog, or the drop queue would wait forever.
  const unsubscribe = app.session.subscribe((state, previous) => {
    if (previous.dialog === 'import' && state.dialog !== 'import') dropPending();
  });

  const failure = (result: OperatorResult<unknown>): string | null => {
    if (result.status === 'failed') return result.error.message;
    if (result.status === 'cancelled') return result.reason;
    return null;
  };
  const throwIfUnfinished = (result: OperatorResult<unknown>, fallback?: string): void => {
    const message = failure(result);
    if (message !== null) throw new ReportedFailure(message);
    if (result.status !== 'finished' && fallback !== undefined) throw new ReportedFailure(fallback);
  };

  async function openFile(name: string, bytes: Uint8Array, opts: OpenFileOptions = {}): Promise<void> {
    // S10 (T0): the Files app can hand over a file under a name that hides its kind; sniff the bytes first.
    name = nameForKind(name, sniffFileKind(bytes));
    const importer = resolveImporter(app.importers, name, bytes);
    if (importer === null) throw new Error(UNSUPPORTED_FILE_TEXT);

    if (importer.op === MODEL_IMPORT_OP && opts.auto !== true) {
      const { closed } = await openImportDialog(name, bytes, importer);
      if (opts.waitForDialog === true) await closed;
      return;
    }
    if (importer.op === PROJECT_OPEN_OP && opts.auto !== true && app.session.getState().dirty) {
      const replace = await deps.confirm({
        title: 'Open project',
        text: 'The current project has unsaved changes. Opening another project discards them.',
        confirmLabel: 'Discard and open',
      });
      if (!replace) return;
    }
    const args = opts.importOptions === undefined ? { name, bytes } : { name, bytes, options: opts.importOptions };
    throwIfUnfinished(await deps.runFromUi(importer.op, args));
  }

  /**
   * Reads the model summary, then opens the import dialog. Resolves once the dialog is showing, with `closed`
   * resolving once it has closed again (after the import when confirmed).
   */
  async function openImportDialog(
    name: string,
    bytes: Uint8Array,
    importer: PendingImport['importer'],
  ): Promise<{ readonly closed: Promise<void> }> {
    ui.setState({ busy: `Reading ${name}…` });
    let summary = null;
    let summaryError: PendingImport['summaryError'] = null;
    try {
      summary = await deps.summarize(bytes);
    } catch (error) {
      summaryError = { code: errorCode(error), message: errorText(error) };
    } finally {
      ui.setState({ busy: null });
    }
    const code = summaryError?.code ?? null;
    if (summaryError !== null && code !== null && UNREADABLE_MODEL_CODES.has(code)) {
      const text = `Cannot import ${name}: ${summaryError.message}`;
      deps.toastError(text);
      throw new ReportedFailure(text);
    }
    const pending: PendingImport = { name, bytes, importer, summary, summaryError };
    const closed = new Promise<void>((resolve) => settlers.set(pending, resolve));
    const replaced = ui.getState().pendingImport;
    ui.setState({ pendingImport: pending });
    if (replaced !== null && replaced !== confirming) settle(replaced);
    const opened = await deps.runFromUi('ui.open', { dialog: 'import' });
    if (opened.status !== 'finished') {
      if (ui.getState().pendingImport === pending) ui.setState({ pendingImport: null });
      settle(pending);
      throwIfUnfinished(opened, 'The import dialog could not open');
    }
    return { closed };
  }

  async function openInOrder(files: readonly File[]): Promise<void> {
    const ordered = files
      .map((file, index) => ({ file, index, rank: openOrderRank(app.importers, file.name) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index);
    for (const { file } of ordered) {
      if (disposed) return;
      try {
        // Read one file at a time: a large drop never holds every file's bytes at once.
        await openFile(file.name, new Uint8Array(await file.arrayBuffer()), { waitForDialog: true });
      } catch (error) {
        // Operator failures were already reported by the runner; report the rest (unknown type, read errors).
        if (!(error instanceof ReportedFailure) && !disposed) deps.toastError(`${file.name}: ${errorText(error)}`);
      }
    }
  }

  return {
    openFile,
    openFiles(files: readonly File[]): Promise<void> {
      const run = queue.then(() => openInOrder(files));
      queue = run.catch(() => undefined);
      return run;
    },
    async confirmImport(options: Readonly<Record<string, unknown>>): Promise<OperatorResult<unknown>> {
      const pending = ui.getState().pendingImport;
      if (pending === null) return { status: 'cancelled', reason: 'No file is waiting to be imported' };
      confirming = pending;
      try {
        // Closing the dialog drops the pending file (ui.close → cancelImport) in the same update.
        await deps.runFromUi('ui.close');
        if (ui.getState().pendingImport === pending) ui.setState({ pendingImport: null });
        return await deps.runFromUi(pending.importer.op, { name: pending.name, bytes: pending.bytes, options });
      } finally {
        if (confirming === pending) confirming = null;
        settle(pending);
      }
    },
    cancelImport: dropPending,
    dispose(): void {
      disposed = true;
      unsubscribe();
      confirming = null;
      for (const resolve of settlers.values()) resolve();
      settlers.clear();
    },
  };
}
