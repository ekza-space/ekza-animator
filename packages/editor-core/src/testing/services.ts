// Host services of the fake app: the production in-memory asset store (content-addressed, verifying) and recording
// file, clipboard and notification services. No model loader, validator or preference storage (Node and browser
// tests alike).
import { createMemoryAssetStore } from '../services/assets';
import type { EditorServices, Notifier } from '../types';

export interface FakeServices extends EditorServices {
  /** Every `files.download` call, oldest first. */
  readonly downloads: readonly { readonly fileName: string; readonly bytes: Uint8Array; readonly mime: string }[];
  /** Every `notify.toast` call, oldest first. */
  readonly toasts: readonly Parameters<Notifier['toast']>[0][];
}

export function createFakeServices(): FakeServices {
  const downloads: { fileName: string; bytes: Uint8Array; mime: string }[] = [];
  const toasts: Parameters<Notifier['toast']>[0][] = [];
  let clipboardText: string | null = null;
  return {
    assets: createMemoryAssetStore(),
    files: {
      download(fileName: string, bytes: Uint8Array, mime: string): void {
        downloads.push({ fileName, bytes, mime });
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
        toasts.push(toast);
      },
    },
    models: null,
    validate: null,
    storage: null,
    downloads,
    toasts,
  };
}
