// '@ekza-animator/io/three' (browser; three + @pixiv/three-vrm). Final signatures (MVP-SPEC §7 WP-4); the loader
// throws until WP-4 lands.
import { EkzaError } from '@ekza-animator/anim-core';
import type { SkeletonDesc } from '@ekza-animator/rig';
import type { VRM } from '@pixiv/three-vrm';
import type { Object3D, SkinnedMesh } from 'three';
import type { GlbContainer } from '../types';

export interface LoadedModel {
  /** Canonical character root (facing applied here only). */
  readonly root: Object3D;
  /** By SkeletonDesc node index. */
  readonly nodeObjects: readonly (Object3D | null)[];
  readonly skinnedMeshes: readonly SkinnedMesh[];
  /** Loaded with autoUpdateHumanBones: false; never rotateVRM0. */
  readonly vrm: VRM | null;
  readonly springBones: { update(deltaSeconds: number): void; reset(): void } | null;
  /** VRMNodeConstraintManager. */
  readonly nodeConstraints: { update(): void } | null;
  dispose(): void;
}

export function createThreeModelLoader(_opts: { readonly decoderPath: string }): {
  /** KTX2Loader.detectSupport; call before load. */
  setRenderer(renderer: unknown): void;
  load(
    c: GlbContainer,
    skeleton: SkeletonDesc,
  ): Promise<{ readonly kind: 'three'; readonly handle: LoadedModel; dispose(): void }>;
} {
  throw new EkzaError('not-implemented', 'io/three.createThreeModelLoader');
}
