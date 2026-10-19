// Project files (ADR 0011): `.ekzanim` (zip: manifest, project.json, source models by SHA-256) and the
// `.ekzanim.json` debug variant. Saving reads every referenced asset through the verifying asset store; opening
// checks the assets, puts them into the asset store and replaces the document (never merges). The archive code and
// fflate load with a dynamic `import('@ekza-animator/io/project')` on the first save or open (M2A-SPEC §5.21.2).
//
// M6a (M6A-SPEC §5.20, B7): a save also stores every manifest and chunk reachable from live mesh records (the blob
// closure, read verified through `BlobStore.get`) and reference images; opening puts the archive's verified blobs
// into the blob store before the document loads, so meshes are ready at once (a missing blob makes its mesh
// 'error', the project still opens). The JSON variant carries no blob or image bytes and says so.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord, DocSnapshot } from '@ekza-animator/doc';
import type * as ProjectModule from '@ekza-animator/io/project';
import { attachMeshes } from '../mesh';
import { chunkIdsOfManifest } from '../mesh/ledger';
import type { BlobId, EditorApp } from '../types';
import { EDITOR_VERSION } from './samples';
import { resetDocumentSession } from './session';

export const PROJECT_EXTENSION = 'ekzanim';
export const PROJECT_JSON_EXTENSION = 'ekzanim.json';
export const PROJECT_MIME = 'application/zip';
export const PROJECT_JSON_MIME = 'application/json';

let projectModule: Promise<typeof ProjectModule> | null = null;

/**
 * Loads `@ekza-animator/io/project` (the `.ekzanim` archive code with fflate) once; a failed load is retried by the
 * next call. Hosts call it on intent (the File menu opening) so the first save or open does not wait for it.
 */
export function loadProjectArchive(): Promise<typeof ProjectModule> {
  if (projectModule === null) {
    projectModule = import('@ekza-animator/io/project');
    projectModule.catch(() => {
      projectModule = null;
    });
  }
  return projectModule;
}

export interface SaveArtifact {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
  /** `store.version` of the saved snapshot: a later change keeps the project dirty. */
  readonly version: number;
  /** Problems worth telling the user (models missing from the asset store). */
  readonly warnings: readonly string[];
}

/** `name` reduced to a safe file name with the given extension (keeps an extension that is already there). */
export function projectFileName(name: string, extension: string): string {
  // Only the project extensions are dropped: a name like 'walk.v2' keeps its dots.
  let stem = name.split(/[\\/]/).pop() ?? name;
  for (const ext of [PROJECT_JSON_EXTENSION, PROJECT_EXTENSION]) {
    if (stem.toLowerCase().endsWith(`.${ext}`)) {
      stem = stem.slice(0, -ext.length - 1);
      break;
    }
  }
  stem = stem.replace(/[^A-Za-z0-9._ -]+/g, '_').trim();
  return `${stem === '' ? 'Untitled' : stem}.${extension}`;
}

function assetRecords(snapshot: DocSnapshot): readonly AssetRecord[] {
  return Object.values(snapshot.tables.assets ?? {});
}

/** The JSON variant's warning when the document has mesh data or reference images (§5.20). */
export const JSON_VARIANT_WARNING = 'Mesh data and reference images are not included';

/** Manifests of the live mesh records of a snapshot (soft-deleted records are not in it). */
export function liveManifests(snapshot: DocSnapshot): readonly BlobId[] {
  const out = new Set<BlobId>();
  for (const record of Object.values(snapshot.tables.meshes ?? {})) {
    if (record.deleted === null && record.data !== null) out.add(record.data.manifest);
  }
  return [...out].sort();
}

/**
 * The blob closure of `manifests` (manifests and their chunks) with verified bytes, read through `BlobStore.get`
 * (resident blobs, else its sources). Blobs that cannot be read are reported in `missing`.
 */
export async function readBlobClosure(
  app: EditorApp,
  manifests: readonly BlobId[],
): Promise<{ readonly blobs: ReadonlyMap<BlobId, Uint8Array>; readonly missing: readonly BlobId[] }> {
  const blobs = new Map<BlobId, Uint8Array>();
  const missing: BlobId[] = [];
  const read = async (id: BlobId): Promise<Uint8Array | null> => {
    if (blobs.has(id)) return blobs.get(id) ?? null;
    try {
      const bytes = await app.blobs.get(id);
      blobs.set(id, bytes);
      return bytes;
    } catch {
      missing.push(id);
      return null;
    }
  };
  for (const manifest of manifests) {
    const bytes = await read(manifest);
    if (bytes === null) continue;
    for (const chunk of chunkIdsOfManifest(bytes)) await read(chunk);
  }
  return { blobs: new Map([...blobs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), missing };
}

/**
 * Opens every character and clip partition (§4.11.21): a snapshot holds only open partitions, and a project file must
 * hold the whole document.
 */
export async function openAllPartitions(app: EditorApp): Promise<void> {
  await app.store.open('scene');
  for (const character of app.store.list('characters')) {
    await app.store.open(`char:${character.id}`);
    for (const clip of app.store.query.clipsOfCharacter(character.id)) await app.store.open(`clip:${clip.id}`);
  }
}

/** The `.ekzanim` archive of the current document with every asset it references (async: verified reads). */
export async function prepareProjectArchive(app: EditorApp, name: string): Promise<SaveArtifact> {
  await openAllPartitions(app);
  const version = app.store.version;
  const snapshot = app.store.snapshot();
  const assets = new Map<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }>();
  const warnings: string[] = [];
  for (const record of assetRecords(snapshot)) {
    // A project opened from the JSON variant may lack a model: save the rest (like that variant) and say so.
    if (!(await app.services.assets.has(record.id))) {
      warnings.push(`${record.name} is not available and was not included`);
      continue;
    }
    assets.set(record.id, { record, bytes: await app.services.assets.get(record.id) });
  }
  const closure = await readBlobClosure(app, liveManifests(snapshot));
  if (closure.missing.length > 0) {
    warnings.push(
      `Mesh data is missing (${closure.missing.length} blob${closure.missing.length === 1 ? '' : 's'}) and was not included`,
    );
  }
  const { writeProjectArchive } = await loadProjectArchive();
  const bytes = writeProjectArchive(snapshot, assets, { version: EDITOR_VERSION }, closure.blobs);
  return { fileName: projectFileName(name, PROJECT_EXTENSION), bytes, mime: PROJECT_MIME, version, warnings };
}

/** The `.ekzanim.json` debug variant (document + asset descriptions, no bytes). */
export async function prepareProjectJson(app: EditorApp, name: string): Promise<SaveArtifact> {
  const { writeProjectJson } = await loadProjectArchive();
  await openAllPartitions(app);
  const version = app.store.version;
  const snapshot = app.store.snapshot();
  const text = writeProjectJson(snapshot, assetRecords(snapshot));
  // §5.20: the debug variant carries no blob or image bytes (as it carries no model bytes): say so.
  const hasMeshData = liveManifests(snapshot).length > 0;
  const hasImages = assetRecords(snapshot).some((record) => record.ext === 'png' || record.ext === 'jpg');
  const warnings = hasMeshData || hasImages ? [JSON_VARIANT_WARNING] : [];
  if (warnings.length > 0) app.services.notify.toast({ kind: 'warning', text: JSON_VARIANT_WARNING });
  return {
    fileName: projectFileName(name, PROJECT_JSON_EXTENSION),
    bytes: new TextEncoder().encode(text),
    mime: PROJECT_JSON_MIME,
    version,
    warnings,
  };
}

export interface OpenedProject {
  readonly snapshot: DocSnapshot;
  readonly readOnly: boolean;
  readonly migratedFrom: number;
  readonly warnings: readonly string[];
}

/**
 * Reads a project file and makes its assets available: archived models are put into the asset store (their SHA-256
 * must match the asset id); models of the JSON variant must already be in the store, else the project opens with a
 * warning and those characters stay without a model.
 */
export async function prepareProjectOpen(app: EditorApp, bytes: Uint8Array): Promise<OpenedProject> {
  const { readProjectArchive } = await loadProjectArchive();
  const archive = await readProjectArchive(bytes);
  const warnings: string[] = [];
  for (const [id, { record, bytes: assetBytes }] of archive.assets) {
    const stored = await app.services.assets.put(assetBytes, { name: record.name, ext: record.ext, role: record.role });
    if (stored.id !== id) {
      throw new EkzaError('asset-corrupt', `The archived asset ${record.name} does not match its SHA-256 ${id}`);
    }
  }
  for (const record of assetRecords(archive.snapshot)) {
    if (archive.assets.has(record.id)) continue;
    if (!(await app.services.assets.has(record.id))) {
      warnings.push(`${record.name} is not part of this file; add the model to see its characters`);
    }
  }
  if (archive.readOnly) warnings.push('This project was written by a newer version and opens read-only');
  // M6a: the archive's verified mesh blobs become resident before the document loads (§5.20).
  for (const [, bytes] of archive.blobs) app.blobs.put(bytes);
  const missing = liveManifests(archive.snapshot).filter((manifest) => !app.blobs.has(manifest));
  if (missing.length > 0) warnings.push('Some mesh data is missing from this file; those meshes cannot be shown');
  return { snapshot: archive.snapshot, readOnly: archive.readOnly, migratedFrom: archive.migratedFrom, warnings };
}

/** Replaces the document with an opened project (origin 'load': clears undo and the editor history). */
export function loadProject(app: EditorApp, opened: OpenedProject): void {
  attachMeshes(app);
  resetDocumentSession(app);
  app.store.load(opened.snapshot, { readOnly: opened.readOnly });
  app.history.clear();
}
