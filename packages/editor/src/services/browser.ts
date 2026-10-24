// Browser implementations of the EditorServices (MVP-SPEC §4.5, §7 WP-8): in-memory asset store with async
// verification, file download, clipboard, toasts, the three.js model loader, localStorage preferences and the
// IndexedDB autosave store (M2A-SPEC §5.20) and (M6a) the mesh blob store.
import type { BlobStore, EditorServices } from '@ekza-studio/editor-core';
import { createBrowserAssetStore } from './assets';
import { createIndexedDbAutosaveStore, newSlotId } from './autosave';
import { createBrowserBlobStore } from './blobs';
import { createBrowserClipboard } from './clipboard';
import { createDownloadService, type DownloadRecord } from './files';
import { createBrowserModelLoader } from './models';
import { createToastNotifier, type ToastNotifier } from './notify';
import { createBlockedStorage, createLocalStorage, createMemoryStorage, namespacePrefix } from './storage';

/** M2A-SPEC §4.8: storage switches of `createBrowserServices` (e2e URL parameters `ns`, `storage`, `pointerLock`). */
export interface BrowserServicesOptions {
  /**
   * The storage namespace: localStorage keys get the prefix `namespacePrefix(ns)` and the autosave database (A5) the
   * suffix, so a reload of the same e2e URL sees the same storage. Absent: the M1 behaviour.
   */
  readonly storageNamespace?: string;
  /** Every storage access throws (private mode, blocked site data; the NFR-12 e2e switch `storage=blocked`). */
  readonly storageBlocked?: boolean;
  /** false: the Channels panel virtual slider uses pointer capture instead of Pointer Lock (§5.18; read by A2). */
  readonly pointerLock?: boolean;
  /** M6a (M6A-SPEC §9.1): the mesh blob store; absent = the browser's (memory) store, null = editor-core's default. */
  readonly blobs?: BlobStore | null;
  /** M6a (§3 rule 8): the kernel debug switch, on in development and e2e builds. */
  readonly kernelDebug?: boolean;
}

export interface ShellServicesOptions extends BrowserServicesOptions {
  readonly decoderPath: string;
  /** Base URL of the bundled samples (`file.loadSample`); default '/samples/'. */
  readonly samplesPath?: string;
  /** M6b (§0.4.7): base URL of the clip library; default '/library/'. */
  readonly libraryPath?: string;
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

/**
 * The autosave store for the storage options (M2A-SPEC §4.8, §5.20): none when storage is blocked or off; a fresh
 * database per page load for in-memory (e2e) storage; the namespace's database for `storageNamespace`; else the
 * default database.
 */
function autosaveStore(opts: ShellServicesOptions, storageKind: 'local' | 'memory' | null) {
  if (opts.storageBlocked === true || storageKind === null) return null;
  if (storageKind === 'memory') return createIndexedDbAutosaveStore({ namespace: `page-${newSlotId().slice(3)}` });
  return createIndexedDbAutosaveStore(opts.storageNamespace === undefined ? {} : { namespace: opts.storageNamespace });
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
    storage:
      opts.storageBlocked === true
        ? createBlockedStorage()
        : storageKind === 'local'
          ? createLocalStorage(opts.storageNamespace === undefined ? '' : namespacePrefix(opts.storageNamespace))
          : storageKind === 'memory'
            ? createMemoryStorage()
            : null,
    samplesPath: opts.samplesPath ?? '/samples/',
    libraryPath: opts.libraryPath ?? '/library/',
    autosave: autosaveStore(opts, storageKind),
    blobs: opts.blobs === undefined ? createBrowserBlobStore() : opts.blobs,
    ...(opts.kernelDebug === undefined ? {} : { kernelDebug: opts.kernelDebug }),
  };
  return { services, toasts };
}

export function createBrowserServices(
  opts: {
    readonly decoderPath: string;
    readonly samplesPath?: string;
    readonly createValidatorWorker?: () => Worker;
  } & BrowserServicesOptions,
): EditorServices {
  return createShellServices(opts).services;
}
