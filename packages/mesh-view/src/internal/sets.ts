// Content comparisons and copies of the inputs the views and the picker keep (M6A-B6-19, M6A-B6-25): a caller may
// mutate a selection, hidden set or isolate set in place and pass the same object again (the §4.6 selection service
// does not promise fresh objects), and the document hands out a fresh palette map on every query, so identity says
// nothing either way. Each holder keeps its own copy and compares contents.
import type { BitSet, HiddenSet } from '@ekza-animator/mesh-core';
import type { Topo } from './topo';

/** Palette colours: slot → sRGB bytes. */
export type PaletteColours = ReadonlyMap<number, readonly [number, number, number]>;

/** Same size and the same bits (null only equals null). */
export function sameSet(a: BitSet | null, b: BitSet | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.size !== b.size) return false;
  const x = a.words;
  const y = b.words;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** A hidden set that hides nothing (null or every set empty). */
export function hidesNothing(h: HiddenSet | null): boolean {
  return h === null || (h.verts.isEmpty() && h.edges.isEmpty() && h.faces.isEmpty());
}

/** Same hidden elements; null and an empty set are the same. */
export function sameHidden(a: HiddenSet | null, b: HiddenSet | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return hidesNothing(a) && hidesNothing(b);
  return sameSet(a.verts, b.verts) && sameSet(a.edges, b.edges) && sameSet(a.faces, b.faces);
}

export function copyHidden(h: HiddenSet | null): HiddenSet | null {
  return h === null ? null : { verts: h.verts.clone(), edges: h.edges.clone(), faces: h.faces.clone() };
}

/** A hidden set of this topology: each of its sets is empty or sized to the element count (M6A-B6-19). */
export function hiddenFits(t: Topo, h: HiddenSet): boolean {
  const fit = (set: BitSet, count: number): boolean => set.size === count || set.isEmpty();
  return fit(h.verts, t.points) && fit(h.edges, t.edges) && fit(h.faces, t.faces);
}

export function samePalette(a: PaletteColours | null, b: PaletteColours | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.size !== b.size) return false;
  for (const [slot, c] of a) {
    const d = b.get(slot);
    if (d === undefined || d[0] !== c[0] || d[1] !== c[1] || d[2] !== c[2]) return false;
  }
  return true;
}

export function copyPalette(colours: PaletteColours | null): Map<number, readonly [number, number, number]> | null {
  if (colours === null) return null;
  const out = new Map<number, readonly [number, number, number]>();
  for (const [slot, c] of colours) out.set(slot, [c[0], c[1], c[2]]);
  return out;
}
