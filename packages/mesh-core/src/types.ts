// Contract file: M6A-SPEC §4.3 (the mesh kernel's public types), copied verbatim (shapes are normative; change the spec
// first). Excluded from formatting in biome.json so it stays diffable against the spec. Only `interface`/`type`
// declarations live here (§4 placement rule); the `function`, `class` and `const` lines of §4.3 are implementation
// modules re-exported from the package root (`BitSet` is ./bitset.ts; the type import below is its declaration).
import type { ParamDef, ParamValues, ReadonlyVec3, ReadonlyXf, Vec3, AnimCurve, CurveEngine } from '@ekza-studio/anim-core';
import type { BitSet } from './bitset';

// ---------- counts, domains, layers ----------
export interface MeshCounts { readonly points: number; readonly edges: number; readonly faces: number; readonly corners: number }
export type Domain = 'point' | 'edge' | 'face' | 'corner';
export type LayerType = 'f32' | 'u8' | 'u16' | 'u32';
export type LayerInterp = 'linear' | 'copy' | 'skin' | 'unit' | 'or' | 'clear';
export type LayerMirror = 'none' | 'negate-axis' | 'swap-side' | 'flip-u';
export interface LayerDef {
  readonly name: string;                       // built-ins below; 'morph:<name>', 'group:<name>', 'vendor.name'
  readonly domain: Domain;
  readonly type: LayerType;
  readonly comps: 1 | 2 | 3 | 4;
  readonly interp: LayerInterp;
  readonly mirror: LayerMirror;
  readonly default: readonly number[];         // length comps; the implicit tail value (§5.20)
  /** Layer metadata, serialized in the manifest (skin palette: { joints: [{ id, parent }] }). */
  readonly meta?: Readonly<Record<string, unknown>>;
}
/** A layer's values; writes go through the owning mesh's log. Index = element index in the layer's domain. */
export interface AttrLayer {
  readonly def: LayerDef;
  get(index: number, comp?: number): number;
  set(index: number, comp: number, value: number): void;           // logged; float layers through Math.fround
  read(index: number, out: Float64Array, offset?: number): void;   // all comps
  /** Direct read access. The view may be longer than count × comps (capacity growth, research 13 K-1); only the
   *  first count × comps values are meaningful, and a view taken before a write may be stale after it. */
  readonly data: Readonly<Float32Array | Uint8Array | Uint16Array | Uint32Array>;
}

// ---------- stored form ----------
/** Immutable stored form of a revision: dense, exact-length arrays. */
export interface MeshData {
  readonly counts: MeshCounts;
  readonly position: Float32Array;     // 3P, mesh-local metres
  readonly edgeVerts: Uint32Array;     // 2E, unordered endpoints (stored order defines t = 0 at index 0)
  readonly edgeFlags: Uint8Array;      // E
  readonly cornerVert: Uint32Array;    // C, vertex at the corner (face winding order, CCW seen from the front)
  readonly cornerNext: Uint32Array;    // C, next corner of the same face
  readonly faceCorner: Uint32Array;    // F, first corner
  readonly faceMaterial: Uint16Array;  // F, material slot
  readonly faceFlags: Uint8Array;      // F
  readonly layers: ReadonlyMap<string, { readonly def: LayerDef; readonly data: Float32Array | Uint8Array | Uint16Array | Uint32Array }>;
}

// ---------- edit form ----------
export interface EditMesh {
  readonly counts: MeshCounts;
  readonly position: Readonly<Float32Array>;   // read access; writes via setPosition
  // traversal (allocation-free; −1 = none)
  cornerVert(c: number): number; cornerNext(c: number): number; cornerPrev(c: number): number;
  cornerEdge(c: number): number; cornerFace(c: number): number; cornerRadialNext(c: number): number;
  edgeVert(e: number, end: 0 | 1): number; edgeCorner(e: number): number; edgeDiskNext(e: number, v: number): number;
  edgeOther(e: number, v: number): number; findEdge(a: number, b: number): number;
  vertEdge(v: number): number; faceCorner(f: number): number; faceLen(f: number): number;
  edgeFaceCount(e: number): number; vertValence(v: number): number; isManifoldVert(v: number): boolean;
  edgeFlags(e: number): number; faceFlags(f: number): number; faceMaterial(f: number): number;
  // Euler operators (logged; the only topology API)
  makeVert(x: number, y: number, z: number): number; killVert(v: number): void;
  makeEdge(a: number, b: number): number; killEdge(e: number): void;
  makeFace(verts: ArrayLike<number>, opts?: { readonly material?: number; readonly example?: number }): number;
  killFace(f: number): void;
  splitEdgeMakeVert(e: number, t: number): number;   // t from edgeVert(e, 0); layers interpolated by their rules
  joinEdgeKillVert(v: number): number;               // dissolve a valence-2 vertex; returns the joined edge
  splitFaceMakeEdge(f: number, cA: number, cB: number): number;   // caller guarantees the chord is inside (§5.11)
  joinFaceKillEdge(e: number): number;               // refuses non-manifold or same-face edges (EkzaError)
  reverseFace(f: number): void;
  // value writes (logged)
  setPosition(v: number, x: number, y: number, z: number): void;
  setEdgeFlags(e: number, flags: number): void; setFaceFlags(f: number, flags: number): void;
  setFaceMaterial(f: number, slot: number): void;
  layer(name: string): AttrLayer | undefined;
  addLayer(def: LayerDef): AttrLayer;                // logged; an existing name returns the existing layer
  removeLayer(name: string): void;                   // logged
  layers(): readonly AttrLayer[];
  // transactions (write log, ADR 0014 §5)
  begin(opId: string): void;
  end(): MeshDelta;                                  // coalesced log = exact undo patch
  abort(): void;                                     // restores the exact pre-begin state
  readonly inTransaction: boolean;
  apply(delta: MeshDelta, dir: 'forward' | 'backward'): void;   // O(|delta|), exact for stored and edit arrays
  snapshot(): MeshData;                              // dense copy of the stored subset
}

// ---------- write log ----------
export interface DomainRemap {
  /** Index after the op for every index before it (−1 = removed); null when no index of the domain moved. */
  readonly forward: Int32Array | null;
  /** Elements with index ≥ createdFrom in the after state were created by the op. */
  readonly createdFrom: number;
}
export type ElementRemap = Readonly<Record<Domain, DomainRemap>>;
export interface DirtySet {
  readonly topology: boolean;                        // any count or connectivity change
  readonly points: Uint32Array | 'all';              // sorted; position or point-layer writes
  readonly edges: Uint32Array | 'all';
  readonly faces: Uint32Array | 'all';
  readonly corners: Uint32Array | 'all';
  readonly layers: readonly string[];                // layers written, added or removed
}
export interface MeshDelta {
  readonly opId: string;
  readonly countsBefore: MeshCounts;
  readonly countsAfter: MeshCounts;
  readonly remap: ElementRemap;
  readonly dirty: DirtySet;
  readonly bytes: number;                            // retained size (journal cap accounting)
  /** Opaque; only `EditMesh.apply` reads it. Large ops switch to copy-on-write array snapshots (> P/4 slots). */
  readonly writes: unknown;
}

// ---------- components, selection, hiding ----------
export type ComponentKind = 'vertex' | 'edge' | 'face';
/** Kernel value object: the selection an op runs on. Bitsets per kind are kept for every kind (per-mode memory). */
export interface ComponentSelection {
  readonly kind: ComponentKind;
  readonly verts: BitSet; readonly edges: BitSet; readonly faces: BitSet;
  readonly order: Uint32Array | null;                // pick order in `kind`'s domain (Bridge, Target Weld, partial loops)
  readonly active: number;                           // lead component of `kind`, −1 = none
}
export interface HiddenSet { readonly verts: BitSet; readonly edges: BitSet; readonly faces: BitSet }

// ---------- operations ----------
export interface Refusal { readonly refused: true; readonly code: string; readonly reason: string }
/** Codes include `symmetry.unmatched-partner` (§5.14): components without a mirror partner were processed on their
 *  own side only; `count` = how many. */
export interface OpWarning { readonly code: string; readonly message: string; readonly count?: number; readonly elements?: Uint32Array }
export interface OpFrame { readonly pivot: Vec3; readonly axes: readonly [Vec3, Vec3, Vec3] }   // manipulator placement (mesh-local)
export interface SymmetryContext {
  readonly map: SymmetryMap;                         // built by buildSymmetryMap (§5.14) for the current revision
  readonly preserveSeam: boolean;
}
export interface SoftContext { readonly radius: number; readonly falloff: 'volume' | 'surface'; readonly curve: FalloffCurve }
export interface OpContext {
  readonly symmetry: SymmetryContext | null;
  readonly hidden: HiddenSet | null;
  /** Placement of the mesh (world from local), for world-space args and world-space soft radii. */
  readonly placement: ReadonlyXf;
  readonly faceted: boolean;                         // resolves nullable smoothingAngle (§5.3)
  readonly soft: SoftContext | null;
  readonly curves: CurveEngine;                      // anim-core engine for custom falloff curves
  /** Scale-relative epsilon: 1e-6 × bounding-box diagonal (min 1e-9 m). */
  readonly epsilon: number;
}
export interface OpResult {
  readonly selection: ComponentSelection;            // the new selection (the usual DCC behaviour)
  readonly warnings: readonly OpWarning[];
  readonly frame?: OpFrame;                          // extrude cap frame, bevel handle frame …
  /** Fast path for continuous value args during a live preview; false → caller reverts and re-runs. */
  readonly adjust?: (patch: ParamValues) => boolean;
  readonly resolvedArgs: ParamValues;                // args after defaults, coercion and selection-bound resolution
}
export interface OpFlags {
  readonly adjustable: boolean;                      // Last-op card / edit.adjustLast
  readonly repeatable: boolean;                      // edit.repeatLast (G); false for pointer-only targets
  readonly topology: boolean;                        // false = positions/flags/layers only (refit, not rebuild)
  readonly manifoldPreserving: boolean;              // P3 class (§5.29)
  readonly whole?: boolean;                          // acts on the whole mesh (object mode), ignores selection
}
/** *descriptors* (eager, `./descriptors`): everything menus, keymap, palette, option boxes and cards need. */
export interface MeshOpDescriptor {
  readonly id: `mesh.${string}`;
  readonly label: string;                            // the DCC-standard name
  readonly kinds: readonly ComponentKind[] | 'object';
  readonly params: readonly ParamDef[];
  readonly flags: OpFlags;
  readonly symmetry: 'expand' | 'pointer' | 'none';  // §5.14 class
}
export interface MeshSetOpDescriptor {
  readonly id: `mesh.${string}`;
  readonly label: string;
  readonly arity: 'one' | 'many';
  readonly params: readonly ParamDef[];
  readonly flags: OpFlags;
}
/** One-mesh operation (ADR 0014 D7). Pure and deterministic; writes only through `m` inside begin/end, which the
 *  caller (MeshRuntime or a test) opens and closes. A refusal after writes is allowed: the caller aborts the log. */
export interface MeshOp<A extends ParamValues = ParamValues> extends MeshOpDescriptor {
  poll(m: EditMesh, sel: ComponentSelection | null, ctx: OpContext): true | Refusal;
  run(m: EditMesh, sel: ComponentSelection | null, args: A, ctx: OpContext): OpResult | Refusal;
}

// ---------- mesh set operations ----------
export interface MeshSetInput {
  readonly key: string;                              // the MeshId
  readonly mesh: EditMesh;
  readonly selection: ComponentSelection | null;
  readonly placement: ReadonlyXf;                    // world from local
  readonly palette: string | null;                   // PaletteId
  readonly skeleton: string | null;                  // SkeletonId of a model skin, or 'asset:<id>:<skin>'
  readonly assetBacked: boolean;                     // record has `source`
  readonly materials: readonly string[];             // identity key per material slot ('preset:unlit', 'asset:<id>:<n>')
}
export interface MeshSetOutput {
  readonly key: string;                              // an input key (record updated) or 'new:<n>' (record created)
  readonly data: MeshData;
  readonly placement: ReadonlyXf;
  readonly materials: readonly string[];
  readonly from: readonly string[];                  // input keys the output's geometry came from
  readonly selection: ComponentSelection | null;
  readonly name: string;                             // proposed name ('Extracted'); '' = the source record's (numbered)
}
export interface MeshSetResult {
  readonly outputs: readonly MeshSetOutput[];
  readonly removed: readonly string[];               // input keys whose records are soft-deleted
  readonly warnings: readonly OpWarning[];
}
/** arity: Separate/Extract/Duplicate Faces 'one'; Combine 'many' (≥ 2). flags.adjustable holds only while the re-run
 *  yields the same record set. */
export interface MeshSetOp<A extends ParamValues = ParamValues> extends MeshSetOpDescriptor {
  poll(inputs: readonly MeshSetInput[], args: A): true | Refusal;
  run(inputs: readonly MeshSetInput[], args: A, ctx: Omit<OpContext, 'placement' | 'symmetry' | 'soft'>): MeshSetResult | Refusal;
}
/** Remap helpers shared by MeshSetOps (B4). */
export interface SubsetResult {
  readonly data: MeshData;
  readonly remap: { readonly points: Int32Array; readonly edges: Int32Array; readonly faces: Int32Array; readonly corners: Int32Array };
}
export interface AppendResult {
  readonly materialSlots: Int32Array;                // b's slot → a's slot
  readonly paintSlots: Int32Array | null;            // b's palette slot → a's (identity when palettes match)
  readonly morphLayers: readonly string[];           // union, a's manifest order first
  readonly jointPalette: readonly string[] | null;   // union, a's order first; b's joint indices remapped
}

// ---------- validation, stats ----------
export interface MeshProblem { readonly code: string; readonly message: string; readonly elements?: Uint32Array; readonly domain?: Domain }
export interface TopologyStats {
  readonly shells: number; readonly boundaryLoops: number; readonly euler: number;   // χ = V − E + F
  readonly nonManifoldEdges: number; readonly nonManifoldVerts: number; readonly genus: number | null;
  readonly triangles: number; readonly ngons: number;
}

// ---------- revisions ----------
export interface RevisionManifest {
  readonly format: 'ekza-mesh';
  readonly version: 1;
  readonly counts: MeshCounts;
  readonly bounds: readonly [ReadonlyVec3, ReadonlyVec3] | null;
  readonly layers: readonly {
    readonly name: string;                           // stored arrays use reserved names '$position', '$edgeVerts', …
    readonly domain: Domain; readonly type: LayerType; readonly comps: number;
    readonly interp: LayerInterp; readonly mirror: LayerMirror; readonly default: readonly number[];
    readonly meta?: Readonly<Record<string, unknown>>;
    readonly chunkElems: number;
    readonly chunks: readonly string[];              // sha256 hex; may end before the element count (implicit default tail)
  }[];
}
export interface RevisionOutput {
  readonly manifestBytes: Uint8Array;                // canonical JSON (sorted keys, shortest round-trip numbers)
  readonly manifestId: string;                       // sha256 hex of manifestBytes
  readonly manifest: RevisionManifest;
  readonly newChunks: ReadonlyMap<string, Uint8Array>;   // chunks not present in `previous`
}

// ---------- derived data (one function each, shared by viewport, picking, HUD and export) ----------
export interface Triangulation {
  readonly tris: Uint32Array;                        // corner indices × 3, CCW
  readonly triFace: Uint32Array;                     // face of each triangle
  readonly faceTriStart: Uint32Array;                // F + 1 prefix offsets into triFace
}
export interface Normals { readonly face: Float32Array /* 3F */; readonly corner: Float32Array /* 3C */ }

// ---------- selection walkers, soft selection, symmetry (B2) ----------
export type ConvertMode = 'touching' | 'contained' | 'perimeter' | 'border' | 'shell' | 'loop' | 'ring';
export type FalloffCurve = 'smooth' | 'linear' | 'sharp' | 'root' | 'sphere' | 'constant' | AnimCurve;
export type SymmetryAxis = 'x' | 'y' | 'z';
export interface SymmetryMap {
  readonly axis: SymmetryAxis;
  readonly space: 'object' | 'world';
  readonly plane: number;                            // plane offset along the axis in mesh-local units (world: transformed)
  readonly tolerance: number;                        // metres
  readonly vertex: Int32Array;                       // partner; −1 none; self = on the seam
  readonly edge: Int32Array;                         // partner edge; −1 none
  readonly edgeReversed: Uint8Array;                 // 1 when the partner runs the opposite direction (t ↦ 1 − t)
  /** Edges that are their own partner: 1 = **crossing** (endpoints are each other's partners, edgeReversed 1),
   *  2 = **in-seam** (both endpoints on the seam), 0 = otherwise (§5.14 pointer rule). */
  readonly edgeSelf: Uint8Array;
  readonly face: Int32Array;                         // partner face; −1 none
  readonly unmatched: number;                        // off-seam vertices without a partner
}

// ---------- loop gestures (B2), Mesh Check (B5), region frames (B3) ----------
export type LoopGesture = 'double' | 'shift-double' | 'mod-double';   // mod = Cmd on macOS, Ctrl elsewhere (§5.6)
export type CheckCode = 'non-manifold-edge' | 'non-manifold-vertex' | 'lamina' | 'zero-length-edge' | 'zero-area-face'
  | 'inconsistent-winding' | 'nonplanar-ngon' | 'concave-ngon' | 'ngon-degenerate' | 'stray-vertex' | 'loose-geometry'
  | 'open-border' | 'duplicate-slot';

// ---------- primitives, templates (B1, B13) ----------
export type PrimitiveKind = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus' | 'humanoidBody';
