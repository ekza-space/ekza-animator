// Project files (ADR 0011): `.ekzanim` (zip: manifest, project.json, source models by SHA-256) and the
// `.ekzanim.json` debug variant. Saving reads every referenced asset through the verifying asset store; opening
// checks the assets, puts them into the asset store and replaces the document (never merges).
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord, DocSnapshot } from '@ekza-animator/doc';
import { readProjectArchive, writeProjectArchive, writeProjectJson } from '@ekza-animator/io';
import type { EditorApp } from '../types';
import { baseName } from './names';
import { EDITOR_VERSION } from './samples';
import { resetDocumentSession } from './session';

export const PROJECT_EXTENSION = 'ekzanim';
export const PROJECT_JSON_EXTENSION = 'ekzanim.json';
export const PROJECT_MIME = 'application/zip';
export const PROJECT_JSON_MIME = 'application/json';

export interface SaveArtifact {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** `name` reduced to a safe file name with the given extension (keeps an extension that is already there). */
export function projectFileName(name: string, extension: string): string {
  const stem = baseName(name.toLowerCase().endsWith(`.${extension}`) ? name.slice(0, -extension.length - 1) : name)
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .trim();
  return `${stem === '' ? 'Untitled' : stem}.${extension}`;
}

function assetRecords(snapshot: DocSnapshot): readonly AssetRecord[] {
  return Object.values(snapshot.tables.assets ?? {});
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
  const snapshot = app.store.snapshot();
  const assets = new Map<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }>();
  for (const record of assetRecords(snapshot)) {
    assets.set(record.id, { record, bytes: await app.services.assets.get(record.id) });
  }
  const bytes = writeProjectArchive(snapshot, assets, { version: EDITOR_VERSION });
  return { fileName: projectFileName(name, PROJECT_EXTENSION), bytes, mime: PROJECT_MIME };
}

/** The `.ekzanim.json` debug variant (document + asset descriptions, no bytes). */
export async function prepareProjectJson(app: EditorApp, name: string): Promise<SaveArtifact> {
  await openAllPartitions(app);
  const snapshot = app.store.snapshot();
  const text = writeProjectJson(snapshot, assetRecords(snapshot));
  return {
    fileName: projectFileName(name, PROJECT_JSON_EXTENSION),
    bytes: new TextEncoder().encode(text),
    mime: PROJECT_JSON_MIME,
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
  return { snapshot: archive.snapshot, readOnly: archive.readOnly, migratedFrom: archive.migratedFrom, warnings };
}

/** Replaces the document with an opened project (origin 'load': clears undo and the editor history). */
export function loadProject(app: EditorApp, opened: OpenedProject): void {
  resetDocumentSession(app);
  app.store.load(opened.snapshot, { readOnly: opened.readOnly });
  app.history.clear();
}
