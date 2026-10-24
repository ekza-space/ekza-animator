// The image rewrite of `mesh.textureDownsize` (MODELING-PLAN §7.2 G-a, research 15 §5.9 step 10): a GLB whose images
// are replaced by what `transform` returns (the editor decodes, downsamples and re-encodes), everything else kept.
// The BIN chunk is laid out again — every bufferView in index order, 4-byte aligned, the replaced images' views with
// their new bytes — so accessors (offsets inside their views) stay valid; an image stored as a data URI gets a new
// data URI. Deterministic: the same container and the same returned bytes give the same file.
import { EkzaError } from '@ekza-studio/anim-core';
import type { GlbContainer } from '../types';
import { align4, assembleGlb } from './write';

type Json = Record<string, unknown>;

/** One image of the file, as `transform` sees it. */
export interface GlbImage {
  readonly index: number;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function base64Decode(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The GLB with every image `transform` returns new bytes for replaced (null keeps an image). Returns null when no image
 * changed. Throws on a container without the BIN chunk its views need.
 */
export async function rewriteImages(
  container: GlbContainer,
  transform: (image: GlbImage) => Promise<{ readonly bytes: Uint8Array; readonly mimeType: string } | null>,
): Promise<Uint8Array | null> {
  const json = structuredClone(container.json) as unknown as Json;
  const views = list(json['bufferViews']);
  if (views.some((view) => isRecord(view) && view['buffer'] !== 0)) {
    throw new EkzaError('unsupported', 'The file keeps data outside its BIN chunk: its images cannot be rewritten');
  }
  const images = list(json['images']);
  const replaced = new Map<number, Uint8Array>();
  let changed = false;
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    if (!isRecord(image)) continue;
    let bytes: Uint8Array | null = null;
    let mimeType = typeof image['mimeType'] === 'string' ? image['mimeType'] : '';
    const viewIndex = image['bufferView'];
    if (typeof viewIndex === 'number') {
      const view = views[viewIndex];
      if (!isRecord(view) || container.bin === null) continue;
      const start = typeof view['byteOffset'] === 'number' ? view['byteOffset'] : 0;
      const length = typeof view['byteLength'] === 'number' ? view['byteLength'] : 0;
      bytes = container.bin.subarray(start, start + length);
    } else if (typeof image['uri'] === 'string') {
      const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(image['uri']);
      if (match === null || match[2] === undefined) continue;
      bytes = base64Decode(match[3] ?? '');
      if (mimeType === '') mimeType = match[1] ?? '';
    }
    if (bytes === null) continue;
    const result = await transform({ index, bytes, mimeType });
    if (result === null) continue;
    changed = true;
    image['mimeType'] = result.mimeType;
    if (typeof viewIndex === 'number') replaced.set(viewIndex, result.bytes);
    else image['uri'] = `data:${result.mimeType};base64,${base64Encode(result.bytes)}`;
  }
  if (!changed) return null;
  // Lay the BIN out again: each view's bytes (replaced or original), in index order, 4-byte aligned.
  const parts: Uint8Array[] = [];
  let length = 0;
  views.forEach((view, index) => {
    if (!isRecord(view)) return;
    const start = typeof view['byteOffset'] === 'number' ? view['byteOffset'] : 0;
    const size = typeof view['byteLength'] === 'number' ? view['byteLength'] : 0;
    const bytes = replaced.get(index) ?? container.bin?.subarray(start, start + size) ?? new Uint8Array(size);
    const pad = align4(length) - length;
    if (pad > 0) {
      parts.push(new Uint8Array(pad));
      length += pad;
    }
    view['byteOffset'] = length;
    view['byteLength'] = bytes.byteLength;
    parts.push(bytes);
    length += bytes.byteLength;
  });
  const pad = align4(length) - length;
  if (pad > 0) parts.push(new Uint8Array(pad));
  const buffers = list(json['buffers']);
  if (isRecord(buffers[0])) {
    buffers[0]['byteLength'] = align4(length);
    delete buffers[0]['uri'];
  }
  return assembleGlb(JSON.stringify(json), parts.length === 0 ? null : parts);
}
