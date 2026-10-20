// `ekza-palette-v1` (M6A-SPEC §5.19, research 12 §4.3): one cell of 8 × 8 px per live swatch, ranked by ascending
// slot, row-major from the top-left of a grid that is 64 × 64 px for ≤ 64 swatches (8 × 8 cells), 128 × 64 for ≤ 128
// (16 × 8) and 128 × 128 for ≤ 256 (16 × 16); unused cells black. Every corner of a painted face samples the centre of
// its cell, so the colour is exact at any distance.
import { EkzaError } from '@ekza-animator/anim-core';
import { encodePngRgb } from '../png/encode';
import type { PaletteTexture } from '../types';

export const PALETTE_CELL_PX = 8;
export const PALETTE_MAX_SWATCHES = 256;

/** Grid of the texture for `count` swatches. */
export function paletteGrid(count: number): { readonly cols: number; readonly rows: number } {
  if (count <= 64) return { cols: 8, rows: 8 };
  if (count <= 128) return { cols: 16, rows: 8 };
  return { cols: 16, rows: 16 };
}

/**
 * The palette texture of `swatches` (live ones; a slot listed twice keeps its first entry). More than 256 swatches
 * throw EkzaError('palette-too-large').
 */
export function writePaletteTexture(
  swatches: readonly { readonly slot: number; readonly srgb: readonly [number, number, number] }[],
): PaletteTexture {
  const bySlot = new Map<number, readonly [number, number, number]>();
  for (const swatch of swatches) {
    if (!Number.isInteger(swatch.slot) || swatch.slot < 0) {
      throw new EkzaError('invalid-record', `A swatch slot must be an integer ≥ 0, got ${swatch.slot}`);
    }
    if (!bySlot.has(swatch.slot)) bySlot.set(swatch.slot, swatch.srgb);
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  if (slots.length > PALETTE_MAX_SWATCHES) {
    throw new EkzaError(
      'palette-too-large',
      `A palette texture holds at most ${PALETTE_MAX_SWATCHES} swatches; this palette has ${slots.length}`,
    );
  }
  const { cols, rows } = paletteGrid(slots.length);
  const width = cols * PALETTE_CELL_PX;
  const height = rows * PALETTE_CELL_PX;
  const rgb = new Uint8Array(width * height * 3);
  const rank = new Map<number, number>();
  slots.forEach((slot, i) => {
    rank.set(slot, i);
    const colour = bySlot.get(slot) as readonly [number, number, number];
    const x0 = (i % cols) * PALETTE_CELL_PX;
    const y0 = Math.floor(i / cols) * PALETTE_CELL_PX;
    for (let y = y0; y < y0 + PALETTE_CELL_PX; y++) {
      for (let x = x0; x < x0 + PALETTE_CELL_PX; x++) {
        const o = (y * width + x) * 3;
        rgb[o] = clampByte(colour[0]);
        rgb[o + 1] = clampByte(colour[1]);
        rgb[o + 2] = clampByte(colour[2]);
      }
    }
  });
  const png = encodePngRgb(width, height, rgb);
  // A slot without a live swatch is exported with slot 0's colour (lint `palette.missing-swatch`), else the first.
  const fallback = rank.get(0) ?? 0;
  return {
    png,
    width,
    height,
    cols,
    rows,
    uvOf(slot: number): readonly [number, number] {
      const i = rank.get(slot) ?? fallback;
      return [((i % cols) + 0.5) / cols, (Math.floor(i / cols) + 0.5) / rows];
    },
  };
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}
