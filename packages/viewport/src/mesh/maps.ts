// The materials of imported models in mesh-view (AR-D8-1, AR-D9-1; lazy with the mesh displays): a mesh without a
// palette whose material slots are adopted asset materials (`MeshRecord.material.assetSlots`, an imported static GLB)
// draws its base colour image and its flat-colour materials in Model, in Auto-Rig ①–③ and on Rig & Skin's skinned
// surfaces, as the written file and the display model do. One loader per app: the asset's GLB read once per slot set
// (io's `characterAssetMaterials`), the image decoded once per image (`createImageBitmap`, glTF orientation: no
// flip), shared by every surface. The first textured slot picks the image; every slot sampling the same image maps; a
// slot without an image draws its base colour factor when it is not glTF's default white; other slots stay clay.
import type { MeshRecord } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { assetMaterialCarriesColour, type CharacterAssetMaterial, characterAssetMaterials } from '@ekza-studio/io';
import type { SurfaceMap } from '@ekza-studio/mesh-view';
import {
  ClampToEdgeWrapping,
  MirroredRepeatWrapping,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type Wrapping,
} from 'three';

type Entry =
  | { readonly state: 'loading'; readonly waiters: Set<() => void> }
  | { readonly state: 'done'; readonly map: SurfaceMap | null };

export interface SurfaceMaps {
  /** The image of a mesh record now (null: none, or still loading — `ready` runs once it is there). */
  mapOf(record: MeshRecord, ready: () => void): SurfaceMap | null;
}

const loaders = new WeakMap<EditorApp, SurfaceMaps>();

const WRAP: Readonly<Record<number, Wrapping>> = {
  33071: ClampToEdgeWrapping,
  33648: MirroredRepeatWrapping,
  10497: RepeatWrapping,
};

/** The slot set key of a record (null: a palette mesh, an authored mesh). */
function keyOf(record: MeshRecord): string | null {
  const material = record.material;
  if (record.palette !== null || !('assetSlots' in material) || material.assetSlots.length === 0) return null;
  return material.assetSlots.map((slot) => `${slot.asset}:${slot.material}`).join('|');
}

async function decode(image: Uint8Array, mimeType: string): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(new Blob([image as BlobPart], { type: mimeType }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  } catch {
    return null;
  }
}

async function load(
  app: EditorApp,
  record: MeshRecord,
  images: Map<string, Promise<Texture | null>>,
): Promise<SurfaceMap | null> {
  const material = record.material;
  if (!('assetSlots' in material)) return null;
  const files = new Map<string, Promise<Uint8Array | null>>();
  const materials: (CharacterAssetMaterial | null)[] = [];
  for (const slot of material.assetSlots) {
    let file = files.get(slot.asset);
    if (file === undefined) {
      file = app.services.assets.get(slot.asset).catch(() => null);
      files.set(slot.asset, file);
    }
    const bytes = await file;
    let found: CharacterAssetMaterial | null = null;
    if (bytes !== null) {
      try {
        found = characterAssetMaterials(bytes, [slot.material], slot.asset)[0] ?? null;
      } catch {
        found = null;
      }
    }
    materials.push(found);
  }
  // Flat-colour slots (AR-D9-1): no image, a base colour factor of their own.
  const flat = new Map<number, readonly [number, number, number]>();
  materials.forEach((m, i) => {
    if (m !== null && m.baseColorTexture === null && assetMaterialCarriesColour(m)) {
      flat.set(i, [m.baseColorFactor[0], m.baseColorFactor[1], m.baseColorFactor[2]]);
    }
  });
  const flatOnly = (): SurfaceMap | null =>
    flat.size === 0 ? null : { texture: null, slots: new Set(), factor: [1, 1, 1], texCoord: 0, flat };
  const first = materials.find((m) => m !== null && m.baseColorTexture !== null);
  const image = first?.baseColorTexture ?? null;
  if (first === undefined || first === null || image === null) return flatOnly();
  let texture = images.get(image.key);
  if (texture === undefined) {
    texture = decode(image.image, image.mimeType).then((bitmap) => {
      if (bitmap === null) return null;
      const t = new Texture(bitmap);
      t.flipY = false;
      t.colorSpace = SRGBColorSpace;
      t.wrapS = WRAP[image.sampler.wrapS] ?? RepeatWrapping;
      t.wrapT = WRAP[image.sampler.wrapT] ?? RepeatWrapping;
      t.needsUpdate = true;
      return t;
    });
    images.set(image.key, texture);
  }
  const loaded = await texture;
  if (loaded === null) return flatOnly();
  const slots = new Set<number>();
  materials.forEach((m, i) => {
    if (m?.baseColorTexture?.key === image.key) slots.add(i);
  });
  const [r, g, b] = first.baseColorFactor;
  return { texture: loaded, slots, factor: [r, g, b], texCoord: image.texCoord, ...(flat.size === 0 ? {} : { flat }) };
}

/** The app's loader (one per app). */
export function surfaceMaps(app: EditorApp): SurfaceMaps {
  let maps = loaders.get(app);
  if (maps !== undefined) return maps;
  const entries = new Map<string, Entry>();
  const images = new Map<string, Promise<Texture | null>>();
  maps = {
    mapOf(record, ready) {
      const key = keyOf(record);
      if (key === null) return null;
      const entry = entries.get(key);
      if (entry?.state === 'done') return entry.map;
      if (entry?.state === 'loading') {
        entry.waiters.add(ready);
        return null;
      }
      const waiters = new Set([ready]);
      entries.set(key, { state: 'loading', waiters });
      void load(app, record, images).then(
        (map) => {
          entries.set(key, { state: 'done', map });
          for (const waiter of waiters) waiter();
        },
        () => entries.set(key, { state: 'done', map: null }),
      );
      return null;
    },
  };
  loaders.set(app, maps);
  return maps;
}
