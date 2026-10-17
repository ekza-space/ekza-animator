// Browser implementations of the EditorServices (MVP-SPEC §4.5, §7 WP-8): in-memory asset store with async
// verification, file download, clipboard, toasts, the three.js model loader and localStorage preferences.
import type { EditorServices } from '@ekza-animator/editor-core';
import { createBrowserAssetStore } from './assets';
import { createBrowserClipboard } from './clipboard';
import { createDownloadService, type DownloadRecord } from './files';
import { createBrowserModelLoader } from './models';
import { createToastNotifier, type ToastNotifier } from './notify';
import { createLocalStorage, createMemoryStorage } from './storage';

export interface ShellServicesOptions {
  readonly decoderPath: string;
  readonly createValidatorWorker?: () => Worker;
  /** 'local': localStorage (default); 'memory': a fresh in-memory namespace (e2e runs); null: no storage. */
  readonly storage?: 'local' | 'memory' | null;
  readonly onDownload?: (record: DownloadRecord) => void;
}

/** The services plus the typed toast queue the shell renders. */
export interface ShellServices {
  readonly services: EditorServices;
  readonly toasts: ToastNotifier;
}

export function createShellServices(opts: ShellServicesOptions): ShellServices {
  const toasts = createToastNotifier();
  const storageKind = opts.storage === undefined ? 'local' : opts.storage;
  const services: EditorServices = {
    assets: createBrowserAssetStore(),
    files: createDownloadService(opts.onDownload),
    clipboard: createBrowserClipboard(),
    notify: toasts,
    models: createBrowserModelLoader({ decoderPath: opts.decoderPath }),
    // The in-app glTF-Validator worker is M1-stretch (MVP-SPEC §1.2); exports run the read-back check instead.
    validate: null,
    storage: storageKind === 'local' ? createLocalStorage() : storageKind === 'memory' ? createMemoryStorage() : null,
  };
  return { services, toasts };
}

export function createBrowserServices(opts: {
  readonly decoderPath: string;
  readonly createValidatorWorker?: () => Worker;
}): EditorServices {
  return createShellServices(opts).services;
}
