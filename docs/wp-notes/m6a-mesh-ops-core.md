# M6a B3 — Core topology ops and extrude: build notes

Branch `m6a/mesh-ops-core` (from `m6a/spec`, with `m6a/mesh-kernel` merged). Scope:
[M6A-SPEC §9 B3](../M6A-SPEC.md#b3--core-topology-ops-and-extrude). Decision IDs below are `M6A-B3-<n>`.

## What landed (by spec responsibility)

| B3 item | Where (`packages/mesh-core/…`) |
|---|---|
| `mesh.extrude` on faces (regions or individual faces, bow-tie fans, divisions, offset, even thickness, the cap transform in the region frame, world space) and on border edges (chains, chain frames); cap keeps its face indices; `adjust` fast path | `src/ops/extrude/{index,faces,edges,topology,geometry,place}.ts` |
| `regionFrame` (§4.3, §5.8 step 4; replaces B0a's stub line in the barrel) | `src/ops/extrude/frame.ts` |
| `mesh.inset` (regions or individual, even offset, clamp, depth; inner faces keep their indices; `adjust`) | `src/ops/inset/index.ts` |
| `mesh.insertLoop` (relative, equal, multiple; ring termination; symmetric loops decided by the mapped seed point; `adjust` for the weight) | `src/ops/loop/{index,ring}.ts` |
| `mesh.offsetLoop` (closed and open loops, `deleteEnds`) | `src/ops/offsetLoop/index.ts` |
| `mesh.connect` (vertices and edges) | `src/ops/connect/index.ts` |
| `mesh.merge`, `mesh.mergeToCenter`, `mesh.mergeByDistance` and the weld engine shared with Target Weld and Collapse | `src/ops/merge/{index,clusters,weld}.ts` |
| `mesh.targetWeld` (the §5.14 seam table) | `src/ops/targetWeld/index.ts` |
| `mesh.collapse` | `src/ops/collapse/index.ts` |
| `mesh.delete` (Maya plain Delete) and `mesh.deleteEdgeVertex` | `src/ops/delete/index.ts` |
| `mesh.fillHole` | `src/ops/fill/index.ts` |
| `mesh.bridge` (loops, chains, two faces; divisions, twist, offset, taper; the mirrored pair) | `src/ops/bridge/index.ts` |
| B3's shared op toolkit: traversal and argument helpers, affine maths, corner rewiring through Euler operators, edge points and chords, the op-side symmetry helpers (M6A-B3-3) | `src/ops/extrude/shared/{util,affine,rewire,split,symmetry}.ts` |
| Tests, goldens, bench | `test/ops-core/**`, `test/goldens/ops-core.json`, `bench/ops-core.bench.ts` |

Every B3 op is the descriptor B0a landed (id, label, kinds, params, flags, symmetry class unchanged) with real `poll`
and `run`; the barrels changed only B3's stub line (`regionFrame`).

## For the UI and op packages (B4, B11, B12b, INT): what the ops guarantee

**Every run** returns a result that passes `validateMesh`, or a `Refusal`; never a throw for valid input. An Euler
refusal or an internal consistency error inside an op becomes the refusal `<op>.topology` (M6A-B3-11): the runner
aborts the transaction as for any refusal. The property tests assert it never happens on manifold input.

**`OpResult`**:
- `selection` — §6.1's `selection′`: cap faces (extrude faces), new outer edges (extrude edges), inner faces (inset),
  new loop edges (insert/offset loop, connect), the merged vertices (merge family, collapse, target weld), new faces
  (fill, bridge), empty (delete family).
- `frame` — extrude: the first group's region frame (axes = the args frame `F`, unrotated by `localRotate*`) with its
  pivot on the placed cap; inset: the region frame with the pivot at the inner faces. Mesh-local.
- `adjust(patch)` (M6A-B3-14) — extrude: `localTranslate*`, `localRotate*`, `localScale*`, `offset`, `thickness`,
  `space`, `smoothingAngle` (positions and wall hardness only); inset: `offset`, `depth`, `evenOffset`, `clamp`,
  `smoothingAngle`; insert loop: `weight` for one relative/equal loop without symmetry. Anything else returns
  `false` (the caller reverts and re-runs). An adjusted mesh is bit-identical to a fresh run with the merged args
  (tests compare the stored arrays). **After a successful `adjust` the same result object reports the adjusted
  state**: `warnings` (e.g. `extrude.offset-clamped` appears when a live preview pushes the offset past the clamp and
  goes when it comes back), `frame` (the pivot on the re-placed cap) and `resolvedArgs` (the merged args) are getters
  over the latest state and equal what a fresh run with the merged args reports (M6A-B3-25). B7's
  `MeshOpSession.results` and commit (`warnings`, `resolvedArgs`), B11's card and B12b's manipulator can read them
  after each `update` without a re-run. A declined `adjust` (`false`) leaves them unchanged.
- `resolvedArgs` — defaults and coercion applied; `smoothingAngle` resolved (§5.3); insert loop's `seedEdge` and
  bridge's `loops` filled from the selection (pick order).

**Refusal codes** (each with a sentence for the help line): `extrude.no-selection`, `extrude.vertex` ("Vertex
extrude is not available yet"), `extrude.interior-edge`, `extrude.non-manifold` (M6A-B3-18); `inset.no-selection`,
`inset.non-manifold`; `insertLoop.no-ring` (no seed, or a seed without faces); `offsetLoop.no-selection`, `offsetLoop.no-ring`; `connect.no-selection`,
`connect.no-face`; `merge.no-selection`, `merge.nothing`, `mergeToCenter.no-selection`, `mergeToCenter.nothing`,
`mergeByDistance.nothing`; `targetWeld.no-pairs`; `collapse.no-selection`; `delete.no-selection`, `delete.not-winged`,
`delete.border-edge`, `delete.non-manifold`, `delete.hole`, `delete.closed`, `delete.degenerate` (M6A-B3-21);
`inset.no-boundary` (M6A-B3-6); `fillHole.no-border`; `bridge.needs-two` (also two sides that share a vertex),
`bridge.unequal-counts` ("… (8 vs 6)"); `symmetry.seam` (Target Weld, Preserve Seam).

**Warning codes**: `symmetry.unmatched-partner` (count; "No mirror partner: applied to one side"),
`extrude.offset-clamped` and `inset.clamped` (count, message with the largest clamped distance), `connect.skipped`
(count of faces with three or more selected edges), `offsetLoop.corner` (count of faces where the loop turns),
`merge.non-manifold` (any merge that leaves an edge with more than two faces), `bridge.non-manifold` (count of edges a
strip over existing edges left with more than two faces, M6A-B3-20), `mergeByDistance.merged` (count of removed
vertices).

**Symmetry**: every op reads `ctx.symmetry` (B2's map) through `Mirror` (`src/ops/extrude/shared/symmetry.ts`) and
honours the §5.14 rows: expanded selections; extrude/inset partner regions with the reflected frame `S·F` (identical
numbers give an exact mirror); self-mirrored regions and merge groups processed once and symmetrized / snapped onto
the plane; Connect's mirrored edge groups measure the weight from mirrored sides (M6A-B3-27); Insert Edge Loop decided
by the mapped seed point (M6A-B3-16); the Target Weld seam table; Bridge's mirrored pair; unmatched partners on one
side with the warning. Scalar args apply to both halves: on the source side every expand-class op but the merge pair
gives what a plain run of the expanded selection gives (asserted by P10, M6A-B3-27).

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B3-1 | **Winding of the new quads follows P4, not the literal corner lists.** Face extrude: for a boundary edge its region face runs a → b, the side quads run (A_k, B_k, B_k+1, A_k+1) from the base to the cap (§5.8 step 3 writes (b, a, a′, b′), the reverse cycle). Edge extrude: for a border edge its face runs a → b, the quads run (B_k, A_k, A_k+1, B_k+1) (§5.8 step 7 writes (a, b, b′, a′)). | The literal cycles run the shared edge in the same direction as the face across it (inconsistent winding, §5.29 P4); only the cycle order differs, the vertex sets are the spec's. |
| M6A-B3-2 | **The cap (extrude) and the inner faces (inset) keep their face indices by corner rewiring through Euler operators** (`swapCorner`: split the face along the chord p–n, make (n, p, w), kill the cut-off triangle, join back; triangles and faces with an existing p–n edge go through a temporary vertex). No new kernel operator, no kill-and-remake. | §5.8 step 2 "the cap keeps the original face indices"; §3 rule 8 "topology only through Euler operators"; the kernel's removal rule moves the last pre-op face into a removed pre-op slot (M6A-B1-2), so a face that must keep its index can never be killed. |
| M6A-B3-3 | **B3's shared toolkit lives in `src/ops/extrude/shared/`** (inside B3's `extrude` dir) and is imported only by B3's op dirs. | §9 B3 Dirs name op directories only; one copy of the traversal, argument, affine, split and symmetry helpers instead of eleven. |
| M6A-B3-4 | **Op-side symmetry helpers** (`Mirror`: reflect, project, symmetrize, crossing parameter, partner lookup; `expandIndices`; `mirrorPoint`) read only the `SymmetryMap` arrays, so B3 does not call B2's functions at run time. Tests use `referenceSymmetryMap` (the §5.14 definition, brute force). A `READY.b2` test checks that the reference maps equal `buildSymmetryMap` on the test meshes (symmetric, extruded and broken) and that `expandIndices`/`mirrorPoint` equal `expandSelection`/`mirrorEdgePoint`; it passed locally with `m6a/mesh-select` merged into the worktree (trial merge, not committed: 18/18, and B2's own suites green next to B3's). | B2 had not merged when B3 started; the contract is the map, not the helper. |
| M6A-B3-5 | **The weld engine** (merge family, Target Weld, Collapse) maps every vertex to a representative, re-makes the faces through merged vertices over the mapped cycle (repeats and spikes dropped, < 3 corners killed, each corner keeping its own values), merges coincident duplicate faces (the larger index dies), removes unused edges and vertices, ORs the flags of edges that map onto one (H3) and reports edges with more than two faces (`merge.non-manifold`). Final vertex indices come from `removalMap` (the kernel's removal rule replayed), valid because the merge creates no vertex and runs as the first writer of its transaction. | §5.12 "after any merge" list; §5.2 merging row; §5.3 H3. |
| M6A-B3-6 | **Nothing to do is a refusal, not an empty step**: `merge.nothing`, `mergeToCenter.nothing`, `mergeByDistance.nothing`, `connect.no-face` ("No face joins the selected vertices" — §5.11 says "do nothing" with that sentence), `fillHole.no-border`, `offsetLoop.no-ring`, `insertLoop.no-ring`, `targetWeld.no-pairs` (no pairs, or pairs that weld nothing), `inset.no-boundary` (every region closes a whole shell, e.g. all six cube faces together: "Inset needs a border around the selected faces; they close a whole shell" — at any `depth`: moving a closed shell along its normals is not an inset; a closed region next to an open one gets no rim, and only a non-zero `depth` moves it with the inner faces). | No history step that changes nothing; the sentence still reaches the help line. |
| M6A-B3-7 | **Collapse**: connected selected components (edges or faces sharing a vertex) collapse to one point at the centroid of their vertices; separate components separately. | §5.12 "each selected edge → its midpoint; each selected face → its centroid" leaves shared vertices undefined; Maya collapses connected selections to one point. |
| M6A-B3-8 | **Bridge pairing**: the strip's direction is fixed by the winding (each new quad runs both border edges against their existing faces); closed loops search the start offset only (minimum summed squared distance; ties to the smaller offset), then shift by `twist + offset` whole steps; open chains pair a₀ ↔ b_last. | §5.12 searches "all cyclic shifts and both directions, then the direction that makes each new face traverse the border edge opposite to its existing face": the second rule decides the direction alone, so only the shift is searched. |
| M6A-B3-9 | **Bridge taper profile**: ring k at s = k / (divisions + 1) is scaled about the interpolated centroid by 1 + (taper − 1)·4s(1 − s) — `taper` at the middle, 1 at both loops; no effect with divisions 0. | §5.12 "taper scales the intermediate rings about the interpolated centroid" without a profile; Maya's taper narrows the middle of the bridge. |
| M6A-B3-10 | **Offset Edge Loop**: in every face beside a selected edge the chord joins the points at `offset` × the crossing edge's length on its two crossing edges; an open loop ending at an interior vertex is closed round that vertex through the far faces (a point on each spoke), and `deleteEnds` removes the end edges between the vertex and the spoke points where two faces join cleanly (end triangles → quads). A face where the loop turns (a crossing edge is selected too) gets no chord and the warning `offsetLoop.corner` counts such faces once each. | §5.11 names Maya's `polyDuplicateEdge -deleteEdge` without corner rules. |
| M6A-B3-11 | **Safety refusal `<op>.topology`**: an Euler refusal (`mesh-euler`) or an op-internal error (`mesh-op`) inside a run becomes a refusal ("<Label> cannot handle the mesh around the selection (…)"); any other throw propagates. | §3 rule 8 "never a throw for valid input, never invalid topology"; on synthetic non-manifold soups some local constructions are impossible; the properties assert the code never appears on manifold input. |
| M6A-B3-12 | **`test/descriptors.test.ts` literal update**: a `LANDED` set lists B3's ops, which now poll and run on an empty mesh without refusing `not-implemented`; every other op is still asserted to be B0a's stub. B2 made the same kind of edit for `mesh.transformComponents` (a merge conflict for INT: the union of both sets). | §3 rule 9 (literal updates in the commit that changes the contract); the test is B0a's. |
| M6A-B3-13 | **READY flags**: B3's gate file is `test/ops-core/ready.ts` (`b2: false`), because B2's new `test/ready.ts` is not on this branch (an add/add conflict avoided). INT: switch `test/ops-core/symmetry.test.ts` to `../ready` (`b2: true`) and add `b3: true` there; B4's Combine + Merge by Distance oracle and the e2e gates naming `b3` (E2E-MOD-02, -03 (b), -09, -12, -13, -19, -23, -25, -32) flip when B3 merges. B3 owns no E2E-MOD scenario (§10.1). | §3 rule 4; §9 B3 DoD "READY flag `b3`" (as M6A-B1-14). |
| M6A-B3-14 | **`adjust` scope** (above): value args only; `divisions`, `keepFacesTogether`, `individual`, `mode`, a symmetric or `multiple` loop decline. | §9 B3: "fast paths for extrude offsets (positions only, no topology change) and loop weight"; topology changes go through the re-run. |
| M6A-B3-15 | **Insert Edge Loop placement and ends**: `equal` = the distance `weight × length(seed)` from the carried side, as a fraction of each ring edge clamped to [0, 1]; lengths and edge directions are read on the pre-op ring (also by `adjust`). Seed = `seedEdge` when given, else the lowest-index visible selected edge. A hidden face ends the ring like a border (the shared edge is still split). **A seed between non-quads** (two triangles: every mesh made editable from glTF is all triangles, e.g. Polybot's body in E2E-MOD-12 and Seed-san's face in E2E-MOD-30) is a ring of one edge: it is split, its faces gain the vertex (triangle → quad) and the selection holds the split pieces; only an edge without faces (or no seed) refuses `insertLoop.no-ring`. A real loop on such a mesh needs Quadrangulate (B4) first. | §5.11: "Termination: … a non-quad face — the shared edge is split and the new vertex joins that face"; refusing would make E2E-MOD-12's, -30's and -31's `mesh.insertLoop` runs fail. Fixes: `adjust` measured the already split edges (de76222); a seed between triangles refused (3fd3544). |
| M6A-B3-16 | **Symmetric Insert Edge Loop**: the partner ring is walked from the mapped seed edge and side vertex with the same fractions; a loop whose mirrored loop coincides with it (every point within the map tolerance on the same edge) is inserted once and its points on crossing edges snapped to t*; otherwise both are inserted. A seed without a partner inserts one loop with `symmetry.unmatched-partner`. | §5.14 Insert Edge Loop row; goldens: arm (two loops), waist (one), X-ring 0.3 (16/28/14, x = ±0.2) and 0.5 (12/20/10, x = 0), `multiple` on an X-ring (inserted once). |
| M6A-B3-17 | **Offset/inset clamp limit**: 0.5 × the shortest region edge through the vertex. | §5.8 (a) "0.5 × the shortest adjacent inner edge", §5.9 "its shortest inner edge". |
| M6A-B3-18 | **`extrude.non-manifold`** (not in §6.1's list): a region with an interior edge of three or more faces, or a face that visits a vertex twice. A vertex the region touches in two fans (a bow-tie) is extruded with one duplicate per fan (§5.8 step 2); Inset refuses that case (`inset.non-manifold`, §5.9 "requires a manifold region boundary"). Faces that share only a vertex are separate regions. | No cap topology exists for those regions. |
| M6A-B3-19 | **Edge extrude frames**: per chain of border edges joined head to tail in their faces' winding, only through a vertex with exactly one selected edge in and one out (a bow-tie vertex — two chains meeting head to head, or two selected edges leaving it — gets separate new vertices per chain; joining there made two quads run their shared new edge the same way, found by the soup property in fix round 1); a closed chain's direction sum is ≈ 0, so X falls back to the region-frame rule on the averaged normal and Y = Z × X is flipped to point away from the faces where that is defined. `offset` and `thickness` are face-region args and do not apply to edges. | §5.8 step 7. |
| M6A-B3-20 | **Bridge inputs**: `bridge.one-mesh` is the editor's refusal (a `MeshOp` sees one mesh). Two faces must share no vertex and have only two-face edges (`bridge.needs-two` with the reason); under symmetry the mirrored faces are deleted and bridged too. Bridging two opposite faces of a plain cube makes strip faces that coincide with its sides (the strip edges are the existing vertical edges): valid, non-manifold, not refused (Maya does the same), and **reported** with the warning `bridge.non-manifold` (count of edges with more than two faces; 8/12/8 with 4 such edges) as §5.1 requires for non-manifold results. Two sides that share a vertex (border loops touching at a bow-tie vertex, or one loop given twice) refuse `bridge.needs-two` ("Bridge needs two border loops that do not touch"): the pairing would pair the vertex with itself. | §5.12, §5.1, §6.1 `bridge.one-mesh`. |
| M6A-B3-21 | **Delete family**: `selection′` is empty in every mode; plain Delete with a border edge removes its face and every face group joined to it in the same run; `delete.degenerate` when dissolving a winged vertex would leave a face with fewer than three corners; `delete.non-manifold` for an edge with more than two faces. **A merged face is made only over a topological disc** (fix round 1): the faces merged into one polygon (edge mode: joined across the deleted edges; Delete Edge/Vertex vertex mode: the faces of the deleted vertices joined across their edges) must have one simple border cycle and Euler characteristic 1 over their own vertices, edges and faces; then the dissolve keeps the mesh's χ (§5.29 P2). A union with a hole or around a handle (a punctured torus: χ −1) refuses `delete.hole`; a union with no border at all — it is a whole closed shell — refuses `delete.closed` ("… would merge a whole closed shell into one face; delete faces instead"), **except** in vertex mode when every vertex of it is deleted: then that shell simply goes (every face beside a deleted vertex joins the group, so such a group is a whole connected shell). Before, a closed group that kept vertices was dropped silently (cone apex + a base vertex → 0/0/0) and a punctured-torus group was capped by one n-gon (χ 0 → 2). | §5.12 delete family ("its incident faces merge into one n-gon"); §5.29 P2; §6.1 "empty selection". |
| M6A-B3-22 | **Merge to Center and Merge under symmetry**: if a pick's partner is among the picks, picks and partners merge into one point on the plane; otherwise the picks and their partners merge separately. `alwaysMergeTwo` also joins the mirror pair of the two picks; a pick pair across the seam is one self-mirrored group. Mirror groups use the mirrored pick order for their representative. | §5.14 merge rows ("a merge group that is its own mirror is processed once … its merge centre is snapped onto the plane"). |
| M6A-B3-23 | **Target Weld**: chains s → g → h resolve to the final target; a cycle of pairs (`[[a, b], [b, a]]`, which only a scripted `run` can pass) welds at the target of its first pair, as dragging them one after the other would, and pairs that weld nothing refuse `targetWeld.no-pairs` (fix round 2; before, a cycle returned an empty step); `center` welds at the midpoint of the dragged pair; edge-mode pairs weld endpoint to endpoint by proximity. Weld groups that share a vertex weld into one point, at the first centre pair's midpoint if the merged group holds one (an edge welded onto a crossing edge under symmetry: s → g plus the mirror pair (g, p(g)) dragged to its centre → one vertex on the plane; before, the vertex sat in two groups and the result was one-sided, found by the new P10 property). | §5.12, §5.14 Target Weld row. |
| M6A-B3-24 | **Goldens** (`test/goldens/ops-core.json`): every §5.29 row of B3's ops plus one case per op and arg family and four seeded op sequences, each as V/E/F and the result's manifest id; the spec's own numbers live in `test/ops-core/goldens.ts` (`SPEC_COUNTS`), so `UPDATE_GOLDENS=1` can never move an oracle. Node keeps the file, Chromium compares against it (P6). Fix round 1 changed only `script/33` and `script/44`: the step generator's Bridge steps now pick bridgeable sides (whole border loops, interior faces apart), so those two seeded scripts run different bridges; with the old `steps.ts` every golden, scripts included, still matches the fixed ops. | §3 rule 5, §5.29 ("JSON goldens", P6 "in Node and in Chromium"). |
| M6A-B3-25 | **`OpResult` after `adjust`**: `warnings`, `frame` and `resolvedArgs` of an adjustable result are getters over the latest adjusted state (`adjustableResult` in `shared/util.ts`), equal to a fresh run's with the merged args; the selection never changes (adjust moves positions only). | §4.3 `OpResult.adjust` "fast path … during a live preview": the preview must see the clamp warning and the frame of what it shows; B7's `MeshOpSession.update` keeps the same result object. |
| M6A-B3-26 | **Fill Hole and bow-tie vertices**: border loops that touch at a vertex (two holes meeting at a corner, a hole touching the outer border) are separate holes. The border walk is split into simple loops at every vertex it visits twice, each loop gets its own n-gon, and a loop is filled only when the selection touches one of **its own** vertices (the flood through the shared vertex no longer reaches the other loop). Selecting the shared vertex touches both. Where three or more loops meet at one vertex, or two loops touch at two vertices, the split follows the walk's turns there: every new face is still a simple loop, but which border edges share a face is not chosen geometrically (no angular order at a non-manifold vertex). | §5.12 "every border loop touched by the selection gets one n-gon"; fix round 2: a walk that turned into the other loop made one face through the shared vertex twice (3 × 3 plane without cells (1, 1) and (2, 2): one 16-gon instead of a 12-gon and a quad), and a centre-hole vertex also capped the outer border. |
| M6A-B3-27 | **Connect under symmetry**: poll and run count the **expanded** selection (one picked edge or vertex whose partner shares a face connects). Edge groups (edges joined through faces with two selected edges) pair up by `pairGroups` like extrude regions: the **source** group (centroid on the positive side, §5.14 source side) carries its sides from its first edge as a plain run does and keeps the plain run's points; its **partner** group starts from the mirrored side (`partner(vertex, side)`; the side carry commutes with the reflection, since a mirrored face runs its edges reversed) and gets the reflected points; a group that is its own mirror is symmetrized as before, so its points on crossing edges land on the plane. Picking either half gives the same mesh. | §5.14 "scalar args apply to both halves"; fix round 2: each group started from its own first edge, so the mirrored side's weight was often 1 − w and the averaging put every loop at 0.5 (cube 2 × 1 × 1, the +X face's vertical edges at weight 0.2: y = 0 instead of ±0.3). P10 now compares the source side with a plain run of the expanded selection for every expand-class op but Merge / Merge to Center (their groups differ by design, M6A-B3-22) and world-space extrudes (a world move of a region that is its own mirror is averaged), and a Connect property picks edge pairs in faces. |

## Bugs found and fixed on the way

- Property tests (427b383): delete groups treated border edges as internal; edge-extrude chains ignored the border
  winding (bow-tie vertices now get separate new vertices); gap edges of Delete Edge/Vertex missed H3; merges that fold
  faces now report `merge.non-manifold`; an Euler refusal inside an op threw instead of refusing (M6A-B3-11).
- Symmetry goldens (3599c50): Insert Edge Loop snapped loops that were not their own mirror; Bridge's offset search
  stayed at offset 0; Merge's always-merge-two pair ignored its mirror pair; Delete Edge/Vertex decided dissolves on a
  changing state, so mirrored vertices could differ.
- Behaviour tests (this round): Insert Edge Loop `adjust` in `equal` mode measured the split edges (de76222);
  `offsetLoop.corner` counted a turning face once per selected side (0fc9bb3); Insert Edge Loop refused a seed
  between triangles, the only kind of edge a mesh made editable from glTF has (3fd3544, M6A-B3-15).
- Fix round 1 (review findings): Delete Edge/Vertex deleted a whole closed shell when the merged group kept vertices
  (cone apex + a base vertex 9/16/9 → 0/0/0; 3 × 2 sphere vertices 0, 1, 4 → 0/0/0), and both deletes capped a group
  that is not a disc with one n-gon (torus 4 × 3, vertices 0, 3, 6, 8: χ 0 → 2) — now `delete.closed` /
  `delete.hole` (M6A-B3-21); P2 was not asserted for the delete family, so the property tests missed both (now
  asserted, plus a delete fuzz on low-poly closed primitives). Inset of a region without a border returned an empty
  step (now `inset.no-boundary`); Bridge of two opposite cube faces was non-manifold without a warning (now
  `bridge.non-manifold`), and two loops touching at a vertex made a strip face through it twice (now refused);
  `adjust` left `warnings`/`frame`/`resolvedArgs` at the first run's values (M6A-B3-25). The stronger properties then
  found two more: edge extrude joined chains through a bow-tie vertex with two selected edges leaving it (inconsistent
  winding, M6A-B3-19), and Target Weld put one vertex in two weld groups when a chain met a centre pair (one-sided
  result under symmetry, M6A-B3-23).
- Fix round 2 (review findings): Connect under symmetry lost its weight on mirrored edge groups (every loop at 0.5,
  M6A-B3-27) and its poll counted the raw selection, so one edge whose partner shares a face refused; Fill Hole made
  one face through a bow-tie vertex twice and capped loops touching the selected one only at that vertex
  (M6A-B3-26); Target Weld returned an empty step for a cycle of pairs (M6A-B3-23). P10 only checked that results are
  symmetric, which a loop at 0.5 is; it now also checks the source side against a plain run. The round's full gate
  then failed once in the Chromium sequence run (seed −529114691): a zero extrude of a strongly non-planar quad after
  ~20 steps "lost" volume. No point moved; the cap kept its index but its first corner moved, and the kernel's
  `signedVolume` fans each face from its first corner, so the measured diagonal of that quad flipped. P4's outward
  check now fans every face around its vertex centroid (`centroidVolume` in `checks.ts`: independent of the start
  corner, equal for planar faces); the display triangulation (§5.4: a quad's shorter diagonal) never depended on it.

## Tests

| File (`test/ops-core/`) | Covers |
|---|---|
| `oracles.test.ts` | §5.29 rows of B3's ops with positions (typed 0.5: cap along the normal, area 1 within 1e-6, face index kept; X-ring loops at x = ±0.2 / x = 0; apex at (0, 0.5, 0); target unmoved) |
| `goldens.test.ts`, `goldens.ts`, `../goldens/ops-core.json` | §5.29 counts from the spec, P6 manifests (M6A-B3-24) |
| `extrude.test.ts` | arg order (scale → rotate Rz·Ry·Rx → translate), world space through a placement, together vs individual, offset/thickness, clamp warning, zero extrude stays, border edges (frame, shared vertices, divisions, a bow-tie vertex with two selected edges leaving it), interior-edge refusal, H2 on faceted and smooth meshes, paint and UV of side faces, `adjust` bit-identical and its reported warnings/frame/args equal to a fresh run (extrude faces and edges, inset; the clamp warning comes and goes), `regionFrame`, inset behaviour |
| `ops.test.ts` | insert loop modes, termination at triangles and hidden faces, a seed between triangles, seed rules, H1, layer interpolation, `adjust` (incl. the reported weight); offset loop (closed, open with/without `deleteEnds`); connect; merge (distance, pick order, `alwaysMergeTwo`, coincident, hidden, lamina), merge to center, H3, collapse, target weld (center, edges); delete (faces, border edge, winged vertex, border corner, hole; cone apex → 8/8/2 and apex + each base vertex → `delete.closed`, the 3 × 2 sphere case, a whole selected shell goes while seven of a cube's vertices refuse, handles on 4 × 3 and 3 × 3 tori → `delete.hole` for both ops, all 12 cube edges → `delete.closed`); fill (both loops from one face, paint slot, bow-tie loops: a hole touching the outer border, two inner holes meeting at a corner, only the touched loop, M6A-B3-26); target weld cycles (two-cycle, a chain into a three-cycle, center mode); bridge (refusals, open chains, two faces, two opposite cube faces → `bridge.non-manifold`, touching loops refused, twist/offset/taper, pick order, H2); inset of a whole closed shell (`inset.no-boundary`; individually 32/60/30; a closed region next to an open one); every remaining refusal and warning code |
| `symmetry.test.ts` | P10 property over every expand/pointer op (plus the source-side check against a plain run of the expanded selection, M6A-B3-27), Connect under symmetry (weights 0.2/0.8 on a cube with a centre loop: the plain run's points on +X, their mirror on −X, either half picked; one picked edge or cap vertex whose partner shares a face; a property over edge pairs in faces on five meshes, crossing edges included), and a second one for the pointer and border rows (edge extrude on border edges, Target Weld vertex and edge pairs, Bridge of whole border loops and of interior faces apart; Preserve Seam on; each kind must run > 5 times); an edge welded onto a crossing edge (one vertex on the plane); extrude with reflected frames, self-mirrored and unmatched regions; Insert Edge Loop goldens (arm, waist, X-ring, multiple, equal, unmatched seed); the Target Weld seam table and an unpaired weld; Bridge's mirrored pair and a self-mirrored pair; the `READY.b2` cross-checks (M6A-B3-4) |
| `properties.test.ts` | P1–P7 per step through `runChecked` (validity, canonical links, dead slots, incremental revision, exact undo/redo on the same and rebuilt meshes, abort exactness), P2 χ (extrude, inset, insert/offset loop, connect; fill +1 per hole; a bridge of two closed loops: χ kept, two boundary loops fewer unless it reports `bridge.non-manifold`; **the delete family** on manifold input without loose elements: dissolves keep χ, a face deletion takes F − E + V of what only the deleted faces used, plain Delete of a border edge deletes its face group, a fully selected shell takes its own χ — `expectedDeleteEuler` in `checks.ts`), P3 closed manifolds (extrude, inset, insert loop, offset loop, connect, and every delete but a face deletion), P4 winding and outward volume (centroid-fanned faces), P6 same step on a copy, P7-hard; single steps (600), sequences of 50–500 steps (8 runs; `size: 'max'` so lengths spread over the range, growth steps skipped above 400 faces instead of stopping the sequence — ≈ 1800 attempted steps per run of the test), a delete-family fuzz (1500 runs: Delete / Delete Edge/Vertex on vertex, edge and face sets of 1–8 on low-poly closed cones, spheres, tori, cubes and cylinders; must also refuse > 50 times), Bridge steps that mostly pick bridgeable sides (`steps.ts`), layered primitives (morph, bits, skin, paint, uv0 stay in their envelope), Bridge of two holes (random sides, offsets, divisions, twist, offset, taper: closed manifold, outward), synthetic soups (P1). `B3_PROPERTY_SCALE=10` multiplies the run counts locally |
| `ops-core.browser.test.ts` | Chromium (Vitest browser mode, local Chrome): P6 against the Node goldens and the spec counts; P1–P5/P7-hard steps and sequences |

Shared, Node-free helpers: `support.ts` (contexts, the checked runner, reference symmetry maps), `fixtures.ts`,
`steps.ts` (op-step arbitraries), `checks.ts` (per-step properties, layer envelopes).

## Benchmarks (report only; Node 25.6, Apple M4 Pro, machine shared with other agents at load ≈ 30; `pnpm --filter @ekza-animator/mesh-core bench`)

Debug validation off; each row runs the op in its transaction on one mesh and undoes it (the undo + redo rows give
that share, ≈ 0.005 ms). §5.27 budget for a typical topology op: ≤ 16 ms **including GPU upload** (INT measures end
to end); these are the kernel's Node share.

| Bench | Mean |
|---|---|
| extrude 100 faces as one region (10 × 10 plane) + full triangulate + normals | 1.9 ms (op alone 1.6 ms) |
| extrude 100 faces individually (sphere 40 × 40) + triangulate + normals | 7.5 ms |
| insert edge loop on a 200-quad ring + triangulate + normals | 0.79 ms |
| insert edge loop, `multiple` 3, on a 200-quad ring (op) | 1.4 ms |
| inset 100 faces individually (op) | 5.9 ms |
| merge by distance collapsing a 101 × 101 grid to one vertex (10k → 1, op) | 80 ms |

Individual extrusion scales linearly (≈ 75 µs per face, 50…800 faces); a profile puts most of it in the kernel's
write log (`record`, the per-target writers) and the Euler operators, not in B3's planning code. Re-run after fix
round 1 (load ≈ 20): 1.86 / 7.2 / 0.81 / 1.31 / 5.97 / 79 ms for the rows above — unchanged (`adjustableResult` only
wraps the result object).

## Gates (local, real Chrome; port 3164)

CI unset, browser tests on the installed Google Chrome only. On the code of `3fd3544` (this notes commit changes no
code): `format:check`, `lint`, `typecheck`, `check:deps` (15 packages) green; **mesh-core 448 passed, 2 skipped**
(Node + Chromium; the two skips are the `READY.b2` cross-checks, M6A-B3-4/-13); the full e2e suite
(`EKZA_E2E_PORT=3164 pnpm run test:e2e --workers=4`): chrome 109 passed, 10 skipped (the stretch `test.fixme`
entries and B0a's `b9` fixme), rc 0 — B3 owns no E2E-MOD scenario (§10.1). A production `build` and `check:size`:
**864,427 B** (≤ 900,000 B; B1 recorded 864,426 B, the eager route is unchanged), the `mesh-kernel` boundary holds
(kernel chunk 47.8 kB lazy, B1's 28.6 kB plus B3's ops).

`test` (turbo, `--concurrency=3`) on `0fc9bb3`, 15/15 tasks green: anim-core 671, doc 233, doc-yjs 78, ui 87, rig 202,
mesh-core 446 + 2 skipped, mesh-view 2, io 170, editor-core 793, headless-tests 173, viewport 100 + 1 skipped,
curve-editor 207 + 3 skipped, editor 359 + 1 skipped, web 10, tooling 14. The two commits after it change only
mesh-core (re-run above); the full e2e suite was also green on `0fc9bb3`.

**Fix round 1** (on `d22ecef`, the code of this round; CI unset, local Chrome): `format:check` (1145 files),
`lint` (oxlint `--type-aware`), `typecheck`, `check:deps` (15 packages) rc 0; `test` (turbo, `--concurrency=3`)
15/15 tasks green — anim-core 671, ui 87, doc 233, doc-yjs 78, rig 202, mesh-view 2, **mesh-core 460 + 2 skipped**
(Node + Chromium; the skips are still the `READY.b2` cross-checks), io 170, editor-core 793, headless-tests 173,
viewport 100 + 1 skipped, curve-editor 207 + 3 skipped, web 10, editor 359 + 1 skipped, tooling 14; the full e2e suite
(`EKZA_E2E_PORT=3164 pnpm --filter web e2e --workers=4`, chrome, `next build` + `next start`): 109 passed, 10 skipped,
rc 0; `check:size` on that build: 865,794 B ≤ 900,000 B. Heavier local property runs passed too
(`B3_PROPERTY_SCALE=5` for `properties.test.ts` twice, `=10` for `symmetry.test.ts` three times). Port 3164 free
afterwards.

## Open for the integration agent

- M6A-B3-12: `packages/mesh-core/test/descriptors.test.ts` (B0a's test) — the `LANDED` literal update; merge with
  B2's `LANDED` set (and B4's/B5's when they land) as their union.
- M6A-B3-13: move B3's gate to `packages/mesh-core/test/ready.ts` and set `b2`/`b3`.
- `src/stubs/frame.ts` (B0a's stub of `regionFrame`) is deleted; the barrel line points at `ops/extrude/frame.ts`.
