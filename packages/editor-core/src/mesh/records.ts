// Record helpers of the mesh runtime's writers (`mesh.create.*`, the MeshSetOp runner): unique names per owner,
// sibling order, material identity keys, skin keys and world ↔ parent-local placements (M6A-SPEC §4.2, §5.13, §5.16).
import { type ReadonlyXf, xfIdentity, xfInvert, xfMultiply } from '@ekza-animator/anim-core';
import {
  type CharacterId,
  fractionalIndex,
  type GroupId,
  type MeshId,
  type MeshMaterial,
  type MeshOwner,
  type MeshRecord,
  type ReadView,
} from '@ekza-animator/doc';
import { worldPlacement } from './context';

/** Longest record name (§4.2). */
export const MAX_NAME = 64;

export function ownerKey(owner: MeshOwner): CharacterId | 'scene' {
  return 'character' in owner ? owner.character : 'scene';
}

/** `base`, or `base 2`, `base 3`, … — the first name no live mesh of `owner` uses (the load repair's suffix rule). */
export function uniqueMeshName(view: ReadView, owner: MeshOwner, base: string, taken?: ReadonlySet<string>): string {
  const stem = (base.trim() === '' ? 'Mesh' : base.trim()).slice(0, MAX_NAME);
  const used = new Set<string>(taken ?? []);
  for (const mesh of view.query.meshesOfOwner(ownerKey(owner))) used.add(mesh.name);
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const name = `${stem.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!used.has(name)) return name;
  }
}

/** An order key after every child of `parent` (and after `after` when given). */
export function orderAfterSiblings(
  view: ReadView,
  owner: MeshOwner,
  parent: GroupId | MeshId | null,
  after?: string | null,
): string {
  let last: string | null = after ?? null;
  for (const child of view.query.childrenOf(parent, ownerKey(owner))) {
    if (last === null || child.order > last) last = child.order;
  }
  return fractionalIndex(last, null);
}

/** Identity key per material slot ('preset:unlit', 'asset:<id>:<n>'), the MeshSetInput convention (§4.3). */
export function materialKeys(material: MeshMaterial): readonly string[] {
  if ('preset' in material) return [`preset:${material.preset}`];
  return material.assetSlots.map((slot) => `asset:${slot.asset}:${slot.material}`);
}

/** The record material for output slot keys (asset slots when every key is one; else the first preset). */
export function materialOfKeys(keys: readonly string[], fallback: MeshMaterial): MeshMaterial {
  if (keys.length > 0 && keys.every((key) => key.startsWith('asset:'))) {
    return {
      assetSlots: keys.map((key) => {
        const [, asset, index] = key.split(':') as [string, string, string];
        return { asset: asset as never, material: Number(index) };
      }),
    };
  }
  const preset = keys.find((key) => key.startsWith('preset:'))?.slice('preset:'.length);
  if (preset === 'unlit' || preset === 'toon' || preset === 'lit') return { preset };
  return fallback;
}

/** The MeshSetInput skeleton key: a model skin's SkeletonId, 'asset:<id>:<skin>' for an imported skin, else null. */
export function skeletonKey(record: MeshRecord): string | null {
  const skin = record.skin;
  if (skin === null) return null;
  return 'skeleton' in skin ? skin.skeleton : `asset:${skin.asset}:${skin.skin}`;
}

/** The parent-local placement of a world placement for a record placed under `parent` of `owner`. */
export function localFromWorld(
  view: ReadView,
  owner: MeshOwner,
  parent: GroupId | MeshId | null,
  world: ReadonlyXf,
): ReadonlyXf {
  let parentWorld: ReadonlyXf = xfIdentity();
  if (parent !== null) {
    const node: { readonly placement: ReadonlyXf; readonly parent: GroupId | MeshId | null } | undefined =
      parent.startsWith('grp_') ? view.get('groups', parent as GroupId) : view.get('meshes', parent as MeshId);
    if (node !== undefined) {
      // A group/mesh parent: its world placement (the same walk as worldPlacement, through a stand-in record).
      parentWorld = worldPlacement(view, {
        id: parent as MeshId,
        owner,
        parent: node.parent,
        placement: node.placement,
      } as MeshRecord);
    }
  } else if ('character' in owner) {
    parentWorld = view.get('characters', owner.character)?.placement ?? xfIdentity();
  }
  return xfMultiply(xfInvert(parentWorld), world);
}
