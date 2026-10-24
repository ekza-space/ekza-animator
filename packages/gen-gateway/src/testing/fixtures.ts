// Deterministic test inputs made in code (no provider output in the repository, research 15 §8): a small valid GLB,
// PNG/JPEG/WebP images with and without EXIF/XMP, and Tripo webhook signatures.
import { deflateSync } from 'node:zlib';
import { hmacSha256Hex } from '../adapters/common.ts';

const pad4 = (n: number): number => (n + 3) & ~3;

/** A unit cube GLB (8 vertices, 12 triangles), scaled by `size` so different calls give different bytes. */
export function makeCubeGlb(opts?: { readonly size?: number; readonly generator?: string }): Uint8Array {
  const s = (opts?.size ?? 1) / 2;
  const pos = new Float32Array([-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, s, -s, 2 * s, -s, s, 2 * s, -s, s, 2 * s, s, -s, 2 * s, s]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  const bin = new Uint8Array(pos.byteLength + idx.byteLength);
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = {
    asset: { version: '2.0', generator: opts?.generator ?? 'ekza-gen-mock' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Cube' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-s, 0, -s], max: [s, 2 * s, s] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.length);
  const binLen = pad4(bin.length);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  dv.setUint32(20 + jsonLen, binLen, true);
  dv.setUint32(24 + jsonLen, 0x004e4942, true);
  out.set(bin, 28 + jsonLen);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** A solid-colour RGB PNG; `metadata` adds an eXIf chunk or an XMP iTXt chunk. */
export function makePng(width = 64, height = 64, metadata?: 'exif' | 'xmp'): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set([200, 120, 40], y * (width * 3 + 1) + 1 + x * 3);
  const extra =
    metadata === 'exif'
      ? [pngChunk('eXIf', new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]))]
      : metadata === 'xmp'
        ? [pngChunk('iTXt', new TextEncoder().encode('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>'))]
        : [];
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...extra,
    pngChunk('IDAT', new Uint8Array(deflateSync(raw))),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/** A JPEG skeleton (SOI, optional APP1 Exif, SOF0 with the size, EOI) — enough for type, size and metadata checks. */
export function makeJpegHeader(width = 64, height = 64, exif = false): Uint8Array {
  const app1 = exif ? [0xff, 0xe1, 0, 16, ...new TextEncoder().encode('Exif\0\0'), 0x4d, 0x4d, 0, 42, 0, 0, 0, 8] : [];
  const sof = [0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9]);
}

/** A WebP VP8X container; `metadata` sets the EXIF flag and adds an EXIF chunk. */
export function makeWebpHeader(width = 64, height = 64, metadata = false): Uint8Array {
  const vp8x = new Uint8Array(18);
  vp8x.set(new TextEncoder().encode('VP8X'), 0);
  new DataView(vp8x.buffer).setUint32(4, 10, true);
  vp8x[8] = metadata ? 0x08 : 0;
  const w = width - 1;
  const h = height - 1;
  vp8x.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 12);
  const exif = metadata ? concat([new TextEncoder().encode('EXIF'), new Uint8Array([4, 0, 0, 0, 0x4d, 0x4d, 0, 42])]) : new Uint8Array(0);
  const body = concat([new TextEncoder().encode('WEBP'), vp8x, exif]);
  const head = new Uint8Array(8);
  head.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(head.buffer).setUint32(4, body.length, true);
  return concat([head, body]);
}

/** Signs a Tripo webhook body the way Tripo does: `t=<unix>,v1=<hex HMAC-SHA256 of t + "." + body>`. */
export async function signTripoWebhook(secret: string, body: string, unixSeconds: number): Promise<string> {
  const v1 = await hmacSha256Hex(secret, new TextEncoder().encode(`${unixSeconds}.${body}`));
  return `t=${unixSeconds},v1=${v1}`;
}
