// '@ekza-animator/io/three' (browser; three + @pixiv/three-vrm): the display-model loader (ARCHITECTURE §7).
// GLTFLoader with VRMLoaderPlugin (autoUpdateHumanBones: false, the kernel writes raw bone locals; never
// VRMUtils.rotateVRM0), self-hosted Draco and KTX2 decoders and the meshopt decoder. The model hangs under a
// canonical character root that carries the SkeletonDesc facing (π yaw for VRM 0.x), the only place it is applied.
import { EkzaError } from '@ekza-animator/anim-core';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { type VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { Group, type Object3D, type SkinnedMesh, type WebGLRenderer } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { GlbContainer } from '../types';

export interface LoadedModel {
  /** Canonical character root (facing applied here only). */
  readonly root: Object3D;
  /** By SkeletonDesc node index. */
  readonly nodeObjects: readonly (Object3D | null)[];
  readonly skinnedMeshes: readonly SkinnedMesh[];
  /**
   * The drawn objects of each glTF mesh (one per primitive, every node that instances it), by glTF mesh index. Model
   * hides a mesh made editable here, since mesh-view draws it (M6A-SPEC §5.23). Absent on hand-built test models.
   */
  readonly meshObjects?: ReadonlyMap<number, readonly Object3D[]>;
  /** Loaded with autoUpdateHumanBones: false; never rotateVRM0. */
  readonly vrm: VRM | null;
  readonly springBones: { update(deltaSeconds: number): void; reset(): void } | null;
  /** VRMNodeConstraintManager. */
  readonly nodeConstraints: { update(): void } | null;
  dispose(): void;
}

export interface ThreeModelLoader {
  /** KTX2Loader.detectSupport; call before load. */
  setRenderer(renderer: unknown): void;
  load(
    c: GlbContainer,
    skeleton: SkeletonDesc,
  ): Promise<{ readonly kind: 'three'; readonly handle: LoadedModel; dispose(): void }>;
}

/** Decoder layout under `decoderPath` mirrors three's examples/jsm/libs (apps/web/scripts/copy-assets.mjs). */
export function createThreeModelLoader(opts: { readonly decoderPath: string }): ThreeModelLoader {
  const base = opts.decoderPath.endsWith('/') ? opts.decoderPath : `${opts.decoderPath}/`;
  let draco: DRACOLoader | null = null;
  let ktx2: KTX2Loader | null = null;

  return {
    setRenderer(renderer: unknown): void {
      ktx2 ??= new KTX2Loader().setTranscoderPath(`${base}basis/`);
      ktx2.detectSupport(renderer as WebGLRenderer);
    },

    async load(c, skeleton) {
      const used = Array.isArray(c.json['extensionsUsed']) ? (c.json['extensionsUsed'] as unknown[]) : [];
      if (used.includes('KHR_texture_basisu') && ktx2 === null) {
        throw new EkzaError('unsupported', 'KTX2 textures need the renderer: call setRenderer() before load()');
      }
      const loader = new GLTFLoader();
      if (used.includes('KHR_draco_mesh_compression')) {
        draco ??= new DRACOLoader().setDecoderPath(`${base}draco/gltf/`);
        loader.setDRACOLoader(draco);
      }
      if (ktx2 !== null) loader.setKTX2Loader(ktx2);
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));
      const buffer = c.bytes.buffer.slice(c.bytes.byteOffset, c.bytes.byteOffset + c.bytes.byteLength) as ArrayBuffer;
      const gltf = await loader.parseAsync(buffer, '');
      const handle = buildModel(gltf, skeleton);
      return { kind: 'three', handle, dispose: () => handle.dispose() };
    },
  };
}

function buildModel(gltf: GLTF, skeleton: SkeletonDesc): LoadedModel {
  const vrmData: unknown = gltf.userData['vrm'];
  const vrm = vrmData === undefined ? null : (vrmData as VRM);
  const scene = vrm?.scene ?? gltf.scene;
  const root = new Group();
  root.name = 'character';
  const [x, y, z, w] = skeleton.facing;
  root.quaternion.set(x, y, z, w);
  root.add(scene);

  const byGltfIndex = new Map<number, Object3D>();
  const skinnedMeshes: SkinnedMesh[] = [];
  const meshObjects = new Map<number, Object3D[]>();
  scene.traverse((object) => {
    const association = gltf.parser.associations.get(object);
    const index = association?.nodes;
    if (index !== undefined && !byGltfIndex.has(index)) byGltfIndex.set(index, object);
    const meshIndex = association?.meshes;
    if (meshIndex !== undefined && (object as { isMesh?: boolean }).isMesh === true) {
      meshObjects.set(meshIndex, [...(meshObjects.get(meshIndex) ?? []), object]);
    }
    if ((object as Partial<SkinnedMesh>).isSkinnedMesh === true) skinnedMeshes.push(object as SkinnedMesh);
  });
  const nodeObjects = skeleton.nodes.map((node) => byGltfIndex.get(node.gltfIndex) ?? null);
  const springs = vrm?.springBoneManager ?? null;
  const constraints = vrm?.nodeConstraintManager ?? null;
  let disposed = false;
  return {
    root,
    nodeObjects,
    skinnedMeshes,
    meshObjects,
    vrm,
    springBones:
      springs === null
        ? null
        : {
            update: (deltaSeconds: number) => springs.update(deltaSeconds),
            reset: () => springs.reset(),
          },
    nodeConstraints: constraints === null ? null : { update: () => constraints.update() },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      VRMUtils.deepDispose(root);
    },
  };
}
