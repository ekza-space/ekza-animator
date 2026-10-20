// A deterministic PNG writer for 8-bit RGB images (M6A-SPEC §5.19 `ekza-palette-v1`): the signature, then exactly the
// chunks IHDR, sRGB (rendering intent 0), one IDAT (zlib by fflate at level 9, filter type 0 on every row) and IEND.
// No timestamps, no text chunks, fixed compression settings: the same pixels always give the same bytes.
import { EkzaError } from '@ekza-animator/anim-core';
import { zlibSync } from 'fflate';

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

let crcTable: Uint32Array | null = null;

/** CRC-32 (ISO 3309, the PNG chunk checksum) of `bytes`, optionally continuing `crc`. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = (crcTable[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encodes `rgb` (width × height × 3 bytes, rows top to bottom) as a PNG with an sRGB chunk. Throws
 * EkzaError('invalid-image') when the sizes disagree.
 */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new EkzaError('invalid-image', `A PNG needs a positive integer size, got ${width} × ${height}`);
  }
  if (rgb.length !== width * height * 3) {
    throw new EkzaError(
      'invalid-image',
      `${width} × ${height} RGB needs ${width * height * 3} bytes, got ${rgb.length}`,
    );
  }
  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour (RGB)
  // compression 0, filter method 0, interlace 0 (the remaining zero bytes)
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('sRGB', Uint8Array.of(0)),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
