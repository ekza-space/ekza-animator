# ADR 0014 — Mesh kernel: radial-edge structure of arrays, write log, deterministic operations

- Status: Accepted (2026-10-19, with [M6A-SPEC](../M6A-SPEC.md) v1.0; proposed 2026-10-18, revised 2026-10-19 after
  the design review, MODELING-PLAN §12). The normative contracts are M6A-SPEC §4; where a sketch here differs,
  the spec wins (its §12.2 lists the refinements).
- Inputs: research [13](../research/13-mesh-kernel.md) (K1–K14, measurements §8), [10](../research/10-maya-poly-modeling.md)
  §4–§5, [12](../research/12-lowpoly-workflow.md) §4–§5, [14](../research/14-skinning-own-models.md) §8.1,
  [08](../research/08-extensibility-modeling.md) §9.8; [MODELING-PLAN](../MODELING-PLAN.md) §3.2; ADRs 0002, 0005, 0006,
  0008, 0009.

## Context

The modeling iteration (M6a) adds polygonal low-poly box modeling: extrude, inset, bevel, edge loops, Multi-Cut,
bridge, merge/weld, mirror, symmetry, soft selection, hard/soft edges. Typical meshes are 500–20k triangles; 50k must
stay interactive. The same kernel must edit **imported** GLB/VRM meshes (split vertices, double-sided hair and lash
cards, bow-tie vertices, duplicate faces, flipped winding), keep skin weights, morph targets, UVs and colours valid
through every edit (the bridge to animation), run headless in Node for tests, give exact one-step undo within the
5 ms budget, support Blender-style "adjust last operation" and stay out of the CRDT at vertex granularity (research 06
D8, 08 trap 10). No maintained JavaScript library offers a BMesh-class structure with attribute layers and undo
(13 §6): the half-edge libraries are unmaintained or young, object-per-element, coupled to three.js and mostly
manifold-only; Blender and Blockbench are GPL.

## Decision

1. **Edit structure: BMesh-style radial-edge** (vertex, edge, corner/loop, face; disk, radial and loop cycles) with
   n-gons, non-manifold edges, wire edges and loose vertices, **stored as struct-of-arrays typed arrays**, not
   objects. Faces have no holes. Faces with < 3 distinct vertices are dropped and counted at import.
2. **Stored versus derived.** Stored (what a revision serializes): `position` f32×3, `edgeVerts` u32×2, `edgeFlags`
   (bit0 hard, bit1 UV seam, bit2 crease reserved), `cornerVert`, `cornerNext`, `faceCorner`, `faceMaterial` u16,
   `faceFlags` (bit0 flip quad diagonal), and attribute layers. Derived and cached for dirty elements only: disk and
   radial links, corner→edge/face/prev, normals, triangulation, BVH, GPU buffers. Edit links exist only while a mesh
   is in a component mode (≈ 1.8 ms to build at 50k triangles).
3. **Identity = dense indices per domain.** Create appends; delete swap-removes. Every op reports its remap and
   returns the new selection. Anything outside the mesh that must survive topology edits references a **named group
   layer** (`group:<name>`), never an index. No global per-component IDs.
4. **Attribute layers** on the point, edge, face or corner domain, each with a declared interpolation rule (`linear`,
   `copy`, `skin`, `unit`, `or`, `clear`) and mirror rule (`none`, `negate-axis`, `swap-side`, `flip-u`), applied by
   every op. Built-ins: `uv0`/`uv1` (corner), `color0` (corner, linear), `normal.custom` (corner, cleared on touched
   corners), `skin.joints` u16×4 + `skin.weights` f32×4 (point; at most 4 non-zero influences, renormalized, joint
   palette in the layer metadata), `morph:<name>` (point `POSITION` deltas; names and order live only in the
   manifest's layer order; `NORMAL` deltas are derived at export, decision 16), `group:<name>`, `paint` (face u16
   palette slot), `crease` (reserved). Ops that do not preserve correspondence (decimate, remesh, booleans) transfer
   layers by closest point on the pre-op surface. Unknown layers survive load and save.
5. **Write log.** Every write goes through a facade that records the first old value per slot inside an operation;
   the coalesced log is a `MeshDelta` (writes, count changes, remap, dirty sets) and **is the exact undo patch**, for
   stored and edit arrays alike (`applyDelta(mesh, delta, 'forward' | 'backward')` in O(|delta|)). Giant operations
   switch to copy-on-write snapshots of the touched arrays. No per-tool inverse code.
6. **Euler operators** (`makeVert/killVert`, `makeEdge/killEdge`, `makeFace/killFace`, `splitEdgeMakeVert`,
   `joinEdgeKillVert`, `splitFaceMakeEdge`, `joinFaceKillEdge`, `reverseFace`, value setters) are the only topology
   API; all tools compose them.
7. **Operations are pure and deterministic**: `run(mesh, selection, args, ctx) → { selection′, warnings, frame? }`
   writing only through the log; JSON args with Maya node parameter names where they exist (`thickness`,
   `localTranslate`, `divisions`, `fraction`, `segments`, `mergeThreshold`…). Each op declares `params: ParamDef[]`
   (type in anim-core, with `bound: 'selection' | 'pointer' | 'value'`); its JSON schema, defaults and the editor's
   operator params are derived from that list (ADR 0016). Operations that create or delete meshes are
   **`MeshSetOp`s**: kernel helpers `copySubset` and `appendMesh` return layer, material-slot, palette-slot, morph
   and joint-palette remaps, and the editor-core runner applies N ref patches and record creations/deletions in one
   transaction with deterministic record ids; they refuse different skeletons, mixed asset-backed/authored inputs and
   (in M6a) Combine/Separate/Extract on asset-backed meshes. No randomness,
   no iteration over float-keyed maps, ties broken by the smaller index, integer spatial hashing, shared float
   formulas; Node and Chromium must produce identical revision hashes. An op that cannot keep the §3.5 invariants of
   research 13 **refuses with a reason**; it never emits invalid topology. `validateMesh` runs in tests, after every
   import and after every commit in debug builds.
8. **No construction history.** Modeling is destructive with Adjust Last Operation (ADR 0015 §6, ADR 0016) and `G`
   repeat. Primitives keep their creation parameters on the mesh record until the first component edit of any kind
   (a vertex nudge included), so regenerating can never misapply index-bound tweaks. Generator
   records with history are reserved for the later spline milestone (M8), whose output type is this kernel's mesh.
9. **One triangulation** serves viewport, picking, HUD, auto-skin and export: triangles as is; quads on the shorter
   diagonal, ties to the lower corner index, overridden by the per-face flip flag; n-gons by `earcut` on the Newell
   plane. Cached per face, so exports are deterministic and match the viewport.
10. **Normals**: Newell face normals; corner normals are angle-weighted averages over the smooth fan bounded by hard,
    boundary and non-manifold edges (Maya's hard/soft-edge model; the edge flag is the stored intent). Imported
    normals are kept as `normal.custom` until an op touches those corners. **Hard-flag propagation is one rule for
    every op**: edges created inside a former face are hard when all of that face's edges were hard; side and strip
    edges follow the op's `smoothingAngle`, resolved at invoke time to 0° on meshes flagged `faceted` and 30°
    otherwise; merged edges keep hard if either was hard. An all-hard mesh stays all-hard (property test).
11. **Precision**: float32 storage, float64 arithmetic, every write through `Math.fround`, so what is shown, saved and
    restored is bit-identical.
12. **Libraries**: depend on `earcut` 3.x (ISC) and `robust-predicates` 3.x (Unlicense, through a reviewed entry in
    `tooling/license-exceptions.json`; fallback: port the four predicates) in `mesh-core`; `three-mesh-bvh` 0.9.x
    (MIT) in `mesh-view`; later `meshoptimizer` 1.3.x (MIT), `manifold-3d` (Apache-2.0) and `xatlas` behind lazy
    worker adapters (`Decimator`, `BooleanSolver`, `UvAtlas`) in `mesh-wasm`. The kernel, every modeling op, LSCM, the
    packer and skinning maths are implemented in-house, clean-room: Blender, LoopTools and Blockbench (GPL) and
    Pinocchio's library (LGPL) are design and sizing references only.
13. **Packages**: `mesh-core` (headless; imports anim-core, `earcut`, `robust-predicates`; never three, React, DOM, doc
    or WASM), `mesh-view` (three overlays and picking; never React or editor-core), `mesh-wasm` (lazy adapters, M7).
    `doc` gains the mesh tables, `io` the glTF bridge, `editor-core` the `MeshRuntime`, `viewport` the hosting of
    overlays and tools. The Model workspace code loads lazily (target ≤ 250 kB gzip excluding WASM); the first-visit
    route gate is unchanged.
14. **Picking is CPU-first**: BVH ray hits for faces and occlusion, a screen-space grid for vertices and edges,
    `shapecast` for marquee and lasso; BVH refit after position commits, rebuild after topology commits (deferred to
    the first pick or idle). A GPU ID buffer (`readRenderTargetPixelsAsync`) only if measurements demand it.
15. **Threading**: operations run on the main thread up to 50k triangles; decimation, unwrap, auto-skin and large
    imports run in workers with transferable typed arrays. No `SharedArrayBuffer` (cross-origin isolation would break
    the Ekza Hub iframe embed, ADR 0010).
16. **glTF bridge** (extends ADR 0005): "Make editable" is explicit per mesh (weld bit-equal positions with equal skin
    data **and equal `POSITION` deltas in every morph target**, recover hard edges from split normals, keep custom
    normals, import skin/morph/UV/colour layers, report). Export splits points by unique corner tuples per material,
    uses the shared triangulation, always writes `NORMAL`, derives morph `NORMAL` deltas for targets that had them
    (normals of base + delta minus base normals, same function), and renormalizes weights after float32 rounding;
    an edited primitive whose original had `TANGENT` is refused unless the user drops tangents (the generator comes
    with mesh-wasm in M7). Untouched meshes are never re-encoded: the surgeon gains a "replace primitives" step that
    appends accessors and re-points only edited meshes' primitives, removes `KHR_draco_mesh_compression` from them,
    decodes quantized inputs and updates `extensionsUsed`/`extensionsRequired`; its bake marker moves to v2 (original
    JSON of replaced primitives and a pre-geometry baseline), so re-baking an edited export rolls geometry and clips
    back together. Models made in the editor go through a fresh author writer.
17. **Budgets** (report-only, reference machine; MODELING-PLAN §3.12): enter component mode ≤ 40 ms, hover pick
    ≤ 0.5 ms, 1,000-vertex drag ≤ 4 ms per frame, typical topology op ≤ 16 ms end to end, commit ≤ 3 ms, undo ≤ 5 ms
    through the journal, ≤ 40 MB per edited 50k-tri mesh, 0 idle frames (gate).

## Alternatives

| Alternative | Why not |
|---|---|
| Half-edge structure (OpenMesh, pmp, CGAL `Surface_mesh`, JS ports) | Rejects non-manifold input: OpenMesh's `add_face` silently drops faces with a "complex edge/vertex", so a VRoid avatar would lose its double-sided hair and lash cards (13 §2.1) |
| Indexed face-vertex arrays with adjacency caches only (Blender `Mesh`, glTF-like) | Fine for storage (it is our stored subset), but every local topology edit becomes an O(n) array rebuild without the edit links |
| String-keyed per-element dictionaries (Blockbench) | Stable IDs cheaply, but every adjacency query is a scan, 25k–100k strings per mesh, and GPL code we may not reuse |
| Objects per element | GC pressure and memory at 50k triangles |
| Hand-written inverse per tool for undo | Maya's documented weak point; the write log gives exact undo for free and drives incremental caches and chunk hashing |
| Construction history (Maya node chain) | Index-fragile, fights skinning ("Delete Non-Deformer History"), needs per-op dirty propagation and a fine collaboration model (10 §5) |
| Compile an existing C++ kernel to WASM | The available permissive kernels are half-edge (same input problem); attribute layers, the write log and determinism rules would still have to be written, behind a WASM boundary crossed on every edit |
| GPU ID-buffer picking by default | Readback stalls and a frame of latency; misses sub-pixel elements; CPU picking is exact and testable (ARCHITECTURE Appendix A #10) |
| Per-vertex CRDT / per-component records | See ADR 0015 |

## Consequences

- `mesh-core` is a reusable geometry kernel with no dependency on `doc`; M8's spline generators output its mesh type.
- Every op is a registry operator with JSON args (ADR 0016), so menus, hotkeys, tools, tests, the AI post chain (ADR
  0017) and a future scripting/MCP bridge call the same `mesh.*` ids.
- Property tests become the main quality gate: validity, Euler characteristic, manifoldness for the
  manifold-preserving class, orientation, bit-exact undo, cross-runtime determinism, attribute propagation,
  serialization, symmetry involution (13 §12).
- Hard tools are bounded in v1: bevel (edges, ≤ 3 segments in M6a, fan corners with a warning) and Multi-Cut
  (points on edges and vertices in M6a) refuse the cases they do not handle.
- The licence gate needs one reviewed exception (`robust-predicates`, Unlicense) or a small port.
- ADR 0005's preservation invariant gains the "replace primitives" step with its own read-back tests (single export,
  and export → re-import → re-bake).
