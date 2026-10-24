// Untrusted input checks without an image library (`sharp` stays banned, ADR 0009): the gateway sniffs the real type
// from the bytes, reads the dimensions, and rejects files that still carry EXIF or XMP — the browser re-encodes inputs
// (G-d), so metadata here means the caller skipped that step (ADR 0017 §10). GLBs are checked structurally: one
// self-contained binary glTF 2.0 without any external `uri`, so nothing the gateway forwards or serves can point
// elsewhere (no SSRF through a model's buffers or images).
import { GEN_LIMITS, type ImageMime, type UploadMime } from '@ekza-studio/gen-core';

export class InputError extends Error {
  readonly kind: 'type' | 'metadata' | 'size' | 'structure';
  constructor(kind: 'type' | 'metadata' | 'size' | 'structure', message: string) {
    super(message);
    this.name = 'InputError';
    this.kind = kind;
  }
}

export interface ImageInfo {
  readonly mime: ImageMime;
  readonly width: number;
  readonly height: number;
}

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));
const u32be = (b: Uint8Array, at: number): number =>
  ((b[at] ?? 0) * 0x1000000 + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0)) >>> 0;
const u32le = (b: Uint8Array, at: number): number =>
  ((b[at] ?? 0) + ((b[at + 1] ?? 0) << 8) + ((b[at + 2] ?? 0) << 16) + (b[at + 3] ?? 0) * 0x1000000) >>> 0;
const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u24le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);

/** The type the bytes really are, or null. */
export function sniff(bytes: Uint8Array): UploadMime | null {
  if (bytes.length >= 8 && u32be(bytes, 0) === 0x89504e47 && u32be(bytes, 4) === 0x0d0a1a0a) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'glTF') return 'model/gltf-binary';
  return null;
}

const XMP_KEYWORD = 'XML:com.adobe.xmp';

function png(b: Uint8Array): ImageInfo {
  let at = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  while (at + 12 <= b.length) {
    const len = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    const data = at + 8;
    if (data + len + 4 > b.length) throw new InputError('structure', `PNG chunk ${type} runs past the end.`);
    if (type === 'IHDR') {
      width = u32be(b, data);
      height = u32be(b, data + 4);
    } else if (type === 'eXIf') {
      throw new InputError('metadata', 'The PNG carries EXIF metadata; re-encode it before uploading.');
    } else if (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') {
      const nul = b.subarray(data, data + Math.min(len, 80)).indexOf(0);
      const keyword = ascii(b, data, nul < 0 ? Math.min(len, 79) : nul);
      if (keyword === XMP_KEYWORD || keyword.toLowerCase().startsWith('raw profile type'))
        throw new InputError('metadata', 'The PNG carries XMP or EXIF text metadata; re-encode it before uploading.');
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    at = data + len + 4;
  }
  if (!sawEnd || width === 0 || height === 0)
    throw new InputError('structure', 'The PNG is truncated or has no header.');
  return { mime: 'image/png', width, height };
}

function webp(b: Uint8Array): ImageInfo {
  const riffEnd = Math.min(b.length, 8 + u32le(b, 4));
  let at = 12;
  let width = 0;
  let height = 0;
  while (at + 8 <= riffEnd) {
    const type = ascii(b, at, 4);
    const len = u32le(b, at + 4);
    const data = at + 8;
    if (data + len > riffEnd) throw new InputError('structure', `WebP chunk ${type} runs past the end.`);
    if (type === 'EXIF' || type === 'XMP ')
      throw new InputError('metadata', 'The WebP carries EXIF or XMP metadata; re-encode it before uploading.');
    if (type === 'VP8X') {
      const flags = b[data] ?? 0;
      if ((flags & 0x0c) !== 0)
        throw new InputError('metadata', 'The WebP declares EXIF or XMP metadata; re-encode it before uploading.');
      if ((flags & 0x02) !== 0) throw new InputError('type', 'Animated WebP is not accepted.');
      width = u24le(b, data + 4) + 1;
      height = u24le(b, data + 7) + 1;
    } else if (type === 'VP8 ' && width === 0) {
      width = (b[data + 6] ?? 0) | (((b[data + 7] ?? 0) & 0x3f) << 8);
      height = (b[data + 8] ?? 0) | (((b[data + 9] ?? 0) & 0x3f) << 8);
    } else if (type === 'VP8L' && width === 0) {
      const bits = u32le(b, data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    at = data + len + (len & 1);
  }
  if (width === 0 || height === 0) throw new InputError('structure', 'The WebP has no image data.');
  return { mime: 'image/webp', width, height };
}

function jpeg(b: Uint8Array): ImageInfo {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) throw new InputError('structure', 'The JPEG has a broken segment.');
    const marker = b[at + 1] ?? 0;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      at += marker === 0xff ? 1 : 2;
      continue;
    }
    const len = u16be(b, at + 2);
    const data = at + 4;
    if (marker === 0xe1) {
      const head = ascii(b, data, Math.min(29, len - 2));
      if (head.startsWith('Exif') || head.startsWith('http://ns.adobe.com/xap/1.0/'))
        throw new InputError('metadata', 'The JPEG carries EXIF or XMP metadata; re-encode it before uploading.');
    }
    if (marker === 0xed)
      throw new InputError('metadata', 'The JPEG carries IPTC metadata; re-encode it before uploading.');
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mime: 'image/jpeg', height: u16be(b, data + 1), width: u16be(b, data + 3) };
    }
    if (marker === 0xda) break;
    at = data + len - 2;
  }
  throw new InputError('structure', 'The JPEG has no frame header.');
}

/** Verifies an input image: its real type is the declared one, no EXIF/XMP, dimensions within the limits. */
export function checkImage(bytes: Uint8Array, declared: string): ImageInfo {
  const real = sniff(bytes);
  if (real === null || real === 'model/gltf-binary') throw new InputError('type', 'Not a PNG, WebP or JPEG image.');
  if (real !== declared) throw new InputError('type', `The file is ${real}, not ${declared}.`);
  const info = real === 'image/png' ? png(bytes) : real === 'image/webp' ? webp(bytes) : jpeg(bytes);
  const { imageMinPx, imageMaxPx } = GEN_LIMITS;
  if (info.width < imageMinPx || info.height < imageMinPx || info.width > imageMaxPx || info.height > imageMaxPx)
    throw new InputError('size', `Images must be ${imageMinPx}–${imageMaxPx} px on each side.`);
  return info;
}

export interface GlbInfo {
  readonly meshes: number;
  readonly generator: string | null;
}

/**
 * Structural check of a binary glTF: header, length, chunk layout, JSON, glTF 2.0, and no `uri` on any buffer or
 * image. It is not the validator: the editor still runs the `io` budgets, the validator and the importer on the bytes.
 */
export function checkGlb(b: Uint8Array): GlbInfo {
  if (b.length < 20 || ascii(b, 0, 4) !== 'glTF') throw new InputError('type', 'Not a binary glTF (GLB).');
  if (u32le(b, 4) !== 2) throw new InputError('structure', 'Only glTF 2.0 binaries are accepted.');
  if (u32le(b, 8) !== b.length) throw new InputError('structure', 'The GLB length does not match its header.');
  const jsonLen = u32le(b, 12);
  if (u32le(b, 16) !== 0x4e4f534a || 20 + jsonLen > b.length)
    throw new InputError('structure', 'The GLB does not start with a JSON chunk.');
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(20, 20 + jsonLen)));
  } catch {
    throw new InputError('structure', 'The GLB JSON chunk is not valid JSON.');
  }
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(doc) || !isObj(doc['asset']) || doc['asset']['version'] !== '2.0')
    throw new InputError('structure', 'The GLB is not glTF 2.0.');
  for (const key of ['buffers', 'images'] as const) {
    const arr = doc[key];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) throw new InputError('structure', `glTF ${key} is not an array.`);
    for (const item of arr)
      if (isObj(item) && item['uri'] !== undefined)
        throw new InputError(
          'structure',
          `The GLB references external or embedded ${key} by uri; only GLB chunks are accepted.`,
        );
  }
  let at = 20 + jsonLen;
  while (at + 8 <= b.length) {
    const len = u32le(b, at);
    if (at + 8 + len > b.length) throw new InputError('structure', 'A GLB chunk runs past the end.');
    at += 8 + len;
  }
  const meshes = Array.isArray(doc['meshes']) ? doc['meshes'].length : 0;
  const generator = typeof doc['asset']['generator'] === 'string' ? doc['asset']['generator'] : null;
  return { meshes, generator };
}
