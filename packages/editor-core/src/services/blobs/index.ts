// The memory BlobStore (M6A-SPEC §4.6, §5.20; B0a complete, B7 owns it after): content-addressed mesh manifests and
// chunks, resident in memory.
// - `put` is synchronous: hashes with the anim-core SHA-256, dedupes and keeps a private copy.
// - `get` re-verifies the bytes and returns a copy the caller owns; `peek` lends the resident bytes, which callers only
//   read (§4.6: copy before any change; `get` reports a corrupted lend as `blob-corrupt`).
// - `sweep` frees what is neither reachable nor fresh (blobs `put` since the last completed sweep are roots until the
//   next one, so a sweep can never free what a commit in progress just stored).
// - `closure` expands manifests to their chunks by reading the manifest JSON directly (no kernel needed, so the
//   autosave store never parses manifests).
import { EkzaError, sha256Hex } from '@ekza-animator/anim-core';
import type { BlobId, BlobStore } from '../../types';

const HEX64 = /^[0-9a-f]{64}$/;

export interface MemoryBlobStore extends BlobStore {
  /** Number of resident blobs. */
  readonly size: number;
}

export function createMemoryBlobStore(): MemoryBlobStore {
  const blobs = new Map<BlobId, Uint8Array>();
  const fresh = new Set<BlobId>();
  let residentBytes = 0;

  const chunkIdsOf = (manifest: Uint8Array): readonly string[] => {
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(manifest));
    } catch {
      return [];
    }
    if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { layers?: unknown }).layers)) return [];
    const out: string[] = [];
    for (const layer of (raw as { layers: readonly unknown[] }).layers) {
      const chunks = (layer as { chunks?: unknown } | null)?.chunks;
      if (!Array.isArray(chunks)) continue;
      for (const id of chunks) if (typeof id === 'string' && HEX64.test(id)) out.push(id);
    }
    return out;
  };

  return {
    put(bytes: Uint8Array): BlobId {
      const id = sha256Hex(bytes);
      if (!blobs.has(id)) {
        blobs.set(id, bytes.slice());
        residentBytes += bytes.byteLength;
      }
      fresh.add(id);
      return id;
    },
    get(id: BlobId): Promise<Uint8Array> {
      const bytes = blobs.get(id);
      if (bytes === undefined)
        return Promise.reject(new EkzaError('blob-missing', `Mesh data is missing (blob ${id})`));
      if (sha256Hex(bytes) !== id) {
        return Promise.reject(new EkzaError('blob-corrupt', `Mesh data is corrupt (blob ${id})`, { id }));
      }
      return Promise.resolve(bytes.slice());
    },
    peek: (id: BlobId) => blobs.get(id),
    has: (id: BlobId) => blobs.has(id),
    sweep(reachable: ReadonlySet<BlobId>): { readonly freed: number; readonly bytes: number } {
      let freed = 0;
      let bytes = 0;
      for (const [id, data] of blobs) {
        if (reachable.has(id) || fresh.has(id)) continue;
        blobs.delete(id);
        freed++;
        bytes += data.byteLength;
      }
      residentBytes -= bytes;
      fresh.clear();
      return { freed, bytes };
    },
    get residentBytes(): number {
      return residentBytes;
    },
    get size(): number {
      return blobs.size;
    },
    ids: () => [...blobs.keys()].sort(),
    get fresh(): ReadonlySet<BlobId> {
      return fresh;
    },
    closure(manifests: readonly BlobId[]): readonly BlobId[] {
      const out = new Set<BlobId>();
      for (const manifest of manifests) {
        out.add(manifest);
        const bytes = blobs.get(manifest);
        if (bytes !== undefined) for (const id of chunkIdsOf(bytes)) out.add(id);
      }
      return [...out];
    },
  };
}
