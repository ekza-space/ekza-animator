// `takeHandoff` of the IndexedDB AutosaveStore (AUTORIG-SPEC §4.4, D1) — a lazy chunk: only a page opened with
// `?handoff=<id>` reads a record. Read-and-delete: the record (snapshot, assets, every blob, info), or null when it is
// missing or expired; the row goes either way.
import type { AssetId, AssetRecord } from '@ekza-studio/doc';
import type { BlobId, HandoffInfo } from '@ekza-studio/editor-core';
import type { SlotRow } from '../services/autosave';

/** A handoff record older than this is expired (housekeeping prunes it after 10 minutes too). */
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

/** The store's row helpers the reader uses. */
export interface HandoffRows {
  allSlots(): Promise<SlotRow[]>;
  readRow(key: string): Promise<{
    readonly snapshot: unknown;
    readonly assets: ReadonlyMap<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }>;
    readonly blob: (id: BlobId) => Promise<Uint8Array | undefined>;
  } | null>;
  removeRow(key: string): Promise<void>;
  now(): number;
}

export async function takeHandoff(
  rows: HandoffRows,
  key: string,
): Promise<{
  readonly snapshot: unknown;
  readonly assets: ReadonlyMap<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }>;
  readonly blobs: ReadonlyMap<BlobId, Uint8Array>;
  readonly info: HandoffInfo;
} | null> {
  const row = (await rows.allSlots()).find((candidate) => candidate.id === key);
  if (row === undefined) return null;
  try {
    const info = row.handoff;
    if (info === undefined || rows.now() - info.createdAt > HANDOFF_TTL_MS) return null;
    const read = await rows.readRow(key);
    if (read === null) return null;
    // Every blob now: the row (and with it the blobs' last reference) goes before this resolves.
    const blobs = new Map<BlobId, Uint8Array>();
    for (const blob of row.blobs ?? []) {
      const bytes = await read.blob(blob);
      if (bytes !== undefined) blobs.set(blob, bytes);
    }
    return { snapshot: read.snapshot, assets: read.assets, blobs, info };
  } finally {
    await rows.removeRow(key);
  }
}
