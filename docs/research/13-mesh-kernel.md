# 13 — Mesh kernel: data structure, base-tool algorithms, libraries, overlays, document integration

> Research note for Ekza Animator. Date: 2026-10-18. Status: proposal for review.
> Scope: the polygon **mesh kernel** for low-poly box modeling in the browser (TypeScript), and how it plugs into the
> existing architecture: the document store and undo (ADR 0002, 0013), the viewport (ADR 0006), the operator/tool
> registries (ADR 0008), the IO pipeline and the surgeon (ADR 0005), and skinned/morphed characters (ADR 0004).
> It replaces the "mesh editing much later" constraints of [research 08 §9.8](08-extensibility-modeling.md) with a
> concrete design. Tool UX (hotkeys, marking menus, manipulators), auto-rig/skinning and AI generation are owned by
> sibling notes; this note defines what the kernel must provide for them.
> Measurements in this note were taken on 2026-10-18 with Node 25.6.1 on an Apple M4 Pro (single thread, median of
> 7–15 runs). The architecture's reference machine is a 2020-class laptop (M1 / GTX 1650 class), roughly 2× slower
> single-threaded; budgets in §8 are stated for the reference machine.
> Two reference DCCs are named generically: "the desktop DCC" is a leading commercial desktop DCC, "the open-source
> DCC" is a popular open-source DCC (GPL-2.0+). Ekza is not affiliated with any DCC vendor.

---

## 0. Decisions in one screen

| # | Decision | Why (evidence) |
|---|---|---|
| K1 | **Edit structure = BMesh-style radial-edge** (vertex, edge, corner/loop, face; disk, radial and loop cycles), n-gons, non-manifold edges, wire edges and loose vertices, **stored as struct-of-arrays typed arrays**, not objects. No half-edge. | Half-edge kernels reject what imported GLBs contain (OpenMesh `add_face` drops faces with "complex edge/vertex"); BMesh "trivially represents any non-manifold condition including wire edges" (§2). Objects per element mean GC pressure at 50k tris. |
| K2 | **One dense index space per domain**; create = append, delete = **swap-remove** (last element moves into the hole). Indices are the component IDs (as in both reference DCCs); every op reports its remap. Anything outside the mesh that must survive topology edits references a **named group** (an attribute layer), never an index. | The desktop DCC keeps component lists by index and its history nodes renumber them (its SDK docs); its 2022+ releases added Component Tags (named groups on the geometry) for exactly this. Swap-remove keeps arrays dense and every edit local (O(touched)), which keeps undo patches and blob chunk changes small. |
| K3 | **Store intrinsic data only**: positions, edge endpoints and flags, corner→vertex and corner→next, face→first corner, material and flags, attribute layers. **Derive** disk/radial links, corner→edge, normals, triangulation, BVH and GPU buffers. | Same split as the open-source DCC's `Mesh` (SoA, "top-down" topology arrays, lazily cached normals) vs `BMesh` (edit adjacency). Measured: deriving all adjacency for 50k tris takes 1.8 ms (§8). "Store intent, not derived data" (06 R5). |
| K4 | **Every write goes through a typed-array write log** (array, index, old, new). An op's coalesced log *is* its undo patch: exact for stored and derived arrays, no per-op inverse code, no adjacency rebuild on undo. Euler operators are the safe topology API on top. | Exact undo/redo in O(changed); the doc undo budget is ≤ 5 ms per gesture (ARCHITECTURE §14). Hand-written inverses per tool are what 08 §1.1 calls the desktop DCC's weak point ("hand-written undo per command"). |
| K5 | **Ops are pure, deterministic functions** of (mesh, selection, args): no randomness, index tie-breaks everywhere. This gives modal numeric input, the open-source DCC's **Adjust Last Operation** (revert the log, re-run with new args, amend the same undo step) and reproducible tests. | The open-source DCC's redo panel and the desktop DCC's history-node inputs both need re-runnable ops; determinism is also what property tests and golden files need. |
| K6 | **Destructive modeling + adjust-last-op; no construction history in v1.** Primitive generators keep their creation params until the first edit. | Construction history drags in dirty propagation, per-node undo and collaboration conflicts; low-poly box modeling does not need it (§5.0). |
| K7 | **The document stores one field per mesh: a revision ref** (`manifest` = SHA-256 of a small manifest listing per-layer **content-addressed chunks**). Undo restores the ref through the existing `PatchUndoManager`; the mesh runtime follows the ref through its write-log journal (fast path) or rebuilds from chunks (fallback). **No per-component records, no per-vertex CRDT.** | Measured on a 50k-tri mesh in Yjs 13.6.33: per-component maps = 1.83 MB and 67 ms to load; a hash-ref record = 132 bytes after 21 revisions; an index-coherent 1,000-vertex edit changes 1–2 position chunks (24–48 KiB) vs a 22 KB per-component CRDT delta (§9.6). CRDT merges cannot keep mesh invariants (a face referencing a concurrently deleted vertex). 06 D8 and 08 trap 10 already say so for keys and vertices. |
| K8 | **Collaboration on meshes is by exclusive claim** (one editor per mesh at a time; partition `mesh:<id>`), others receive revisions chunk by chunk. | Same pattern as structural clip ops (ADR 0002 §8) and 06 P3 ("polygon meshes as coarse LWW blobs"). |
| K9 | **Main-thread ops up to 50k tris; workers for heavy jobs** (decimate, auto-atlas, booleans, big imports) with transferable typed arrays. No `SharedArrayBuffer`. | Measured op-path costs are a few ms at 50k (§8); SAB needs cross-origin isolation, which breaks the Ekza Studio iframe embed (ADR 0010). |
| K10 | **Picking is CPU-first**: `three-mesh-bvh` for ray hits, occlusion and region queries, plus a screen-space grid for vertices/edges; a GPU ID buffer (`readRenderTargetPixelsAsync`, present in three r186) only if measurements demand it. | Follows ARCHITECTURE conflict #10 (analytic, exact, testable, no readback stall). Measured: BVH build 6.3 ms, refit 0.9 ms, 1,000 raycasts 1.0 ms at 50k tris. |
| K11 | **Libraries**: depend on `earcut` (ISC), `three-mesh-bvh` (MIT), `meshoptimizer` (MIT), `robust-predicates` (Unlicense: needs a licence-gate exception, or port the four predicates). Behind adapters and lazily loaded: `manifold-3d` (Apache-2.0, booleans, later) and `xatlasjs` (MIT, auto-atlas/packing). **Implement** the radial-edge kernel, all modeling ops, LSCM and the overlay renderer ourselves, clean-room. | No maintained JS half-edge/BMesh library with attribute layers and undo exists (§6); the open-source DCC (GPL-2.0+) and Blockbench (GPL-3.0) are design references only. |
| K12 | **Imports: "Make editable" is explicit and per mesh.** Exact-position weld (also requiring equal skin data), hard edges recovered from split normals, the file's normals kept as custom normals until touched. **Untouched meshes are never re-encoded** on export. | Keeps the surgeon's byte-preservation promise (ADR 0005); reproduces DCC topology from glTF's split vertices. |
| K13 | **Animation coexistence**: model in bind pose; skin weights (4 influences), morph deltas, UVs, colours and groups are attribute layers with declared propagation rules that every op applies; morph target **order is stable** (VRM expression binds index it). | glTF/three/Bevy skin with 4 influences per set; "All primitives MUST have the same number of morph targets in the same order" (glTF 2.0). |
| K14 | **Packages**: `mesh-core` (headless kernel, ops, UV, validators, glTF bridge types), `mesh-wasm` (headless adapters, lazy), `mesh-view` (three.js overlays + picking). `editor-core` gains `MeshRuntime` and `mesh.*` operators; `doc` gains a `meshes` table and the `mesh:` partition; `io` gains the glTF ↔ mesh bridge and a surgeon "replace primitives" step. | Fits the layering of ARCHITECTURE §3 (headless below viewport; three only in view packages). |

**The desktop DCC or the open-source DCC, from the kernel's side.** The engine should be shaped like the
open-source DCC (BMesh-style topology, attribute layers, destructive ops with a redo panel), because that is the
better documented, more robust edit-kernel design and because history graphs are expensive in a collaborative web
document. The surface can be shaped like the desktop DCC (component modes, modeling-tools habits, tool
manipulators, its node parameter names on the op args, the last op's inputs shown next to the Channels panel as it does
there): every kernel op exposes JSON args that both a desktop-DCC-style tool and an open-source-DCC-style modal/redo
panel drive. This supports the coordinator's position — the desktop DCC's interaction model, the open-source DCC's
ideas where they are better — with one refinement: copy the open-source DCC's *data model*, not just its UI ideas.

---

## 1. Requirements the kernel must meet

| Requirement | Source | Consequence |
|---|---|---|
| Low-poly box modeling: typical meshes 500–20k triangles; **50k triangles must stay interactive**; up to ~200k works but slower; larger inputs (AI generation, scans) are decimated first | Owner request ("low-poly, no crazy complexity"), AI-generation follow-up | Budgets in §8; decimation and cleanup in §5.17 |
| n-gons for modeling, quads for loops and rings, triangles for export | Behaviour of both reference DCCs; glTF has triangles only | Faces of any length ≥ 3, no holes in faces; deterministic triangulation (§5.12) |
| Robust with imported GLB/VRM meshes: split vertices, double-sided cards (hair, lashes), duplicate faces, bow-tie vertices, flipped winding, degenerate triangles | VRoid/VRM avatars, game assets, AI meshes | Non-manifold-capable structure (K1); tools degrade instead of failing (§2.4) |
| One gesture = one undo step; per-user undo; compare-before-restore | ADR 0002, ADR 0013, 06 §9 | Revision-ref field + journal fast path (§9) |
| Collaboration-ready without CRDT-per-vertex | 06 D8, 08 trap 10 | Claims + chunked blobs (§9.6) |
| Headless and Node-testable | ARCHITECTURE principle 7 | `mesh-core` has no three/DOM; property tests in Node (§12) |
| Skinned meshes and morph targets keep working after edits | Turnkey pipeline model → rig/skin → animate → export | Attribute propagation rules (§3.4), bind-pose editing (§10) |
| Export to glTF/VRM; append-only surgeon for originals | ADR 0005 | glTF bridge + "replace primitives" surgeon step (§10.4) |
| Editor route JS gate ≤ 900 kB gzip | ARCHITECTURE §14 | Modeling code and WASM load lazily with the Model workspace (§6.3) |

---

## 2. Data-structure evaluation

### 2.1 Candidates

| Criterion | Half-edge (OpenMesh, pmp, CGAL `Surface_mesh`, JS: `three-mesh-halfedge`, `geometry-processing-js`) | **Radial-edge, BMesh-style** (open-source DCC edit mode) | Indexed face-vertex + adjacency caches (open-source DCC `Mesh`, glTF-like) | String-keyed dictionaries (Blockbench) |
|---|---|---|---|---|
| n-gons | yes | yes | yes | Blockbench renders 3- and 4-vertex faces only |
| Non-manifold edge (>2 faces) | **no**: faces rejected | yes (radial cycle of any length) | yes | yes (no adjacency at all) |
| Non-manifold vertex (bow-tie) | partial; OpenMesh rejects "complex vertex" | yes (disk cycle independent of faces) | yes | yes |
| Wire edges, loose vertices | awkward | yes ("wire edges are fully integrated into the topology database") | edges stored explicitly → yes | vertices yes, edges implicit |
| Local topology edits (split edge, split face) | O(1) | O(1) via Euler operators with logical inverses | O(n) array rebuild, or relocate-to-tail tricks | O(1) but every query is a scan |
| Adjacency queries (loop walk, one-ring) | O(1) | O(valence); cycle order undefined | needs derived maps | O(n) scans |
| Memory @ 50k tris (25k quads) | ~2.5 MB of links | ~3.2 MB of links (§3.2) | ~1.7 MB stored + caches | one string key + one JS array per element (heap and GC cost; not measured here) |
| Serialization / GPU / export | convert | convert | direct | convert |
| Undo patches | per-op inverse code | per-op inverse code (BMesh: "each Euler has a logical inverse") | array diffs | object snapshots |

Evidence:

- BMesh is "a non-manifold boundary representation … comparable to the Radial Edge Structure", with persistent
  adjacency in disk, radial and loop cycles, faces of arbitrary length, and it "trivially represents any non-manifold
  condition including wire edges"; "unlike half edge, the disk cycle is completely independent from face data". Edit
  tools are built from Euler operators (`make/kill vert/edge/face`, split edge/make vert, split face/make edge, join,
  reverse), "each Euler has a logical inverse" (open-source DCC developer docs: BMesh).
- The open-source DCC's non-edit `Mesh` uses "a struct of arrays paradigm": positions, edges (two vertex indices),
  face offsets, corner→vertex and corner→edge arrays, with normals and loose edges as lazily computed caches; edges
  are stored because that is "the only way to encode loose edges" (open-source DCC developer docs: Mesh).
- OpenMesh's `add_face` returns an invalid handle and prints "complex edge" (winding conflict or duplicate triangle)
  or "complex vertex" (non-boundary vertex) — the face is simply not added
  ([thread 1](https://lists.rwth-aachen.de/archives/list/openmesh@lists.rwth-aachen.de/message/Q3G5VPCTFE5KLE4XAUX2KRKXCZXQUPA6/),
  [thread 2](https://lists.rwth-aachen.de/archives/list/openmesh@lists.rwth-aachen.de/thread/AAI7DZQTLYPUPWKLWLCOENQGXUNW27PM/),
  [source](https://graphics.rwth-aachen.de/media/openflipper_static/Daily-Builds/Doc/Free/Developer/PolyConnectivity_8cc_source.html)).
  A half-edge import of a VRoid avatar would silently lose double-sided hair and lash cards.
- Blockbench (the most-used open web-technology low-poly modeler, GPL-3.0) keys vertices with random 4-character
  strings (`bbuid(4)`) and faces with 8-character strings, and its render path handles 3- and 4-vertex faces
  ([`mesh.js`](https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/mesh.js)). String keys give
  stable IDs cheaply but make every adjacency query a scan and cost memory at 50k tris; it is a design reference,
  not a model for a 50k-tri kernel.
- The desktop DCC stores component lists "using the vertex index", and "some construction history nodes modify the
  vertex numbering, for example, polySplit and deleteComponent" (vendor SDK docs, 2018); its 2022 release added
  **Component Tags**, named groups of components stored on the geometry (vendor help, 2026).

### 2.2 Decision

A single SoA mesh whose **stored subset** is the intrinsic data (K3) and whose **edit subset** adds BMesh-style
links, maintained incrementally by Euler operators. The stored subset is what a revision serializes, renders and
exports; the edit subset exists only while a mesh is open in component mode and is rebuilt on demand (1.8 ms at
50k tris). Unlike the open-source DCC, there is no conversion that renumbers elements: both subsets share one index
space, so a selection bitset is valid in both.

Corners are a linked cycle per face (`cornerNext`), not contiguous ranges (the open-source DCC's `face_offsets`), so
splitting an edge inserts a corner in O(1) without relocating the face; export walks the cycles.

### 2.3 Stable IDs vs indices

| Consumer | Needs | Mechanism |
|---|---|---|
| Undo/redo | exact restoration of element identity | the write log restores array slots exactly (K4) |
| Selection (U state) | survives ops | ops return the new selection; swap-remove moves are in the op's remap; undo restores selection snapshots (`TxMeta.selectionBefore/After`) |
| UV islands, soft selection, symmetry map | derived | recomputed from the current arrays |
| Vertex groups, face sets, "pin to vertex" rigs, weight-paint masks, collider regions | survive topology edits | **named attribute layers** (`group:<name>`, bool or weight per element): swap-remove moves layer values with the element; split/extrude propagate them by rule |
| Collaboration | identity across peers | not needed: one editor per mesh (K8); peers receive whole revisions |
| glTF export | none (glTF uses indices) | — |

Global random IDs per component (Blockbench) are rejected: 25k–100k strings per mesh, and they buy nothing that
claims + revisions do not already give.

### 2.4 Non-manifold input policy

| Input condition | Represented | Tools that need manifoldness |
|---|---|---|
| Edge with 3+ faces (double-sided cards after weld, fins) | radial cycle length ≥ 3 | loop/ring walk stops; bevel and inset treat it as a boundary; boolean and LSCM refuse with a count |
| Bow-tie vertex (two fans meet at a point) | disk cycle with two face fans | corner normals computed per fan (correct shading); vertex bevel refuses |
| Inconsistent winding across an edge | allowed | `mesh.normals.conform` (BFS over manifold edges, per shell orientation by signed volume) |
| Duplicate faces (same vertex cycle) | allowed, flagged | Cleanup removes |
| Zero-area faces, zero-length edges | allowed, flagged | Cleanup collapses |
| Face with a repeated consecutive vertex, or < 3 distinct vertices | **rejected at import** (dropped and counted) | — |
| Faces with holes | not representable (BMesh lists holes as future work too); glTF cannot express them | — |

Imports never fail on topology; the import report lists counts, and Mesh › Cleanup (§5.16) fixes on request.

---

## 3. Layout of the mesh

### 3.1 Arrays

Counts: `P` points (vertices), `E` edges, `F` faces, `C` corners (face-vertices, "loops" in BMesh terms).

| Array | Type | Subset | Meaning |
|---|---|---|---|
| `position` | `Float32Array(3P)` | stored | vertex positions, mesh-local metres |
| `edgeVerts` | `Uint32Array(2E)` | stored | endpoints (unordered) |
| `edgeFlags` | `Uint8Array(E)` | stored | bit0 hard (the desktop DCC's hard edge), bit1 UV seam, bit2 crease (reserved for subdivision) |
| `cornerVert` | `Uint32Array(C)` | stored | vertex at the start of the corner's edge (face winding order) |
| `cornerNext` | `Uint32Array(C)` | stored | next corner in the same face (cyclic) |
| `faceCorner` | `Uint32Array(F)` | stored | first corner of the face |
| `faceMaterial` | `Uint16Array(F)` | stored | index into the mesh record's material slots |
| `faceFlags` | `Uint8Array(F)` | stored | bit0 flip quad diagonal (§5.12) |
| `vertEdge` | `Int32Array(P)` | edit | one edge of the vertex's disk cycle, −1 = loose |
| `edgeDisk` | `Int32Array(4E)` | edit | next/prev edge in the disk cycle at endpoint 0 and at endpoint 1 |
| `edgeCorner` | `Int32Array(E)` | edit | one corner of the edge's radial cycle, −1 = wire edge |
| `cornerEdge`, `cornerFace`, `cornerPrev`, `cornerRadNext`, `cornerRadPrev` | `Uint32Array(C)` each | edit | BMesh loop pointers |
| `faceLen` | `Uint32Array(F)` | edit | corner count |
| `faceNormal`, `cornerNormal`, `faceTris`, BVH, GPU buffers | — | caches | rebuilt for dirty elements only |

Selection, hide state, soft-selection weights and the symmetry map are **session state** (bitsets/typed arrays next
to the mesh, never in a revision).

### 3.2 Memory at 50k triangles (25k quads: P ≈ 25k, E ≈ 50k, C = 100k, F = 25k)

| Part | Bytes |
|---|---|
| Stored topology + positions | ≈ 1.7 MB |
| UV0 (corner f32×2) + skin (point u16×4 + f32×4) | ≈ 1.4 MB |
| Edit links | ≈ 3.2 MB |
| Caches: normals, triangulation | ≈ 2.0 MB |
| GPU staging (per-corner position, normal, uv, state) + index | ≈ 4.2 MB |
| BVH (`three-mesh-bvh`) | ≈ 2–3 MB |
| **Total per edited 50k mesh** | **≈ 15 MB** (budget 40 MB, §8) |

### 3.3 Precision

Positions are float32 everywhere (the open-source DCC does the same; glTF is float32), arithmetic is float64, and
every write goes through `Math.fround`, so what the user sees, what is saved and what undo restores are
bit-identical. The desktop DCC's double precision is not needed at character and prop scale (float32 resolves
0.1 mm at 1 km).

### 3.4 Attribute layers

```ts
export type Domain = 'point' | 'edge' | 'face' | 'corner';
export interface AttrDef {
  readonly name: string;            // 'uv0', 'uv1', 'color0', 'normal.custom', 'skin.joints', 'skin.weights',
                                    // 'morph:<name>', 'group:<name>', or 'vendor.name' for extensions
  readonly domain: Domain;
  readonly type: 'f32' | 'u8' | 'u16' | 'u32' | 'bit';
  readonly comps: 1 | 2 | 3 | 4;
  readonly interp: 'linear' | 'copy' | 'skin' | 'unit' | 'or' | 'clear';   // rule for created elements (below)
  readonly mirror: 'none' | 'negate-axis' | 'swap-side' | 'flip-u';          // rule for mirror/symmetrize
  readonly default: readonly number[];
}
```

| Layer | Domain | Interp on split/subdivide | On extrude/duplicate | On merge/collapse | Mirror |
|---|---|---|---|---|---|
| `uv0`, `uv1` | corner f32×2 | linear along the split edge, per face side (keeps seams) | copy from the source corner; side faces take the adjacent face's corner UVs | average within each UV island | `flip-u` optional (the desktop DCC's `flipUVs`) |
| `color0` | corner f32×4 (linear) | linear | copy | average | none |
| `normal.custom` | corner f32×3 | `clear` (touched corners fall back to computed normals) | clear | clear | negate axis |
| `skin.joints` + `skin.weights` | point u16×4 + f32×4 | `skin`: blend weights of both ends, union of joints, keep the top 4, renormalize | copy | `skin` blend | `swap-side` through the rig's mirror pairs |
| `morph:<name>` | point f32×3 (delta) | linear | copy | average | negate axis + swap the L/R target by name |
| `group:<name>` | point/edge/face bit or f32 | `or` for bits, linear for weights | copy | `or`/max | swap-side by name |
| `paint` (palette swatch, [note 12](12-lowpoly-workflow.md) §4.2) | face u16 | copy (both halves of a split face keep it) | copy | keep the surviving face's | none |
| `crease` (reserved) | edge f32 | copy | copy | max | none |

Ops that do not preserve vertex correspondence (decimate, voxel remesh, booleans) transfer point and corner layers
by **closest point on the pre-op surface** (a closest-point query on a triangle BVH of the old mesh — `mesh-core`
needs a small headless BVH for this, since `three-mesh-bvh` lives in the view layer — then barycentric
interpolation and the layer's rule: skin pruned to 4 and renormalized), as note 14 §8.1 requires. Part of K-11.

glTF facts behind the rules: `COLOR_n` is an "RGB or RGBA vertex color linear multiplier"; `JOINTS_n`/`WEIGHTS_n`
are VEC4 sets ("when any of the vertices are influenced by more than four joints, the additional … are stored in
subsequent sets"); "all primitives MUST have the same number of morph targets in the same order"
([glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)). three.js and Bevy skin with one set of four,
so the kernel caps influences at 4.

### 3.5 Invariants (checked by `validateMesh`, in tests, in debug builds and after every import)

1. Array lengths equal counts; every index is in range.
2. Each face's `cornerNext` cycle has `faceLen ≥ 3` corners, all with `cornerFace = f`, and no two consecutive corners
   share a vertex.
3. `cornerEdge[c]` connects `cornerVert[c]` and `cornerVert[cornerNext[c]]`.
4. At most one edge per unordered vertex pair; each edge's radial cycle contains exactly the corners that use it.
5. Each vertex's disk cycle contains exactly the edges incident to it; `vertEdge = −1` iff the vertex has none.
6. Corner attribute values on both sides of a non-seam edge are bit-equal when the UVs are continuous there
   (ops must write identical values; seams are derived from inequality).
7. Skin weights sum to 1 ± 1e-6 with at most 4 non-zero influences; all floats finite.

---

## 4. Write log, Euler operators, deltas

### 4.1 Write log

All mutation goes through a small facade that records `(arrayId, index, oldValue)` the first time an element slot is
written inside a transaction, plus the new value at the end (coalesced per slot with a bitset per array). Counts and
capacities are logged as scalar slots. The result is a `MeshDelta`:

```ts
export interface MeshDelta {
  readonly opId: string;                          // 'mesh.extrude'
  readonly countsBefore: MeshCounts; readonly countsAfter: MeshCounts;
  readonly writes: readonly ArrayWrites[];        // per array: sorted indices + old/new values (run-length for ranges)
  readonly remap: ElementRemap;                   // swap-remove moves, created ranges, removed slots, per domain
  readonly dirty: DirtySet;                       // per domain: changed elements → caches, chunks, GPU ranges
}
export function applyDelta(m: EditMesh, d: MeshDelta, dir: 'forward' | 'backward'): void;   // exact, O(|writes|)
```

Properties: exact for stored *and* edit arrays (so undo needs no adjacency rebuild); one generic mechanism instead
of per-tool inverses; the `dirty` set drives incremental caches, GPU uploads and chunk re-hashing. Cost: an extrude of
100 quads writes a few thousand slots (tens of KB). For giant ops (merge-by-distance over a whole 200k mesh) the log
switches to whole-array copy-on-write snapshots of the touched arrays when it exceeds a quarter of the mesh size.

### 4.2 Euler operators (the topology API ops are written in)

| Operator | Effect | Notes |
|---|---|---|
| `makeVert(p)` / `killVert(v)` | add/remove a vertex (kill requires no edges, or kills them) | swap-remove |
| `makeEdge(a, b)` / `killEdge(e)` | add/remove an edge (returns the existing edge for a known pair) | keeps invariant 4 |
| `makeFace(verts, edges?)` / `killFace(f)` | add/remove a face from a vertex cycle, creating missing edges | rejects < 3 or repeated consecutive vertices |
| `splitEdgeMakeVert(e, t)` | insert a vertex at parameter `t`, new edge, a new corner in every face of the radial cycle | attributes interpolated (§3.4) |
| `joinEdgeKillVert(v)` | dissolve a valence-2 vertex | inverse of the above |
| `splitFaceMakeEdge(f, cA, cB)` | cut a face between two of its corners | caller guarantees the chord lies inside (n-gon test, §5.5) |
| `joinFaceKillEdge(e)` | merge the two faces of a manifold edge | refuses non-manifold or same-face edges |
| `reverseFace(f)` | flip winding (corner attributes move with corners) | its own inverse |
| `setPosition`, `setAttr`, `setFlag` | value writes | logged |

All tools (§5) compose these; tests can assert that any op preserves §3.5.

### 4.3 Determinism rules

No `Math.random`; no iteration over hash maps keyed by floats (iterate sorted indices); ties broken by the smaller
index; spatial hashing uses integer cells; floating-point formulas are written once and shared (normals, plane
fits). Ops are never replayed on another machine (peers receive revisions), so cross-engine `Math.sin` differences do
not matter; Node and Chromium (both V8) must produce identical manifests, which a test checks.

---

## 5. Algorithms for the base tools

### 5.0 Scope and phasing

Phase A = the box-modeling core; B = completes the turnkey pipeline; Later = after usage data. Sizes are kernel
implementation estimates (agent-days, tests included); tool UX is not included. Open-source DCC line counts (GPL-2.0+,
read for sizing only, never copied) calibrate the hard ones: `bmesh_bevel.cc` 8,485 lines, `editmesh_knife.cc` 4,936,
`uv_parametrizer.cc` 5,484, `bmo_inset.cc` 1,377, `bmo_subdivide_edgering.cc` 1,240, `bmo_extrude.cc` 869,
`bmo_bridge.cc` 662 (its `bmesh/` sources on the main branch).

| Tool | Desktop DCC reference (node, key params) | Open-source DCC ideas to take | Kernel recipe | Needs manifold | Phase | Size |
|---|---|---|---|---|---|---|
| Extrude faces | `polyExtrudeFace`: `keepFacesTogether`, `thickness`, `offset`, `divisions`, `smoothingAngle`, `taper`, `twist` | region vs individual; "extrude along normals" with even thickness | §5.1 | no (non-manifold boundary edges are treated as boundaries) | A | 2 |
| Extrude edges / vertices | `polyExtrudeEdge`, `polyExtrudeVertex` (spikes) | edge extrude to a strip; vertex extrude to a wire edge | duplicate boundary chain + quads | no | A (edges), Later (vertex) | 1 |
| Inset (desktop DCC: extrude with offset, thickness 0) | `polyExtrudeFace.offset` | even offset, clamp, depth, region vs individual | §5.2 | region boundary must be manifold | A | 1.5 |
| Bevel edges / vertices | `polyBevel3`: `fraction`, `offsetAsFraction`, `segments`, `depth`, `chamfer`, `mitering`, `smoothingAngle` | clamp overlap, profile shape, harden normals | §5.3 | yes for v1 patches | A (v1 scope) | 6 |
| Insert edge loop (multiple) | `polySplitRing`: `weight`, `splitType`, `divisions`, `insertWithEdgeFlow`, `absoluteWeight` | loop slide | §5.4 | ring over quads | A | 1.5 |
| Offset edge loop | Offset Edge Loop tool | — | two ring splits at distance d either side | ring over quads | A | 0.5 |
| Multi-cut / knife / slice | Multi-Cut tool (edge/vertex/face clicks, Ctrl = loop, snap %) | knife with angle snap; bisect plane | §5.5 | no | A | 4 |
| Bridge | `polyBridgeEdge`: `divisions`, `twist`, `taper`, `curveType`, `bridgeOffset` | bridge loops with different counts, smoothness | §5.6 | border loops | A | 1.5 |
| Merge / target weld / collapse / merge to centre | `polyMergeVert`: `distance`, `alwaysMergeTwoVertices`; Target Weld tool; `polyCollapseEdge` | merge by distance (spatial hash) | §5.7 | no | A | 1.5 |
| Delete / dissolve | `polyDelEdge`: `cleanVertices`; Delete Vertex | dissolve vs delete distinction, limited dissolve (planar) | §5.8 | no | A | 1 |
| Fill hole | `polyCloseBorder` | grid fill (later), triangle fill (beauty) | §5.9 | border loop | A | 0.5 |
| Mirror / symmetrize / symmetry mode | `polyMirror`: `mirrorAxis`, `mergeMode`, `mergeThreshold`, `cutMesh`, `flipUVs`; Symmetry (object/world/topology); Symmetrize | mirror options X/Y/Z, topology mirror | §5.10 | topology mirror: yes | A | 2.5 |
| Normals: harden/soften/by angle, conform, reverse, lock | `polySoftEdge` (angle), Conform, Reverse, Lock/Unlock Normals | sharp edges, smooth by angle, custom normals | §5.11 | conform: per manifold shell | A | 1.5 |
| Triangulate, quadrangulate, flip/spin edge | `polyTriangulate`, `polyQuad`, Flip Triangle Edge, Spin Edge | tris-to-quads thresholds, beauty | §5.12 | no | A | 1.5 |
| Primitives | `polyCube`, `polyCylinder`, `polySphere`, `polyCone`, `polyPlane`, `polyTorus`, `polyPrism` (history params) | redo panel on creation | parametric builders, low-poly defaults | — | A | 1.5 |
| Selection walkers | loop/ring (double-click), grow/shrink, convert (to verts/edges/faces, contained/border), shell, border, by angle | select linked, select similar | §5.14 | loop: manifold quads | A | 2 |
| Soft selection | falloff radius, curve, mode volume/surface/global | proportional edit, connected only | §5.15 | surface mode: graph | A | 1 |
| Cleanup / diagnostics | Mesh › Cleanup (n-sided, concave, lamina, non-manifold, zero length/area) | merge by distance, degenerate dissolve | §5.16 | — | B | 2 |
| UV: planar/box(automatic)/cylindrical/spherical | `polyPlanarProjection`, `polyAutoProjection`, `polyCylindricalProjection` | cube projection, smart UV project | §5.13 | no | B | 1.5 |
| UV: seams → unwrap (LSCM) → pack | Unfold (Unfold3D), Layout | mark seams, unwrap LSCM/ABF, pack islands | §5.13 | per chart manifold disc | B | 4 |
| Vertex colours | Apply Color, Paint Vertex Color | colour attributes | corner layer writes, per-face fill | no | B | 0.5 |
| Decimate / cleanup of generated meshes | Reduce (`polyReduce`) | decimate (collapse) | §5.17, meshoptimizer | no | B | 1.5 |
| Separate / combine / extract / duplicate faces | `polySeparate`, `polyUnite`, Extract, Duplicate Face | separate by loose parts / material | copy subsets between meshes, remap layers | no | B | 1.5 |
| Subdivide (Catmull–Clark, levels 1–2) / smooth | `polySmooth` | subdivision with creases | standard CC over n-gons using crease layer | no | Later | 2 |
| Booleans | Booleans (union/difference/intersection) | Exact/Fast solvers | manifold-3d adapter + re-merge coplanar triangles by `faceID` | **closed manifold** | Later | 3 |
| Edge flow, slide, poke, wedge, chamfer vertex, shrinkwrap/retopo | various | various | — | — | Later | — |

### 5.1 Extrude (faces)

- **Region** (`keepFacesTogether: true`, the desktop DCC's default for face extrude): boundary edges = edges of
  selected faces whose radial cycle contains an unselected face *or* has length ≠ 2. Duplicate the vertices on those
  edges; rewire the selected faces' corners from the originals to the duplicates; interior vertices of the region
  move with it without duplication. For each boundary edge `(a, b)` create the side quad `(a, b, b′, a′)` oriented
  so its shared edges run opposite to the neighbours. A region with no boundary (a whole closed shell) only moves.
- **Individual** faces: the same per face (each face is its own region).
- **Direction**: per vertex, the normalized sum of the adjacent selected face normals; **even thickness** scales by
  `1 / max(cos θ, 0.25)` where θ is the largest angle between that direction and the adjacent selected face normals
  (prevents thin corners; the clamp avoids spikes).
  `divisions` inserts `n − 1` rings along the sides; `offset` is an inset (§5.2) applied to the moved cap.
- **Attributes**: duplicates copy point layers; side-face corners take the corner UVs of the adjacent selected face
  (stretched, as in the open-source DCC), colours copied; new vertical edges hard when the dihedral angle exceeds
  `smoothingAngle` (desktop DCC default 30°; *v0.2: resolved to 0° on meshes flagged `faceted`, and one hard-flag rule
  covers every op, MODELING-PLAN §3.2*).
- **Topology check**: closed manifold region extrude has Δχ = 0 (b new vertices, 2b new edges, b new faces).

### 5.2 Inset

Per region boundary vertex, move along the in-plane bisector of the two boundary edges at distance `w`, scaled
by `1 / sin(α/2)` for "even offset" (α = interior angle). **Clamp overlap**: limit `w` per vertex to
`0.5 × min(adjacent inner edge length)`; report "clamped at 0.034 m". Individual mode insets every face toward its
centroid. Depth moves the inner ring along normals. Same Euler pattern as extrude with thickness 0.

### 5.3 Bevel (v1 scope)

The most complex base tool (the open-source DCC's implementation is 8.5k lines), so v1 is deliberately bounded:

- **Inputs**: edges (vertex bevel later); width as `fraction` of the shortest adjacent edge (the desktop
  DCC's `offsetAsFraction`, default on; "Fractional … prevents inside-out bevels", vendor help: Bevel Options)
  or absolute; `segments` 1–8; `profile` 0–1 (0.5 = circular-ish, desktop DCC `depth` / open-source DCC shape);
  `clamp` on by default; harden the bevel's border edges (low-poly look) on by default.
- **Algorithm** (our own write-up, clean-room): (1) per beveled edge and side, the offset line in the adjacent face
  plane at width `w`; (2) per vertex, the **boundary points** where consecutive offset lines meet (intersection inside
  the face; when two beveled edges are collinear, the perpendicular foot); a non-beveled edge between two beveled ones
  gets a point on that edge at distance `w`; (3) replace each beveled edge by a strip of `segments` quads between its
  boundary points, interpolated along a profile curve (a superellipse in the plane spanned by the two offset
  directions); (4) fill each vertex with valence ≥ 3 beveled edges by a **patch**: one n-gon for `segments = 1`, a
  grid-like patch (centre point + rings) for more segments; (5) re-cut the faces around the vertex to the new
  boundary points (`splitFaceMakeEdge`).
- **Clamp overlap**: global `w ≤ min over beveled edges of (fraction × shortest adjacent edge)`; per-vertex clamp when
  boundary points would pass the far end of a non-beveled edge.
- **v1 limits** (refuse with a message, never produce invalid topology): non-manifold edges; vertices where beveled
  edges meet non-planar fans of more than 6 faces with `segments > 1` fall back to the single-n-gon patch;
  vertex-only bevel and "miter arc/patch" variants are Later.

### 5.4 Insert edge loop / offset edge loop

- **Ring walk** from a seed edge `e` in quad `f`: the opposite edge of `f`, then into the other face of that edge's
  radial cycle; stop at a triangle or n-gon (both reference DCCs stop there), a boundary, a non-manifold edge, or when
  the ring closes. Walk both directions from the seed.
- **Split**: for each ring edge, parameter `t` measured from the side consistent with the walk (flip when the edge
  orientation reverses); `divisions` = n → `t = i/(n+1)`; `absoluteWeight` → distance from one side clamped to the
  edge length; `splitEdgeMakeVert` then `splitFaceMakeEdge` across each quad.
- **Edge flow** (desktop DCC `insertWithEdgeFlow`): place new vertices on a cubic Hermite through the ring neighbours'
  positions instead of linearly. Later.
- **Offset edge loop**: for each edge of a selected loop, split the two adjacent rings at distance `d` from the loop.

### 5.5 Multi-cut, knife, slice

- **Cut path** = an ordered list of points on edges (edge + t), on vertices, or inside faces (desktop DCC
  Multi-Cut clicks; Ctrl = insert loop at the cursor; Shift = snap t to 10 % steps).
- Consecutive path points in the same face become a chord: split edges, then `splitFaceMakeEdge`; points inside a face
  become a vertex chain that must start and end on that face's boundary. Paths that end inside a face are trimmed to
  the last boundary point (holes in faces are not representable) with feedback.
- **n-gon chords**: a chord between two corners is valid when it lies inside the polygon: project the face to its
  Newell plane and test the segment against all face edges with `orient2d` (exact predicates) plus a midpoint
  point-in-polygon test. Invalid chords are split at the crossing or refused.
- **Slice** (plane cut through selected faces): classify vertices by signed distance with snapping (|d| < ε → on
  plane, ε relative to the bounding box); split crossing edges; per face, sort the intersection points along the cut
  line and pair them (non-convex faces can be crossed more than once).

### 5.6 Bridge

Input: two boundary edge loops (open or closed) or two selected face regions (deleted first). Order each loop;
choose the start alignment and direction minimizing the summed squared distances over all cyclic shifts and both
directions (O(n²), fine at loop sizes < 500); `twist`/`bridgeOffset` shift the alignment; unequal counts are bridged
by distributing the extra vertices (quads plus a minimal number of triangles). `divisions` creates intermediate rings:
linear, or along cubic Hermite curves using each loop vertex's outward tangent (desktop DCC `curveType` blend/curve).

### 5.7 Merge, target weld, collapse, merge by distance

- **Weld v into u**: rewire every corner of `v` to `u`; edges `v–x` become `u–x`; when that pair already exists, merge
  the two edges (union of radial cycles); remove consecutive duplicate corners; faces left with < 3 corners are
  killed; edges and vertices left unused are killed. The result may be non-manifold — allowed and reported.
- **Merge by distance**: integer spatial hash with cell = threshold; union-find over pairs within the threshold
  (desktop DCC `distance`; `alwaysMergeTwoVertices` merges any two selected vertices); target = the cluster
  centroid (merge) or the first-picked vertex (target weld; selection order is tracked).
- **Collapse**: edges → their midpoint; faces → their centroid (all their vertices welded).

### 5.8 Delete and dissolve

`Delete` faces removes faces and their now-unused edges/vertices. `Dissolve` edges = `joinFaceKillEdge`, then
valence-2 vertices are dissolved (desktop DCC `cleanVertices`). Dissolve vertex merges its manifold fan into one
n-gon (boundary vertex: the fan's outer edges form the new boundary). The desktop DCC's Delete Edge/Vertex (which
dissolves) and the open-source DCC's Delete-vs-Dissolve map to the same two kernel ops; the keymap preset decides the
label.

### 5.9 Fill hole and triangulation of fills

Find the boundary loop(s) through the selection; create one face whose winding is opposite to the adjacent faces'
traversal of each boundary edge (consistent orientation). Optional "triangle fill": triangulate the loop's projection
with `earcut` and run `earcut.refine` (Delaunay flips, added in earcut 3.x) for quality; `earcut.deviation` verifies.
A constrained Delaunay library (`@kninnug/constrainautor`) is not needed for v1.

### 5.10 Mirror, symmetrize, symmetry mode

- **Mirror op** (`polyMirror` semantics): optional `cutMesh` (slice at the plane and delete the far side first), snap
  vertices within `mergeThreshold` of the plane onto it, duplicate the geometry, reflect positions, reverse the
  copies' winding, then weld seam vertex pairs (`mergeMode`: merge / bridge / none). Layers follow their `mirror` rule:
  skin joints swap through the rig's mirror pairs (already in `rig`), `morph:*_L`/`_R` and `group:*` swap by name,
  UV `u` flips optionally (`flipUVs`).
- **Symmetry map** (session state): `Int32Array(P)` partner index or −1 (*v0.2: plus derived edge and face partner
  maps with an edge-orientation bit, needed to mirror pointer arguments such as `{edge, t}`; MODELING-PLAN §3.14*).
  Positional mode (object or world axis):
  reflect each vertex and look up the nearest within tolerance in an integer spatial hash (O(P)). Topological mode
  (the desktop DCC's topology symmetry): the user picks a seam edge; a BFS pairs vertices across the seam by walking
  corresponding corners on both sides; works on posed or asymmetric shapes. The map is recomputed after each topology op
  (incrementally for created elements when positions are symmetric).
- **Symmetry mode**: transforms on a selection are mirrored onto partners; vertices on the plane are constrained to
  it. Topology ops run on the **symmetry-expanded selection** (selection ∪ partners ∪ mirrored faces/edges); since op
  geometry is normal- and length-relative, symmetric input yields symmetric output. Manipulators show on the
  selection; modal args apply to both halves.
- **Symmetrize**: copy one half's positions (and layers by rule) to partners; vertices without partners are reported.

### 5.11 Normals

- **Face normal**: Newell's method (robust for non-planar n-gons).
- **Corner normals** (derived): the angle-weighted average of face normals in the *smooth fan* around the vertex — the
  run of faces bounded by hard edges, boundary edges and non-manifold edges (bow-tie fans stay separate). This is the
  desktop DCC's hard/soft-edge model; `edgeFlags.hard` is the stored intent. "Set normal angle" (`polySoftEdge`) sets
  hard flags by dihedral angle; "Harden/Soften" set them on the selection; "flat look" = all edges hard.
- **Custom normals** (`normal.custom`): imported files keep their exact normals while untouched; any op that changes
  a face clears custom normals on its corners (rule `clear`) and the UI says how many were cleared. The desktop DCC's
  Lock/Unlock Normals map to keep/clear.
- **Conform** (recalculate outside): BFS over manifold edges flipping faces to agree, then per shell flip all if the
  signed volume is negative (open shells: orient toward the majority of face normals vs the centroid).
- Measured: face + angle-limited corner normals for 50k tris in 2.9 ms (naive full recompute); edits recompute only the
  one-ring of dirty vertices.

### 5.12 Triangulation (render and export)

- Triangles as is; **quads split along the shorter diagonal**, ties to the lower corner index, overridden per face by
  `faceFlags.flipDiagonal` (the desktop DCC's Flip Triangle Edge on a quad toggles it). n-gons: `earcut` on the
  Newell-plane projection (earcut's documented limit: "does not guarantee a correct triangulation on arbitrary
  input"; self-intersecting projections are flagged by Cleanup, and `mesh.triangulate` makes the split explicit).
- The same triangulation is used by the viewport, the BVH and export (WYSIWYG for flat-shaded low-poly, where the
  diagonal is visible). It changes only when a face changes (cached per face), so exports are deterministic.
- **Quadrangulate** (tris → quads, desktop DCC `polyQuad`): greedy pairing by a score (normal angle < threshold, not
  across hard edges, UV seams or material borders, best rectangularity), deterministic order. Used after imports,
  booleans and decimation.

### 5.13 UVs

- **Projections**: planar (axis, camera or best-fit plane; fit to 0–1 keeping aspect), box/automatic (each face to the
  most aligned of 6 planes, or of N planes for the desktop DCC's automatic mapping; charts = connected faces with the
  same plane), cylindrical and spherical (seam at the angle wrap; split corners at the wrap so no face spans it).
- **Unwrap**: seams (`edgeFlags.seam`) and existing UV discontinuities cut the mesh into charts (flood fill across
  non-seam manifold edges). Per chart, **LSCM** (Lévy et al., "Least Squares Conformal Maps for Automatic Texture
  Atlas Generation", SIGGRAPH 2002, [doi:10.1145/566654.566590](https://doi.org/10.1145/566654.566590)): a sparse
  least-squares system over triangles (n-gons triangulated as in §5.12) with two pinned vertices (the farthest pair on
  the chart boundary, or user pins), solved by conjugate gradient on the normal equations (charts ≤ 5k vertices
  converge in milliseconds). A chart that is not a disc (handle, non-manifold) is refused with a "needs a seam here"
  hint (the loop of a handle is suggested). Implemented in-house: there is no maintained MIT LSCM in JS
  (`@triforge/uv-core`, MIT, first published 2026-06 and three releases, advertises LSCM/ABF matched to
  the open-source DCC — too young, and a claimed match to a GPL implementation raises a GPL-provenance question).
- **Pack**: in-house skyline packer with 0°/90° rotation, margin in texels and texel-density normalization (scale
  charts by √(3D area / UV area)). `xatlas` packing (and full automatic seams + parameterization for generated meshes)
  as an optional adapter in a worker (§6).

### 5.14 Selection walkers

Edge loop: from edge `e` at vertex `v` with an interior manifold disk of exactly 4 edges, continue with the edge that
shares no face with `e`; stop at poles (valence ≠ 4), boundaries (then follow the boundary loop: boundary edges
through vertices with exactly two boundary edges), non-manifold edges or the start. Ring: across quads (§5.4).
Grow/shrink by one ring of adjacency; convert between modes (contained vs touching, border); shell = connected
component over edges; border = boundary of the selected face region. All return bitsets in O(selection + touched).

### 5.15 Soft selection

Weight per vertex `w = falloff(d / r)`; `d` = Euclidean distance to the nearest selected vertex (volume mode, integer
spatial hash with cell = r) or geodesic along edges (surface / "connected only" mode, Dijkstra limited to r).
Falloff is a curve: the default smooth ramp, with presets (linear, sharp, root, sphere, constant); a custom falloff
reuses the anim-core curve engine (an `AnimCurve` from 0 to 1), so the Graph Editor's tangent tools edit it. Weights
are session state, recomputed when selection, r, mode or positions change (≤ 2 ms for 25k vertices).

### 5.16 Cleanup and diagnostics

Report and optionally fix: n-gons > 4 (info), concave faces, non-planar faces (max distance to the Newell plane /
face size), lamina faces (faces sharing all edges), duplicate faces, non-manifold edges/vertices, zero-length edges,
zero-area faces, loose vertices/edges, inconsistent winding, open edges (for booleans/unwrap), > 4 skin influences
or unnormalized weights. Fixes are ordinary undoable ops. The import report and the export lints (Ekza/Bevy
profiles) reuse the same diagnostics.

### 5.17 Decimation and intake of generated meshes

AI-generated and scanned meshes arrive as large triangle soups (100k–1M+ triangles, often non-manifold):
weld by position (tolerance option) → Cleanup → **decimate** with meshoptimizer `simplifyWithAttributes` (UV and
normal weights; `vertex_lock` marks UV seams and material borders, `Permissive` with lock value 2 protects seams while
allowing collapse along them; `Regularize` "can improve geometric quality under deformation such as skinning") →
quadrangulate → hand-off to modeling/auto-rig. meshoptimizer 1.3 also ships an **experimental voxel remesher**
(`remesh`, resolution 4–256: "the original topology is not preserved … small gaps … may be closed") that can turn a
broken soup into a closed shell before decimation; evaluate it with the AI-generation note.
Measured: simplifying 50k → 25k triangles takes 6.0 ms (5k → 2.5k: 1.2 ms).

---

## 6. Libraries: depend vs implement

Versions, licences and dates checked on the npm registry and GitHub on 2026-10-18. Sizes: gzip -9 of the published
build unless noted.

| Library | Version (date) | Licence | Size | Use | Decision |
|---|---|---|---|---|---|
| [`three-mesh-bvh`](https://github.com/gkjohnson/three-mesh-bvh) | 0.9.16 (2026-10-08), active | MIT | full ESM build 62 kB gz unminified (tree-shakes lower); peer `three >= 0.159` | ray hits, occlusion, `shapecast` for marquee/lasso, `refit` after position edits; also `PointsBVH`, `LineBVH`, `SkinnedMeshBVH` ("recently added … APIs may change") | **Depend** (`mesh-view`). Side benefit: could replace the O(tris) skinned click raycast in `viewport/src/picking/meshPicker.ts` |
| [`meshoptimizer`](https://github.com/zeux/meshoptimizer) | 1.3.0 (2026-09-25) | MIT | simplifier module 68 kB raw / 20 kB gz with embedded WASM | decimate (`simplifyWithAttributes`, `vertex_lock`, flags `Permissive`/`Regularize`/`Prune`), `generateTangents` (`Compatible` = MikkTSpace-compatible) for normal-mapped exports, experimental `remesh` | **Depend** (`mesh-wasm`, lazy); already a dev dependency (compressed fixture) |
| [`earcut`](https://github.com/mapbox/earcut) | 3.2.4 (2026-09-28) | ISC | 4.3 kB gz | n-gon triangulation, fills; `refine` (Delaunay flips), `deviation` | **Depend** (`mesh-core`). three r186 bundles an older earcut port (`src/extras/Earcut.js`), but `mesh-core` must not import three |
| [`robust-predicates`](https://github.com/mourner/robust-predicates) | 3.0.3 (2026-03-22) | **Unlicense** | small | exact `orient2d`, `orient3d`, `incircle` for knife/slice/chord tests | **Depend after a licence-gate exception** (`tooling/license-exceptions.json`: Unlicense is a public-domain dedication, not in `ALLOWED_LICENSES`), or port the predicates from Shewchuk's public-domain C |
| [`manifold-3d`](https://github.com/elalish/manifold) | 3.5.4 (2026-09-25), active | Apache-2.0 | `manifold.wasm` 541 kB raw / 205 kB gz + JS 19 kB gz | booleans with guaranteed manifold output; `MeshGL.faceID` and `runOriginalID` let us re-merge coplanar triangles into the original faces and keep materials | **Later, lazy, in a worker.** The npm package declares runtime deps for its CAD/CLI tooling (`commander`, `fast-xml-parser`, `@gltf-transform/*`, `@jscadui/3mf-export`, …) and an `esbuild-wasm` peer: check the install footprint and licence gate; keep NOTICE (as for AnimX) |
| [`xatlasjs`](https://github.com/repalash/xatlas.js) (wraps [`xatlas`](https://github.com/jpcy/xatlas)) | 0.2.0 (2024-09); xatlas upstream last push 2024-06 | MIT / MIT | `xatlas.wasm` 145 kB raw; no `.d.ts` | automatic charts + parameterization + packing for generated meshes; `AddUvMesh` + `PackCharts` to pack our LSCM charts | **Optional adapter** behind `UvPacker`, pinned, in a worker; plan to build xatlas to WASM ourselves if the wrapper stalls; check CSP (no `eval`) |
| [`mikktspace`](https://github.com/donmccurdy/mikktspace-wasm) | 1.1.1 (2022) | MIT | 100 kB unpacked | MikkTSpace tangents (three's `computeMikkTSpaceTangents` takes it) | Not needed: meshoptimizer 1.3 tangents with `Compatible` |
| [`@kninnug/constrainautor`](https://github.com/kninnug/constrainautor) (+ `delaunator`) | 4.1.0 (2026-03) | ISC | — | constrained Delaunay | Not in v1 (earcut + refine suffice) |
| [`three-bvh-csg`](https://github.com/gkjohnson/three-bvh-csg) | 0.0.18 (2026-02) | MIT | 33 kB gz | booleans | No (pre-1.0; manifold-3d is the robust choice) |
| `trimesh-boolean` | 0.7.6 (2026-10) | MIT | — | booleans on open meshes | No (young; open-mesh booleans are not a low-poly need) |
| Half-edge libraries: [`three-mesh-halfedge`](https://github.com/LokiResearch/three-mesh-halfedge) 1.0.3 (2022), its fork `@sherifmagdy/three-mesh-halfedge` 2.5.2 (2026), [`three-halfedge-dcel`](https://github.com/erasta/three-halfedge-dcel) 1.1.0 (2025, 8 stars), `@amanyadev/half-edge` 0.1.0 (2025, one release, string IDs, command-object undo), [`geometry-processing-js`](https://github.com/GeometryCollective/geometry-processing-js) (2021, not published officially) | — | MIT | — | — | **Do not depend**: unmaintained or very young; object-per-element (GC); coupled to three; no attribute layers, no write log, mostly manifold-only |
| Open-source DCC BMesh/tools, Blockbench | — | GPL-2.0+ / GPL-3.0 | — | design references | **Clean-room only** (CONTRIBUTING rule) |

### 6.1 Adapter rule

Every WASM library sits behind a `mesh-core` interface (`Decimator`, `TangentGenerator`, `BooleanSolver`,
`UvAtlas`), has a pure-JS fallback or a clear "unavailable" state, runs in a worker in the browser and directly in
Node tests, and is loaded on first use. `mesh-core` itself has no WASM.

### 6.2 What we implement (and why it is affordable)

The radial-edge kernel with write log (~1.5k lines), Euler operators, validators, all §5 ops, selection walkers, soft
selection, symmetry, normals, triangulation glue, projections, LSCM + CG solver, skyline packer, glTF bridge and
chunk serialization. The two hard pieces are bevel and knife (§5.0 sizes); the rest are textbook algorithms on a sound
structure. Owning them is what gives exact undo, deterministic results and attribute propagation everywhere.

### 6.3 Bundle plan

`mesh-core` + `mesh-view` + modeling tools load with the Model workspace (dynamic import), never on the Animate
route; target ≤ 250 kB gzip for that chunk excluding WASM; WASM files are self-hosted next to the Draco/meshopt
decoders (CSP-friendly, as today). The `check:size` gate measures the first-visit route only, so it stays green.

---

## 7. Rendering and editing overlays (three.js r186)

### 7.1 Edit-mode draw list (per edited mesh, per pane)

| Layer | three object | Data | Update on position drag | Update on topology change |
|---|---|---|---|---|
| Shaded surface | `Mesh` with a per-corner non-indexed-by-vertex layout: one GPU vertex per corner (`position`, `normal`, `uv`, `state`), index = the per-face triangulation | corners | positions + normals of dirty corners (`BufferAttribute.addUpdateRange`, present in r186) | rebuild arrays (0.2 ms) + index (0.6 ms) |
| Face tint / soft-selection ramp | same mesh, `state` attribute (selected, hover, soft weight u8) mixed in the shader | corners | soft weights per frame while dragging | rebuild |
| Edges | `LineSegments` over `edgeVerts` (1 px); `LineSegments2` (fat lines, addons, instanced) for selected/hover edges only | edges | positions | rebuild |
| Vertices | `Points` with a small custom shader: constant pixel size, colour by state | points | positions | rebuild |
| Face dots (optional, desktop DCC face centres) | `Points` at face centroids | faces | centroids of dirty faces | rebuild |
| Normals display (optional) | `LineSegments` | corners/faces | — | — |
| Symmetry plane, manipulators, cut previews | existing overlay passes | — | — | — |

- **Occlusion**: the surface draws with `polygonOffset` pushed back, overlays draw depth-tested on top (no z-fighting
  of edges/points with faces). **X-ray**: the surface draws at reduced opacity without depth writes and overlays draw
  in the existing two passes (occluded pass with `GreaterDepth` at reduced alpha, then visible pass) used for controls
  (ARCHITECTURE §8).
- **Colours** come from the design tokens (theme), never literals; desktop-DCC conventions: selected vertices/edges
  orange, hover highlight (its preselection highlight), soft-selection ramp yellow→red→black.
- **Skinned meshes** render at bind pose in edit mode (skinning off on the edit surface); the Animate workspace shows
  the deformed character with the latest committed revision (§10).
- **Idle cost** stays 0 frames: overlays redraw only on `invalidate()` after a change.

### 7.2 Picking

| Query | Method | Measured / budget |
|---|---|---|
| Hover / click face | BVH `raycastFirst` → triangle → `triFace` map → face | 1,000 raycasts in 1.0 ms at 50k tris |
| Hover / click vertex | screen-space grid of projected vertices (cell 16 px, rebuilt per camera or position change: projecting 25k vertices < 0.2 ms) → nearest within the pick radius → occlusion test unless x-ray | ≤ 0.5 ms per hover |
| Hover / click edge | candidate edges = edges of the hit face and edges incident to grid-near vertices; screen-space segment distance; silhouette fallback via grid when the ray misses | ≤ 0.5 ms |
| Occlusion of a vertex/edge | ray from the camera to the element: visible if nothing is hit before `distance − ε`, or the hit face contains the element | ~1 µs per test |
| Marquee / lasso | project candidates, rectangle/polygon test (lasso: even-odd with the grid as a prefilter), then occlusion per candidate (or BVH `shapecast` with a frustum for faces) | 10k candidates ≤ 16 ms |
| Back faces | not pickable unless x-ray or "select back faces" | — |

GPU ID buffer (the open-source DCC's edit-mode "select buffer" approach, `draw_select_buffer.cc`):
render element IDs into an RGBA8 target restricted by scissor to the cursor region or marquee rectangle and read it
with `WebGLRenderer.readRenderTargetPixelsAsync` (present in three r186). Kept as a fallback for meshes far above the
budget; it adds a frame of latency and misses sub-pixel elements.

BVH maintenance: refit after position-only commits (0.9 ms at 50k); full rebuild after topology changes (6.3 ms at
50k), deferred to the first pick or an idle callback so the commit itself stays inside budget.

---

## 8. Measured performance and budgets

### 8.1 Measurements (Node 25.6.1, Apple M4 Pro, single thread)

Workload: a quad grid with a wavy surface, 25,000 quads = 50,000 render triangles (25,326 vertices, 50,325 edges,
100,000 corners), and a 2,500-quad version. Algorithms as in §3–§5 (typed arrays, no allocation in loops).

| Step | 50k tris | 5k tris |
|---|---|---|
| Derive edges, corner→edge and radial cycles (open-addressing hash) | **1.8 ms** | 0.25 ms |
| Same with a sort instead of a hash | 9.1 ms | 0.86 ms |
| Face normals (Newell) + angle-limited corner normals (full recompute) | 2.9 ms | 0.29 ms |
| Render triangulation (quads, shorter diagonal) | 0.6 ms | 0.08 ms |
| Per-corner render positions | 0.2 ms | 0.04 ms |
| `three-mesh-bvh` build | 6.3 ms | 0.65 ms |
| BVH refit after moving 100 vertices | 0.9 ms | 0.14 ms |
| 1,000 BVH raycasts | 1.0 ms | 1.0 ms |
| Clone of the stored arrays (0.8 MB topology + positions) | 0.03 ms | — |
| SHA-256 of 0.8 MB (WebCrypto) | 0.3 ms | 0.06 ms |
| SHA-256 of one 64 KiB chunk with the in-repo synchronous implementation (`doc/src/migrations/sha256.ts`) | 0.2 ms (≈ 312 MB/s) | — |
| `earcut` of a 64-gon | 2.9 µs | — |
| meshoptimizer `simplify` to half the triangles | 6.0 ms | 1.2 ms |

### 8.2 Budgets (reference machine; recorded by benches, report-only like ARCHITECTURE §14)

| Scenario at 50k tris | Budget |
|---|---|
| Enter component mode (edit links, caches, overlays, BVH) | ≤ 40 ms |
| Hover pick (vertex/edge/face) | ≤ 0.5 ms |
| Marquee/lasso of 10k vertices with occlusion | ≤ 16 ms |
| Drag 1,000 vertices: positions + dirty normals + GPU upload (BVH refit deferred) | ≤ 4 ms per frame |
| Soft-selection drag over 10k vertices | ≤ 8 ms per frame |
| Typical topology op (extrude 100 faces; insert a loop on a 200-quad ring): op ≤ 4 ms, op + caches + GPU ≤ 16 ms | ≤ 16 ms |
| Commit: hash dirty chunks + write the revision ref | ≤ 3 ms typical |
| Undo/redo of one mesh op (journal path) | ≤ 5 ms (ARCHITECTURE: one gesture ≤ 5 ms) |
| Undo/redo fallback (rebuild from chunks) | ≤ 40 ms |
| Make editable from GLB (weld, report, layers) | ≤ 150 ms |
| Export one edited mesh (split by corner attributes, per-material primitives) | ≤ 50 ms |
| Memory per edited mesh (stored + edit + caches + GPU + BVH) | ≤ 40 MB |
| Idle in the Model workspace | 0 frames (gate, as today) |

Above 200k triangles the editor offers "Decimate first" and opens the mesh read-only in component mode until then.

---

## 9. Document, undo, persistence, collaboration

### 9.1 Records

New table `meshes` (registered through `TableDef`, merge unit `field`, soft delete):

```ts
export interface MeshRecord {
  readonly id: MeshId;                                   // 'msh_<16 base62>'
  readonly name: string;
  readonly owner: { readonly character: CharacterId } | { readonly scene: true };
  /** glTF mesh this record edits (export target); null for meshes made in the editor. */
  readonly source: { readonly asset: AssetId; readonly mesh: number } | null;
  /** Current revision; null = not made editable yet (the asset's geometry is shown). */
  readonly data: { readonly manifest: string /* sha256 hex */; readonly rev: number } | null;
  /** Face material index → material. Materials are not edited by the kernel. */
  readonly materials: readonly ({ readonly asset: AssetId; readonly material: number } | { readonly builtin: 'default' | 'vertex-color' })[];
  /** Skin binding of a character mesh: joints and inverse binds come from the asset's skin; modeling never changes them. */
  readonly skin: { readonly asset: AssetId; readonly skin: number } | null;
  /** Stable morph target order (VRM expression binds index it). Rename = field patch; removal needs an expression remap. */
  readonly morphTargets: readonly string[];
  /** Creation parameters of a primitive, dropped by the first edit (desktop-DCC history-like tweaks without history). */
  readonly generator: { readonly kind: string; readonly params: Readonly<Record<string, number | boolean | string>> } | null;
  readonly placement: ReadonlyXf;                        // scene props; character meshes stay under the character root
  readonly order: string;
  readonly deleted: Tombstone;
}
```

**Partition**: `mesh:<meshId>` — a contract change to `Partition` (`'scene' | 'char:' | 'clip:'` today, ADR 0002) that
needs an ADR. Reasons: a modeler and an animator can work in parallel (claims and, in M4b, permissions are per
document); a big mesh's revision churn does not touch the character or clip documents. Alternative: `char:<id>` for
character meshes (fewer documents, no parallel modeling).

### 9.2 Revision format ("ekza-mesh", version 1)

- **Chunks**: each stored array (§3.1) and each attribute layer is cut into chunks of about 32 KiB: elements per
  chunk = the largest power of two whose bytes fit (positions 2,048 vertices = 24 KiB; `u32` corner arrays 8,192
  corners; `u8` flags 32,768). A chunk is the raw little-endian bytes; its id is its SHA-256. Swap-remove and append
  keep edits local, so a commit changes the chunks its edited indices span plus the tails (a 1,000-vertex edit on
  index-coherent vertices: 1–2 position chunks; scattered indices: more; worst case the whole layer, ~300 KiB of
  positions at 25k vertices). A 50k-tri mesh with UV0 and skin has ~200 chunks; its manifest is ~15 KB.
- **Manifest**: deterministic JSON (sorted keys, shortest round-trip numbers, like `project.json`):
  `{format, version, counts, bounds, layers: [{name, domain, type, comps, interp, mirror, chunkElems, chunks: [sha256…]}]}`.
  The revision id is the SHA-256 of the manifest bytes, so identical meshes have identical ids.
- **Hashing** is synchronous (the in-repo SHA-256 at ~312 MB/s, 0.2 ms per 64 KiB chunk) so `transact` stays
  synchronous; only dirty chunks are rehashed.

### 9.3 BlobStore

Mesh chunks are not user-facing assets, so they do not become `AssetRecord`s (thousands of rows). A content-addressed
`BlobStore` service (editor-core) sits next to `AssetStore`:

```ts
export interface BlobStore {
  put(bytes: Uint8Array): string;                    // sync; returns sha256 hex; dedupes; in-memory first
  get(id: string): Promise<Uint8Array>;              // verifies hash; EkzaError('blob-missing' | 'blob-corrupt')
  peek(id: string): Uint8Array | undefined;
  pin(owner: string, ids: readonly string[]): void;  // keep alive for undo steps / open revisions
  unpin(owner: string): void;
  persist(): Promise<void>;                          // IndexedDB/OPFS for autosave; later presigned HTTP (06 §10.1)
}
```

GC is mark-and-sweep from current mesh records, pinned undo steps and open revisions. `.ekzanim` gains
`blobs/<sha256>` entries for the chunks and manifests reachable from current records (a `schemaVersion` bump, ADR 0011
amendment); autosave stores chunks by hash, so repeated autosaves of a large mesh write only changed chunks.

### 9.4 Commit, undo and redo

```
tool gesture ─► MeshRuntime.beginOp('mesh.extrude', args)        // runs the op on EditMesh, keeps its MeshDelta
            ─► session.update(args) …                           // modal drag / numeric input: adjust() fast path,
                                                                //  else revert delta + re-run (no doc writes)
            ─► session.commit()                                 // 1. hash dirty chunks, BlobStore.put
                                                                // 2. store.transact({label:'Extrude', selectionBefore/After},
                                                                //      tx => tx.patch('meshes', id, { data: newRef }))
                                                                // 3. journal edge oldRef → newRef with the delta; pin chunks
            ─► session.cancel()                                 // revert delta; nothing written
undo        ─► PatchUndoManager restores data: oldRef           // compare-before-restore on the field (06 §9)
            ─► MeshRuntime (batch listener) sees the ref change:
                 journal has newRef → oldRef?  applyDelta(backward)   O(|delta|), caches/GPU updated from delta.dirty
                 otherwise                     load chunks, rebuild    O(n), ~10–40 ms at 50k
```

- **One gesture = one undo step** (ADR 0013): a modal extrude drag is one commit.
- **Adjust last operation**: while no other change happened, editing the last op's args reverts its delta, re-runs
  and re-commits with the same `coalesceKey` (`mesh-op:<sessionId>`), so the history keeps one step. Contract delta:
  an "amend last entry" option on `TxMeta` (or `coalesceMs: Infinity` for that key) — `PatchUndoManager` coalesces
  only inside a time window today.
- **Selection**: component selections are bitsets in the session store (`ComponentSelection` per mesh: mode, three
  bitsets, pick order, active element); snapshots ride in `TxMeta.selectionBefore/After` (a 50k-tri mesh's three
  bitsets are ~25 KB; run-length encoded they are usually far smaller).
- **Object-level edits** (rename, placement, material slots) are ordinary field patches.

### 9.5 Preview sessions and other users

During a modal session the EditMesh mutates in place, but the document does not change, so no `PreviewSession`
(ADR 0002) is opened: that keeps per-frame mesh writes out of the store and out of collaboration traffic (06 D5).
Collaborators see the result on commit (in M3, optionally a low-rate ghost through presence).

### 9.6 Collaboration (M3+)

- **Claim**: entering component mode takes an exclusive claim on `mesh:<id>`; a second user gets "Alice is modeling
  Hat" and can view revisions live. Object-mode field patches stay free.
- **Transport**: peers receive the `data` field change and fetch missing chunks (presigned GET, verified by hash);
  local edits upload dirty chunks first, then write the ref.
- **Why not per-component CRDT** (measured with Yjs 13.6.33, V2 encoding, the 50k-tri grid):

  | Layout | Document | Build | Load | Per commit (1,000 vertices moved) |
  |---|---|---|---|---|
  | Per component: `Y.Map` vertex id → `[x,y,z]`, face id → vertex ids (Blockbench-like) | 1.83 MB (1.84 MB after 20 commits) | 31.5 ms | **66.9 ms** | ≈ 22 KB update |
  | Whole mesh as one `Uint8Array` in the CRDT | 0.70 MB | 0.2 ms | — | 0.70 MB (whole blob) |
  | **Hash ref in the CRDT + chunks outside** | **132 bytes** after 21 revisions (chunks: ~0.8–3 MB in the blob store, fetched once, cached by hash) | — | — | 1–2 position chunks (24–48 KiB) for index-coherent edits + ~100 bytes |

  Wire cost per commit is the same order for per-component maps and chunks, but the per-component layout puts
  1.83 MB per mesh into the CRDT document itself (loaded and kept in memory on every peer, 67 ms per mesh), and its
  merges can produce invalid meshes (faces pointing at concurrently deleted vertices, two users splitting the same
  edge). Claims plus revisions avoid all of it.

### 9.7 Versioning and migrations

The manifest carries `format`/`version`; readers accept known versions and refuse newer ones (read-only + "update the
app", like `minWriterVersion`). Layer names are open strings; unknown layers survive load/save untouched (the same
"unknown data survives" rule as unknown tables).

---

## 10. Coexistence with animation

### 10.1 Make editable (import)

`io` reads the glTF mesh's primitives (uncompressed accessors directly; Draco/meshopt through the existing decoders in
the browser and glTF Transform in Node), then: concatenate primitives (`faceMaterial` = primitive's material slot);
**weld** vertices with bit-equal positions *and* equal skin joints/weights (so separately skinned shells are not
glued) *and* (v0.2) equal `POSITION` deltas in every morph target, so coincident lip or eyelid vertices that separate
in a target stay apart; per-corner attributes from the split vertices (UV, colour, normal → `normal.custom`); **hard
edges** where the two faces' corner normals differ at either endpoint (recovers the DCC's hard/soft edges); morph
target deltas per welded point (~~if split copies disagree, keep the first and report~~ — a disagreement now means
"do not weld"). Faces with repeated vertices are dropped and
counted. Untouched meshes are never re-encoded.

### 10.2 Skinned meshes

- Modeling happens in **bind pose**; the skin binding (joints, inverse bind matrices) is untouched; skin weights are a
  point layer propagated by every op (§3.4), so a mesh fix on a rigged character needs no re-rig.
- Derived rig data that read the mesh (per-bone radii for control sizes, the foot-roll support functions of M2a)
  are recomputed when the mesh revision changes; stored control shapes are not resized automatically.
- Display: ~~on each commit `MeshRuntime` produces a `BufferGeometry` descriptor (with `skinIndex`/`skinWeight`,
  `morphAttributes`, material groups) and `SceneSync` swaps the geometry of the character's mesh objects (three's
  `GLTFLoader` `parser.associations` gives glTF mesh index → objects; `LoadedModel` exposes that map).~~
  *Superseded (MODELING-PLAN v0.2 §3.6): three-vrm's MToon outline pass replaces `mesh.material` with
  `[surface, outline]` and adds two geometry groups, `GLTFLoader` makes one `Mesh` per primitive, and Make editable
  can change the primitive count, so a geometry swap would lose outlines or render nothing. Characters are
  re-displayed through `ModelLoader.load(container)` on a container rebuilt in memory (surgeon output, or the author
  writer's for model-sourced characters) when leaving Model and on idle after commits.*
- Editing on the posed mesh ("on cage") is not supported; a read-only "show deformed" toggle is.
- **Where the weights live** (alignment with [note 14](14-skinning-own-models.md) §3.1–3.2, which proposes a
  `SkinRecord` whose `weights` field points at a separate `ekza.skin.v1` blob plus a topology hash for stale checks):
  the kernel recommends keeping the per-vertex weights **inside the mesh revision** as the `skin.joints` (u16×4,
  indices into the `SkinRecord`'s joint palette) and `skin.weights` (f32×4) layers, and keeping palette, skeleton and
  bind arguments in `SkinRecord`. Reasons: every topology op must update weights in the same transaction (note 14
  §8.1 asks for exactly that), which is one revision and one undo step instead of two blobs that can drift; the stale
  check disappears; and a paint stroke commits only the weight chunks it touched (~32 KiB each), not a whole
  240 KB-per-10k-vertex blob. The `ekza.skin.v1` byte layout (palette + u16×4 + f32×4) maps 1:1 onto the two layers,
  so its export and validation code carries over. Owner/coordinator decision: open question 9.

### 10.3 Morph targets

Deltas are point layers, so base-shape edits keep targets relative (desktop-DCC blend-shape behaviour); ops
propagate deltas. Target order is stable (*v0.2: the manifest's layer order is the only source;
`MeshRecord.morphTargets` was removed so the two cannot drift under per-field undo*); adding a target appends;
removing one requires remapping `VRMC_vrm.expressions…morphTargetBinds` / VRM 0.x `blendShapeMaster` binds in the
surgeon (refused until that step exists). "Edit target" mode (positions written as deltas of the active target) is a
later tool.

### 10.4 Export

- Per edited mesh: split points by unique corner-attribute tuples (UV, colour, normal) per material, triangulate per
  §5.12, normals from §5.11, tangents only when a material uses a normal map (meshoptimizer `Compatible`), quantize
  weights and renormalize. *v0.2 (MODELING-PLAN §3.9): morph `NORMAL` deltas are derived (normals of base + delta
  minus base normals) for targets that had them; an edited primitive whose original had `TANGENT` is refused with a
  reason in M6a unless the user drops tangents (the generator arrives with mesh-wasm in M7).*
- **Into the original GLB/VRM** (surgeon): append new accessors and repoint `mesh.primitives[*].attributes/indices/
  targets` of the edited meshes only; ~~old accessors become orphans (already handled by the surgeon's compaction
  policy)~~ *corrected: no compaction policy exists (the original BIN is copied verbatim), and `EkzaBakeMarkerV1`
  rolls back by truncating accessors and bufferViews to its baseline, which would cut off the appended accessors on
  a re-bake of an edited export. v0.2 adds bake marker v2 (original JSON of replaced primitives, a pre-geometry
  baseline, geometry and clips rolled back together), drops dead BIN ranges as an allowed diff, removes
  `KHR_draco_mesh_compression` from replaced primitives and decodes quantized inputs*; node, skin and material
  indices stay valid, so VRM extensions remain intact. This is a new surgeon step with its own read-back tests
  (single export; export → re-import → re-bake).
- **New models** go through the glTF Transform writer (fresh document) with export-profile lints (triangle budgets,
  ≤ 4 influences, UV sets) shared with the Cleanup diagnostics.

---

## 11. Package design

### 11.1 Packages and dependency rules (additions to ARCHITECTURE §3)

| Package | Dir | Responsibility | May import | Must not import |
|---|---|---|---|---|
| `@ekza-studio/mesh-core` | `packages/mesh-core` | `MeshData`, `EditMesh`, write log, Euler operators, attribute layers, validators, topology stats, all modeling ops, selection walkers, soft selection, symmetry, normals, triangulation, projections, LSCM, skyline packer, chunk (de)serialization, glTF primitive bridge types; `/testing` (arbitraries, fixtures, golden runner) | anim-core, `earcut`, `robust-predicates` | three, React, DOM, doc, WASM |
| `@ekza-studio/mesh-wasm` | `packages/mesh-wasm` | adapters: `Decimator` + `TangentGenerator` (meshoptimizer), later `BooleanSolver` (manifold-3d), `UvAtlas` (xatlas); `/worker` entry with a typed message protocol | mesh-core, the WASM libraries | three, React, doc |
| `@ekza-studio/mesh-view` | `packages/mesh-view` | `EditMeshView` overlays, `ComponentPicker`, screen grids, BVH lifecycle, geometry descriptors → three | mesh-core, anim-core, `three`, `three-mesh-bvh` | React, R3F, editor-core |
| `doc` (changed) | — | `meshes` table, `MeshId`, `mesh:` partition, `MeshRecord` validation | — | — |
| `io` (changed) | — | `meshFromGltf`, `meshToGltfPrimitives`, surgeon "replace primitives" step, writer for new models | + mesh-core | — |
| `editor-core` (changed) | — | `MeshRuntime` per edited mesh (EditMesh, journal, op sessions, adjust-last, sync-to-ref), `BlobStore` service, `mesh.*` operators and their JSON args, component selection in the session store | + mesh-core (mesh-wasm through a service, lazily) | — |
| `viewport` (changed) | — | hosts `mesh-view` layers in panes, modeling tools (state machines) and their manipulators | + mesh-view | — |

`mesh-core` deliberately does not depend on `doc`: it is a reusable geometry kernel (also usable by the spline
generators of the old M6 plan — sweep/revolve/loft output `MeshData`).

### 11.2 Core API sketch (`mesh-core`)

```ts
export interface MeshCounts { readonly points: number; readonly edges: number; readonly faces: number; readonly corners: number }

/** Immutable stored form of a revision (dense, exact-length arrays). */
export interface MeshData {
  readonly counts: MeshCounts;
  readonly position: Float32Array; readonly edgeVerts: Uint32Array; readonly edgeFlags: Uint8Array;
  readonly cornerVert: Uint32Array; readonly cornerNext: Uint32Array;
  readonly faceCorner: Uint32Array; readonly faceMaterial: Uint16Array; readonly faceFlags: Uint8Array;
  readonly layers: ReadonlyMap<string, AttrLayer>;
}

export interface EditMesh {
  readonly counts: MeshCounts;
  // traversal (allocation-free)
  cornerVert(c: number): number; cornerNext(c: number): number; cornerPrev(c: number): number;
  cornerEdge(c: number): number; cornerFace(c: number): number; cornerRadialNext(c: number): number;
  edgeVert(e: number, end: 0 | 1): number; edgeCorner(e: number): number; edgeDiskNext(e: number, v: number): number;
  vertEdge(v: number): number; faceCorner(f: number): number; faceLen(f: number): number;
  edgeFaceCount(e: number): number; isManifoldVert(v: number): boolean;
  // Euler operators (logged)
  makeVert(x: number, y: number, z: number): number; killVert(v: number): void;
  makeEdge(a: number, b: number): number; killEdge(e: number): void;
  makeFace(verts: ArrayLike<number>, material?: number): number; killFace(f: number): void;
  splitEdgeMakeVert(e: number, t: number, from: number): number; joinEdgeKillVert(v: number): number;
  splitFaceMakeEdge(f: number, cA: number, cB: number): number; joinFaceKillEdge(e: number): number;
  reverseFace(f: number): void;
  setPosition(v: number, x: number, y: number, z: number): void;
  layer(name: string): AttrLayer | undefined; addLayer(def: AttrDef): AttrLayer;
  // transactions
  begin(opId: string): void; end(): MeshDelta; abort(): void;
  apply(delta: MeshDelta, dir: 'forward' | 'backward'): void;
  snapshot(): MeshData;                                  // copy-on-write views of the stored subset
}
export function editMeshFrom(data: MeshData): EditMesh;  // derives edit links (1.8 ms at 50k tris)

export type SelectMode = 'vertex' | 'edge' | 'face';
export interface ComponentSelection {
  readonly mode: SelectMode;
  readonly verts: BitSet; readonly edges: BitSet; readonly faces: BitSet;
  readonly order: Uint32Array | null;                    // pick order (bridge, target weld)
  readonly active: number;                               // lead component, −1 = none
}

export interface MeshOp<A extends object> {
  readonly id: `mesh.${string}`;                         // 'mesh.extrude', 'mesh.bevel', 'mesh.insertLoop', …
  readonly modes: readonly SelectMode[];
  readonly params: readonly ParamDef[];                  // v0.2: ParamDef from anim-core; one source for the UI params,
                                                         // the JSON schema and the defaults (desktop-DCC parameter names)
  poll(m: EditMesh, sel: ComponentSelection): true | { readonly reason: string };
  /** Deterministic; writes only through m inside begin/end. */
  run(m: EditMesh, sel: ComponentSelection, args: A, ctx: OpContext): OpResult<A>;
}
export interface OpContext {
  readonly symmetry: SymmetryMap | null;                 // selection is expanded by the runtime before run()
  readonly epsilon: number;                              // scale-relative tolerance
}
export interface OpResult<A> {
  readonly selection: ComponentSelection;
  readonly warnings: readonly { readonly code: string; readonly count?: number }[];
  readonly adjust?: (args: Partial<A>) => boolean;       // fast path for continuous args; false → revert + re-run
  readonly frame?: { readonly pivot: Vec3; readonly axes: Mat3 };   // manipulator placement
}

export function validateMesh(m: MeshData | EditMesh): readonly MeshProblem[];
export function topologyStats(m: MeshData | EditMesh): {
  readonly shells: number; readonly boundaryLoops: number; readonly euler: number;     // χ = V − E + F
  readonly nonManifoldEdges: number; readonly nonManifoldVerts: number; readonly genus: number | null;
};
export function writeRevision(m: MeshData, chunkElems?: number): { readonly manifest: Uint8Array; readonly chunks: ReadonlyMap<string, Uint8Array> };
export function readRevision(manifest: Uint8Array, getChunk: (id: string) => Uint8Array): MeshData;
```

### 11.3 Operator naming (editor-core)

`mesh.extrude`, `mesh.inset`, `mesh.bevel`, `mesh.insertLoop`, `mesh.offsetLoop`, `mesh.cut` (multi-cut path),
`mesh.slice`, `mesh.bridge`, `mesh.merge`, `mesh.targetWeld`, `mesh.collapse`, `mesh.delete`, `mesh.dissolve`,
`mesh.fillHole`, `mesh.mirror`, `mesh.symmetrize`, `mesh.normals.{harden,soften,byAngle,conform,reverse,lock,unlock}`,
`mesh.triangulate`, `mesh.quadrangulate`, `mesh.flipEdge`, `mesh.spinEdge`, `mesh.primitive.{cube,plane,cylinder,cone,sphere,torus,prism}`,
`mesh.uv.{planar,box,cylindrical,spherical,unwrap,pack,markSeam,clearSeam}`, `mesh.color.apply`, `mesh.cleanup`,
`mesh.decimate`, `mesh.separate`, `mesh.combine`, `mesh.makeEditable`; selection operators `select.mesh.{loop,ring,grow,shrink,convert,shell,border,all,invert}`.
All are registry operators (ADR 0008): menus, hotkeys, marking menus, the command palette, scripting and the future
MCP/agent bridge call them with JSON args — which is also what an AI-generation pipeline uses for cleanup steps.

---

## 12. Test strategy

| Layer | What | How |
|---|---|---|
| Invariants | §3.5 after every op, import and delta application | `validateMesh` in every test; debug builds assert after each commit |
| Property tests (fast-check 4.10.2, already used by five packages) | random meshes from arbitraries: primitives with random divisions, random op sequences, random non-manifold soups | model-based `fc.commands` runs of 50–500 ops |
| P1 validity | every op on any valid input yields a valid mesh or a refusal with a reason (never a throw, never an invalid mesh) | all ops |
| P2 Euler characteristic | χ = V − E + F unchanged by extrude (region/individual), inset, insert/offset loop, cuts through faces, bevel (manifold cases), triangulate/quadrangulate, dissolve of a manifold edge or a valence-2 vertex, and bridge (which instead lowers the boundary-loop count by 2); fill hole: χ + 1 and boundary loops − 1; delete face: χ − 1 plus removed loose elements; weld/merge: checked against a recount; per closed manifold shell χ = 2 − 2G | `topologyStats` before/after |
| P3 Manifoldness preserved | closed 2-manifold in → closed 2-manifold out for the manifold-preserving class (extrude region/individual, inset, insert loop, bevel v1, bridge of two holes, cut, mirror with merge, triangulate/quadrangulate) | every edge has exactly 2 faces; every vertex one fan |
| P4 Orientation and normals | adjacent faces traverse shared edges in opposite directions; closed outward meshes keep positive signed volume; corner normals unit length; flat shading equals face normals | geometric checks |
| P5 Undo exactness | `apply(op)` then `apply(delta, backward)` is bit-identical (all stored and edit arrays, counts, layers); redo re-yields the after-state; the manifest hash matches | every op |
| P6 Determinism | same input + args ⇒ same manifest hash; Node vs Chromium (Vitest browser mode) identical | goldens |
| P7 Attribute propagation | weights normalized with ≤ 4 influences; split values on the segment between endpoints; seams preserved (no UV bleeding across seam edges); mirror swaps sides | per rule |
| P8 Serialization | `readRevision(writeRevision(m))` bit-identical; unchanged chunks keep their hashes after local edits | round trip |
| P9 Symmetry | mirror map is an involution; a symmetric op on symmetric input yields symmetric output within ε | — |
| Goldens | hand-checked small cases: region extrude of a cube's top face (8→12 vertices, 12→20 edges, 6→10 faces, χ stays 2), loop cut on a cube ring, 1- and 2-segment bevel of a cube edge, bridge of two 8-loops, fill hole, knife across an L-shaped n-gon | JSON fixtures with counts + positions |
| Robustness corpus | the licensed fixtures (Seed-san VRM PL 1.0, Polybot CC0, UAL CC0): make editable → validate → export → re-import → same topology after weld; synthetic nasties: bow-tie, 3-face edges, flipped face, duplicate faces, coincident shells, zero-area, non-planar and self-intersecting n-gons | `headless-tests` |
| glTF | exports pass the Khronos glTF-Validator with 0 errors; surgeon "replace primitives" keeps every untouched byte (existing surgeon tests extended) | `io` tests |
| Browser | overlay pixel probes (selected vertex colour, x-ray pass), hover/marquee picking on fixed cameras with occlusion, GPU upload ranges | Vitest browser mode (Chromium) |
| Benches | §8.2 table at 5k and 50k tris | `vitest bench`, recorded per milestone |
| E2E | box → extrude → loop → bevel → mirror → UV → (skin, from the sibling note) → animate → export → re-import and validate | Playwright, Chrome + SwiftShader |

---

## 13. Kernel work packages for the TODO

Sizes in agent-days, tests included; UX/tool state machines, keymaps and skinning tools are in the sibling notes.

| WP | Content | Size | Depends on | Acceptance |
|---|---|---|---|---|
| K-0 | ADR "mesh kernel" (this note's K1–K14), contract deltas: `mesh:` partition, `meshes` table, `BlobStore`, amend-last undo option, licence-gate entry for `robust-predicates` | 1 | — | ADR accepted |
| K-1 | `mesh-core` foundation: arrays, attribute layers, write log + `MeshDelta`, Euler operators, `validateMesh`, `topologyStats`, revision chunks/manifest, primitives, test arbitraries | 6 | K-0 | P1, P5, P8 green; budgets for derive/serialize |
| K-2 | glTF bridge: make editable (weld, hard edges, custom normals, skin/morph/colour/UV layers, report), export split/triangulate/normals/tangents, surgeon "replace primitives", writer for new models | 5 | K-1 | fixtures round-trip; validator 0 errors; untouched bytes preserved |
| K-3 | Selection & queries: loop/ring/grow/shrink/convert/shell/border, soft selection, symmetry map (positional + topological) | 3 | K-1 | P9; walker goldens |
| K-4 | Ops A1: extrude (faces individual/region, edges), inset, insert/offset loop, merge/target weld/collapse/merge by distance, delete/dissolve, fill hole, bridge | 7 | K-1, K-3 | P2–P4 + goldens |
| K-5 | Ops A2: mirror/symmetrize/symmetry expansion, normals ops, triangulate/quadrangulate/flip/spin, separate/combine | 4 | K-4 | P2–P4, P7, P9 |
| K-6 | Cut: multi-cut path, knife chords in n-gons (exact predicates), slice | 4 | K-4 | fuzzed paths never yield invalid meshes |
| K-7 | Bevel v1 (§5.3) | 6 | K-4 | goldens; clamp property; refusals instead of invalid output |
| K-8 | `mesh-view`: overlays, x-ray, soft-selection ramp, incremental uploads, `ComponentPicker` (hover, click, marquee, lasso, occlusion), BVH lifecycle | 6 | K-1 | browser tests; §8.2 picking/drag budgets |
| K-9 | Document integration: `meshes` table, partition, `BlobStore` (memory + IndexedDB + `.ekzanim` blobs), `MeshRuntime` (op sessions, journal fast path, sync-to-ref fallback, adjust-last), selection snapshots, autosave | 5 | K-1, K-0 | conformance suite extended (mesh ref undo/compare-before-restore); undo ≤ 5 ms at 50k |
| K-10 | UV: projections, seams → charts, LSCM + CG, skyline packer, texel density; `UvAtlas` adapter (xatlas) | 6 | K-1 | charts flatten without flips on fixtures; packing overlap-free |
| K-11 | `mesh-wasm`: meshoptimizer decimate + tangents in a worker; Cleanup diagnostics and fixes; AI-mesh intake path (weld tolerance, cleanup, decimate, quadrangulate) | 4 | K-1, K-5 | decimated fixtures valid; seams locked |
| K-12 (later) | Booleans via manifold-3d (+ coplanar re-merge by `faceID`), Catmull–Clark subdivide, edge flow, vertex bevel | 7 | K-11 | — |

Total for the modeling base (K-0…K-11): **≈ 57 agent-days** of kernel/view work; K-1, then K-2/K-3/K-8/K-9 in
parallel, then K-4…K-7, K-10, K-11.

---

## 14. Risks and traps

| # | Trap | Mitigation |
|---|---|---|
| 1 | Per-component records or per-vertex CRDT (08 trap 10) | Revision refs + chunks; measured 1.83 MB / 67 ms vs 132 bytes (§9.6) |
| 2 | Half-edge kernels silently dropping imported faces | Radial-edge structure; import report counts every dropped face (only degenerate ones) |
| 3 | External references by index breaking after topology ops | Named group layers; ops propagate them |
| 4 | Drift between edit and stored precision | float32 storage, `Math.fround` on every write |
| 5 | Non-deterministic ops (randomness, float-keyed maps, unstable sorts) breaking adjust-last, goldens and redo | §4.3 rules; P6 test across Node and Chromium |
| 6 | Bevel and knife scope creep | v1 scopes with refusals (§5.3, §5.5); sizes calibrated (§5.0) |
| 7 | Re-encoding untouched meshes on export (breaks the surgeon's byte preservation) | Only edited meshes get new accessors |
| 8 | Reordering or removing morph targets breaks VRM expressions | Stable order in the record; removal blocked until the surgeon remaps binds |
| 9 | More than 4 influences silently dropped by three/Bevy | Kernel caps at 4 with renormalization; lint on import |
| 10 | Custom normals going stale after edits | Rule `clear` on touched corners + a visible count |
| 11 | earcut on self-intersecting projections | Cleanup flags non-planar/self-intersecting n-gons; explicit triangulate |
| 12 | Undo memory for giant ops | Adaptive log → snapshot switch; pinned chunk GC; 500-entry cap |
| 13 | GPL contamination (the open-source DCC, Blockbench) or provenance-unclear ports "matched" to a GPL implementation | Clean-room rule in CONTRIBUTING; open-source DCC files used for sizing only; reject such dependencies |
| 14 | WASM weight and CSP (manifold's npm dependency tree, a stale xatlas wrapper) | Lazy adapters in workers, install-footprint check, own xatlas build if needed |
| 15 | `Unlicense` outside the licence allow-list | Exception entry or own port of the predicates (K-0) |
| 16 | Symmetry seams drifting off the plane, partner loss after asymmetric edits | Snap on-plane vertices; report unpaired vertices; topological mode |
| 17 | UV seams derived from float equality | Ops write bit-identical values on continuous sides; invariant 6 |
| 18 | GPU readback stalls if ID picking becomes the default | CPU picking default; async readback only as a fallback |
| 19 | Partition change ripples (`Partition` is a closed union in `doc`) | ADR first; doc-yjs conformance suite covers the new partition kind |

---

## 15. Open questions for the owner

1. **Partition**: `mesh:<id>` (parallel modeler + animator, per-mesh claims) or meshes inside `char:<id>`?
2. **Influences**: cap skin influences at 4 (three, Bevy, Ekza runtimes) or allow 8 with a second set in export?
3. **Quad recovery on import**: run tris→quads automatically on "Make editable", or only on request?
4. **Construction history**: confirm destructive modeling with adjust-last-op and primitive params (no
   desktop-DCC-style history graph).
5. **Booleans** in the first modeling milestone, or later (they need closed manifold meshes and add ~200 kB gz WASM)?
6. **UV packing**: in-house skyline packer only at first, with xatlas as an optional adapter — or depend on xatlas
   from day one?
7. **Vertex colour export precision**: unorm8 (smaller, banding in darks) or unorm16/float?
8. **`robust-predicates`**: add a reviewed licence exception for Unlicense, or port the predicates?
9. **Skin weights storage**: mesh-revision layers (this note, §10.2) or the separate `ekza.skin.v1` blob of note 14?
   Either way the byte layout is the same; the difference is atomicity with topology edits.
10. **Chunk size**: ~32 KiB per chunk (§9.2) trades manifest size (~15 KB for a 50k-tri mesh) against upload size per
    commit; confirm after the K-9 benchmarks with real modeling sessions.

---

## Appendix A — Benchmark method

- Mesh: `NX × NY` quad grid (`125 × 200` and `50 × 50`), positions `(i, sin(0.3i)·cos(0.2j), j)`, stored as
  Float32 positions, face start offsets and corner→vertex (the 0.8 MB "stored" figure covers only these).
- Topology derivation (hash variant): for every corner, key = `min(a,b)·P + max(a,b)` of its edge; open addressing
  with linear probing in a `Float64Array`; the first corner of a key creates the edge, later corners are inserted into
  the edge's radial cycle. Sort variant: argsort of keys, then runs.
- Normals: Newell face normals; per corner, the normalized sum of face normals around its vertex whose dot product
  with the corner's face normal ≥ cos 30°.
- BVH: `new MeshBVH(geometry)` over the per-corner positions with the triangulated index; refit after offsetting 400
  corner positions; 1,000 `raycastFirst` calls with random vertical rays.
- CRDT: Yjs 13.6.33 (the version `doc-yjs` pins), `encodeStateAsUpdateV2` sizes; per-component layout = `Y.Map` of
  vertex ids → `[x, y, z]` arrays and face ids → arrays of vertex ids; edits replace 1,000 vertex entries per
  transaction; the delta is `encodeStateAsUpdateV2(doc, stateVectorBefore)`.
- Median of 7–15 runs after warm-up, Node 25.6.1, Apple M4 Pro, one thread.

## Sources

- Open-source DCC developer docs: BMesh design; Mesh (SoA) design.
- Open-source DCC source, for sizing only (GPL-2.0-or-later): the `bmesh/` directory on the main branch; edit-mode
  select buffer `draw/intern/draw_select_buffer.cc`.
- OpenMesh `add_face` failures: https://lists.rwth-aachen.de/archives/list/openmesh@lists.rwth-aachen.de/message/Q3G5VPCTFE5KLE4XAUX2KRKXCZXQUPA6/ ;
  https://lists.rwth-aachen.de/archives/list/openmesh@lists.rwth-aachen.de/thread/AAI7DZQTLYPUPWKLWLCOENQGXUNW27PM/ ;
  https://graphics.rwth-aachen.de/media/openflipper_static/Daily-Builds/Doc/Free/Developer/PolyConnectivity_8cc_source.html
- Blockbench mesh model (GPL-3.0): https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/mesh.js ;
  modeling tools: https://github.com/JannisX11/blockbench/tree/master/js/modeling/mesh
- Desktop DCC reference (vendor documentation): SDK "Deformers in the Dependency Graph" (component lists by index,
  renumbering; 2018); Component Tags / deformer memberships (2026 help); node references (2026): `polyExtrudeFace`,
  `polyBevel3`, `polySplitRing`, `polyBridgeEdge`, `polyMergeVert`, `polyMirror`, `polyCloseBorder`, `polyDelEdge`;
  Bevel Options (fractional offset; 2017 help).
- glTF 2.0 specification (COLOR_n linear, JOINTS_n/WEIGHTS_n sets, morph target order): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- three.js r186: `WebGLRenderer.readRenderTargetPixelsAsync`: https://github.com/mrdoob/three.js/blob/r186/src/renderers/WebGLRenderer.js ;
  `BufferAttribute.addUpdateRange`: https://github.com/mrdoob/three.js/blob/r186/src/core/BufferAttribute.js ;
  fat lines: https://github.com/mrdoob/three.js/tree/r186/examples/jsm/lines ; `toCreasedNormals`,
  `computeMikkTSpaceTangents`: https://github.com/mrdoob/three.js/blob/r186/examples/jsm/utils/BufferGeometryUtils.js ;
  bundled earcut port: https://github.com/mrdoob/three.js/blob/r186/src/extras/Earcut.js
- three-mesh-bvh: https://github.com/gkjohnson/three-mesh-bvh — npm 0.9.16
- meshoptimizer (JS README, simplifier flags, tangents, experimental remesher): https://github.com/zeux/meshoptimizer ;
  https://github.com/zeux/meshoptimizer/tree/master/js ; https://github.com/zeux/meshoptimizer/blob/master/src/meshoptimizer.h — npm 1.3.0
- manifold: https://github.com/elalish/manifold — npm `manifold-3d` 3.5.4
- xatlas: https://github.com/jpcy/xatlas ; xatlas.js: https://github.com/repalash/xatlas.js — npm `xatlasjs` 0.2.0
- earcut (robustness, `refine`, `deviation`): https://github.com/mapbox/earcut — npm 3.2.4
- robust-predicates: https://github.com/mourner/robust-predicates — npm 3.0.3
- constrainautor: https://github.com/kninnug/constrainautor — npm 4.1.0
- three-bvh-csg: https://github.com/gkjohnson/three-bvh-csg — npm 0.0.18
- mikktspace-wasm: https://github.com/donmccurdy/mikktspace-wasm — npm `mikktspace` 1.1.1
- Half-edge libraries reviewed: https://github.com/LokiResearch/three-mesh-halfedge ; https://github.com/erasta/three-halfedge-dcel ;
  https://github.com/GeometryCollective/geometry-processing-js ; npm `@sherifmagdy/three-mesh-halfedge` 2.5.2,
  `@amanyadev/half-edge` 0.1.0; UV: npm `@triforge/uv-core` 0.1.2; booleans: npm `trimesh-boolean` 0.7.6
- LSCM: B. Lévy, S. Petitjean, N. Ray, J. Maillot, "Least Squares Conformal Maps for Automatic Texture Atlas
  Generation", SIGGRAPH 2002: https://doi.org/10.1145/566654.566590
- Yjs 13.6.33 (benchmarks): https://github.com/yjs/yjs
- fast-check: https://github.com/dubzzz/fast-check — npm 4.10.2
- Internal: [ARCHITECTURE.md](../../ARCHITECTURE.md), [ADR 0002](../adr/0002-document-store-and-collaboration-readiness.md),
  [ADR 0005](../adr/0005-export-strategy.md), [ADR 0006](../adr/0006-viewport-rendering.md),
  [ADR 0008](../adr/0008-operator-tool-editor-registries.md), [ADR 0011](../adr/0011-project-file-format.md),
  [ADR 0013](../adr/0013-editor-history.md), [research 06](06-collaboration.md), [research 08](08-extensibility-modeling.md)
