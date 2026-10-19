// Surgeon "replace primitives" and the in-memory display rebuild (M6A-SPEC §4.5, §5.22, §5.23): B0a stubs in the
// lazy `io/write` entry; B8 owns this file.
import { EkzaError } from '@ekza-animator/anim-core';
import type { GlbContainer, PrimitiveEdit } from '../types';

/** Appends accessors and re-points `meshes[i].primitives` of edited meshes only (§5.22); with `marker`, writes or
 *  extends `ekza_animator_bake_v2`. Untouched JSON values and the BIN prefix stay byte-identical. */
export function replacePrimitives(
  _source: Uint8Array,
  _edits: readonly PrimitiveEdit[],
  _opts: { readonly marker: boolean },
): Promise<Uint8Array> {
  return Promise.reject(new EkzaError('not-implemented', 'io.replacePrimitives'));
}

/** In-memory container for the display of edited characters (§5.23): replacePrimitives without a marker, parsed. */
export function rebuildContainer(_container: GlbContainer, _edits: readonly PrimitiveEdit[]): Promise<GlbContainer> {
  return Promise.reject(new EkzaError('not-implemented', 'io.rebuildContainer'));
}
