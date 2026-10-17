// WP-4 stubs: final signatures (MVP-SPEC §7 WP-4; ADR 0011); bodies throw until project files land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord, DocSnapshot } from '@ekza-animator/doc';
import type { ProjectArchive } from '../types';

/** Deterministic zip. */
export function writeProjectArchive(
  _snapshot: DocSnapshot,
  _assets: ReadonlyMap<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }>,
  _app: { readonly version: string },
): Uint8Array {
  throw new EkzaError('not-implemented', 'io.writeProjectArchive');
}

export function writeProjectJson(_snapshot: DocSnapshot, _assets: readonly AssetRecord[]): string {
  throw new EkzaError('not-implemented', 'io.writeProjectJson');
}

/** Zip or JSON variant (assets empty). */
export function readProjectArchive(_bytes: Uint8Array): Promise<ProjectArchive> {
  throw new EkzaError('not-implemented', 'io.readProjectArchive');
}
