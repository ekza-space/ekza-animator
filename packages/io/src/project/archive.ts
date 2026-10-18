// `.ekzanim` project files (ADR 0011): a deterministic ZIP (fflate) with manifest.json, project.json (the doc's
// serializeSnapshot output: sorted keys, no timestamps) and the source models under assets/<sha256>.<ext>, plus the
// plain JSON debug variant `*.ekzanim.json` (snapshot + asset entries without bytes). Opening verifies every asset's
// size and SHA-256 and migrates the snapshot; a newer minWriterVersion opens read-only.
import { EkzaError } from '@ekza-animator/anim-core';
import {
  type AssetId,
  type AssetRecord,
  type DocSnapshot,
  migrateSnapshot,
  parseSnapshot,
  SCHEMA_VERSION,
  serializeSnapshot,
} from '@ekza-animator/doc';
import { type UnzipFileInfo, unzipSync, zipSync, type Zippable } from 'fflate';
import { canonicalJson } from '../gltf/json';
import { isIndex, isRecord, type JsonRecord, textOf, unknownList } from '../gltf/schema';
import { sha256Hex } from '../hash/sha256';
import { DEFAULT_INPUT_BUDGET, type ProjectArchive } from '../types';

export const PROJECT_FORMAT = 'ekza-animator-project';
export const SNAPSHOT_FORMAT = 'ekza-animator-doc';
export const APP_NAME = 'Ekza Animator';

/** Upper bounds while unzipping untrusted projects (checked against the declared sizes before inflating). */
export const PROJECT_LIMITS = {
  maxManifestBytes: 1_048_576,
  maxProjectJsonBytes: 67_108_864,
  maxAssetBytes: DEFAULT_INPUT_BUDGET.maxFileBytes,
  maxTotalBytes: 1_073_741_824,
} as const;

/** DOS timestamps start in 1980; every entry gets this one, so identical input gives identical bytes. */
const ZIP_TIME = new Date(1980, 0, 1, 0, 0, 0);

export interface ProjectManifestAsset {
  readonly sha256: string;
  readonly size: number;
  readonly mime: AssetRecord['mime'];
  readonly ext: AssetRecord['ext'];
  readonly path: string;
}

export interface ProjectManifest {
  readonly format: typeof PROJECT_FORMAT;
  readonly schemaVersion: number;
  readonly minWriterVersion: number;
  readonly app: { readonly name: string; readonly version: string };
  readonly assets: readonly ProjectManifestAsset[];
}

type AssetEntry = { readonly record: AssetRecord; readonly bytes: Uint8Array };

/** Deterministic `.ekzanim` zip. Throws EkzaError('asset-corrupt') when an asset's id or size does not match. */
export function writeProjectArchive(
  snapshot: DocSnapshot,
  assets: ReadonlyMap<AssetId, AssetEntry>,
  app: { readonly version: string },
): Uint8Array {
  return zipProject(serializeSnapshot(snapshot), snapshot, assets, app);
}

/** The container part of `writeProjectArchive`, given the serialized snapshot. */
export function zipProject(
  projectJson: string,
  snapshot: Pick<DocSnapshot, 'schemaVersion' | 'minWriterVersion'>,
  assets: ReadonlyMap<AssetId, AssetEntry>,
  app: { readonly version: string },
): Uint8Array {
  const entries = [...assets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const manifestAssets: ProjectManifestAsset[] = entries.map(([id, { record, bytes }]) => {
    // The asset store verified the hash when it handed out the bytes; a cheap consistency check suffices here.
    if (record.id !== id || bytes.byteLength !== record.size) {
      throw new EkzaError('asset-corrupt', `Asset ${id} (${record.name}) does not match its bytes`, { asset: id });
    }
    return { sha256: id, size: record.size, mime: record.mime, ext: record.ext, path: assetPath(id, record.ext) };
  });
  const manifest: ProjectManifest = {
    format: PROJECT_FORMAT,
    schemaVersion: snapshot.schemaVersion,
    minWriterVersion: snapshot.minWriterVersion,
    app: { name: APP_NAME, version: app.version },
    assets: manifestAssets,
  };
  const encoder = new TextEncoder();
  const files: Zippable = {
    'manifest.json': [encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`), { level: 6 }],
    'project.json': [encoder.encode(projectJson), { level: 6 }],
  };
  // Models are already compressed (or large): store them.
  entries.forEach(([, { bytes }], i) => {
    files[(manifestAssets[i] as ProjectManifestAsset).path] = [bytes, { level: 0 }];
  });
  return zipSync(files, { mtime: ZIP_TIME, os: 0, attrs: 0 });
}

/** The `*.ekzanim.json` debug variant: the snapshot plus asset entries without bytes, sorted keys, 2-space indent. */
export function writeProjectJson(snapshot: DocSnapshot, assets: readonly AssetRecord[]): string {
  const parsed = parseSnapshot(serializeSnapshot(snapshot));
  return projectJsonText(parsed, assets);
}

export function projectJsonText(snapshot: unknown, assets: readonly AssetRecord[]): string {
  const entries = [...assets]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((a) => ({ sha256: a.id, size: a.size, mime: a.mime, ext: a.ext, name: a.name }));
  return `${canonicalJson({ ...(isRecord(snapshot) ? snapshot : {}), assets: entries }, 2)}\n`;
}

/** Opens a `.ekzanim` zip or a `.ekzanim.json` debug file (whose assets come back empty). */
export async function readProjectArchive(bytes: Uint8Array): Promise<ProjectArchive> {
  const opened = await openProject(bytes);
  const parsed = parseSnapshot(opened.projectText);
  // The debug variant carries asset entries next to the snapshot fields.
  const raw = opened.kind === 'json' && isRecord(parsed) ? withoutAssets(parsed) : parsed;
  if (!isRecord(raw) || raw['format'] !== SNAPSHOT_FORMAT) {
    throw new EkzaError('unsupported', 'project.json is not an Ekza Animator document snapshot');
  }
  const migrated = migrateSnapshot(raw);
  const records: Readonly<Record<string, AssetRecord>> = migrated.snapshot.tables.assets ?? {};
  const assets = new Map<AssetId, AssetEntry>();
  for (const asset of opened.assets) {
    // An asset the snapshot does not describe still opens, with a record derived from the manifest.
    const record: AssetRecord = records[asset.sha256] ?? {
      id: asset.sha256 as AssetId,
      name: asset.path.slice(asset.path.lastIndexOf('/') + 1),
      ext: asset.ext,
      mime: asset.mime,
      size: asset.size,
      role: asset.ext === 'vrma' ? 'animation-source' : 'model',
      provenance: null,
    };
    assets.set(asset.sha256 as AssetId, { record, bytes: asset.bytes });
  }
  return {
    snapshot: migrated.snapshot,
    assets,
    readOnly: migrated.readOnly || (opened.manifest?.minWriterVersion ?? 0) > SCHEMA_VERSION,
    migratedFrom: migrated.migratedFrom,
  };
}

export interface OpenedProject {
  readonly kind: 'zip' | 'json';
  /** project.json (zip) or the whole debug file (json), for the doc's parseSnapshot. */
  readonly projectText: string;
  readonly manifest: ProjectManifest | null;
  readonly assets: readonly (ProjectManifestAsset & { readonly bytes: Uint8Array })[];
}

/** The container part of `readProjectArchive`: unzip, check the manifest and verify every asset. */
export async function openProject(bytes: Uint8Array): Promise<OpenedProject> {
  if (isZip(bytes)) return openZip(bytes);
  if (looksLikeJson(bytes)) return openJson(bytes);
  throw new EkzaError('unsupported', 'Not an Ekza Animator project (.ekzanim or .ekzanim.json)');
}

async function openZip(bytes: Uint8Array): Promise<OpenedProject> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file: UnzipFileInfo) => {
        const limit =
          file.name === 'manifest.json'
            ? PROJECT_LIMITS.maxManifestBytes
            : file.name === 'project.json'
              ? PROJECT_LIMITS.maxProjectJsonBytes
              : file.name.startsWith('assets/')
                ? PROJECT_LIMITS.maxAssetBytes
                : 0;
        if (limit === 0) return false; // unknown entries are ignored, never inflated
        total += file.originalSize;
        if (file.originalSize > limit || total > PROJECT_LIMITS.maxTotalBytes) {
          throw new EkzaError(
            'budget-exceeded',
            `Project entry ${file.name} is too large (${file.originalSize} bytes)`,
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof EkzaError) throw error;
    throw new EkzaError('unsupported', `The project archive is not a valid zip: ${(error as Error).message}`);
  }
  const manifestBytes = files['manifest.json'];
  const projectBytes = files['project.json'];
  if (manifestBytes === undefined || projectBytes === undefined) {
    throw new EkzaError(
      'unsupported',
      'The archive has no manifest.json or project.json (not an Ekza Animator project)',
    );
  }
  const manifest = readManifest(parseJson(manifestBytes, 'manifest.json'));
  const assets = await Promise.all(
    manifest.assets.map(async (asset) => {
      const data = files[asset.path];
      if (data === undefined) {
        throw new EkzaError('asset-missing', `Asset ${asset.sha256} (${asset.path}) is missing from the project`, {
          asset: asset.sha256,
        });
      }
      if (data.byteLength !== asset.size || (await sha256Hex(data)) !== asset.sha256) {
        throw new EkzaError('asset-corrupt', `Asset ${asset.sha256} (${asset.path}) does not match its hash or size`, {
          asset: asset.sha256,
        });
      }
      return { ...asset, bytes: data };
    }),
  );
  return { kind: 'zip', projectText: decodeUtf8(projectBytes, 'project.json'), manifest, assets };
}

function openJson(bytes: Uint8Array): OpenedProject {
  return { kind: 'json', projectText: decodeUtf8(bytes, 'project'), manifest: null, assets: [] };
}

function withoutAssets(raw: JsonRecord): JsonRecord {
  const { assets: _assets, ...snapshot } = raw;
  return snapshot;
}

function readManifest(value: unknown): ProjectManifest {
  if (!isRecord(value) || value['format'] !== PROJECT_FORMAT) {
    throw new EkzaError('unsupported', 'manifest.json is not an Ekza Animator project manifest');
  }
  const app = isRecord(value['app']) ? value['app'] : {};
  const assets = unknownList(value['assets']).map((entry): ProjectManifestAsset => {
    const asset: JsonRecord = isRecord(entry) ? entry : {};
    const sha256 = textOf(asset['sha256']).toLowerCase();
    const ext = asset['ext'];
    if (
      !/^[0-9a-f]{64}$/.test(sha256) ||
      !isIndex(asset['size']) ||
      (ext !== 'glb' && ext !== 'vrm' && ext !== 'vrma')
    ) {
      throw new EkzaError('unsupported', 'manifest.json lists an invalid asset entry');
    }
    return { sha256, size: asset['size'], mime: 'model/gltf-binary', ext, path: assetPath(sha256, ext) };
  });
  return {
    format: PROJECT_FORMAT,
    schemaVersion: isIndex(value['schemaVersion']) ? value['schemaVersion'] : 0,
    minWriterVersion: isIndex(value['minWriterVersion']) ? value['minWriterVersion'] : 0,
    app: { name: textOf(app['name']), version: textOf(app['version']) },
    assets,
  };
}

function assetPath(sha256: string, ext: string): string {
  return `assets/${sha256}.${ext}`;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new EkzaError('unsupported', `${label} is not UTF-8 text`);
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes, label)) as unknown;
  } catch (error) {
    if (error instanceof EkzaError) throw error;
    throw new EkzaError('unsupported', `${label} is not valid JSON: ${(error as Error).message}`);
  }
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function looksLikeJson(bytes: Uint8Array): boolean {
  for (const byte of bytes.subarray(0, 64)) {
    if (
      byte === 0x20 ||
      byte === 0x0a ||
      byte === 0x0d ||
      byte === 0x09 ||
      byte === 0xef ||
      byte === 0xbb ||
      byte === 0xbf
    )
      continue;
    return byte === 0x7b; // '{'
  }
  return false;
}
