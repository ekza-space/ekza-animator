// Live skinned display in Rig & Skin (M6B-SPEC §4.7, §5.1; C1 body, C6 the weight display under `skin/display/**`):
// the bound mesh's surface (M6a's shaded corner surface, wire and hard edges, palette paint, pane display rules)
// deformed by linear blend skinning with bind = rest: p' = Σ w · boneWorld · inverseBind · p.
//
// - `setData` builds the surface at the bind pose and adds per-corner `skinIndex` (u16 × 4, bone indices through
//   `paletteToBone`) and `skinWeight` (f32 × 4) attributes for the weight display (C6) and for GPU skinning later;
// - `setBones` (once per pose version) skins on the CPU: posed point positions and corner normals (the linear part of
//   the blended matrix, renormalized), uploaded in full; the posed points are what `cpuSkin` hands to posed picking
//   and painting (refit the BVH after each pose change);
// - `updateWeights` re-skins only the changed points and uploads only their corners' ranges (`addUpdateRange`);
// - `setWeightDisplay` records the display state; switching the active influence uploads nothing (C6 draws it).
// CPU skinning is the MVP path (≤ 0.2 ms per pose at 3k points, §5.25's 4 ms frame budget); a GPU path can use the
// same attributes without changing the class surface.
import type { MeshData, Normals, SkinWeights, Triangulation } from '@ekza-studio/mesh-core';
import { BufferAttribute } from 'three';
import { ViewBase } from '../internal/base';
import { addRange, uploadAll } from '../internal/ranges';
import { copyPalette } from '../internal/sets';
import { type Csr, type Topo, topoOfData, vertexCorners } from '../internal/topo';
import { STATE } from '../style';
import type { MeshViewThemeInput } from '../theme';
import type { MeshPaneDisplay, MeshViewLayers } from '../types';
import { EDGE_HARD } from '@ekza-studio/mesh-core';

export type WeightDisplayMode = 'off' | 'greyscale' | 'ramp' | 'influences';

export class SkinnedSurface extends ViewBase {
  private data: MeshData | null = null;
  private skin: SkinWeights | null = null;
  private paletteToBone: Int32Array = new Int32Array(0);
  private bind: Float32Array = new Float32Array(0);
  private bindNormals: Float32Array = new Float32Array(0);
  private bindFaceNormals: Float32Array = new Float32Array(0);
  private posed: Float32Array = new Float32Array(0);
  private posedNormals: Float32Array = new Float32Array(0);
  /** Skinning matrices (16 × bones, column-major) of the last `setBones`, or null at the bind pose. */
  private matrices: Float64Array | null = null;
  private cornersOf: Csr = { start: new Uint32Array(1), items: new Uint32Array(0) };
  private skinIndex = new BufferAttribute(new Uint16Array(0), 4);
  private skinWeight = new BufferAttribute(new Float32Array(0), 4);
  /** Bytes the last `updateWeights`/`setWeightDisplay` uploaded (the §5.25 "0 bytes" gate reads it in tests). */
  uploadedBytes = 0;
  /** The weight display state (C6 draws it). */
  weightDisplay: {
    readonly mode: WeightDisplayMode;
    readonly active: number;
    readonly held: Uint8Array | null;
    readonly lockRelative: boolean;
  } = { mode: 'off', active: -1, held: null, lockRelative: false };

  constructor(opts: { readonly theme: MeshViewThemeInput; readonly layers: MeshViewLayers }) {
    super(opts);
    this.root.name = 'ekza-skinned-surface';
  }

  /**
   * Builds the bind-pose surface (stored form, its triangulation and normals) with the skin of its points and the
   * palette colours. `paletteToBone` maps each palette index of `skin` to a bone index of `setBones` (−1: none).
   */
  setData(
    data: MeshData,
    tri: Triangulation,
    normals: Normals,
    skin: SkinWeights,
    paint: ReadonlyMap<number, readonly [number, number, number]> | null,
    paletteToBone: Int32Array,
  ): void {
    const t = topoOfData(data);
    this.data = data;
    this.topo = t;
    this.tri = tri;
    this.normals = normals;
    this.skin = skin;
    this.paletteToBone = Int32Array.from(paletteToBone);
    this.bind = Float32Array.from(data.position);
    this.bindNormals = Float32Array.from(normals.corner);
    this.bindFaceNormals = Float32Array.from(normals.face);
    this.posed = Float32Array.from(data.position);
    this.posedNormals = Float32Array.from(normals.corner);
    this.position = this.posed;
    this.cornersOf = vertexCorners(t);
    this.surface.build(t, this.posed, tri, normals, null);
    this.surface.writePaint(t, data.layers.get('paint')?.data ?? null, copyPalette(paint));
    this.edges.setGeometry(t.edges);
    this.writeEdgeSegments(t, null);
    const state = this.edges.state.array as Uint8Array;
    for (let e = 0; e < t.edges; e++) state[e] = ((t.ef[e] as number) & EDGE_HARD) !== 0 ? STATE.hard : 0;
    uploadAll(this.edges.state);
    this.writeSkinAttributes(t, 'all');
    this.normalsDirty = true;
    this.diagonalsDirty = true;
    if (this.matrices !== null) this.skinPoints('all');
  }

  /**
   * Bone world matrices and inverse binds (16 × bones each, character space); called once per pose version. Re-skins
   * every point and uploads the posed surface.
   */
  setBones(boneWorld: Float64Array, inverseBind: Float64Array): void {
    const bones = Math.min(boneWorld.length, inverseBind.length) >> 4;
    const out =
      this.matrices !== null && this.matrices.length === 16 * bones ? this.matrices : new Float64Array(16 * bones);
    for (let b = 0; b < bones; b++) multiply(boneWorld, 16 * b, inverseBind, 16 * b, out, 16 * b);
    this.matrices = out;
    this.skinPoints('all');
  }

  /** New weights for the given points ('all' = every point): partial `skinIndex`/`skinWeight` uploads. */
  updateWeights(skin: SkinWeights, changed: Uint32Array | 'all'): void {
    this.skin = skin;
    const t = this.topo;
    if (t === null) return;
    this.uploadedBytes = this.writeSkinAttributes(t, changed);
    if (this.matrices !== null) this.skinPoints(changed);
  }

  /** Uniform-only switch of the active influence: uploads nothing (gate §5.25). */
  setWeightDisplay(mode: WeightDisplayMode, active: number, held: Uint8Array | null, lockRelative: boolean): void {
    this.weightDisplay = { mode, active, held, lockRelative };
    this.uploadedBytes = 0;
  }

  /** CPU-skinned point positions (3 per point, mesh space) at the last `setBones`; the bind pose before. */
  cpuSkin(out: Float32Array): void {
    out.set(this.posed.subarray(0, Math.min(out.length, this.posed.length)));
  }

  /** The displayed stored form (null before the first `setData`). */
  get current(): MeshData | null {
    return this.data;
  }

  applyPane(display: MeshPaneDisplay): void {
    this.applyCommon(display, false);
  }

  /** Writes the corners' `skinIndex`/`skinWeight` of the changed points; returns the bytes uploaded. */
  private writeSkinAttributes(t: Topo, changed: Uint32Array | 'all'): number {
    const skin = this.skin;
    if (skin === null) return 0;
    const geometry = this.surface.mesh.geometry;
    if (
      changed === 'all' ||
      this.skinIndex.count !== t.corners ||
      geometry.getAttribute('skinIndex') !== this.skinIndex
    ) {
      this.skinIndex = new BufferAttribute(new Uint16Array(4 * t.corners), 4);
      this.skinWeight = new BufferAttribute(new Float32Array(4 * t.corners), 4);
      for (let c = 0; c < t.corners; c++) this.writeCorner(c, t.cv[c] as number);
      geometry.setAttribute('skinIndex', this.skinIndex);
      geometry.setAttribute('skinWeight', this.skinWeight);
      return 4 * t.corners * (2 + 4);
    }
    let bytes = 0;
    for (let k = 0; k < changed.length; k++) {
      const v = changed[k] as number;
      if (v >= t.points) continue;
      for (let i = this.cornersOf.start[v] as number; i < (this.cornersOf.start[v + 1] as number); i++) {
        const c = this.cornersOf.items[i] as number;
        this.writeCorner(c, v);
        addRange(this.skinIndex, 4 * c, 4);
        addRange(this.skinWeight, 4 * c, 4);
        bytes += 4 * (2 + 4);
      }
    }
    return bytes;
  }

  private writeCorner(c: number, v: number): void {
    const skin = this.skin as SkinWeights;
    const index = this.skinIndex.array as Uint16Array;
    const weight = this.skinWeight.array as Float32Array;
    for (let k = 0; k < 4; k++) {
      const bone = this.paletteToBone[skin.joints[4 * v + k] as number] ?? -1;
      index[4 * c + k] = bone < 0 ? 0 : bone;
      weight[4 * c + k] = bone < 0 ? 0 : (skin.weights[4 * v + k] as number);
    }
  }

  /** Linear blend skinning of the given points and their corners' normals, then the uploads. */
  private skinPoints(points: Uint32Array | 'all'): void {
    const t = this.topo;
    const skin = this.skin;
    const m = this.matrices;
    if (t === null || skin === null || m === null) return;
    const blended = new Float64Array(12);
    const skinPoint = (v: number): void => {
      blended.fill(0);
      let total = 0;
      for (let k = 0; k < 4; k++) {
        const w = skin.weights[4 * v + k] as number;
        if (!(w > 0)) continue;
        const bone = this.paletteToBone[skin.joints[4 * v + k] as number] ?? -1;
        if (bone < 0 || 16 * bone + 15 >= m.length) continue;
        const o = 16 * bone;
        for (let r = 0; r < 3; r++) {
          blended[r] = (blended[r] as number) + w * (m[o + r] as number);
          blended[3 + r] = (blended[3 + r] as number) + w * (m[o + 4 + r] as number);
          blended[6 + r] = (blended[6 + r] as number) + w * (m[o + 8 + r] as number);
          blended[9 + r] = (blended[9 + r] as number) + w * (m[o + 12 + r] as number);
        }
        total += w;
      }
      const x = this.bind[3 * v] as number;
      const y = this.bind[3 * v + 1] as number;
      const z = this.bind[3 * v + 2] as number;
      if (total === 0) {
        this.posed[3 * v] = x;
        this.posed[3 * v + 1] = y;
        this.posed[3 * v + 2] = z;
      } else {
        for (let r = 0; r < 3; r++) {
          this.posed[3 * v + r] =
            (blended[r] as number) * x +
            (blended[3 + r] as number) * y +
            (blended[6 + r] as number) * z +
            (blended[9 + r] as number);
        }
      }
      for (let i = this.cornersOf.start[v] as number; i < (this.cornersOf.start[v + 1] as number); i++) {
        const c = this.cornersOf.items[i] as number;
        const nx = this.bindNormals[3 * c] as number;
        const ny = this.bindNormals[3 * c + 1] as number;
        const nz = this.bindNormals[3 * c + 2] as number;
        if (total === 0) {
          this.posedNormals.set([nx, ny, nz], 3 * c);
          continue;
        }
        const a = (blended[0] as number) * nx + (blended[3] as number) * ny + (blended[6] as number) * nz;
        const b = (blended[1] as number) * nx + (blended[4] as number) * ny + (blended[7] as number) * nz;
        const d = (blended[2] as number) * nx + (blended[5] as number) * ny + (blended[8] as number) * nz;
        const length = Math.hypot(a, b, d) || 1;
        this.posedNormals[3 * c] = a / length;
        this.posedNormals[3 * c + 1] = b / length;
        this.posedNormals[3 * c + 2] = d / length;
      }
    };
    if (points === 'all') for (let v = 0; v < t.points; v++) skinPoint(v);
    else for (let k = 0; k < points.length; k++) if ((points[k] as number) < t.points) skinPoint(points[k] as number);
    this.surface.updatePositions(t, this.posed, 'all', this.cornersOf);
    this.surface.writeNormals(t, { face: this.bindFaceNormals, corner: this.posedNormals }, null);
    this.writeEdgeSegments(t, null);
    uploadAll(this.edges.start);
    uploadAll(this.edges.end);
    this.normalsDirty = true;
    this.diagonalsDirty = true;
  }
}

/** out[o..o+16] = a[ao..] · b[bo..] (column-major 4 × 4). */
function multiply(a: Float64Array, ao: number, b: Float64Array, bo: number, out: Float64Array, o: number): void {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[ao + 4 * k + row] as number) * (b[bo + 4 * col + k] as number);
      out[o + 4 * col + row] = sum;
    }
  }
}
