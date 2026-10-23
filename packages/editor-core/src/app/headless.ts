// The headless editor (MCP-SPEC §4.1, §5.17): the production kernel over host services that need neither a DOM nor
// Node — a memory asset store, a capturing file service, a memory clipboard and a notifier sink. The MCP server's
// headless projects, the eval harness and Node tests run on it. Nothing here imports `node:*` or touches the DOM: a
// Node host passes `readSample` (bundled samples from disk), `validate` (gltf-validator) and `viewCapture`
// (schematic) in.
import type { DocumentStore, IdSource } from '@ekza-studio/doc';
import type { ValidationReport } from '@ekza-studio/io';
import { createMemoryAssetStore } from '../services/assets';
import type { EditorApp, EditorServices, Notifier, ViewCaptureService } from '../types';
import type { SampleDef } from '../workflows/samples';
import { createEditorApp } from './createEditorApp';

export interface HeadlessServicesOptions {
  readonly validate?: ((bytes: Uint8Array) => Promise<ValidationReport>) | null; // default null (read-back only)
  readonly readSample?: ((sample: SampleDef) => Promise<Uint8Array>) | null; // default null (loadSample poll-fails "samples are not available")
  readonly viewCapture?: ViewCaptureService | null;
  /** Every `files.download` (exports, saves); the host decides where the bytes go. */
  readonly onDownload?: (file: {
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly mime: string;
  }) => void;
  /** Every toast; hosts turn them into result warnings. */
  readonly onNotify?: (toast: Parameters<Notifier['toast']>[0]) => void;
}

/** Memory asset store, capturing files, memory clipboard, notifier sink, models null, storage null, autosave null. */
export function createHeadlessServices(opts?: HeadlessServicesOptions): EditorServices {
  let clipboardText: string | null = null;
  const onDownload = opts?.onDownload;
  const onNotify = opts?.onNotify;
  return {
    assets: createMemoryAssetStore(),
    files: {
      download(fileName: string, bytes: Uint8Array, mime: string): void {
        onDownload?.({ fileName, bytes, mime });
      },
    },
    clipboard: {
      writeText(text: string): Promise<void> {
        clipboardText = text;
        return Promise.resolve();
      },
      readText: () => Promise.resolve(clipboardText),
    },
    notify: {
      toast(toast): void {
        onNotify?.(toast);
      },
    },
    models: null,
    validate: opts?.validate ?? null,
    storage: null,
    autosave: null,
    // null (not undefined): `file.loadSample` poll-fails "samples are not available" instead of trying `fetch`.
    readSample: opts?.readSample ?? null,
    viewCapture: opts?.viewCapture ?? null,
  };
}

/** createEditorApp over createHeadlessServices; `idSource` only for single-project processes (tests, --seed). */
export function createHeadlessEditorApp(
  opts?: HeadlessServicesOptions & {
    readonly idSource?: IdSource;
    readonly store?: DocumentStore;
  },
): EditorApp {
  return createEditorApp({
    services: createHeadlessServices(opts),
    ...(opts?.store === undefined ? {} : { store: opts.store }),
    ...(opts?.idSource === undefined ? {} : { idSource: opts.idSource }),
  });
}
