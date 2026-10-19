// The editor-side painting rules of §5.19 that the kernel cannot see (B13): painting is refused on asset-backed
// (made-editable) meshes in M6a, and with a swatch that is not in the mesh's palette (the Palette panel can show and
// activate another palette's swatch: its slot would paint another colour there, or a slot the palette lacks). Only the
// lazy Paint Colour tool, Palette panel and operator bodies import this module (no operator definition does), so it
// stays out of the eager route (§5.27).
import type { MeshId, SwatchRecord } from '@ekza-animator/doc';
import type { EditorApp } from '../../types';

/** Null when every mesh may be painted (with `swatch`: by that swatch), else the reason. */
export function paintRefusal(app: EditorApp, meshes: readonly MeshId[], swatch?: SwatchRecord | null): string | null {
  for (const id of meshes) {
    const record = app.store.get('meshes', id);
    if (record !== undefined && record.source !== null) return 'Painting imported meshes arrives later';
  }
  return swatch === undefined || swatch === null ? null : swatchMismatch(app, meshes, swatch);
}

/** The reason `swatch` cannot paint one of `meshes` (not in its palette), or null. */
export function swatchMismatch(app: EditorApp, meshes: readonly MeshId[], swatch: SwatchRecord): string | null {
  for (const id of meshes) {
    const record = app.store.get('meshes', id);
    if (record === undefined || record.palette === swatch.palette) continue;
    const palette = app.store.get('palettes', swatch.palette)?.name ?? 'its palette';
    return `The active swatch is not in ${record.name}'s palette: assign ${palette} first`;
  }
  return null;
}
