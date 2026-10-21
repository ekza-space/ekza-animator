// The memory BlobStore (M6A-SPEC §4.6, §5.20; B0a, then B7): content-addressed mesh manifests and chunks, resident in
// memory.
// - `put` is synchronous: hashes with the anim-core SHA-256, dedupes and keeps a private copy.
// - `get` re-verifies the bytes and returns a copy the caller owns; `peek` lends the resident bytes, which callers only
//   read (§4.6: copy before any change; `get` reports a corrupted lend as `blob-corrupt`).
// - **Sources** (B7): a blob that is not resident is looked up in the registered sources (an autosave slot being
//   recovered); bytes a source returns are verified, kept resident (fresh) and handed out like resident ones. `has`
//   and `peek` see resident blobs only, so a runtime whose chunks wait in a source goes 'loading' and reads them
//   through `get` (§5.5 rule 4, §5.20 recovery).
// - `sweep` frees what is neither reachable nor fresh (blobs `put` since the last completed sweep are roots until the
//   next one, so a sweep can never free what a commit in progress just stored).
// - `closure` expands manifests to their chunks by reading the manifest JSON directly (no kernel needed, so the
//   autosave store never parses manifests).
import { type Disposer, EkzaError, sha256Hex } from '@ekza-studio/anim-core';
import type { BlobId, BlobStore } from '../../types';

const HEX64 = /^[0-9a-f]{64}$/;

/** A place to look up blobs that are not resident (resolves undefined when it does not have one). */
export type BlobSource = (id: BlobId) => Promise<Uint8Array | undefined>;

export interface MemoryBlobStore extends BlobStore {
  /** Number of resident blobs. */
  readonly size: number;
  /** Registers a source `get` consults for blobs that are not resident (latest first). */
  addSource(source: BlobSource): Disposer;
}

/** Registers `source` on stores that support sources (the memory store); a no-op disposer otherwise. */
export function addBlobSource(store: BlobStore, source: BlobSource): Disposer {
  const withSources = store as Partial<MemoryBlobStore>;
  return typeof withSources.addSource === 'function' ? withSources.addSource(source) : () => {};
}

export function createMemoryBlobStore(): MemoryBlobStore {
  const blobs = new Map<BlobId, Uint8Array>();
  const fresh = new Set<BlobId>();
  const sources: BlobSource[] = [];
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

  const put = (bytes: Uint8Array): BlobId => {
    const id = sha256Hex(bytes);
    if (!blobs.has(id)) {
      blobs.set(id, bytes.slice());
      residentBytes += bytes.byteLength;
    }
    fresh.add(id);
    return id;
  };

  const fromSources = async (id: BlobId): Promise<Uint8Array> => {
    for (const source of [...sources].reverse()) {
      let bytes: Uint8Array | undefined;
      try {
        bytes = await source(id);
      } catch {
        bytes = undefined;
      }
      if (bytes === undefined) continue;
      if (sha256Hex(bytes) !== id) throw new EkzaError('blob-corrupt', `Mesh data is corrupt (blob ${id})`, { id });
      put(bytes);
      return bytes.slice();
    }
    throw new EkzaError('blob-missing', `Mesh data is missing (blob ${id})`);
  };

  return {
    put,
    get(id: BlobId): Promise<Uint8Array> {
      const bytes = blobs.get(id);
      if (bytes === undefined) return fromSources(id);
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
    addSource(source: BlobSource): Disposer {
      sources.push(source);
      return () => {
        const at = sources.indexOf(source);
        if (at >= 0) sources.splice(at, 1);
      };
    },
  };
}
