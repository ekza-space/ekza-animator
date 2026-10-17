// '@ekza-animator/io/testing' (Node; WP-0b, then WP-4). Final signature (MVP-SPEC §7 WP-4); throws until it lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { VRM } from '@pixiv/three-vrm';
import type { Object3D } from 'three';

export function loadGltfInNode(_bytes: Uint8Array): Promise<{
  readonly scene: Object3D;
  readonly vrm: VRM | null;
  readonly nodeByIndex: readonly (Object3D | null)[];
}> {
  throw new EkzaError('not-implemented', 'io/testing.loadGltfInNode');
}
