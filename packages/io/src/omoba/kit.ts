// The OMOBA local test kit packer (AUTORIG-SPEC §5.6.4, AR-D24; D6) and the deterministic zip it and the VRMA bundle
// use (`fflate`, which io already owns; no new dependency). The kit holds `<slug>.glb` (the VRM bytes unchanged),
// `<slug>.png` (the thumbnail, when there is one; `.jpg` for an imported VRM's JPEG), `manifest-entry.json` (OMOBA's field names) and `README.txt`.
// Identical input gives identical bytes: every entry has the DOS epoch as its time, no OS attributes, a fixed order.
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { type OmobaKitMeta, omobaManifestEntry, omobaManifestJson } from './manifest';
import { omobaKitReadme } from './readme';

/** DOS timestamps start in 1980; every entry gets this one (as the project archive does). */
const ZIP_TIME = new Date(1980, 0, 1, 0, 0, 0);

/** One file of a zip: its path inside the archive, its bytes and whether to deflate it. */
export interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
  /** Deflate (default true); already-compressed data (PNG) is stored. */
  readonly deflate?: boolean;
}

/** A deterministic zip of the entries in their order (paths must be distinct). */
export function zipFiles(entries: readonly ZipEntry[]): Uint8Array {
  const files: Zippable = {};
  for (const entry of entries) {
    if (entry.path in files) throw new Error(`Duplicate zip entry ${entry.path}`);
    files[entry.path] = [entry.bytes, { level: entry.deflate === false ? 0 : 6 }];
  }
  return zipSync(files, { mtime: ZIP_TIME, os: 0, attrs: 0 });
}

/** The files of a zip by path, in archive order (reads a kit or a VRMA bundle back; tests and tools). */
export function unzipFiles(bytes: Uint8Array): Readonly<Record<string, Uint8Array>> {
  return unzipSync(bytes);
}

export interface OmobaKitInput {
  /** The exported VRM 1.0 bytes (the Ekza avatar target's file). */
  readonly vrm: Uint8Array;
  /** The thumbnail (a PNG, or a JPEG with `meta.thumbnailExtension: 'jpg'`), or null (the entry's `thumbnail` is then null). */
  readonly thumbnail: Uint8Array | null;
  readonly meta: OmobaKitMeta;
}

/** The kit's file names for a meta. */
export function omobaKitFiles(meta: OmobaKitMeta, hasThumbnail: boolean): readonly string[] {
  const entry = omobaManifestEntry(meta, hasThumbnail);
  return [
    `${entry.slug}.glb`,
    ...(entry.thumbnail === null ? [] : [entry.thumbnail]),
    'manifest-entry.json',
    'README.txt',
  ];
}

/** The zip name of a kit: `<slug>-omoba-kit.zip`. */
export function omobaKitFileName(meta: OmobaKitMeta): string {
  return `${omobaManifestEntry(meta, false).slug}-omoba-kit.zip`;
}

/** Packs the OMOBA local test kit (§5.6.4). The VRM bytes go in unchanged. */
export function packOmobaKit(input: OmobaKitInput): Uint8Array {
  const entry = omobaManifestEntry(input.meta, input.thumbnail !== null);
  const text = new TextEncoder();
  return zipFiles([
    { path: `${entry.slug}.glb`, bytes: input.vrm },
    ...(input.thumbnail === null || entry.thumbnail === null
      ? []
      : [{ path: entry.thumbnail, bytes: input.thumbnail, deflate: false }]),
    { path: 'manifest-entry.json', bytes: text.encode(omobaManifestJson(entry)) },
    { path: 'README.txt', bytes: text.encode(omobaKitReadme(entry)) },
  ]);
}
