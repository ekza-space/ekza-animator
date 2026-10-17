// The file pipeline shared by drag-and-drop, the file pickers and the test API's `loadFile` (MVP-SPEC §4.8: "same
// path as drag-and-drop"): importer resolution, the import dialog for models, confirmation before replacing a
// dirty project, and error reporting.
import type { EditorApp, OperatorResult } from '@ekza-animator/editor-core';
import type { StoreApi } from 'zustand/vanilla';
import { MODEL_IMPORT_OP, PROJECT_OPEN_OP, resolveImporter } from './importers';
import type { Summarizer } from './summary';
import type { FilePipeline, OpenFileOptions, ShellUiState } from './types';

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

export function createFilePipeline(deps: FilePipelineDeps): FilePipeline {
  const { app, ui } = deps;

  const failure = (result: OperatorResult<unknown>): string | null => {
    if (result.status === 'failed') return result.error.message;
    if (result.status === 'cancelled') return result.reason;
    return null;
  };

  async function openFile(name: string, bytes: Uint8Array, opts: OpenFileOptions = {}): Promise<void> {
    const importer = resolveImporter(app.importers, name, bytes);
    if (importer === null) throw new Error(`No importer for '${name}' (supported: .glb, .vrm, .vrma, .ekzanim)`);

    if (importer.op === MODEL_IMPORT_OP && opts.auto !== true) {
      await openImportDialog(name, bytes, importer);
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
    const result = await deps.runFromUi(importer.op, args);
    const message = failure(result);
    if (message !== null) throw new Error(message);
  }

  /** Reads the model summary, then opens the import dialog. Resolves once the dialog is showing. */
  async function openImportDialog(name: string, bytes: Uint8Array, importer: PendingImporter): Promise<void> {
    ui.setState({ busy: `Reading ${name}…` });
    let summary = null;
    let summaryError: string | null = null;
    try {
      summary = await deps.summarize(bytes);
    } catch (error) {
      summaryError = errorText(error);
    } finally {
      ui.setState({ busy: null });
    }
    ui.setState({
      pendingImport: { name, bytes, importer, summary, summaryError },
    });
    const opened = await deps.runFromUi('ui.open', { dialog: 'import' });
    if (opened.status !== 'finished') {
      ui.setState({ pendingImport: null });
      throw new Error(failure(opened) ?? 'The import dialog could not open');
    }
  }

  return {
    openFile,
    async openFiles(files: readonly File[]): Promise<void> {
      for (const file of files) {
        try {
          await openFile(file.name, new Uint8Array(await file.arrayBuffer()));
        } catch (error) {
          deps.toastError(`${file.name}: ${errorText(error)}`);
        }
      }
    },
    async confirmImport(options: Readonly<Record<string, unknown>>): Promise<OperatorResult<unknown>> {
      const pending = ui.getState().pendingImport;
      if (pending === null) return { status: 'cancelled', reason: 'No file is waiting to be imported' };
      // Closing the dialog drops the pending file (ui.close → cancelImport) in the same update.
      await deps.runFromUi('ui.close');
      if (ui.getState().pendingImport === pending) ui.setState({ pendingImport: null });
      return deps.runFromUi(pending.importer.op, { name: pending.name, bytes: pending.bytes, options });
    },
    cancelImport(): void {
      if (ui.getState().pendingImport !== null) ui.setState({ pendingImport: null });
    },
  };
}

type PendingImporter = NonNullable<ShellUiState['pendingImport']>['importer'];
