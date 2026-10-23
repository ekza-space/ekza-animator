// The handoff record's writer and reader (AUTORIG-SPEC §4.4, D1) — a lazy chunk: only the new-tab flow, the page-load
// fallback and a `?handoff=` page load it. The autosave slot is not the medium (a clean document's slot is deleted,
// a paused autosave writes nothing, a slot belongs to its live tab): the writer stores a one-shot record from the live
// document — dirty or clean, autosave on, off or paused — with its asset and blob closure, and never touches this
// tab's slot. The receiving page takes it (read-and-delete), puts the assets and blobs into its stores and opens the
// document silently through `file.openProject`'s path (the project JSON variant: migrations, the read-only rule,
// session repair, history cleared) — no Recovery dialog, its own fresh autosave slot.
import { EkzaError } from '@ekza-studio/anim-core';
import { type AssetRecord, type DocSnapshot, serializeSnapshot } from '@ekza-studio/doc';
import {
  attachMeshes,
  type BlobId,
  type EditorApp,
  type HandoffInfo,
  loadProjectArchive,
  type NavigationRequest,
} from '@ekza-studio/editor-core';
import type { HostShell } from './types';

/** The receiving page's message when the record is gone (taken, expired, or another browser profile). */
export const HANDOFF_EXPIRED = 'This hand-over has expired — open the file from the source tab';
/** Without browser storage there is no record to hand over. */
export const HANDOFF_UNAVAILABLE = 'Opening in another tab needs browser storage, which is blocked here';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Every partition of the document (the snapshot of an unopened partition would be partial). */
async function openAllPartitions(app: EditorApp): Promise<void> {
  await app.store.open('scene');
  for (const character of app.store.list('characters')) {
    await app.store.open(`char:${character.id}`);
    for (const clip of app.store.query.clipsOfCharacter(character.id)) await app.store.open(`clip:${clip.id}`);
  }
}

/** The mesh manifests the snapshot's live meshes use. */
function liveManifests(snapshot: DocSnapshot): BlobId[] {
  const out = new Set<BlobId>();
  for (const record of Object.values(snapshot.tables.meshes ?? {})) {
    if (record.deleted === null && record.data !== null) out.add(record.data.manifest);
  }
  return [...out].sort();
}

/**
 * Writes the live document as a handoff record and returns its id (a UUID). Throws without a store that takes
 * records (storage blocked, Node).
 */
export async function writeHandoffRecord(app: EditorApp, info: HandoffInfo): Promise<string> {
  const store = app.services.autosave ?? null;
  if (store === null || store.writeHandoff === undefined) throw new EkzaError('unsupported', HANDOFF_UNAVAILABLE);
  await openAllPartitions(app);
  const snapshot = app.store.snapshot();
  const manifests = liveManifests(snapshot);
  // The snapshot's mesh blobs are GC roots until the record is written (as for an autosave write, M6A-SPEC §5.20).
  const meshes = attachMeshes(app);
  const unpinManifests = meshes?.pinBlobs(manifests) ?? (() => {});
  try {
    for (const manifest of manifests) if (!app.blobs.has(manifest)) await app.blobs.get(manifest).catch(() => {});
    const blobs = app.blobs.closure(manifests);
    const unpinBlobs = meshes?.pinBlobs(blobs) ?? (() => {});
    try {
      const assets: AssetRecord[] = [];
      for (const record of Object.values(snapshot.tables.assets ?? {})) {
        if (await app.services.assets.has(record.id)) assets.push(record);
      }
      const id = globalThis.crypto.randomUUID();
      await store.writeHandoff(
        id,
        { snapshotJson: serializeSnapshot(snapshot), assets, blobs, info },
        (asset) => app.services.assets.get(asset),
        (blob) => app.blobs.get(blob),
      );
      return id;
    } finally {
      unpinBlobs();
    }
  } finally {
    unpinManifests();
  }
}

/** `href` with `handoff=<id>`. */
export function withHandoff(href: string, id: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}handoff=${encodeURIComponent(id)}`;
}

/**
 * The new-tab flow and the page-load fallback (§4.4): writes the record, then points the tab opened in the gesture (or
 * this page) at `href` with the record's id. A failed write closes that tab and says why; nothing else changes.
 */
export async function handOver(
  host: Pick<HostShell, 'app' | 'mounted'>,
  request: NavigationRequest,
  href: string,
  tab: Window | null,
  location: Pick<Location, 'assign'> = window.location,
): Promise<void> {
  const info: HandoffInfo = {
    route: request.to === 'autorig' ? 'autorig' : 'studio',
    workspace: request.workspace ?? null,
    subject: request.subject ?? null,
    autorig: host.mounted.getState()?.handoffState?.() ?? null,
    createdAt: Date.now(),
  };
  let id: string;
  try {
    id = await writeHandoffRecord(host.app, info);
  } catch (error) {
    tab?.close();
    const where = info.route === 'studio' ? 'Studio' : 'Auto-Rig';
    host.app.services.notify.toast({ kind: 'error', text: `Could not open ${where}: ${messageOf(error)}` });
    return;
  }
  const url = withHandoff(href, id);
  if (tab === null) location.assign(url);
  else tab.location.href = url;
}

/**
 * Takes the record `id` and opens its document in this page (§4.4): assets and blobs first, then the document
 * through `file.openProject`'s path, silently. A missing or expired record leaves the empty document and says so.
 * Returns the record's info (also handed to the navigation port for the arriving shell), or null.
 */
export async function receiveHandoff(host: HostShell, id: string): Promise<HandoffInfo | null> {
  const { app } = host;
  const notify = app.services.notify;
  let record: Awaited<ReturnType<NonNullable<NonNullable<EditorApp['services']['autosave']>['takeHandoff']>>>;
  try {
    record = (await app.services.autosave?.takeHandoff?.(id)) ?? null;
  } catch (error) {
    console.warn('Ekza Studio: the hand-over could not be read', error);
    record = null;
  }
  if (record === null) {
    notify.toast({ kind: 'warning', text: HANDOFF_EXPIRED });
    return null;
  }
  for (const { record: asset, bytes } of record.assets.values()) {
    await app.services.assets.put(bytes, { name: asset.name, ext: asset.ext, role: asset.role });
  }
  for (const bytes of record.blobs.values()) app.blobs.put(bytes);
  const snapshot = record.snapshot as DocSnapshot;
  const { writeProjectJson } = await loadProjectArchive();
  const text = writeProjectJson(
    snapshot,
    [...record.assets.values()].map((entry) => entry.record),
  );
  const name = `${snapshot.tables.project?.['project']?.name ?? 'Untitled'}.ekzanim.json`;
  const opened = await app.runUntyped('file.openProject', { bytes: new TextEncoder().encode(text), name });
  if (opened.status !== 'finished') {
    const reason = opened.status === 'failed' ? opened.error.message : opened.reason;
    notify.toast({ kind: 'error', text: `The hand-over could not be opened: ${reason}` });
    return null;
  }
  host.navigation.arrive(record.info);
  const where = record.info.route === 'studio' ? 'Studio' : 'Auto-Rig';
  notify.toast({ kind: 'success', text: `Opened in ${where}; undo history starts here` });
  return record.info;
}
