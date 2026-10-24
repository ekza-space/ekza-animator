// A PNG reader for the AI intake (MODELING-PLAN §7.2 G-a): base colour textures become RGBA8 pixels for the palette
// bake and the texture downsize, the same bytes in Node and in every browser (the browser's own decoder is used only
// for formats this reader does not take: JPEG, WebP). Reads colour types 0, 2, 3, 4 and 6 at bit depths 1–16 (16-bit
// samples keep their high byte; tRNS gives palette and key-colour transparency), non-interlaced; Adam7 interlacing and
// damaged files throw EkzaError('invalid-image').
import { EkzaError } from '@ekza-studio/anim-core';
import { unzlibSync } from 'fflate';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Decoded size limit (64 Mpx: 16,384 × 4,096), far above the io input budget's textures. */
const MAX_PIXELS = 64 * 1024 * 1024;

const bad = (reason: string): EkzaError => new EkzaError('invalid-image', `PNG: ${reason}`);

/** Decoded pixels: straight RGBA, 8 bits per channel, rows top to bottom. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** True when the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodes a PNG to RGBA8 (see the module comment). */
export function decodePng(bytes: Uint8Array): DecodedImage {
  if (!isPng(bytes)) throw bad('not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    if (start + length + 4 > bytes.length) throw bad(`chunk ${name} runs past the end`);
    const data = bytes.subarray(start, start + length);
    if (name === 'IHDR') {
      if (length !== 13) throw bad('bad IHDR');
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      depth = data[8] as number;
      type = data[9] as number;
      if (data[12] !== 0) throw bad('interlaced images are not supported');
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    offset = start + length + 4;
  }
  if (width < 1 || height < 1 || width * height > MAX_PIXELS) throw bad(`unsupported size ${width} × ${height}`);
  const channels = type === 0 ? 1 : type === 2 ? 3 : type === 3 ? 1 : type === 4 ? 2 : type === 6 ? 4 : 0;
  if (channels === 0) throw bad(`unknown colour type ${type}`);
  if (![1, 2, 4, 8, 16].includes(depth) || (depth < 8 && type !== 0 && type !== 3) || (depth === 16 && type === 3)) {
    throw bad(`unsupported bit depth ${depth} for colour type ${type}`);
  }
  if (type === 3 && palette === null) throw bad('palette image without PLTE');
  const total = idat.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(total);
  let o = 0;
  for (const part of idat) {
    compressed.set(part, o);
    o += part.length;
  }
  let raw: Uint8Array;
  try {
    raw = unzlibSync(compressed);
  } catch (error) {
    throw bad(`damaged image data (${error instanceof Error ? error.message : String(error)})`);
  }
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw bad('image data is short');
  // Unfilter in place into `lines`.
  const lines = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x] as number;
      const left = x >= bpp ? (lines[dst + x - bpp] as number) : 0;
      const up = y > 0 ? (lines[dst - stride + x] as number) : 0;
      const corner = y > 0 && x >= bpp ? (lines[dst - stride + x - bpp] as number) : 0;
      let out: number;
      if (filter === 0) out = value;
      else if (filter === 1) out = value + left;
      else if (filter === 2) out = value + up;
      else if (filter === 3) out = value + ((left + up) >> 1);
      else if (filter === 4) out = value + paeth(left, up, corner);
      else throw bad(`unknown filter ${filter}`);
      lines[dst + x] = out & 0xff;
    }
  }
  const rgba = new Uint8Array(4 * width * height);
  const sample = (line: number, index: number): number => {
    // The index-th sample of a line, scaled to 8 bits (16-bit: the high byte; < 8 bits: replicated).
    if (depth === 8) return lines[line * stride + index] as number;
    if (depth === 16) return lines[line * stride + 2 * index] as number;
    const bit = index * depth;
    const byte = lines[line * stride + (bit >> 3)] as number;
    const value = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };
  const keyGrey =
    type === 0 && trns !== null && trns.length >= 2 ? ((trns[0] as number) << 8) | (trns[1] as number) : -1;
  const keyRgb =
    type === 2 && trns !== null && trns.length >= 6
      ? [0, 2, 4].map((i) => ((trns[i] as number) << 8) | (trns[i + 1] as number))
      : null;
  const raw16 = (line: number, index: number): number =>
    depth === 16
      ? ((lines[line * stride + 2 * index] as number) << 8) | (lines[line * stride + 2 * index + 1] as number)
      : sample(line, index);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = 4 * (y * width + x);
      if (type === 0) {
        const g = sample(y, x);
        rgba[p] = g;
        rgba[p + 1] = g;
        rgba[p + 2] = g;
        rgba[p + 3] = keyGrey !== -1 && raw16(y, x) === keyGrey ? 0 : 255;
      } else if (type === 2) {
        rgba[p] = sample(y, 3 * x);
        rgba[p + 1] = sample(y, 3 * x + 1);
        rgba[p + 2] = sample(y, 3 * x + 2);
        rgba[p + 3] =
          keyRgb !== null &&
          raw16(y, 3 * x) === keyRgb[0] &&
          raw16(y, 3 * x + 1) === keyRgb[1] &&
          raw16(y, 3 * x + 2) === keyRgb[2]
            ? 0
            : 255;
      } else if (type === 3) {
        const index = sample(y, x);
        const pal = palette as Uint8Array;
        if (3 * index + 2 >= pal.length) throw bad('palette index out of range');
        rgba[p] = pal[3 * index] as number;
        rgba[p + 1] = pal[3 * index + 1] as number;
        rgba[p + 2] = pal[3 * index + 2] as number;
        rgba[p + 3] = trns !== null && index < trns.length ? (trns[index] as number) : 255;
      } else if (type === 4) {
        const g = sample(y, 2 * x);
        rgba[p] = g;
        rgba[p + 1] = g;
        rgba[p + 2] = g;
        rgba[p + 3] = sample(y, 2 * x + 1);
      } else {
        rgba[p] = sample(y, 4 * x);
        rgba[p + 1] = sample(y, 4 * x + 1);
        rgba[p + 2] = sample(y, 4 * x + 2);
        rgba[p + 3] = sample(y, 4 * x + 3);
      }
    }
  }
  return { width, height, rgba };
}
