// The adopted asset materials of a model-sourced character's meshes (AUTORIG-SPEC §6.1, AR-D7-15; lazy: the export
// and the character-runtime chunks import it): an imported model's materials (its asset slots) read from the asset
// GLB, so its image textures reach the written file, the display container (Animate, Auto-Rig ④; AR-D8-1) and the
// thumbnail. A mesh with a palette, an authored mesh or an asset that cannot be read gets none (index-aligned with
// `meshes`, undefined there).
import type { AssetId, MeshRecord } from '@ekza-studio/doc';
import type { CharacterAssetMaterial } from '@ekza-studio/io';
import type { EditorApp } from '../types';
import type { WritePath } from '../workflows/export';

/** Per asset and material index, the material read once (a display rebuild must not re-parse the GLB). */
export type AssetMaterialCache = Map<string, Promise<CharacterAssetMaterial | null>>;

export async function adoptedMaterials(
  app: Pick<EditorApp, 'services'>,
  write: Pick<WritePath, 'characterAssetMaterials'>,
  meshes: readonly { readonly record: MeshRecord }[],
  cache: AssetMaterialCache = new Map(),
): Promise<(readonly (CharacterAssetMaterial | null)[] | undefined)[]> {
  const bytes = new Map<AssetId, Promise<Uint8Array | null>>();
  const read = (asset: AssetId, index: number): Promise<CharacterAssetMaterial | null> => {
    const key = `${asset}:${index}`;
    let found = cache.get(key);
    if (found === undefined) {
      let file = bytes.get(asset);
      if (file === undefined) {
        file = app.services.assets.get(asset).catch(() => null);
        bytes.set(asset, file);
      }
      found = file.then((data) => {
        if (data === null) return null;
        try {
          return write.characterAssetMaterials(data, [index], asset)[0] ?? null;
        } catch {
          return null;
        }
      });
      cache.set(key, found);
      // A failed read is not remembered (the asset may arrive later).
      void found.then((material) => {
        if (material === null && cache.get(key) === found) cache.delete(key);
      });
    }
    return found;
  };
  const out: (readonly (CharacterAssetMaterial | null)[] | undefined)[] = [];
  for (const { record } of meshes) {
    const material = record.material;
    if (record.palette !== null || !('assetSlots' in material) || material.assetSlots.length === 0) {
      out.push(undefined);
      continue;
    }
    const slots = await Promise.all(material.assetSlots.map((slot) => read(slot.asset, slot.material)));
    out.push(slots.some((slot) => slot !== null && slot.baseColorTexture !== null) ? slots : undefined);
  }
  return out;
}
