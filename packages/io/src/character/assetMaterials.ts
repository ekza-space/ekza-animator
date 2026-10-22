// Adopted asset materials of a character mesh (AUTORIG-SPEC §6.1, AR-D7-15; C10): an imported static model keeps its
// glTF materials as asset slots (`MeshRecord.material.assetSlots`, C1), and the character writer copies them — base
// colour factor, base colour image texture (embedded `bufferView` or `data:` URI; an external URI is left out), its
// sampler and texCoord, alpha mode and cutoff, double-sidedness — so a textured model's VRM keeps its texture.
import { parseGlbSync } from '../glb/parse';
import { bufferViewsOf, isIndex, isRecord, unknownList } from '../gltf/schema';
import type { CharacterAssetMaterial } from '../types';

const REPEAT = 10497;

/** `data:<mime>;base64,<payload>` → bytes, else null. */
function dataUri(uri: string): { readonly bytes: Uint8Array; readonly mimeType: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (match === null || match[2] === undefined) return null;
  const binary = atob(match[3] ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mimeType: match[1] ?? '' };
}

/** The image's MIME type from its bytes when the file does not say it (PNG, JPEG, WebP). */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The materials `indices` of the GLB `bytes` (an asset the character's meshes were imported from), in order; an
 * index the file does not have gives null. `assetKey` names the file, so the same image of the same asset is one key.
 */
export function characterAssetMaterials(
  bytes: Uint8Array,
  indices: readonly number[],
  assetKey: string,
): (CharacterAssetMaterial | null)[] {
  const container = parseGlbSync(bytes);
  const json = container.json as Readonly<Record<string, unknown>>;
  const materials = unknownList(json['materials']);
  const textures = unknownList(json['textures']);
  const images = unknownList(json['images']);
  const samplers = unknownList(json['samplers']);
  const views = bufferViewsOf(container.json);
  const imageOf = (index: number): { readonly image: Uint8Array; readonly mimeType: string } | null => {
    const image = images[index];
    if (!isRecord(image)) return null;
    let data: Uint8Array | null = null;
    let mime = typeof image['mimeType'] === 'string' ? image['mimeType'] : '';
    if (isIndex(image['bufferView'])) {
      const view = views[image['bufferView']];
      if (view === undefined || container.bin === null) return null;
      const start = view.byteOffset ?? 0;
      if (start + view.byteLength > container.bin.byteLength) return null;
      data = container.bin.slice(start, start + view.byteLength);
    } else if (typeof image['uri'] === 'string') {
      const decoded = dataUri(image['uri']);
      if (decoded === null) return null;
      data = decoded.bytes;
      if (mime === '') mime = decoded.mimeType;
    }
    if (data === null || data.byteLength === 0) return null;
    const sniffed = sniffMime(data);
    if (sniffed === null) return null;
    return { image: data, mimeType: mime === '' ? sniffed : mime };
  };
  return indices.map((index) => {
    const material = materials[index];
    if (!isRecord(material)) return null;
    const pbr = isRecord(material['pbrMetallicRoughness']) ? material['pbrMetallicRoughness'] : {};
    const factor = unknownList(pbr['baseColorFactor']);
    const info = isRecord(pbr['baseColorTexture']) ? pbr['baseColorTexture'] : null;
    let baseColorTexture: CharacterAssetMaterial['baseColorTexture'] = null;
    const texture = info !== null && isIndex(info['index']) ? textures[info['index']] : undefined;
    if (isRecord(texture) && isIndex(texture['source'])) {
      const image = imageOf(texture['source']);
      const sampler = isIndex(texture['sampler']) ? samplers[texture['sampler']] : undefined;
      const texCoord = info?.['texCoord'];
      const s = isRecord(sampler) ? sampler : {};
      if (image !== null) {
        baseColorTexture = {
          key: `${assetKey}#image${texture['source']}`,
          image: image.image,
          mimeType: image.mimeType,
          texCoord: isIndex(texCoord) ? texCoord : 0,
          sampler: {
            magFilter: isIndex(s['magFilter']) ? s['magFilter'] : null,
            minFilter: isIndex(s['minFilter']) ? s['minFilter'] : null,
            wrapS: isIndex(s['wrapS']) ? s['wrapS'] : REPEAT,
            wrapT: isIndex(s['wrapT']) ? s['wrapT'] : REPEAT,
          },
        };
      }
    }
    const alphaMode = material['alphaMode'];
    return {
      name: typeof material['name'] === 'string' && material['name'] !== '' ? material['name'] : `Material ${index}`,
      baseColorFactor: [finite(factor[0], 1), finite(factor[1], 1), finite(factor[2], 1), finite(factor[3], 1)],
      baseColorTexture,
      alphaMode: alphaMode === 'MASK' || alphaMode === 'BLEND' ? alphaMode : 'OPAQUE',
      alphaCutoff: alphaMode === 'MASK' ? finite(material['alphaCutoff'], 0.5) : null,
      doubleSided: material['doubleSided'] === true,
    };
  });
}
