// The thumbnail a VRM file carries (AUTORIG-SPEC §5.6.4; D6): the OMOBA kit of an imported avatar ships the image
// the exported VRM names as its thumbnail (VRM 1.0 `VRMC_vrm.meta.thumbnailImage`, an image index; VRM 0.x
// `VRM.meta.texture`, a texture index), so the kit's picture is the one inside its `<slug>.glb`. Pure; never throws.
import { parseGlbSync } from '../glb/parse';

/** An embedded image: its bytes and the kit's file extension for it. */
export interface VrmThumbnail {
  readonly bytes: Uint8Array;
  readonly extension: 'png' | 'jpg';
}

type Json = Readonly<Record<string, unknown>>;

const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const index = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const starts = (bytes: Uint8Array, magic: readonly number[]): boolean => magic.every((b, i) => bytes[i] === b);

/** The image index of the VRM's thumbnail, or null. */
function thumbnailImageIndex(json: Json): number | null {
  const extensions = json['extensions'];
  if (!isJson(extensions)) return null;
  const vrmc = extensions['VRMC_vrm'];
  if (isJson(vrmc)) return isJson(vrmc['meta']) ? index(vrmc['meta']['thumbnailImage']) : null;
  const vrm0 = extensions['VRM'];
  if (!isJson(vrm0) || !isJson(vrm0['meta'])) return null;
  const texture = index(vrm0['meta']['texture']);
  const textures = json['textures'];
  if (texture === null || !Array.isArray(textures)) return null;
  const entry: unknown = textures[texture];
  return isJson(entry) ? index(entry['source']) : null;
}

/**
 * The thumbnail image embedded in VRM bytes (a PNG or JPEG in the BIN chunk), or null when the file names none, the
 * image is external or of another type, or the bytes are not a readable GLB.
 */
export function vrmThumbnail(vrm: Uint8Array): VrmThumbnail | null {
  try {
    const glb = parseGlbSync(vrm);
    const json = glb.json as unknown as Json;
    const image = thumbnailImageIndex(json);
    const images = json['images'];
    const views = json['bufferViews'];
    if (image === null || !Array.isArray(images) || !Array.isArray(views) || glb.bin === null) return null;
    const entry: unknown = images[image];
    if (!isJson(entry)) return null;
    const viewIndex = index(entry['bufferView']);
    const view: unknown = viewIndex === null ? undefined : views[viewIndex];
    if (!isJson(view) || index(view['buffer']) !== 0) return null;
    const offset = index(view['byteOffset'] ?? 0);
    const length = index(view['byteLength']);
    if (offset === null || length === null || length === 0 || offset + length > glb.bin.byteLength) return null;
    const bytes = glb.bin.slice(offset, offset + length);
    if (starts(bytes, PNG)) return { bytes, extension: 'png' };
    if (starts(bytes, JPEG)) return { bytes, extension: 'jpg' };
    return null;
  } catch {
    return null;
  }
}
