// A double of the shipped M2a `.ekzanim` reader (v0.2.0, `io/src/project/archive.ts` at the M2a release), kept to
// check M6A-SPEC §4.2/§5.20: an M2a app opens a project with meshes and reference images **read-only**, accepts only
// glb/vrm/vrma under the manifest key `assets`, and never inflates `images/` or `blobs/` entries. The container code
// is copied verbatim; the document part keeps M2a's rule (schema 2: a newer `minWriterVersion` opens read-only).
// It also reports the entries it inflated, so a test can tell that unknown entries were never read.
import { EkzaError, sha256Hex } from '@ekza-animator/anim-core';
import { parseSnapshot } from '@ekza-animator/doc';
import { type UnzipFileInfo, unzipSync } from 'fflate';

/** The M2a app's core format version. */
export const M2A_SCHEMA_VERSION = 2;

const PROJECT_FORMAT = 'ekza-animator-project';
const SNAPSHOT_FORMAT = 'ekza-animator-doc';
const PROJECT_LIMITS = {
  maxManifestBytes: 1_048_576,
  maxProjectJsonBytes: 67_108_864,
  maxAssetBytes: 268_435_456,
  maxTotalBytes: 1_073_741_824,
} as const;

interface M2aManifestAsset {
  readonly sha256: string;
  readonly size: number;
  readonly ext: 'glb' | 'vrm' | 'vrma';
  readonly path: string;
}

export interface M2aOpened {
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly assets: ReadonlyMap<string, Uint8Array>;
  readonly readOnly: boolean;
  /** Entry names the reader inflated. */
  readonly inflated: readonly string[];
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function readProjectArchiveM2a(bytes: Uint8Array): Promise<M2aOpened> {
  let total = 0;
  const inflated: string[] = [];
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
        inflated.push(file.name);
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
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown;
  if (!isRecord(manifest) || manifest['format'] !== PROJECT_FORMAT) {
    throw new EkzaError('unsupported', 'manifest.json is not an Ekza Animator project manifest');
  }
  const list = Array.isArray(manifest['assets']) ? (manifest['assets'] as unknown[]) : [];
  const entries = list.map((entry): M2aManifestAsset => {
    const asset = isRecord(entry) ? entry : {};
    const sha256 = typeof asset['sha256'] === 'string' ? asset['sha256'].toLowerCase() : '';
    const ext = asset['ext'];
    const size = asset['size'];
    if (
      !/^[0-9a-f]{64}$/.test(sha256) ||
      typeof size !== 'number' ||
      !Number.isInteger(size) ||
      size < 0 ||
      (ext !== 'glb' && ext !== 'vrm' && ext !== 'vrma')
    ) {
      throw new EkzaError('unsupported', 'manifest.json lists an invalid asset entry');
    }
    return { sha256, size, ext, path: `assets/${sha256}.${ext}` };
  });
  const assets = new Map<string, Uint8Array>();
  for (const asset of entries) {
    const data = files[asset.path];
    if (data === undefined) throw new EkzaError('asset-missing', `Asset ${asset.sha256} is missing from the project`);
    if (data.byteLength !== asset.size || sha256Hex(data) !== asset.sha256) {
      throw new EkzaError('asset-corrupt', `Asset ${asset.sha256} does not match its hash or size`);
    }
    assets.set(asset.sha256, data);
  }
  const snapshot = parseSnapshot(new TextDecoder().decode(projectBytes));
  if (!isRecord(snapshot) || snapshot['format'] !== SNAPSHOT_FORMAT) {
    throw new EkzaError('unsupported', 'project.json is not an Ekza Animator document snapshot');
  }
  const minWriter = typeof manifest['minWriterVersion'] === 'number' ? manifest['minWriterVersion'] : 0;
  const snapshotMin = typeof snapshot['minWriterVersion'] === 'number' ? snapshot['minWriterVersion'] : 0;
  return {
    snapshot,
    assets,
    readOnly: minWriter > M2A_SCHEMA_VERSION || snapshotMin > M2A_SCHEMA_VERSION,
    inflated,
  };
}
