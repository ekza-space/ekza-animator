# M6a B4 — Shape ops, Multi-Cut, Slide, Average, MeshSetOps: build notes

Branch `m6a/mesh-ops-shape` (from `m6a/spec`, with `m6a/mesh-kernel` merged). Scope:
[M6A-SPEC §9 B4](../M6A-SPEC.md#b4--shape-ops-multi-cut-slide-average-meshsetops). Decision IDs below are
`M6A-B4-<n>`. B4 is kernel-only: no editor, UI or test-API file, and no E2E-MOD scenario is owned by B4 (§10.1: B4
appears only in the Gates of E2E-MOD-09, -13 and -32, which B11 and B13 land).

## What landed (by spec responsibility)

| B4 item | Where (`packages/mesh-core/…`) |
|---|---|
| `copySubset`, `appendMesh` (B0a stubs replaced; `src/stubs/subset.ts` deleted, barrel line switched) | `src/subset/{copy,append,index}.ts` |
| Shared op plumbing: arg coercion, the component scopes, marks, orphan cleanup, the Euler-refusal guard | `src/subset/support.ts` |
| Affine transforms of mesh data (positions, morph deltas, inverse-transpose custom normals, reversal for det < 0) | `src/subset/matrix.ts` |
| §5.14 pieces the ops need: the map's mirror in mesh-local space (Object/World), pointer rule, partner expansion, unmatched warning, vertex partners, vector layers through the mirror | `src/subset/symmetry.ts` (M6A-B4-2, M6A-B4-3) |
| Boundary inset (Extract / Duplicate Faces `offset`), MeshSetOp steps (shells, remove, detach) | `src/subset/{inset,setops}.ts` |
| `mesh.harden`, `mesh.soften`, `mesh.setNormalAngle`, `mesh.reverse`, `mesh.conform` | `src/ops/normals/index.ts` |
| `mesh.triangulate`, `mesh.quadrangulate` | `src/ops/{triangulate,quadrangulate}/index.ts` |
| `mesh.spinEdge`, `mesh.flipTriangleEdge` (one spin move, ./spin/spin.ts) | `src/ops/{spin,flip}/` |
| `mesh.applyTransform` (behind Freeze and Bake Pivot) | `src/ops/freeze/index.ts` |
| `mesh.averageVertices`, `mesh.slide` (with `adjust` fast paths) | `src/ops/{average,slide}/index.ts` |
| `mesh.cut` (Multi-Cut: exact chord tests, vertex points, symmetric paths and the seam clip) | `src/ops/cut/index.ts` |
| `mesh.mirror`, `mesh.symmetrize` | `src/ops/{mirror,symmetrize}/index.ts` |
| `mesh.combine`, `mesh.separate`, `mesh.extract`, `mesh.duplicateFaces` (MeshSetOps) | `src/ops/{combine,separate,extract,duplicate}/index.ts` |
| Tests: harness, per-op cases, properties P1–P10, Multi-Cut fuzz, goldens (Node + Chromium), READY probes | `test/ops/**`, `test/subset/**`, `test/goldens/ops-shape.json`, `test/ready.ts` |

Every descriptor is B0a's, unchanged (§11.1 op freeze); `test/descriptors.test.ts` lists the landed ops (M6A-B4-21).

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B4-1 | **Component scopes.** An op whose kinds differ from the selection's converts by containment: faces = those whose every edge (edge mode) or vertex (vertex mode) is selected; edges of selected faces; edges with both ends selected; vertices touched by edges or faces. Object mode (`sel` null) = every visible component. Hidden components are skipped everywhere. | Maya converts a selection to the command's component type; containment keeps an op on what the user sees selected. |
| M6A-B4-2 | **Symmetry helpers in B4** (`src/subset/symmetry.ts`): the map's mirror (M6A-B4-3), the §5.14 pointer rule (`mirrorEdgePointOf`, same contract as B2's `mirrorEdgePoint`), the partner expansion for the pointer-class ops (Multi-Cut, Slide expand their own selection; the runtime expands only 'expand'-class ops, B7 `runSelection`), the unmatched-partner warning and a vertex-partner builder for Symmetrize. They read the `SymmetryMap` the caller passes, so B4 works and is tested before B2 merges. `test/ops/symmetry.test.ts` checks them against B2's `buildSymmetryMap`, `mirrorEdgePoint` and `expandSelection` behind `READY.b2`; INT may switch the imports to B2's functions once they agree. | §9: B4's unit tests gate on B2 only for the symmetric cut/slide cases; duplicating ~60 lines of the rule kept B4's own code tested now. |
| M6A-B4-3 | **The mirror of a `SymmetryMap`** (fix round 2; it used to be the local axis plane at `map.plane` in every mode, which in World mode on a rotated mesh is not the mirror plane). Every op builds it once per run from `map.space` and `ctx.placement` (`contextMirror`), the same affine reflection as B2's `MirrorSpace`: S(p) = p − 2·d(p)·g with d(p) = n·p − c the signed **world** distance in metres and n·g = 1. Object: the local axis plane at `map.plane` (B2's maps: 0, through the object origin); World: the world axis plane through the world origin, mapped through the placement (P⁻¹·S·P; not orthogonal under a non-uniform scale). Sides, seam tests and the crossing snap compare d with `map.tolerance` in metres (§5.14 tolerance unit). When the reflection runs along one local axis (Object mode, or a rotation that maps the world axis onto a local one up to 1e-12 of rounding noise, e.g. 90° about Y) the helpers change only that coordinate (`2·offset − x`, projection = `offset`), so seam points land exactly on the plane and Object-mode positions are computed exactly as before (only the tolerance comparisons now measure metres through the placement's scale; with a unit scale nothing changes — the P6 goldens are unchanged). Users: the side and seam rules of Average, Slide, Multi-Cut, the source side of Triangulate, Flip and Spin, Symmetrize (positions and point layers), and Mirror's vector layers in World position (M6A-B4-17). | §5.14: World maps the world plane into mesh-local space; B2's `buildSymmetryMap` registers the same mirror (`test/ops/world.test.ts` checks partners and the pointer rule against it behind `READY.b2`). |
| M6A-B4-4 | **Temporary mark.** Ops that remove elements and must find theirs again (Quadrangulate, Spin, Flip) set flag bit `0x80` on edges or faces and clear it before returning; it never reaches a revision (the harness checks every run). | Removals move indices (M6A-B1-2); flags travel with moved elements and through splits (H4). |
| M6A-B4-5 | **Refusal codes** beyond §6.1's list, all `<op>.<reason>` with a sentence: `harden/soften/setNormalAngle.no-edges`, `reverse/conform/triangulate/quadrangulate.no-faces`, `triangulate.degenerate`, `quadrangulate.no-pairs`, `spin.no-edges/non-manifold/winding/shared-vertices/existing-edge`, `flip.not-triangles/no-quads/same-face`, `freeze.invalid-matrix/singular`, `averageVertices.no-vertices`, `slide.no-components`, `cut.invalid-points/too-few-points/crossing/nothing/no-faces`, `mirror.no-faces/empty/placement`, `symmetrize.no-vertices`, `combine.needs-two/asset-backed/palette-mismatch/placement`, `separate.no-mesh/asset-backed/single-shell`, `extract.asset-backed/no-faces/all-faces`, `duplicate.no-faces/asset-backed`; warnings `flip.skipped`, `mirror.non-manifold`, `separate.loose-dropped`, `extract/duplicate.offset-clamped`. An Euler refusal on unusual input becomes `<op>.failed`/`.degenerate`/`.join` (`guarded`), never a throw (§5.1). MeshSetOps refuse in `poll` whatever `run` would refuse, so menus disable them. | §5.1 policy; B11/B13 map codes to help lines. |
| M6A-B4-6 | **Reverse** keeps every corner on its vertex (B1 `reverseFace`) and negates `normal.custom` on the reversed faces. | A reversed face's custom normals should still point to its front. |
| M6A-B4-7 | **Conform** per BFS patch over manifold edges of the scope: a patch with manifold edges to faces outside the scope **agrees with them** (majority of those edges); otherwise a closed patch flips when its signed volume is negative and an open shell when most face normals point toward its centroid, counting only votes above rounding noise (a single or flat face never flips). | The spec's closed/open rules describe whole shells; a partial selection on a consistent mesh must not end up inconsistent with its surroundings (found by P3/P4 on a torus). |
| M6A-B4-8 | **Set Normal Angle**: hard iff `angle = 0` or the dihedral angle exceeds `angle` (B1's H2 helper); border edges count as flat, so they become soft for any angle > 0. | Keeps P7-hard for angle 0 (§5.3: only angles > 0 may soften). |
| M6A-B4-9 | **Triangulate** writes the shared triangulation's diagonals with `splitFaceMakeEdge` (no removals: the original face keeps its index) and clears `FACE_FLIP_DIAGONAL` on the triangles. **Under symmetry** the partner of a source face (centroid on the positive side) is cut along the mirrored diagonals, and a self-mirrored face with two seam vertices is first cut along the seam, so its halves triangulate as mirror images (P10). A quad that straddles the plane has no symmetric triangulation and keeps the shared one. | §5.14: "symmetric input → symmetric output"; quad ties would otherwise go to the smaller vertex index on both sides. The seam cut makes the written triangles differ from the viewport's for that face only when symmetry is on. |
| M6A-B4-10 | **Quadrangulate** joins only strictly convex quads (exact `orient2d` on the Newell plane), scores rectangularity (sum of \|corner angle − 90°\|, quantized to 1e-9 rad), ties to the smaller face then edge index, and **sets `FACE_FLIP_DIAGONAL` so each quad shows the removed edge as its diagonal** (the shape you see does not change). Under symmetry a pair is taken only with its mirrored pair. With nothing to join it refuses (`quadrangulate.no-pairs`, naming Keep Hard Edges when hard edges blocked every candidate). Note: on a faceted mesh every edge is hard, so the default `keepHardEdges` joins nothing there. | §5.13 options and defaults are Maya's; the refusal says why. |
| M6A-B4-11 | **Spin**: the joined polygon is [a, y₁…yₘ, b, x₁…xₖ]; forward reattaches to y₁–x₁, back to yₘ–xₖ (two triangles: the same move). Each new face takes the material, face layers and flags (flip bit cleared) of the face whose own vertices it holds, and its corners that face's values (the other face's for its one foreign vertex); the spun edge keeps its flags and edge layers (H5). Under symmetry a negative-side edge whose partner is spun too turns the other way. Refuses spins that would fold faces sharing more than the edge or duplicate an edge. **Several edges in one run** (every symmetric spin or flip is two): a plan stores the edge and its vertices only, and each spin finds faces A and B again from its edge when it runs — plans run in descending edge order, so an earlier spin never moves a later plan's edge, while it does move face slots (fix round 1). | §5.12; P10. |
| M6A-B4-12 | **Flip Triangle Edge** skips non-triangle edges and non-quad faces with `flip.skipped` when something else is flipped, refuses when nothing is; under symmetry a partner quad gets the mirrored diagonal. | §5.12. |
| M6A-B4-13 | **Apply Transform** also transforms morph deltas (point f32×3 layers with mirror rule `negate-axis`) by the linear part, refuses any skin layer (`freeze.skinned`) and singular matrices (`freeze.singular`). | §5.13 lists positions and custom normals; morph deltas live in the same space. |
| M6A-B4-14 | **Average Vertices**: Jacobi steps in float64, one write per vertex; pinned: border, non-manifold and loose vertices; under symmetry pairs are averaged then re-mirrored and seam vertices stay on the plane (pinned with Preserve Seam, else projected). `adjust` re-solves `iterations`/`strength` from the pre-op positions. **Heads-up for B12b (E2E-MOD-24):** on a regular 4 × 4 plane every interior vertex already sits at its neighbours' average, so "Average Vertices moves interior vertices" needs an irregular plane (e.g. one vertex moved first). | §5.12. |
| M6A-B4-15 | **Slide**: `reference` (pointer-bound) is `{vertex, rail}` — a selected vertex and one of its edges; the side holding that rail is positive. Edge mode: chains of selected edges, oriented along the chain; a vertex's rail on a side is the single unselected edge next to a chain edge in that side's faces (none, or two different ones at a pole: the vertex stays). Other chains, and every chain without a reference, take the side whose rails point most along the reference direction (null reference: the left side of the chain through the lowest-index edge). Vertex mode: positive rail = the edge best aligned with the reference direction, negative = best aligned against it. Under symmetry every negative-side vertex whose partner slides **takes its partner's rails mirrored** — only when the mirrored rail ends are joined to it by edges of its own: where the topology differs between the sides (a one-sided Triangulate, Multi-Cut, Spin or Connect) the vertex keeps its own rails (chosen with the mirrored reference direction) and is reported with `symmetry.unmatched-partner` (its vertex, or in edge mode the selected edges that hold it), so it never leaves the pre-slide surface (fix round 2). Seam vertices use only rails in the plane. `adjust` re-solves `percent` from the pre-slide positions. | §5.12 leaves the rail and side rules to the build; B12b's Slide tool fills `reference` from its first drag. |
| M6A-B4-16 | **Multi-Cut**: points within `ctx.epsilon` of an edge's end are that vertex, points within ε of each other on one edge are one point; two points on one edge (or an edge and its end, or two vertices joined by an edge) run along the boundary and cut nothing; a path with nothing to cut refuses `cut.nothing`. The chord test runs on the face polygon **with every cut point on its edges inserted at its float32 position**, so the exact predicates see the face as it will be. Symmetric runs build the §5.14 paths: a path on one side plus its mirror (second cut, same run); a path that reaches the plane at a point (or crosses it inside a face) is clipped there and its kept half mirrored back: one symmetric cut; a crossing inside a face (no point on the plane) becomes one chord from the last kept point to its mirror image. Points without a partner leave the path unmirrored (`symmetry.unmatched-partner` with the count). When the mirrored part cannot be cut although the user's own path can (the sides' topology differs: no common face, a chord outside the face), the user's path (or its kept half up to the plane) is cut on its side alone with `symmetry.unmatched-partner` (the count of its points off the plane) instead of refusing the run; a refusal of the user's own path stays a refusal (fix round 2). `selection′` = the chord edges. | §5.11, §5.14 Multi-Cut row, E2E-MOD-20. |
| M6A-B4-17 | **Mirror**: the snap tolerance is at least `ctx.epsilon` (a `mergeThreshold` of 0 still welds vertices that lie on the plane up to float noise, such as a torus's x ≈ 7e-17 ring); clipped faces are rebuilt from their kept runs with the face as example (clip edges by H1); faces lying in the plane are not copied in merge mode (they would be laminas); copied quads show the mirror image of their source's diagonal; non-manifold seam edges are reported (`mirror.non-manifold`); `position: 'world'` reflects through P⁻¹·S·P, and so do its vector layers: morph deltas by S's linear part, custom normals by its inverse transpose (renormalized) — B1's axis negation when the reflection runs along a local axis, the full reflection when it is oblique (fix round 2, M6A-B4-3). | §5.13; the epsilon snap was found by P3 on a coarse torus. |
| M6A-B4-18 | **−0 after the B1 mirror helpers.** `mirrorPointAttributes`/`mirrorCornerAttributes` negate an axis component, turning a stored 0 into −0; B4 rewrites −0 as +0 after them (`positiveZeros`), so a mirrored mesh hashes canonically. **Request to the B1 owner:** write `0 - x` in the helpers and drop B4's pass. | Revision hashes compare bytes. |
| M6A-B4-19 | **Symmetrize** uses the context's map when it is on the same axis and `tolerance` is null or equal to the map's — with that map's mirror (World mode: the world plane through the placement, M6A-B4-3); otherwise it builds vertex partners on the object plane with `tolerance` (null → the map's, else 0.001 m; distances in metres through the placement's scale). Vertex mode acts on the pairs the selection touches; seam vertices go exactly onto the plane; point layers follow the mirror rules (vector layers through the mirror). | §5.13 "by the current symmetry map, or a map built with `prefs.modeling.symmetryTolerance`". |
| M6A-B4-20 | **MeshSetOps.** Several inputs of a one-mesh op (Separate, Extract, Duplicate Faces) are processed one by one (`new:<n>` numbered across them). Separate drops loose vertices and wire edges (they belong to no shell) with `separate.loose-dropped`. Extract in place removes the faces and appends their copy (other elements keep their data, indices may move). Duplicate Faces on an asset-backed mesh makes a static copy without `skin.*` and `morph:*` layers; in place it is refused. Combine with `pivot: 'center'` places the result at the centre of the combined world bounds, unrotated, unit scale (Maya); `'first'` leaves the lead's geometry untouched. **Names**: the op cannot see record names (`MeshSetInput` has none), so new records are proposed as "Separated", "Extracted", "Duplicated" (the runner numbers them); the spec's "<name> 2" needs the runner (B7) to pass the source name — a follow-up for INT. Combine's palette refusal carries no action (the `Refusal` type has none): the UI maps `combine.palette-mismatch` to `palette.assign`. | §5.13; contract gaps noted for INT. |
| M6A-B4-21 | **`appendMesh` details**: material slots without a key keep their index; a same-name layer of another shape is skipped (defaults); a longer joint palette re-declares a's `skin.joints` layer with the union (layer metadata is part of the definition; the layer moves to the end of a's layer list); `paintSlots` is the identity (Combine refuses differing palettes). `copySubset` copies only the vertices and edges the faces use. | §4.3 contract; no other way to change layer metadata through `EditMesh`. |
| M6A-B4-23 | **Slide tolerances** (§9 B4: "on its rail (1e-9) and on the pre-slide surface (1e-4 m)"). Slide solves each position in float64 on the rail and rounds once to float32 storage. On an axis-aligned rail (the cylinder loop of E2E-MOD-24) that is exact: the off-rail coordinates are bit-equal and the along-rail one is `fround` of the float64 value, which the kernel test asserts. On a general rail no float32 point lies within 1e-9 of the segment in general, so the property test bounds the distance to the pre-slide rail by float32 rounding, 4e-7 × the mesh's largest coordinate; that is far inside the 1e-4 m surface bound, which every rail point meets because rails are edges of the pre-slide surface. | float32 storage (§4.3) cannot hold 1e-9 off axis; the bound states what the kernel guarantees. |
| M6A-B4-24 | **Extract's "all faces" refusal** counts only inputs that give up faces: an input without faces (or without selected faces) is skipped by the run, so it no longer makes the poll refuse `extract.all-faces` (fix round 1). | Poll and run must agree with what the run does. |
| M6A-B4-22 | **Literal updates.** `test/descriptors.test.ts` (B1's file; B0a's stub expectation): a `LANDED` list excludes landed ops from "run refuses not-implemented" and asserts they never answer it (§3 rule 9). `test/ready.ts` is new (mesh-core had none): probes `b2` (`buildSymmetryMap` stops throwing `not-implemented`) and `b3` (`mesh.mergeByDistance` runs), `b4: true`. B2, B3 and B5 add their own lines when they merge. | §3 rule 4; the B7 pattern of probe-based READY flags turns gated cases on by themselves. |

## Tests

- `test/ops/harness.ts` — runs an op like the runtime (poll, begin, run, end or abort) and checks P1 (no throw; a
  refusal leaves the mesh bit-identical; results validate), canonical links and dead slots, no temporary mark left,
  selection sized to the counts, P7-hard, P8 (incremental = full revision; after the undo the before id), P5 (undo and
  redo on the same mesh and on runtimes rebuilt from the after- and before-states).
- Per op: `test/ops/{normals,triangulate,spin,cut,slide,average,mirror,setops}/*.test.ts`, `test/subset/subset.test.ts`,
  `test/ops/symmetry.test.ts` (helpers; agreement with B2 behind `READY.b2`).
- World mode (`test/ops/world.test.ts`, fix round 2): the mirror of a World map is the world reflection seen in local
  space (an involution whose plane distance is the world coordinate; 300 random placements with rotations, signed
  non-uniform scales and translations); in World X on a bumpy cube rotated 90° about Y (World X = local Z), Average
  (Preserve Seam on and off), Slide (edge and vertex mode) and Multi-Cut (second cut, a path through the seam, a chord
  crossing the plane inside a face) equal the Object Z run and the run without symmetry on symmetric input and stay
  world-symmetric; P10 in World mode on oblique placements (400 runs with similarity placements over every B4 row of
  §5.14, 400 with signed non-uniform scales over every row but Set Normal Angle, whose local-space dihedral angles a
  non-uniform scale changes with or without symmetry); Symmetrize through a World map on an oblique placement; Mirror
  in World position reflecting morph deltas and custom normals through the world plane. Behind `READY.b2`: B2's World
  maps pair what the B4 test maps pair (90° and oblique, non-uniform, mirrored placements), `mirrorEdgePoint` agrees
  on World maps (t* to 1e-12), and Average, Slide and Multi-Cut on B2 World maps give the B4-map results. The
  placement generators spread values evenly (`fc.double` favours 0 and ±1, i.e. axis-aligned rotations, under which
  the old local-axis rule happened to be right).
- Oracles (§5.29): triangulate cube 8/18/12; half cube 8/12/5 → Mirror 12/20/10 (closed, manifold, outward); the
  mirrored-duplicate Combine 16/24/10 with reversed winding (→ 12/20/10 through B3's Merge by Distance behind
  `READY.b3`); spin keeps 8/12/6; the E2E-MOD-05 plane cut 9/12/4; separate shells; extract 8/12/5 + 4/4/1.
- Face attributes (`test/ops/attributes.ts`, in `properties.test.ts`): before each op every face gets its own
  `paint` slot, a material and distinct `uv0` values per corner; ops that keep their faces must keep the multiset of
  (material, paint) and each corner's value at its vertex (Spin/Flip: the one new vertex takes the other face's
  value), Triangulate and Multi-Cut only split (every piece carries its face's values, no face lost), Quadrangulate
  and Mirror only reuse values; random sequences on primitives (symmetric runs included) and soups, plus runs of
  several spins and flips at once. `test/ops/spin/spin.test.ts`: a multi-edge run equals the same spins one at a time
  (every spinnable pair of a cube and a cylinder; every flippable pair of a triangulated cube), symmetric spins on a
  2 × 2 × 2 cube keep every slot.
- MeshSetOps property (`test/ops/setops/setops.test.ts`): Combine, Separate, Extract and Duplicate Faces on random
  primitives and soups with random component selections, offsets, `separate` flags, pivots and placements (rotations,
  scales with negative components): outputs validate, inputs bit-identical after the abort, poll = run, faces
  conserved per op, and Combine of closed inputs has Σ |det Pᵢ|·Vᵢ / |det P_out| volume (400 + 150 runs).
- Properties (`test/ops/properties.test.ts`, model-based via `test/ops/steps.ts`): P1 + P5 + P8 + P7-hard on random
  sequences of 20–60 B4 ops over random primitives (40) and soups (60); P2 χ for every op but Mirror (300); P3 + P4
  on closed primitives for the manifold-preserving ops, volume measured on the shared triangulation (300); P7 chords
  never seams (200); P10 on six symmetric meshes for every B4 row of §5.14 (400), plus Mirror/Symmetrize making any
  mesh symmetric. Multi-Cut fuzz: 400 random face-walk paths on primitives (symmetric and not) + 300 on soups. Slide
  rails: every moved vertex lies on a pre-slide edge from its old position (300), and again under symmetry after one to
  three one-sided Triangulate/Multi-Cut/Spin/Flip/Quadrangulate runs (asymmetric topology on symmetric positions; 400,
  more than 20 of them reporting `symmetry.unmatched-partner`); the reviewer's strip cases in vertex and edge mode.
  Multi-Cut: a path whose mirror image shares no face is cut on its own side (and a clipped one keeps its half).
  Heavier unseeded runs (properties: P10 × 4000, P2/P3/P7 × 2000–3000, sequences × 200/300, five times; Multi-Cut
  fuzz 5000 + 3000, three times) found nothing further after the fixes below.
- P6: `test/ops/determinism.ts` → `test/goldens/ops-shape.json` (oracle counts with manifest ids, four fixed scripts of
  40–60 random B4 ops); `test/ops/ops.browser.test.ts` checks the same file in Chromium and runs P1/P5 sequences and a
  symmetric cut and slide there.

## Bugs the properties found (fixed before the first commit of each op)

- Spin read the faces' vertex runs with a non-cyclic slice (every edge whose corner was not first refused).
- **Found in review (fix round 1):** a run spinning several edges (every symmetric spin or flip) restored material,
  paint and corner values from face indices taken at plan time, stale after the first spin's face removal
  (M6A-B4-11); the single-edge test could not see it. The face-attribute property and the multi-edge spin tests now
  gate it. Extract refused `extract.all-faces` when another input had no faces (M6A-B4-24), found by the MeshSetOps
  property.
- **Found in review (fix round 2):** the symmetry helpers reflected along the local axis in World mode too, so on a
  rotated mesh Average collapsed vertices onto the wrong plane (0.42 m on a symmetric bumpy cube) and Slide, the cut's
  side test and the source side of Triangulate, Flip and Spin used it as well (M6A-B4-3); Slide moved a vertex toward
  its partner's mirrored rail end even when no edge joined them (asymmetric topology), leaving the surface
  (M6A-B4-15); Multi-Cut refused a valid path when only its mirror image could not be cut (M6A-B4-16). The new World
  P10 property, the asymmetric-topology Slide property and the World Average/Slide/Cut cases each fail on the old
  code (checked by reverting each fix locally).
- Quadrangulate projected Y-normal faces onto a left-handed plane (convex quads looked concave).
- Conform flipped single selected faces by rounding noise, and inside-out patches on concave parts of a torus
  (M6A-B4-7).
- Mirror duplicated near-plane rings at `mergeThreshold` 0 (M6A-B4-17).
- Slide picked sides chain by chain, so a mirrored pair of chains could slide opposite ways (M6A-B4-15).
- Triangulate wrote asymmetric diagonals into self-mirrored n-gons under symmetry (M6A-B4-9).

## Gates (local, real Chrome; port 3165; CI unset)

Fix round 2, on the code of `b6e3dd1`: `format:check` (1146 files), `lint`, `typecheck`, `check:deps` (15 packages)
green; `test` (`turbo run test test:tooling --concurrency=2 --force`) 15/15 tasks green, **mesh-core 468 passed + 8
skipped** (Node + Chromium in real Chrome; the skips are the `READY.b2`/`READY.b3` cases, now eight with the three
World-map cases), editor 359 + 1 skipped, editor-core 793. The first forced run had one `@ekza-animator/editor` file
fail (9 tests) under the concurrent load; it passed alone and the full forced rerun passed — the editor does not use
the B4 symmetry code. No UI file changed; the e2e run's production build passes `check:size`: 865,794 B ≤ 900,000 B,
the mesh kernel a lazy 51.0 kB chunk. Full e2e suite (`EKZA_E2E_PORT=3165`, project `chrome`): 109 passed,
10 skipped, rc 0; port 3165 free afterwards. Integration check with B2 and B3 merged: see the next section.

Fix round 1, on the code of `b661302`: `format:check`, `lint`, `typecheck`, `check:deps` (15 packages) green; `test`
15/15 turbo tasks green (`--concurrency=2`; 9 executed — mesh-core and everything downstream of it — and 6 replayed
from the cache for packages whose inputs did not change), **mesh-core 452 passed + 5 skipped (Node + 9 Chromium in
real Chrome; the skips are the `READY.b2`/`READY.b3` cases, now five with the symmetric-slide case)**, editor-core 793,
editor 359 + 1 skipped. No UI file changed, so no separate `build`; the e2e run's production build passes
`check:size`: 865,793 B ≤ 900,000 B. Full e2e suite (`EKZA_E2E_PORT=3165`, project `chrome`, the config's default 7
workers): 109 passed, 10 skipped (the stretch `test.fixme` entries and B0a's `b9` fixme), rc 0; port 3165 free
afterwards — B4 owns no E2E-MOD scenario. Integration check with B2 and B3 merged: see the next section.

Before fix round 1 (code of `8b48625`): mesh-core 443 passed + 4 skipped, the same e2e result, `check:size`
865,791 B; the mesh kernel stays a lazy chunk (49.9 kB with the B4 ops; B1 measured 28.6 kB).

## Open for the integration agent

- `test/descriptors.test.ts` (B1's file) and the new shared `test/ready.ts` — literal updates and probes
  (M6A-B4-22). **Merge conflicts, verified resolution** (fix round 1, throwaway worktree: this branch + `m6a/mesh-select`
  + `m6a/mesh-ops-core`): merging B2 gives an add/add conflict on `test/ready.ts` (B2 has static flags `b2: true,
  b13: false`) and a content conflict in `descriptors.test.ts` (B2 adds an inner `const LANDED =
  new Set(['mesh.transformComponents'])` that shadows B4's module-level set); merging B3 then conflicts on the
  module-level `LANDED` again (B3's own list) and on the stub check's body. Resolution: **one** module-level `LANDED`
  holding the union of the B4, B2 (`mesh.transformComponents`) and B3 ids, B2's inner declaration removed, B4's body
  of the stub check (it also covers `MESH_SET_OPS`); `READY` keeps B4's probes and adds B2's flag:
  `export const READY = { b2, b3, b4: true, b13: false } as const;`. Result: mesh-core node tests 656 passed,
  3 skipped (B3's own `READY.b2` cases, B2's `READY.b13` golden), root `tsc -b` clean; all five B4-gated cases pass
  (B2 agreement ×2, the symmetric cut and the symmetric slides on B2 maps, Combine + Merge by Distance 16/24/10 →
  12/20/10), each also when run alone. **Fix round 2**, the same resolution on `b6e3dd1` in a throwaway
  `git clone --shared`: mesh-core node tests 686 passed, 3 skipped, `tsc -b` clean; all eight B4-gated cases pass,
  the three new ones being B2's World maps (partners on 90° and oblique placements, `mirrorEdgePoint` on World maps,
  Average/Slide/Multi-Cut on B2 World maps = the B4-map results).
- Switch B4's symmetry helpers to B2's functions once `READY.b2` holds and `test/ops/symmetry.test.ts` agrees
  (M6A-B4-2). The plane convention is settled (M6A-B4-3): B4 builds the same mirror as B2's `mirrorSpace` from
  `map.space` and `ctx.placement`, so B2's `mirrorSpaceOf(map)` could replace `contextMirror` — with one caveat: for a
  hand-built map (tests) `mirrorSpaceOf` falls back to an identity placement, while B4 uses the context's placement.
- MeshSetOp names and the palette action (M6A-B4-20): the runner could pass the source record's name and attach
  `palette.assign` to `combine.palette-mismatch`.
- The −0 writes of B1's mirror helpers (M6A-B4-18).
- E2E-MOD-24 needs an irregular plane for "Average moves interior vertices" (M6A-B4-14).
