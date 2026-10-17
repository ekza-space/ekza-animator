// WP-4 stubs: final signatures (MVP-SPEC §7 WP-4, §4.11.10); bodies throw until the bake lands.
import { EkzaError, type Frame } from '@ekza-animator/anim-core';
import type { BakedClip, BakeOptions, EkzaAnimationV1, PoseSource } from '../types';

export function bakeClip(_source: PoseSource, _opts: BakeOptions): BakedClip {
  throw new EkzaError('not-implemented', 'io.bakeClip');
}

export function ekzaAnimationMeta(
  _clips: readonly BakedClip[],
  _rig: 'vrm-humanoid' | 'gltf-nodes',
  _provenance: Omit<EkzaAnimationV1['provenance'], 'tool' | 'derivedFrom'>,
): EkzaAnimationV1 {
  throw new EkzaError('not-implemented', 'io.ekzaAnimationMeta');
}

export function clipFramesToSeconds(_frames: Frame, _fps: { readonly num: number; readonly den: number }): number {
  throw new EkzaError('not-implemented', 'io.clipFramesToSeconds');
}
