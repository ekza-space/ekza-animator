# M6a B2 — Selection walkers, soft selection, symmetry maps, component transforms: build notes

Branch `m6a/mesh-select` (from `m6a/spec`, with `m6a/mesh-kernel` merged, which carries `m6a/contracts-foundation`).
Scope: [M6A-SPEC §9 B2](../M6A-SPEC.md#b2--selection-walkers-soft-selection-symmetry-maps-component-transforms).
Decision IDs below are `M6A-B2-<n>`. B2 owns no E2E-MOD scenario (§10.1); its gates are unit, property and
browser-mode tests in `packages/mesh-core`.

## What landed (by spec responsibility)

| B2 item | Where (`packages/mesh-core/…`) |
|---|---|
| Edge, vertex and face loops, rings, partial loops (pole, triangle, n-gon, border, non-manifold and hidden stops) | `src/select/loops.ts` |
| Grow, shrink, convert (touching, contained, perimeter, border, shell, loop, ring), hidden honoured | `src/select/region.ts` |
| Maya's loop table as `loopGesture` | `src/select/gesture.ts` |
| Soft weights (Volume: world Euclidean via an integer spatial hash; Surface: Dijkstra along visible edges cut at r; six presets and custom `AnimCurve` falloffs) | `src/soft/{weights,falloff}.ts` |
| Vertex/edge/face partner maps with mutual matching, `edgeReversed`, `edgeSelf` (crossing vs in-seam) | `src/symmetry/map.ts`, `src/symmetry/hash.ts` |
| The mirror of Object/World X/Y/Z in mesh-local space (rotated and non-uniformly scaled placements included) | `src/symmetry/space.ts` |
| `expandSelection`, the unmatched-partner helpers | `src/symmetry/expand.ts` |
| The pointer rule `mirrorEdgePoint` (t / 1 − t, crossing edges snap to t*, in-seam edges never snap), `crossingParameter` | `src/symmetry/pointer.ts` |
| Seam helpers: in-plane projection and delta part, symmetrize a self-mirrored region, the source side of a pair, Preserve Seam check and refusal | `src/symmetry/{seam,space}.ts` |
| `mesh.transformComponents` with soft weights and symmetry (§5.14 first row), World/Object/Component | `src/ops/transform/{index,math}.ts` |
| B0a's stubs `src/stubs/{select,soft,symmetry}.ts` deleted; the B2 barrel lines point at the modules | `src/index.ts` (B2 lines only) |

## For the op packages (B3, B4, B5) and the UI packages (B10, B12a)

Import the helpers from their modules (they are kernel-internal, not in the barrel; every module references the kernel
marker):

- `src/symmetry/space.ts` — `mirrorSpaceOf(map)` gives the map's mirror: `planeDistance(space, x, y, z)` (signed
  **world metres**, positive side = the positive axis), `reflectPoint`, `reflectVector` (S and its linear part, in
  mesh-local coordinates), `projectOntoPlane` (the midpoint of p and S·p), `inPlanePart` (the average of a delta and its
  mirror), `worldDistance`. `mirrorSpace({axis, space, placement})` builds one without a map.
- `src/symmetry/expand.ts` — `unmatchedOf(set, map, kind)`, `unmatchedPartnerWarning(elements | count)` (the
  `symmetry.unmatched-partner` `OpWarning` with the help-line sentence "No mirror partner: applied to one side"),
  `selectionUnmatchedWarning(sel, map)`, `partnersOf(map, kind)`.
- `src/symmetry/pointer.ts` — `crossingParameter(m, map, edge)` (t*, from `edgeVert(edge, 0)`), `mirrorVertex`.
- `src/symmetry/seam.ts` — `isSourceOfPair(m, map, kind, i)` (§5.14 "keep: 'positive'"), `centroidPlaneDistance`,
  `symmetrizeVertices(m, verts, partner, space)` (a region that is its own mirror: each vertex and its partner set to
  the mean of p and S·p(partner), seam vertices onto the plane; `partner` may be a lookup for vertices the op created),
  `seamVertices(map)`, `seamViolation(m, map, seamVerts)` + `seamRefusal()` (Preserve Seam: refuse `symmetry.seam`).
- `src/select/common.ts` — adjacency iteration over the edit links (`forEachVertEdge`, `forEachEdgeCorner`,
  `forEachFaceCorner`, `forEachVertFace`), `visibleCopy` (drop hidden components), `resultSelection`.
- `src/select/loops.ts` — the `*Walk` forms return `{ items, closed }`; `arcOf`, `loopsThrough`.
- `buildSymmetryMap` reads any `EditMesh` state, so an op can rebuild a map on its result inside its transaction to
  pair the vertices it created (P10: "partners found for every new vertex").

For B10: walkers do not take a symmetry context. Under symmetry B10 expands the stored picks (`expandSelection`), runs
the walker on the expanded set and stores the result (§5.6). `loopGesture` takes the selection **before** the
double-click (the first click of the double-click is not applied) and the reference is its `active` component when
`sel.kind === kind`.

For B12a: pass the **stored picks** (not the expanded set) to `mesh.transformComponents`, or pass `pivot` explicitly;
the run expands through `ctx.symmetry` itself and needs the picks to tell the source side (M6A-B2-12). The resolved
`pivot` and `orientation` are in `resolvedArgs`; `OpResult.frame` is the manipulator placement after the run
(mesh-local).

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B2-1 | **The mirror is one affine reflection in mesh-local space**: S(p) = p − 2·d(p)·g with d(p) = n·p − c the signed world distance (n·g = 1). Object mode reflects across the local axis plane through the object origin (d = abs(s_axis)·p_axis); World mode across the world axis plane through the world origin, mapped through the placement (with a rotated, non-uniformly scaled placement S is not orthogonal in local coordinates but is exactly the local image of the world reflection). `SymmetryMap.plane` is informative (the local axis coordinate where the plane crosses the local axis; 0 in Object mode); ops read the mirror with `mirrorSpaceOf(map)`, which `buildSymmetryMap` records (a `WeakMap`, no contract change); a hand-made map falls back to the axis plane at `plane` with an identity placement. | §4.3 `SymmetryMap.plane` is one number, which cannot describe a World plane under a rotated placement; the frozen contract keeps its shape. |
| M6A-B2-2 | **Tolerance is world metres in both spaces** (seam band and partner distance): a mesh scaled ×2 in Object mode pairs vertices whose mirrors are within 0.001 m in world, i.e. 0.0005 local units. The spatial hash uses cell = tolerance / min abs(scale) in local units and filters by the exact world distance. | §5.14 "Tolerance is in metres". |
| M6A-B2-3 | **Mutual matching** (P9 by construction): a vertex's nearest off-seam candidate within the tolerance of its mirror (ties: smaller index); a pair only when both choose each other; every other off-seam vertex gets −1 and counts in `unmatched`. Seam vertices never partner others. Faces are matched by vertex set (stamps; sorted tuples only when a face repeats a vertex, identical results) and accepted when mutual too. | §5.14 rules; mutual faces keep `face` an involution on duplicate-face soups. |
| M6A-B2-4 | **Walker order**: a closed loop starts at the seed and runs towards `edgeVert(seed, 1)` (edges), along `along` (vertices), across `across` (faces); an open one runs from its backward end to its forward end. A face loop seeded on a non-quad is the face plus the strip across `across`. A vertex loop is the vertices of the edge loop through `along`, hidden vertices dropped. Out-of-range seeds throw `out-of-range` (caller errors, like `selectionOf`); a hidden seed gives an empty list. | §4.3 "ordered"; the tie rule of §5.6 needs a defined forward direction. |
| M6A-B2-5 | **Partial loops**: the shorter arc of a loop through both; among several loops through a vertex or face (one per incident edge, disk order, or per face edge, corner order) the shortest arc wins, ties to the first loop; within a closed loop ties go forward (§5.6 tie rule). | §5.6 table "shorter arc". |
| M6A-B2-6 | **`loopGesture`**: `double` replaces (edges: the loop; vertices and faces: the component); `shift-double` without a reference, on the reference itself or on a hidden component is a plain Shift toggle; added components follow in loop order (partial loops from the reference to the click) and the click becomes `active`. `mod-double` removes the contiguous selected run containing the click along its loop (vertices and faces: the loop with the longest run); edges consider the edge loop only (not the ring); an unselected click removes nothing. | §5.6 table; "the loop through the clicked vertex" is ambiguous at a valence-4 vertex. |
| M6A-B2-7 | **Grow and shrink**: grow uses Maya's/Blender's face step (vertices across edges and faces; edges and faces by shared vertices); shrink removes members with a visible unselected neighbour — the mesh border is no neighbour (Blender's select less), so a block touching the border keeps its border row. Hidden neighbours neither join nor count. | §5.6 wording; research 10 §4.1. |
| M6A-B2-8 | **Convert modes**: *perimeter* = the boundary of the selected face region (faces, or the faces a vertex or edge selection contains): edges with exactly one region face (mesh-border edges of region faces included), their vertices, or the region faces along them — a selection enclosing no face has an empty perimeter; *border* = the complete mesh-border loops touching the selection (an empty selection gives nothing: B10 passes everything for "Select › Border" with nothing selected); *shell* = flood fill over visible edges from the touching vertices; *loop*/*ring* = the loops/rings of the selection's edges (vertices: the edges between selected vertices; faces: the edges of the selected faces), then converted *touching*. | §5.6 and the `model.convert` marking menu (§8.4). |
| M6A-B2-9 | **Result selections**: only the returned kind's bitset changes; the other kinds are copies (per-mode memory), never aliases. Order: the previous order filtered to members still selected, then additions; the same kind keeps its order and `active`; a conversion to another kind starts in ascending order with the last member active. | §4.3 `order`/`active`. |
| M6A-B2-10 | **Soft weights**: seeds (the expanded selected vertices) weigh 1 whatever the curve; d > r weighs 0 (`constant` is 1 up to r inclusive); hidden vertices weigh 0 and hidden seeds or edges carry nothing; a custom `AnimCurve` is evaluated at frame x = d/r ∈ [0, 1] and clamped to [0, 1]. Distances are world metres through the placement. | §5.15; research 13 §5.15. |
| M6A-B2-11 | **`mesh.transformComponents` args** are world measures: M = T(pivot)·O·T(t)·R·S·Oᵀ·T(−pivot), with `translate*` along the frame axes (metres), R = Rz·Ry·Rx (rotate order xyz, as §5.8), `scale*` along the frame axes; O = identity (`world`), the placement's rotation (`object`), or `orientation` (`component`); the local matrix is P⁻¹·M·P. `pivot` = [x, y, z] world (null: the bounding-box centre of the picked vertices); `orientation` = quaternion [x, y, z, w] world (null: the Component frame of the picks: Z = the area-weighted sum of the selected faces' Newell normals, or of the unit normals of the faces around the picked vertices; X/Y by the region-frame rule of §5.8). Both are resolved and recorded in every space, so an adjusted re-run switched to `component` uses the original frame. Refusal `transform.no-selection` when no visible component of the selection's kind is selected. | §6.1 lists the params without their encoding. |
| M6A-B2-12 | **Symmetry in transforms**: the run expands the picks itself; each moved vertex takes its own side's delta — the source side (the side of the off-seam picks when their mean plane distance exceeds the tolerance, else the pivot's side when it lies off the plane, else positive — float noise in two-sided picks must not choose the side) gets M, the mirror side S·M·S (partners move by the mirrored delta; rotations and scales about S·pivot); seam vertices take the in-plane part, projected onto the plane with Preserve Seam; picked vertices without a partner get M on their own side only and the run warns `symmetry.unmatched-partner` (count = picked components of the selection's kind without a partner). A map built for another vertex count is a caller error `symmetry-stale`. | §5.14 first two rows; two-sided picks need one source per pair to stay symmetric (P10). |
| M6A-B2-13 | **Hidden components in transforms**: hidden picks never move; a visible edge or face moves all its vertices, also one shared with hidden geometry; soft weights skip hidden vertices. | §5.6 "never op targets … edits to visible neighbours may move shared vertices". |
| M6A-B2-14 | **`OpResult.adjust`** keeps the run's plan (moved vertices, weights, sides) and rewrites positions from the pre-op values inside the open transaction for any patch of the op's args; it returns false once the transaction has ended. `resolvedArgs` stays the first run's (the caller holds the patched args). | §4.3 `adjust`; a live drag patches `translate*`/`rotate*`/`scale*` every frame. |
| M6A-B2-15 | **Off-centre plane golden** (§9 B2 "t* ≠ 0.5"): a crossing edge's endpoints are each other's mirror within the tolerance, so the plane cuts it off-centre only by up to the tolerance; the goldens use a box from x = −0.45 to 0.5 with a 0.1 m tolerance (t* = 0.45/0.95) and a World-mode cube moved 0.02 m along X with a 0.05 m tolerance (t* = 0.48). | The spec names the case, not the fixture. |
| M6A-B2-16 | **In-seam golden**: the humanoid body is B13's generator (still a stub here). The rule is covered now by the centre loop of a cube with two width spans; the humanoid case is in place behind `describe.skipIf(!READY.b13)`. `packages/mesh-core/test/ready.ts` is new (`b2: true`, `b13: false`) — B3/B4/B5 may add their flags to it; **INT turns `b13` on**. | §3 rule 4. |
| M6A-B2-17 | **Literal update** in `test/descriptors.test.ts` (B0a/B1 file): landed ops are listed in a `LANDED` set and skipped by the "stub refuses not-implemented" case (B2: `mesh.transformComponents`; its runs are tested in `test/transform`), and the marker scan includes B2's module dirs (`select`, `soft`, `symmetry`). | §3 rule 9; the next op owners add one line each. |
| M6A-B2-18 | **Performance**: `buildSymmetryMap` matches faces by vertex-set stamps (13 → 4 ms at 10k vertices); soft weights reuse `out`. | §5.27 (the map is rebuilt after every topology commit). |

## Tests (all in `packages/mesh-core/test/`)

- `select/walkers.test.ts` — loops and rings on the torus (12/6, closed, ordered, complementary), cube (poles), cylinder
  with three height spans (closed middle rings; verticals stop at the n-gon caps' valence-3 rims), sphere (meridians
  stop next to the triangle fans), plane borders, an open cylinder's rims, non-manifold and wire seeds; vertex and face
  loops; partial loops on edges (incl. the tie rule), vertices and faces; hidden edges, vertices and faces stopping
  walkers.
- `select/region.test.ts` — grow/shrink in every kind, hidden components, per-mode memory without aliasing; every
  convert mode.
- `select/gesture.test.ts` — the loop table rows in edge, vertex and face mode, the plain-Shift fallback, `Mod`-double.
- `select/goldens.test.ts` + `select/b2.browser.test.ts` — the exact lists (walkers, loop table, grow/shrink/convert),
  the symmetry maps of the cube, a two-span cube, the torus and the sphere on X/Y/Z with pointer samples, soft
  weights digests and five transform manifests in `test/goldens/mesh-select.json`; Chromium reproduces them (P6).
- `soft/weights.test.ts` — the presets at sample distances (1e-9 against the float32 rounding), Volume vs Surface on
  a U-shaped strip, the E2E-MOD-10 plane (10,000 vertices, r = 1.8), world radii under a scaled placement, hidden
  vertices and edges, a custom `AnimCurve`, caller errors.
- `symmetry/map.test.ts` — goldens: the cube X ring (crossing, t ↦ 1 − t, snap to t* = 0.5), the off-centre plane
  (t* ≠ 0.5, Object and World), in-seam edges (t ↦ t, never snapped; humanoid case READY-gated), an unmatched vertex,
  the mutual rule and ties, seam band, World mode under rotation, translation and non-uniform scale, tolerance in world
  metres; **P9** and the map rules as properties on primitives (with jitter, random placements, axes, spaces and
  tolerances) and on non-manifold soups.
- `symmetry/seam.test.ts` — `expandSelection`, unmatched warnings, the mirror space (involution, local image of the
  world reflection, projections; properties), `symmetrizeVertices`, `isSourceOfPair`, Preserve Seam checks,
  `crossingParameter`.
- `transform/transform.test.ts` — World/Object/Component under placements, pivot and orientation resolution, rotate
  order, edges and hidden geometry, **P5** exact undo with soft weights, **P6**, symmetry (both sides, rotations and
  scales, seam vertices with and without Preserve Seam, unmatched picks, two-sided picks, stale maps), soft selection
  (the E2E-MOD-10 plane; weights from the expanded selection with seam vertices in the falloff), the adjust fast path,
  and **P10** for transforms and soft selection as properties (Object X under any X-preserving placement and World X;
  random primitives, picks, args, spaces, soft settings and Preserve Seam).
- A mutation check during the build (S·M·S replaced by M) fails both P10 properties.

## Gates (local, real Chrome; port 3163)

On `1e3e9ee` (the later commit changes only the transform's source-side threshold and its test; the mesh-core suite,
format, lint and typecheck were re-run on it), CI unset: `format:check` (1,141 files), `lint`, `typecheck`,
`check:deps` (15 packages) green; `test` 15/15 tasks green (turbo, `--concurrency=4`): anim-core 671, doc 233, doc-yjs 78,
ui 87, rig 202, **mesh-core 450 + 1 skipped** (the READY.b13 humanoid case; Node and Chromium), mesh-view 2, io 170,
editor-core 793, headless-tests 173, viewport 100 + 1 skipped, curve-editor 207 + 3 skipped, editor 359 + 1 skipped,
web 10, tooling. A production `build` and `check:size` green: **864,423 B** (≤ 900,000 B; the eager route is unchanged),
the `mesh-kernel` boundary holds (kernel chunk 39.2 kB lazy, B1: 28.6 kB). The full e2e suite
(`EKZA_E2E_PORT=3163`, `--workers=4`, chrome project): 109 passed, 10 skipped (the stretch `test.fixme` entries and
B0a's `b9` fixme), rc 0 — B2 owns no E2E-MOD scenario (§10.1).

## Benchmarks (report only; Node 25.6, Apple M-series; `pnpm --filter @ekza-animator/mesh-core bench`)

`bench/select.bench.ts`, debug validation off:

| Bench | Mean |
|---|---|
| Soft weights, 10k vertices, one seed, r = 1.8 (E2E-MOD-10): Volume / Surface | 0.21 ms / 0.12 ms (budget ≤ 2 ms) |
| Soft weights, 10k vertices, 271 seeds, r = 0.5, Volume | 1.4 ms |
| `buildSymmetryMap`, 10k vertices / 50k triangles | 4.2 ms / 11.4 ms |
| `mesh.transformComponents`, one vertex with soft (r = 1.8) and symmetry X on 10k vertices, with its undo | 0.47 ms |
| `edgeLoop` + `edgeRing` on a 128 × 64 torus | 0.06 ms |
| Grow a 100-face selection and convert it to the edge perimeter (same torus) | 0.12 ms |

## Open for the integration agent

- M6A-B2-16: `packages/mesh-core/test/ready.ts` is new; set `b13: true` when B13 merges (the humanoid in-seam golden).
- M6A-B2-17: the literal update of `test/descriptors.test.ts` (outside B2's Dirs; minimal and additive).
- M6A-B2-1 and M6A-B2-11 interpret contract fields (`SymmetryMap.plane`; the `pivot`/`orientation` encodings):
  candidates for DECISIONS-OPEN §I and, if the owner wants them normative, a contract PR to §4.3/§6.1.
