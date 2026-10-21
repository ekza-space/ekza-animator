// Intent prefetch of the editor route's lazy chunks (M2A-SPEC §5.21.2: "prefetched on intent, never at idle"). Each
// helper starts a dynamic import that the later use shares, so the first drop, export, save or dialog does not wait
// for its chunk; nothing here runs unless the user shows the intent.
import { loadProjectArchive, preloadExportPath, preloadImportPath, type UiDialog } from '@ekza-studio/editor-core';
import { preloadDialog } from '../dialogs/DialogHost';
import { preloadModelLoader } from '../services/models';

const swallow = (promise: Promise<unknown>): void => {
  promise.catch(() => {});
};

/**
 * A model or clip is about to arrive: a file dragged over the window, a sample hovered or pressed, the Open dialog.
 * Loads the import pipelines and the three.js model loader.
 */
export function prefetchModelLoading(): void {
  swallow(preloadImportPath());
  swallow(preloadModelLoader());
}

/** A file is dragged over the window: the model loader, the import dialog and the project archive code. */
export function prefetchForFileDrag(): void {
  prefetchModelLoading();
  swallow(preloadDialog('import'));
  swallow(loadProjectArchive());
}

/** A menu opened: the chunks its items would need (dialogs they open, the export path, the archive, models). */
export function prefetchForMenuItems(items: readonly { readonly op: string; readonly args?: unknown }[]): void {
  for (const item of items) {
    if (item.op === 'ui.open') {
      const dialog = (item.args as { readonly dialog?: unknown } | undefined)?.dialog;
      if (typeof dialog === 'string') swallow(preloadDialog(dialog as UiDialog));
    } else if (item.op === 'file.export') {
      swallow(preloadExportPath());
    } else if (item.op === 'file.save' || item.op === 'file.saveAs' || item.op === 'file.saveJson') {
      swallow(loadProjectArchive());
    } else if (item.op === 'file.openProject' || item.op === 'file.open') {
      swallow(loadProjectArchive());
      prefetchModelLoading();
    } else if (item.op === 'file.loadSample' || item.op === 'file.importModel' || item.op === 'file.importAnimation') {
      prefetchModelLoading();
    }
  }
}

/** Sample buttons of the empty state (`sample-<id>`) and of the Open dialog (`open-sample-<id>`). */
export const SAMPLE_SELECTOR = '[data-testid^="sample-"], [data-testid^="open-sample-"]';
