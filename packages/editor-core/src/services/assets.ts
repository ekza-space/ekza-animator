// In-memory content-addressed asset store (research 06 §10.1, MVP-SPEC §4.11.21): blobs keyed by the lowercase
// SHA-256 of their bytes. `get` is async and re-verifies hash and size, so the interface fits a remote store later
// and in-place corruption of resident bytes is detected instead of propagated.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord } from '@ekza-animator/doc';
import type { AssetStore } from '../types';

interface Blob {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly size: number;
}

export function createMemoryAssetStore(): AssetStore {
  const blobs = new Map<AssetId, Blob>();
  return {
    async put(bytes, meta): Promise<AssetRecord> {
      // Own copy: the caller may reuse or transfer its buffer.
      const copy = bytes.slice();
      const id = (await sha256Hex(copy)) as AssetId;
      if (!blobs.has(id)) blobs.set(id, { bytes: copy, size: copy.byteLength });
      return { id, name: meta.name, ext: meta.ext, mime: 'model/gltf-binary', size: copy.byteLength, role: meta.role };
    },
    async get(id: AssetId): Promise<Uint8Array> {
      const blob = blobs.get(id);
      if (blob === undefined) throw new EkzaError('asset-missing', `Asset ${id} is not in the asset store`);
      const actual = await sha256Hex(blob.bytes);
      if (actual !== id || blob.bytes.byteLength !== blob.size) {
        throw new EkzaError('asset-corrupt', `Asset ${id} failed verification (SHA-256 ${actual})`, {
          expected: id,
          actual,
          size: blob.bytes.byteLength,
        });
      }
      // The resident bytes, not a copy (avatars are megabytes); callers treat them as immutable and every get
      // re-verifies them.
      return blob.bytes;
    },
    has: (id: AssetId) => Promise.resolve(blobs.has(id)),
    peek: (id: AssetId) => blobs.get(id)?.bytes,
    ids: () => [...blobs.keys()].sort(),
  };
}

/** Lowercase hex SHA-256 through WebCrypto (browsers, workers and Node alike). */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
