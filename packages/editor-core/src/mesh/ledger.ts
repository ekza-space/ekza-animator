// Blob reference counts (M6A-SPEC §5.20 "GC from derived roots"): which manifests and chunks the editor still needs,
// kept incrementally so a budget check and a sweep cost O(changed references), never a set difference over history.
//
// - References are counted per **manifest** and per root class: `hist` (a meshes.data value in a doc undo or redo
//   entry, root 2) and `other` (live records, runtimes, the last op's journal edge, roots 1 and 3). A manifest's
//   closure (itself plus its chunks, from the resident manifest bytes) inherits its counts; a manifest whose bytes are
//   not resident yet counts only itself until `resolve()` finds its bytes.
// - Autosave blobs (root 4: the current slot and a write in flight) are pinned per **blob id** in the `other` class.
// - Root 5 (`BlobStore.fresh`) is the store's own: a sweep never frees a fresh blob.
// - A blob is **history-only** when hist > 0 and other = 0: those bytes count against the undo byte budget.
import type { BlobId, BlobStore } from '../types';

export type RefClass = 'hist' | 'other';

interface BlobCount {
  hist: number;
  other: number;
  /** Bytes added to `historyOnlyBytes` while this blob was history-only (subtracted with the same amount). */
  counted: number;
}

interface ManifestCount {
  hist: number;
  other: number;
  /** Unique blob ids of the closure (the manifest first); null while the manifest bytes are not resident. */
  closure: readonly BlobId[] | null;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Chunk ids listed by manifest JSON bytes (no kernel needed; the same reading as `BlobStore.closure`). */
export function chunkIdsOfManifest(bytes: Uint8Array): readonly BlobId[] {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return [];
  }
  const layers = (raw as { layers?: unknown } | null)?.layers;
  if (!Array.isArray(layers)) return [];
  const out: BlobId[] = [];
  for (const layer of layers) {
    const chunks = (layer as { chunks?: unknown } | null)?.chunks;
    if (!Array.isArray(chunks)) continue;
    for (const id of chunks) if (typeof id === 'string' && HEX64.test(id)) out.push(id);
  }
  return out;
}

export class BlobLedger {
  private readonly manifests = new Map<BlobId, ManifestCount>();
  private readonly counts = new Map<BlobId, BlobCount>();
  private readonly reachableIds = new Set<BlobId>();
  private readonly unresolved = new Set<BlobId>();
  private historyOnly = 0;

  constructor(private readonly blobs: BlobStore) {}

  /** Bytes of blobs reachable only from the doc undo history (the budget's first term). */
  get historyOnlyBytes(): number {
    return this.historyOnly;
  }

  /** Every blob some root references (the sweep's reachable set; a live view, do not keep it across writes). */
  get reachable(): ReadonlySet<BlobId> {
    return this.reachableIds;
  }

  /** True when a root references `id`. */
  has(id: BlobId): boolean {
    return this.reachableIds.has(id);
  }

  /** Reference count of a manifest in one class (tests). */
  manifestCount(manifest: BlobId, cls: RefClass): number {
    return this.manifests.get(manifest)?.[cls] ?? 0;
  }

  /** Adds (`delta` +1) or removes (−1) one reference of `cls` to a manifest and, through it, its closure. */
  ref(manifest: BlobId, cls: RefClass, delta: 1 | -1): void {
    let entry = this.manifests.get(manifest);
    if (entry === undefined) {
      if (delta < 0) return;
      entry = { hist: 0, other: 0, closure: this.closureOf(manifest) };
      this.manifests.set(manifest, entry);
      if (entry.closure === null) this.unresolved.add(manifest);
    }
    const before = entry[cls];
    const after = Math.max(0, before + delta);
    entry[cls] = after;
    if ((before === 0) !== (after === 0)) {
      const step = after > 0 ? 1 : -1;
      for (const id of entry.closure ?? [manifest]) this.blob(id, cls, step);
    }
    if (entry.hist === 0 && entry.other === 0) {
      this.manifests.delete(manifest);
      this.unresolved.delete(manifest);
    }
  }

  /** Pins (`delta` +1) or unpins (−1) blob ids directly in the `other` class (autosave slots and writes in flight). */
  pin(ids: Iterable<BlobId>, delta: 1 | -1): void {
    for (const id of ids) this.blob(id, 'other', delta);
  }

  /** Computes the closures of manifests whose bytes have become resident since they were referenced. */
  resolve(): void {
    for (const manifest of [...this.unresolved]) {
      const entry = this.manifests.get(manifest);
      if (entry === undefined) {
        this.unresolved.delete(manifest);
        continue;
      }
      const closure = this.closureOf(manifest);
      if (closure === null) continue;
      this.unresolved.delete(manifest);
      // The manifest id itself is already counted; add the chunks under the live classes.
      for (const cls of ['hist', 'other'] as const) {
        if (entry[cls] === 0) continue;
        for (const id of closure) if (id !== manifest) this.blob(id, cls, 1);
      }
      entry.closure = closure;
    }
  }

  /** Forgets every reference (a document load rebuilds them). */
  reset(): void {
    this.manifests.clear();
    this.counts.clear();
    this.reachableIds.clear();
    this.unresolved.clear();
    this.historyOnly = 0;
  }

  private closureOf(manifest: BlobId): readonly BlobId[] | null {
    const bytes = this.blobs.peek(manifest);
    if (bytes === undefined) return null;
    const ids = new Set<BlobId>([manifest]);
    for (const id of chunkIdsOfManifest(bytes)) ids.add(id);
    return [...ids];
  }

  private blob(id: BlobId, cls: RefClass, delta: 1 | -1): void {
    let count = this.counts.get(id);
    if (count === undefined) {
      if (delta < 0) return;
      count = { hist: 0, other: 0, counted: 0 };
      this.counts.set(id, count);
    }
    const wasOnly = count.hist > 0 && count.other === 0;
    count[cls] = Math.max(0, count[cls] + delta);
    const isOnly = count.hist > 0 && count.other === 0;
    if (wasOnly && !isOnly) {
      this.historyOnly -= count.counted;
      count.counted = 0;
    } else if (!wasOnly && isOnly) {
      count.counted = this.blobs.peek(id)?.byteLength ?? 0;
      this.historyOnly += count.counted;
    }
    if (count.hist === 0 && count.other === 0) {
      this.counts.delete(id);
      this.reachableIds.delete(id);
    } else {
      this.reachableIds.add(id);
    }
  }
}
