// The browser's BlobStore (M6A-SPEC §4.6, §5.20; B7): mesh manifests and chunks resident in memory. It has no
// persistence of its own — the autosave store owns the IndexedDB `blobs` object store and receives the blob closure
// with every write; a recovered slot is attached as a source, so its blobs load on demand (S27).
import { createMemoryBlobStore, type MemoryBlobStore } from '@ekza-studio/editor-core';

export function createBrowserBlobStore(): MemoryBlobStore {
  return createMemoryBlobStore();
}
