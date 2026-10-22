// M6b test API, C1 group (M6B-SPEC §4.8, §0.5): the skeleton records of a model character, its SkeletonDesc as the
// runtime compiled it, the synthesized container's version and CPU-skinned positions of a bound mesh at the current
// evaluated pose (linear blend skinning with bind = rest: Σ w · boneWorld · (W⁰)⁻¹ · p, character space).
import {
  mat4Compose,
  mat4Invert,
  mat4Multiply,
  mat4TransformPoint,
  type ReadonlyXf,
  xfMultiply,
} from '@ekza-studio/anim-core';
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import { meshKernel } from '@ekza-studio/editor-core';
import type { EkzaStudioTestApi } from '../types';
import type { M6bTestApiContext } from './support';

export type CharacterRuntimeTestApi = Pick<
  EkzaStudioTestApi,
  'skeleton' | 'skeletonDesc' | 'containerVersion' | 'displayTextures' | 'posedPositions'
>;

export function characterRuntimeTestApi(ctx: M6bTestApiContext): CharacterRuntimeTestApi {
  const app = () => ctx.shell.app;
  return {
    skeleton(character) {
      const record = app().store.get('characters', character as CharacterId);
      if (record?.source?.kind !== 'model') return null;
      const skeleton = app().store.get('skeletons', record.source.skeleton);
      if (skeleton === undefined) return null;
      return {
        id: skeleton.id,
        preset: skeleton.preset,
        symmetry: skeleton.symmetry,
        joints: app()
          .store.query.jointsOfSkeleton(skeleton.id)
          .map((joint) => ({
            id: joint.id,
            name: joint.name,
            key: joint.key,
            parent: joint.parent,
            humanBone: joint.humanBone,
            side: joint.side,
            mirror: joint.mirror,
            role: joint.role,
            restPosition: [...joint.restPosition],
            restRotation: [...joint.restRotation],
            tail: joint.tail === null ? null : [...joint.tail],
          })),
      };
    },
    skeletonDesc(character) {
      ctx.sync();
      const desc = app().characters.get(character as CharacterId)?.skeleton;
      if (desc === undefined) return null;
      const humanoid: Record<string, number> = {};
      for (const [bone, node] of Object.entries(desc.humanoid ?? {})) if (node !== undefined) humanoid[bone] = node;
      return {
        fingerprint: desc.fingerprint,
        height: desc.height,
        humanoid,
        radii: [...desc.boneRadii],
        names: desc.nodes.map((node) => node.name),
      };
    },
    containerVersion(character) {
      const runtime = app().characters.get(character as CharacterId) as { containerVersion?: unknown } | undefined;
      return typeof runtime?.containerVersion === 'number' ? runtime.containerVersion : 0;
    },
    displayTextures(character) {
      const runtime = app().characters.get(character as CharacterId);
      if (runtime === undefined) return null;
      const json = runtime.container.json as {
        images?: { name?: string }[];
        textures?: { source?: number }[];
        materials?: { pbrMetallicRoughness?: { baseColorTexture?: { index?: number } } }[];
      };
      const adopted = (index: number | undefined): boolean =>
        /^image \d+$/.test(json.images?.[index ?? -1]?.name ?? '');
      return {
        images: (json.images ?? []).filter((image) => /^image \d+$/.test(image.name ?? '')).length,
        textured: (json.materials ?? []).filter((material) => {
          const texture = json.textures?.[material.pbrMetallicRoughness?.baseColorTexture?.index ?? -1];
          return adopted(texture?.source);
        }).length,
      };
    },
    posedPositions(mesh, points) {
      ctx.sync();
      const a = app();
      const record = a.store.get('meshes', mesh as MeshId);
      if (record === undefined || !('character' in record.owner)) return [];
      const runtime = a.characters.get(record.owner.character);
      const data = a.meshes.get(record.id)?.data() ?? null;
      const kernel = meshKernel();
      if (runtime === undefined || data === null || kernel === null) return [];
      const skin = kernel.readSkin(data);
      const desc = runtime.skeleton;
      const pick = points ?? Array.from({ length: data.counts.points }, (_, p) => p);
      const unposed = (p: number) => [
        data.position[3 * p] as number,
        data.position[3 * p + 1] as number,
        data.position[3 * p + 2] as number,
      ];
      if (skin === null || record.skin === null) return pick.map(unposed);
      // Palette key (JointId) → node, through the joints' stable keys.
      const nodeOfKey = new Map((desc.jointKeys ?? []).map((key, i) => [key, i]));
      const nodeOfPalette = skin.palette.map((entry) => {
        const joint = a.store.get('joints', entry.key as never);
        return joint === undefined ? -1 : (nodeOfKey.get(joint.key) ?? -1);
      });
      const rest: ReadonlyXf[] = [];
      for (const node of desc.nodes) {
        const parent = node.parent === -1 ? null : rest[node.parent];
        rest.push(parent === null || parent === undefined ? node.restLocal : xfMultiply(parent, node.restLocal));
      }
      const skinning = desc.nodes.map((_, i) => {
        const inverse = mat4Invert(mat4Compose(rest[i] as ReadonlyXf));
        const world = runtime.pose.boneWorld.subarray(16 * i, 16 * i + 16);
        return inverse === null ? null : mat4Multiply(Float64Array.from(world), inverse);
      });
      return pick.map((p) => {
        const v = unposed(p) as [number, number, number];
        const out = [0, 0, 0];
        let total = 0;
        for (let k = 0; k < 4; k++) {
          const w = skin.weights[4 * p + k] as number;
          if (!(w > 0)) continue;
          const m = skinning[nodeOfPalette[skin.joints[4 * p + k] as number] ?? -1];
          if (m === undefined || m === null) continue;
          const q = mat4TransformPoint(m, v);
          out[0] = (out[0] as number) + w * q[0];
          out[1] = (out[1] as number) + w * q[1];
          out[2] = (out[2] as number) + w * q[2];
          total += w;
        }
        return total > 0 ? out : v;
      });
    },
  };
}
