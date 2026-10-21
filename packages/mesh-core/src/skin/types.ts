// Contract file: M6B-SPEC §4.2 (skin value objects, the skeleton and geometry as the solvers see them, the sparse kit,
// triangle queries, bind, weight edits), copied verbatim (shapes are normative; change the spec first). Excluded from
// formatting in biome.json so it stays diffable against the spec. Only `interface`/`type` declarations live here (§4
// placement rule); the `function`, `class` and `const` lines of §4.2 are implementation modules under `skin/**` and
// `query/**`, re-exported from the package root (the lazy kernel chunk; nothing here is eager).
import type { ReadonlyVec3 } from '@ekza-studio/anim-core';

// ---------- skin value objects (C0 working baseline: readSkin, withSkin, readSkinReview) ----------
/** key: a JointId; 'node:<glTF node index>' for imported skins (CR-9). mirror: the partner's key or null (CR-6). */
export interface SkinPaletteEntry { readonly key: string; readonly parent: string | null; readonly mirror: string | null }
export interface SkinWeights {
  readonly points: number;
  readonly palette: readonly SkinPaletteEntry[];
  readonly joints: Uint16Array;              // 4·points palette indices, by descending weight (ties: smaller index); unused slots 0
  readonly weights: Float32Array;            // 4·points; weighted point: Σ = 1 ± 1e-6, ≤ 4 non-zero; unweighted point: all 0
}
export interface SkinReview {
  readonly reason: 'filled' | 'transferred';
  readonly source: string | null;            // manifest id of the source revision (transfer) or null (fill)
  readonly points: Uint32Array;              // ascending
}

// ---------- the skeleton and geometry as the solvers see them ----------
export interface SkinSkeleton {
  readonly keys: readonly string[];          // every joint, topological (parents first, then JointRecord.order, then id)
  readonly parent: Int32Array;               // −1 = root
  readonly head: Float64Array;               // 3J rest positions, character space
  readonly tail: Float64Array;               // 3J: humanoid-chain child, else first child, else JointRecord.tail, else head + 0.05·H along the parent direction
  readonly mirror: Int32Array;               // −1 none: JointRecord.mirror, then mirrorHumanBone, then the L/R name swap (§5.13)
  readonly side: Uint8Array;                 // 0 C, 1 L, 2 R
  readonly deform: Uint8Array;               // 1 = role 'bone'; 0 = 'helper' or 'prop': never a candidate of automatic
                                             // methods unless masked in (§5.9), never a fold or remainder target (§5.10)
  readonly humanBone: readonly (string | null)[];
  readonly height: number;                   // H
}
export interface SkinGeometry {
  readonly positions: Float64Array;          // 3P, character space (skinned meshes have identity placement, §5.1)
  readonly tris: Uint32Array;                // point indices × 3: M6a's one triangulation mapped corners → points
  readonly normals: Float64Array;            // 3P: angle-weighted point normals (unit; [0, 1, 0] when degenerate)
  readonly partner: Int32Array;              // the skin pipeline's own X partner map (−1 none, self = seam)
  readonly paired: number;                   // fraction of points with a partner (self counts), 0…1
}

// ---------- shared sparse kit (C4; C5 reuses it) ----------
/** Sign convention (binding for every solver): `cotLaplacian` returns the **positive semi-definite** operator
 *  Lpsd = −Δ (diagonal ≥ 0, off-diagonals −½(cot α + cot β), negative cotangents clamped to 0 when `clamp`). Heat is
 *  `(Lpsd + H)·w = H·p` (§5.9); inpainting is `Q = Lpsd + Lpsd·M⁻¹·Lpsd` (§5.14). */
export interface CsrMatrix { readonly n: number; readonly rowPtr: Int32Array; readonly col: Int32Array; readonly val: Float64Array }

// ---------- triangle queries (C0: brute-force reference; C2: BVH, identical results) ----------
export interface RayHit { readonly t: number; readonly tri: number; readonly front: boolean }   // front: dot(dir, n) < 0
/** The `TriangleBvh` class's instance shape (the class is `query/reference.ts` until C2 replaces it). */
export interface TriangleQueries {
  /** Every hit with 0 < t ≤ maxT, t ascending (ties by triangle index). */
  raycastAll(origin: ReadonlyVec3, dir: ReadonlyVec3, maxT?: number): readonly RayHit[];
  raycast(origin: ReadonlyVec3, dir: ReadonlyVec3, minT: number, maxT: number, ignore?: ReadonlySet<number>): RayHit | null;
  closestPoint(p: ReadonlyVec3, maxDistance?: number):
    { readonly tri: number; readonly bary: readonly [number, number, number]; readonly distance: number } | null;
}

// ---------- bind (C4; §5.9) ----------
export type BindMethod = 'auto-lowpoly' | 'closest' | 'rigid-islands' | 'heat';
export interface SkinBindArgs {
  readonly method: BindMethod;               // 'auto-lowpoly'
  readonly joints: readonly string[] | null; // influence mask (palette keys); null = every deforming joint; one key = rigid attach
  readonly points: readonly number[] | null; // point mask: only these points are re-solved, the others keep their weights
  readonly hierarchy: boolean;               // closest: true = Maya "Closest in hierarchy" (our reading), false = "Closest distance"
  readonly dropoff: number;                  // closest: 4 (0.1…10)
  readonly stiffness: number;                // heat: 1 (0.1…10); the role of Maya's falloff
  readonly pruneBelow: number;               // 0.025 (0…0.2)
  readonly rigidifyAbove: number | null;     // null = off; 0.5…1
  /** null = auto, resolved by the operator at invoke time (true when `SkinGeometry.paired ≥ 0.9` and the skeleton has
   *  mirror pairs) and recorded as a boolean in LastRun.args; bindSkin itself only accepts a boolean. */
  readonly symmetrize: boolean | null;
}
/** What `MeshRecord.skin.bind` stores after a **full** bind (never the point mask; masked runs and Auto Weights for
 *  Selected Joints leave it unchanged). Rebind… re-runs from it. */
export interface SkinBindRecord {
  readonly v: 1;
  readonly method: BindMethod; readonly hierarchy: boolean; readonly dropoff: number; readonly stiffness: number;
  readonly pruneBelow: number; readonly rigidifyAbove: number | null; readonly symmetrize: boolean;
  readonly joints?: readonly string[];       // only when the run had a joint mask
}
export interface BindReport {
  readonly islands: number; readonly rigidIslands: number; readonly heatIslands: number;
  readonly unreachable: Uint32Array;         // points of islands that saw no joint (rigid fallback, skin.unreachable-island)
  readonly cgIterations: number; readonly solveMs: number;
}

// ---------- weight edits (C5; §5.10–§5.13) ----------
export type PaintOp = 'replace' | 'add' | 'scale' | 'smooth';
/** Sparse per-stamp strengths of one stroke, in stamp order (§5.11). */
export interface StrokeStamp { readonly points: Uint32Array; readonly strength: Float32Array }
export interface WeightContext {
  readonly skeleton: SkinSkeleton;
  readonly geometry: SkinGeometry;           // adjacency for smooth/hammer/expand; partners for mirror strokes
  /** Held (locked) palette keys: never changed (§5.10). Operators resolve them from the session at invoke time and
   *  record them in their args (`holds`, §6.2), so adjust-last and M3 replay use the recorded set. */
  readonly holds: ReadonlySet<string>;
}
export type WeightEdit =
  | { readonly kind: 'set'; readonly points: ArrayLike<number>; readonly joint: string; readonly value: number;
      readonly mode: 'set' | 'add' | 'mul' }                                         // table cells; assign = set 1
  | { readonly kind: 'stroke'; readonly joint: string; readonly op: PaintOp; readonly value: number;
      readonly stamps: readonly StrokeStamp[]; readonly mirror: boolean }
  | { readonly kind: 'flood'; readonly points: ArrayLike<number>; readonly joint: string; readonly op: PaintOp;
      readonly value: number; readonly opacity: number; readonly mirror: boolean }
  | { readonly kind: 'smooth'; readonly points: ArrayLike<number>; readonly factor: number; readonly iterations: number;
      readonly expand: number }
  | { readonly kind: 'hammer'; readonly points: ArrayLike<number> }
  | { readonly kind: 'paste'; readonly points: ArrayLike<number>; readonly vector: readonly (readonly [string, number])[];
      readonly mirrorJoints: boolean }
  | { readonly kind: 'move'; readonly points: ArrayLike<number>; readonly from: string; readonly to: readonly string[];
      readonly fraction: number }
  | { readonly kind: 'prune'; readonly points: ArrayLike<number> | null; readonly below: number }
  | { readonly kind: 'normalize'; readonly points: ArrayLike<number> | null; readonly lockActive: string | null }
  | { readonly kind: 'rigidIslands'; readonly points: ArrayLike<number> }
  | { readonly kind: 'compact' };
/** Incremental stroke for the live preview (§5.11): works on private copies, O(stamp) per `addStamp`; `current()`
 *  shares its arrays (read-only for the caller). After any stamp sequence, `finish().skin` is **bit-identical** to
 *  `editWeights(skin, {kind: 'stroke', joint, op, value, stamps, mirror}, ctx).skin` (P-S2). */
export interface StrokeSession {
  addStamp(stamp: StrokeStamp): Uint32Array;                     // points changed by this stamp
  current(): SkinWeights;
  finish(): { readonly skin: SkinWeights; readonly changed: Uint32Array };
}
export interface TransferArgs { readonly method: 'inpaint' | 'closest-point' | 'closest-component';
  readonly distance: number /* fraction of the target bbox diagonal, 0.05 */; readonly angle: number /* 35° */ }
export type SkinProblemCode = 'skin.unweighted-vertex' | 'skin.influences' | 'skin.weight-sum' | 'skin.cross-side'
  | 'skin.joint-without-weights' | 'skin.dangling-joint' | 'skin.review' | 'skin.unreachable-island'
  | 'skin.non-deforming-weighted';
export interface SkinProblem { readonly code: SkinProblemCode; readonly points: Uint32Array; readonly joints: readonly string[] }
