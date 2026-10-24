// Public types of `@ekza-studio/mesh-wasm` (MODELING-PLAN §7.2 G-a): the intake chain's arguments, its job (what the
// editor posts to the worker) and its result. Plain data and typed arrays only, so a job and its result cross the
// worker boundary by structured clone with their buffers transferred.
import type { MeshData } from '@ekza-studio/mesh-core';

/** An RGBA8 image, rows top to bottom (glTF's UV (0, 0) is the top-left texel), colours sRGB-encoded. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
}

/** The base colour of one material (glTF `pbrMetallicRoughness`): its factor (linear RGBA) and texture, if any. */
export interface BaseColourSource {
  readonly factor: readonly [number, number, number, number];
  readonly texture: {
    readonly image: RgbaImage;
    /** TEXCOORD set the texture reads: 0 → the `uv0` layer, 1 → `uv1`. */
    readonly texCoord: number;
    readonly wrapS: number;
    readonly wrapT: number;
  } | null;
}

/** A signed axis of the source's frame. */
export type SignedAxis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** Where normalize puts the model's origin. */
export type NormalizeOrigin = 'bottom-center' | 'center' | 'keep';

/** `mesh.normalize`: the source's up and forward axes, its unit, a target height and the origin rule. */
export interface NormalizeArgs {
  /** The axis the model faces in the source (Tripo exports +X by default); it becomes +Z. */
  readonly forward: SignedAxis;
  /** The source's up axis; it becomes +Y. */
  readonly up: SignedAxis;
  /** Metres per source unit (1 m, 0.01 cm, 0.001 mm, 0.0254 in). */
  readonly unit: number;
  /** Uniform scale to this height in metres (after the unit); null keeps the size. */
  readonly height: number | null;
  readonly origin: NormalizeOrigin;
}

/** `mesh.reduce` (meshoptimizer `simplifyWithAttributes`). */
export interface ReduceArgs {
  /** Triangle budget for all meshes of the job together. */
  readonly triangles: number;
  /** Attribute weight of the texture coordinates (keeps texture placement). */
  readonly uvWeight: number;
  /** Attribute weight of the smooth vertex normals (keeps shading features). */
  readonly normalWeight: number;
  /** `vertex_lock` on UV-seam vertices: they never move (crack-free either way: seams collapse only along themselves). */
  readonly lockSeams: boolean;
  /** `vertex_lock` on material and palette borders: colour boundaries keep every vertex. */
  readonly lockPalette: boolean;
  /** meshoptimizer `LockBorder`: open borders keep every vertex. */
  readonly lockBorder: boolean;
  /** meshoptimizer `Regularize` (more even triangles, better under skinning); null: on for skinned meshes. */
  readonly regularize: boolean | null;
  /** meshoptimizer `Prune`: small disconnected parts may disappear. */
  readonly prune: boolean;
  /** Edges whose faces meet more sharply than this (radians) are hard after the reduce (normals are recomputed). */
  readonly hardAngle: number;
}

/** The kernel's `mesh.quadrangulate` on the whole mesh (Q-MOD-K-9: automatic only in the intake preset). */
export interface QuadrangulateArgs {
  readonly angle: number;
}

/** `mesh.paletteBake`: area-weighted base-colour samples, k-means in OKLab, per-face `paint` slots. */
export interface PaletteBakeArgs {
  /** At most this many colours (fewer when the model has fewer distinct ones). */
  readonly colours: number;
  /** Base-colour samples per triangle (a fixed low-discrepancy pattern). */
  readonly samples: number;
}

export type IntakeStep =
  | { readonly kind: 'normalize'; readonly args: NormalizeArgs }
  | { readonly kind: 'reduce'; readonly args: ReduceArgs }
  | { readonly kind: 'quadrangulate'; readonly args: QuadrangulateArgs }
  | { readonly kind: 'paletteBake'; readonly args: PaletteBakeArgs };

/** One mesh of a job. */
export interface IntakeMeshIn {
  /** The caller's key (a MeshId); results come back under it. */
  readonly key: string;
  readonly data: MeshData;
  /** World-from-local, column-major 4×4 (normalize bakes it into the data). */
  readonly world: readonly number[];
  /** The mesh has skin weights (Regularize by default; normalize refuses it). */
  readonly skinned: boolean;
  /** Per face-material slot: the index of its base colour in `IntakeJob.sources`, or null (white). */
  readonly materials: readonly (number | null)[];
}

/** What the editor posts to the worker: the meshes, their base colours and the steps, in order. */
export interface IntakeJob {
  readonly meshes: readonly IntakeMeshIn[];
  readonly sources: readonly BaseColourSource[];
  readonly steps: readonly IntakeStep[];
}

export interface IntakeWarning {
  readonly code: string;
  readonly message: string;
}

/** One step's numbers (the report the post-chain dialog and the wp-note budgets read). */
export interface IntakeStepReport {
  readonly kind: IntakeStep['kind'];
  readonly ms: number;
  readonly trianglesBefore: number;
  readonly trianglesAfter: number;
  /** Step facts: normalize's scale and height, reduce's error and search, quadrangulate's quads, the bake's colours. */
  readonly facts: Readonly<Record<string, number | string | boolean>>;
}

export interface IntakeMeshOut {
  readonly key: string;
  readonly data: MeshData;
  /** True when normalize baked the world transform in: the data is in world space (identity placement). */
  readonly world: boolean;
}

export interface IntakeResult {
  readonly meshes: readonly IntakeMeshOut[];
  /** The baked palette (sRGB 8-bit; slot = index), or null when no palette bake ran. */
  readonly palette: readonly (readonly [number, number, number])[] | null;
  readonly steps: readonly IntakeStepReport[];
  readonly warnings: readonly IntakeWarning[];
  /** Milliseconds of the whole job inside the worker (or the thread that ran it). */
  readonly ms: number;
}
