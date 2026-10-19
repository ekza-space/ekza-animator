// M6A-SPEC §5.19 `ekza-palette-v1` (B8): grid sizes, cell ranks by slot, unused cells black, exactly IHDR/sRGB/IDAT/
// IEND with valid CRCs, deterministic bytes, cell-centre UVs and the 256-swatch limit.
import { describe, expect, it } from 'vitest';
import { writePaletteTexture } from '../src/mesh';
import { crc32 } from '../src/png/encode';
import { readPngRgb } from './helpers/mesh';

const swatches = (n: number, start = 0) =>
  Array.from({ length: n }, (_, i) => ({
    slot: start + i * 2,
    srgb: [(i * 37) % 256, (i * 91) % 256, (i * 13 + 7) % 256] as [number, number, number],
  }));

function cell(png: { readonly width: number; readonly rgb: Uint8Array }, col: number, row: number) {
  const pixels = new Set<string>();
  for (let y = row * 8; y < row * 8 + 8; y++) {
    for (let x = col * 8; x < col * 8 + 8; x++) {
      const o = (y * png.width + x) * 3;
      pixels.add(`${png.rgb[o]},${png.rgb[o + 1]},${png.rgb[o + 2]}`);
    }
  }
  return [...pixels];
}

describe('writePaletteTexture', () => {
  it('64 × 64 for ≤ 64 swatches: cells ranked by ascending slot, row-major, unused cells black', () => {
    const list = swatches(10);
    const texture = writePaletteTexture([...list].reverse());
    expect([texture.width, texture.height, texture.cols, texture.rows]).toEqual([64, 64, 8, 8]);
    const png = readPngRgb(texture.png);
    expect(png.chunks).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND']);
    expect([png.width, png.height]).toEqual([64, 64]);
    list.forEach((swatch, i) => {
      expect(cell(png, i % 8, Math.floor(i / 8))).toEqual([swatch.srgb.join(',')]);
      expect(texture.uvOf(swatch.slot)).toEqual([((i % 8) + 0.5) / 8, (Math.floor(i / 8) + 0.5) / 8]);
    });
    expect(cell(png, 7, 7)).toEqual(['0,0,0']);
  });

  it('grows to 128 × 64 (≤ 128) and 128 × 128 (≤ 256) and refuses more', () => {
    expect([writePaletteTexture(swatches(64)).width, writePaletteTexture(swatches(64)).height]).toEqual([64, 64]);
    const t128 = writePaletteTexture(swatches(65));
    expect([t128.width, t128.height, t128.cols, t128.rows]).toEqual([128, 64, 16, 8]);
    expect(t128.uvOf(2 * 64)).toEqual([0.5 / 16, 4.5 / 8]);
    const t256 = writePaletteTexture(swatches(256));
    expect([t256.width, t256.height, t256.cols, t256.rows]).toEqual([128, 128, 16, 16]);
    expect(() => writePaletteTexture(swatches(257))).toThrow(/at most 256 swatches/);
  });

  it('writes deterministic bytes with valid chunk CRCs and sRGB intent 0', () => {
    const a = writePaletteTexture(swatches(16)).png;
    const b = writePaletteTexture(swatches(16)).png;
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    const dv = new DataView(a.buffer, a.byteOffset, a.byteLength);
    expect([...a.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    let offset = 8;
    const chunks = new Map<string, Uint8Array>();
    while (offset < a.length) {
      const length = dv.getUint32(offset);
      expect(dv.getUint32(offset + 8 + length)).toBe(crc32(a.subarray(offset + 4, offset + 8 + length)));
      chunks.set(
        String.fromCharCode(...a.subarray(offset + 4, offset + 8)),
        a.subarray(offset + 8, offset + 8 + length),
      );
      offset += 12 + length;
    }
    expect([...(chunks.get('sRGB') ?? [])]).toEqual([0]);
    // width 64, height 64, bit depth 8, colour type 2 (RGB), compression, filter and interlace 0
    expect([...(chunks.get('IHDR') ?? [])]).toEqual([0, 0, 0, 64, 0, 0, 0, 64, 8, 2, 0, 0, 0]);
  });

  it('maps a slot without a live swatch to slot 0, and keeps the first entry of a repeated slot', () => {
    const texture = writePaletteTexture([
      { slot: 3, srgb: [1, 2, 3] },
      { slot: 0, srgb: [9, 9, 9] },
      { slot: 3, srgb: [200, 200, 200] },
    ]);
    expect(texture.uvOf(42)).toEqual(texture.uvOf(0));
    const png = readPngRgb(texture.png);
    expect(cell(png, 1, 0)).toEqual(['1,2,3']);
  });
});
