// Palette panel model (M6A-SPEC §5.19, §8.8; research 16 §14; B13): pure reads of the document and the session that
// the panel, the Outliner and the Attributes panel share — the mesh the panels act on, a palette's swatches in display
// order, the slots a mesh uses, the recent swatches.
import type { DocumentStore, MeshId, MeshRecord, PaletteId, PaletteRecord, SwatchRecord } from '@ekza-animator/doc';
import { DEFAULT_PALETTE_ID, type EditorApp, type SessionState } from '@ekza-animator/editor-core';

/** How many recent swatches the panel keeps (`prefs.modeling.paletteRecents`). */
export const MAX_RECENTS = 8;
/** Swatches per row (§8.8). */
export const SWATCHES_PER_ROW = 8;

const isMesh = (id: string): id is MeshId => id.startsWith('msh_');

/**
 * The mesh the Model panels act on: the lead (last) selected mesh object, else the first hilited mesh, else null.
 */
export function leadMeshId(state: SessionState): MeshId | null {
  const objects = state.selection.objects;
  for (let i = objects.length - 1; i >= 0; i--) {
    const id = objects[i] as string;
    if (isMesh(id)) return id;
  }
  return state.model.hilite[0] ?? null;
}

/** Every selected mesh object, else the hilited meshes (the targets of "Export colours as"). */
export function targetMeshIds(state: SessionState): readonly MeshId[] {
  const objects = state.selection.objects.filter(isMesh);
  return objects.length > 0 ? objects : state.model.hilite;
}

export const byOrder = (
  a: { readonly order: string; readonly id: string },
  b: { readonly order: string; readonly id: string },
): number => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The project's palettes in display order. */
export function palettesOf(store: DocumentStore): readonly PaletteRecord[] {
  return [...store.list('palettes')].sort(byOrder);
}

/** A palette's live swatches in display order. */
export function swatchesOf(store: DocumentStore, palette: PaletteId | null): readonly SwatchRecord[] {
  return palette === null ? [] : [...store.query.swatchesOfPalette(palette)].sort(byOrder);
}

/**
 * The palette the panel shows: the user's choice while it exists, else the lead mesh's palette, else the default
 * palette, else the first one, else null (no palette in the project).
 */
export function shownPalette(
  palettes: readonly PaletteRecord[],
  choice: PaletteId | null,
  mesh: MeshRecord | null,
): PaletteId | null {
  const exists = (id: PaletteId | null | undefined): id is PaletteId =>
    id !== null && id !== undefined && palettes.some((p) => p.id === id);
  if (exists(choice)) return choice;
  if (exists(mesh?.palette)) return mesh.palette;
  if (exists(DEFAULT_PALETTE_ID)) return DEFAULT_PALETTE_ID;
  return palettes[0]?.id ?? null;
}

/** The distinct slots a mesh's faces paint with (slot 0 for faces without the `paint` layer), or null without data. */
export function usedSlots(app: EditorApp, mesh: MeshId): ReadonlySet<number> | null {
  const data = app.meshes.get(mesh)?.data() ?? null;
  if (data === null) return null;
  const out = new Set<number>();
  const layer = data.layers.get('paint');
  if (layer === undefined) {
    if (data.counts.faces > 0) out.add(0);
    return out;
  }
  for (let f = 0; f < data.counts.faces; f++) out.add(layer.data[f] as number);
  return out;
}

/** "Used on mesh: 9 of 16": how many of the palette's live swatches the mesh uses. */
export function usageLine(used: ReadonlySet<number> | null, swatches: readonly SwatchRecord[]): string | null {
  if (used === null) return null;
  const count = swatches.filter((swatch) => used.has(swatch.slot)).length;
  return `Used on mesh: ${count} of ${swatches.length}`;
}

/** The recents list after `swatch` was used: most recent first, unique, at most `MAX_RECENTS`. */
export function pushRecent(recents: readonly string[], swatch: string): string[] {
  return [swatch, ...recents.filter((id) => id !== swatch)].slice(0, MAX_RECENTS);
}

/** The swatch shown in a cell (`#rrggbb` text colour that reads on it: dark on light swatches). */
export function contrastOn(srgb: readonly [number, number, number]): string {
  const luminance = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return luminance > 140 ? '#14151a' : '#ffffff';
}
