// Host services of the fake app: an in-memory content-addressed asset store and recording file, clipboard and
// notification services. No model loader, validator or preference storage (Node and browser tests alike).
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord } from '@ekza-animator/doc';
import type { AssetStore, EditorServices, Notifier } from '../types';

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
    assets: createFakeAssetStore(),
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

/** Content-addressed store keyed by the lowercase SHA-256 of the bytes (WebCrypto: Node and browsers). */
export function createFakeAssetStore(): AssetStore {
  const blobs = new Map<AssetId, Uint8Array>();
  return {
    async put(bytes, meta): Promise<AssetRecord> {
      const id = (await sha256Hex(bytes)) as AssetId;
      blobs.set(id, bytes.slice());
      return { id, name: meta.name, ext: meta.ext, mime: 'model/gltf-binary', size: bytes.byteLength, role: meta.role };
    },
    get(id: AssetId): Promise<Uint8Array> {
      const bytes = blobs.get(id);
      if (bytes === undefined) return Promise.reject(new EkzaError('asset-missing', `Asset ${id} is not stored`));
      return Promise.resolve(bytes.slice());
    },
    has: (id: AssetId) => Promise.resolve(blobs.has(id)),
    peek: (id: AssetId) => blobs.get(id),
    ids: () => [...blobs.keys()],
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
