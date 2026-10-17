// three.js GLTFLoader + VRMLoaderPlugin in Node (shared test kit, MVP-SPEC §7 WP-0b). The approach follows
// ekza-avatar-renderer's test/vrm1Retarget.test.ts: Node has no image decoder and GLTFLoader waits on it, so
// `self` and `createImageBitmap` are stubbed while a load runs. Textures do not affect skeletons or motion.
import { type VRM, VRMLoaderPlugin } from '@pixiv/three-vrm';
import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readGlbJson, skeletonNodeOrder } from './nodeOrder';

export interface NodeGltf {
  /** The glTF default scene (`vrm.scene` for VRM files). */
  readonly scene: Object3D;
  /** Loaded with three-vrm's default options (autoUpdateHumanBones: true); never `VRMUtils.rotateVRM0`. */
  readonly vrm: VRM | null;
  /** Objects by SkeletonDesc node index (see `skeletonNodeOrder`); null for nodes outside the default scene. */
  readonly nodeByIndex: readonly (Object3D | null)[];
  /** three's clips (`gltf.animations`), for the `readAnimations` parity gate (§6.3); not attached to `scene`. */
  readonly animations: readonly AnimationClip[];
}

/** Loads a GLB/VRM with three.js in Node. Throws EkzaError('not-glb') for anything but a GLB. */
export async function loadGltfInNode(bytes: Uint8Array): Promise<NodeGltf> {
  const order = skeletonNodeOrder(readGlbJson(bytes));
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await withImageStub(() => loader.parseAsync(bytes.slice().buffer, ''));
  const byGltfIndex = new Map<number, Object3D>();
  gltf.scene.traverse((object) => {
    const index = gltf.parser.associations.get(object)?.nodes;
    if (index !== undefined && !byGltfIndex.has(index)) byGltfIndex.set(index, object);
  });
  const vrm: unknown = gltf.userData['vrm'];
  return {
    scene: gltf.scene,
    vrm: vrm === undefined ? null : (vrm as VRM),
    nodeByIndex: order.map((gltfIndex) => byGltfIndex.get(gltfIndex) ?? null),
    animations: gltf.animations,
  };
}

let activeLoads = 0;
let restoreGlobals: (() => void) | null = null;

/** Installs the globals for the duration of the outermost concurrent load and restores them afterwards. */
async function withImageStub<T>(load: () => Promise<T>): Promise<T> {
  if (activeLoads++ === 0) restoreGlobals = installImageStub();
  try {
    return await load();
  } finally {
    if (--activeLoads === 0) {
      restoreGlobals?.();
      restoreGlobals = null;
    }
  }
}

function installImageStub(): () => void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const installed: string[] = [];
  const define = (name: string, value: unknown): void => {
    if (name in scope) return;
    scope[name] = value;
    installed.push(name);
  };
  // GLTFLoader reads `self.URL` for embedded images and switches to ImageBitmapLoader when createImageBitmap exists.
  define('self', globalThis);
  define('createImageBitmap', () => Promise.resolve({ width: 1, height: 1, close: () => {} }));
  return () => {
    for (const name of installed) delete scope[name];
  };
}
