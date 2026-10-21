// Live skinned display in Rig & Skin (M6B-SPEC §4.7; C1 body, C6 the weight display under `skin/display/**`). C0 stub:
// the class with its final surface; the constructor fails `not-implemented` until C1 lands it.
import { EkzaError } from '@ekza-studio/anim-core';
import type { MeshData, Normals, SkinWeights, Triangulation } from '@ekza-studio/mesh-core';
import type { Object3D } from 'three';
import type { MeshPaneDisplay, MeshViewLayers, MeshViewTheme } from '../types';

export class SkinnedSurface {
  readonly root!: Object3D;

  constructor(_opts: { readonly theme: MeshViewTheme; readonly layers: MeshViewLayers }) {
    throw new EkzaError('not-implemented', 'mesh-view.SkinnedSurface');
  }

  setData(
    _data: MeshData,
    _tri: Triangulation,
    _normals: Normals,
    _skin: SkinWeights,
    _paint: ReadonlyMap<number, readonly [number, number, number]> | null,
    _paletteToBone: Int32Array,
  ): void {}
  /** Bone matrices (16 × bones, character space) and inverse binds (16 × bones); called once per pose version. */
  setBones(_boneWorld: Float64Array, _inverseBind: Float64Array): void {}
  /** Partial `skinIndex`/`skinWeight` uploads (`addUpdateRange`) for the changed points. */
  updateWeights(_skin: SkinWeights, _changed: Uint32Array | 'all'): void {}
  /** Uniform-only switch of the active influence: uploads nothing (gate §5.25). */
  setWeightDisplay(
    _mode: 'off' | 'greyscale' | 'ramp' | 'influences',
    _active: number,
    _held: Uint8Array | null,
    _lockRelative: boolean,
  ): void {}
  /** CPU-skinned positions (posed painting and picking; refit after each pose change). */
  cpuSkin(_out: Float32Array): void {}
  setWorld(_matrix: Float64Array): void {}
  applyPane(_display: MeshPaneDisplay): void {}
  dispose(): void {}
}
