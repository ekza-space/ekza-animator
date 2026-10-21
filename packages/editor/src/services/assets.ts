// Content-addressed in-memory asset store of the browser host (research 06 §10.1; MVP-SPEC §4.5 AssetStore).
// `get` re-hashes the stored bytes, so a corrupted cache surfaces as EkzaError('asset-corrupt') instead of a broken
// bake. Async so a remote store (presigned URLs, M3) fits behind the same interface.
import { EkzaError } from '@ekza-studio/anim-core';
import { type AssetId, type AssetRecord, assetMime } from '@ekza-studio/doc';
import type { AssetStore } from '@ekza-studio/editor-core';

/** Lowercase hex SHA-256 of `bytes` (WebCrypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface StoredAsset {
  readonly bytes: Uint8Array;
  readonly size: number;
}

export interface BrowserAssetStore extends AssetStore {
  /** Number of resident blobs (diagnostics). */
  readonly size: number;
}

export function createBrowserAssetStore(): BrowserAssetStore {
  const blobs = new Map<AssetId, StoredAsset>();
  return {
    get size() {
      return blobs.size;
    },
    async put(bytes, meta): Promise<AssetRecord> {
      const id = (await sha256Hex(bytes)) as AssetId;
      if (!blobs.has(id)) blobs.set(id, { bytes: bytes.slice(), size: bytes.byteLength });
      return {
        id,
        name: meta.name,
        ext: meta.ext,
        mime: assetMime(meta.ext),
        size: bytes.byteLength,
        role: meta.role,
        provenance: null,
      };
    },
    async get(id: AssetId): Promise<Uint8Array> {
      const stored = blobs.get(id);
      if (stored === undefined) throw new EkzaError('asset-missing', `Asset ${id} is not in the asset store`, { id });
      if (stored.bytes.byteLength !== stored.size || (await sha256Hex(stored.bytes)) !== id) {
        throw new EkzaError('asset-corrupt', `Asset ${id} does not match its SHA-256`, { id });
      }
      return stored.bytes.slice();
    },
    has: (id: AssetId) => Promise.resolve(blobs.has(id)),
    peek: (id: AssetId) => blobs.get(id)?.bytes,
    ids: () => [...blobs.keys()],
  };
}
