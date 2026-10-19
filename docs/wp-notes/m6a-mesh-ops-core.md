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
  (tests compare the stored arrays).
- `resolvedArgs` — defaults and coercion applied; `smoothingAngle` resolved (§5.3); insert loop's `seedEdge` and
  bridge's `loops` filled from the selection (pick order).

**Refusal codes** (each with a sentence for the help line): `extrude.no-selection`, `extrude.vertex` ("Vertex
extrude is not available yet"), `extrude.interior-edge`, `extrude.non-manifold` (M6A-B3-18); `inset.no-selection`,
`inset.non-manifold`; `insertLoop.no-ring` (no seed, or a seed without faces); `offsetLoop.no-selection`, `offsetLoop.no-ring`; `connect.no-selection`,
`connect.no-face`; `merge.no-selection`, `merge.nothing`, `mergeToCenter.no-selection`, `mergeToCenter.nothing`,
`mergeByDistance.nothing`; `targetWeld.no-pairs`; `collapse.no-selection`; `delete.no-selection`, `delete.not-winged`,
`delete.border-edge`, `delete.non-manifold`, `delete.hole`, `delete.degenerate` (M6A-B3-21); `fillHole.no-border`;
`bridge.needs-two`, `bridge.unequal-counts` ("… (8 vs 6)"); `symmetry.seam` (Target Weld, Preserve Seam).

**Warning codes**: `symmetry.unmatched-partner` (count; "No mirror partner: applied to one side"),
`extrude.offset-clamped` and `inset.clamped` (count, message with the largest clamped distance), `connect.skipped`
(count of faces with three or more selected edges), `offsetLoop.corner` (count of faces where the loop turns),
`merge.non-manifold` (any merge that leaves an edge with more than two faces), `mergeByDistance.merged` (count of
removed vertices).

**Symmetry**: every op reads `ctx.symmetry` (B2's map) through `Mirror` (`src/ops/extrude/shared/symmetry.ts`) and
honours the §5.14 rows: expanded selections; extrude/inset partner regions with the reflected frame `S·F` (identical
numbers give an exact mirror); self-mirrored regions and merge groups processed once and symmetrized / snapped onto
the plane; Insert Edge Loop decided by the mapped seed point (M6A-B3-16); the Target Weld seam table; Bridge's mirrored
pair; unmatched partners on one side with the warning.

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B3-1 | **Winding of the new quads follows P4, not the literal corner lists.** Face extrude: for a boundary edge its region face runs a → b, the side quads run (A_k, B_k, B_k+1, A_k+1) from the base to the cap (§5.8 step 3 writes (b, a, a′, b′), the reverse cycle). Edge extrude: for a border edge its face runs a → b, the quads run (B_k, A_k, A_k+1, B_k+1) (§5.8 step 7 writes (a, b, b′, a′)). | The literal cycles run the shared edge in the same direction as the face across it (inconsistent winding, §5.29 P4); only the cycle order differs, the vertex sets are the spec's. |
| M6A-B3-2 | **The cap (extrude) and the inner faces (inset) keep their face indices by corner rewiring through Euler operators** (`swapCorner`: split the face along the chord p–n, make (n, p, w), kill the cut-off triangle, join back; triangles and faces with an existing p–n edge go through a temporary vertex). No new kernel operator, no kill-and-remake. | §5.8 step 2 "the cap keeps the original face indices"; §3 rule 8 "topology only through Euler operators"; the kernel's removal rule moves the last pre-op face into a removed pre-op slot (M6A-B1-2), so a face that must keep its index can never be killed. |
| M6A-B3-3 | **B3's shared toolkit lives in `src/ops/extrude/shared/`** (inside B3's `extrude` dir) and is imported only by B3's op dirs. | §9 B3 Dirs name op directories only; one copy of the traversal, argument, affine, split and symmetry helpers instead of eleven. |
| M6A-B3-4 | **Op-side symmetry helpers** (`Mirror`: reflect, project, symmetrize, crossing parameter, partner lookup; `expandIndices`; `mirrorPoint`) read only the `SymmetryMap` arrays, so B3 does not call B2's functions at run time. Tests use `referenceSymmetryMap` (the §5.14 definition, brute force). A `READY.b2` test checks that the reference maps equal `buildSymmetryMap` on the test meshes (symmetric, extruded and broken) and that `expandIndices`/`mirrorPoint` equal `expandSelection`/`mirrorEdgePoint`; it passed locally with `m6a/mesh-select` merged into the worktree (trial merge, not committed: 18/18, and B2's own suites green next to B3's). | B2 had not merged when B3 started; the contract is the map, not the helper. |
| M6A-B3-5 | **The weld engine** (merge family, Target Weld, Collapse) maps every vertex to a representative, re-makes the faces through merged vertices over the mapped cycle (repeats and spikes dropped, < 3 corners killed, each corner keeping its own values), merges coincident duplicate faces (the larger index dies), removes unused edges and vertices, ORs the flags of edges that map onto one (H3) and reports edges with more than two faces (`merge.non-manifold`). Final vertex indices come from `removalMap` (the kernel's removal rule replayed), valid because the merge creates no vertex and runs as the first writer of its transaction. | §5.12 "after any merge" list; §5.2 merging row; §5.3 H3. |
| M6A-B3-6 | **Nothing to do is a refusal, not an empty step**: `merge.nothing`, `mergeToCenter.nothing`, `mergeByDistance.nothing`, `connect.no-face` ("No face joins the selected vertices" — §5.11 says "do nothing" with that sentence), `fillHole.no-border`, `offsetLoop.no-ring`, `insertLoop.no-ring`. | No history step that changes nothing; the sentence still reaches the help line. |
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
| M6A-B3-19 | **Edge extrude frames**: per chain of border edges joined head to tail in their faces' winding (a bow-tie vertex where two chains meet head to head gets separate new vertices); a closed chain's direction sum is ≈ 0, so X falls back to the region-frame rule on the averaged normal and Y = Z × X is flipped to point away from the faces where that is defined. `offset` and `thickness` are face-region args and do not apply to edges. | §5.8 step 7. |
| M6A-B3-20 | **Bridge inputs**: `bridge.one-mesh` is the editor's refusal (a `MeshOp` sees one mesh). Two faces must share no vertex and have only two-face edges (`bridge.needs-two` with the reason); under symmetry the mirrored faces are deleted and bridged too. Bridging two opposite faces of a plain cube makes strip faces that coincide with its sides (the strip edges are the existing vertical edges): valid, non-manifold, not refused (Maya does the same). | §5.12, §6.1 `bridge.one-mesh`. |
| M6A-B3-21 | **Delete family**: `selection′` is empty in every mode; plain Delete with a border edge removes its face and every face group joined to it in the same run; `delete.hole` when a merged face would need a hole; `delete.degenerate` when dissolving a winged vertex would leave a face with fewer than three corners; `delete.non-manifold` for an edge with more than two faces. | §5.12 delete family; §6.1 "empty selection". |
| M6A-B3-22 | **Merge to Center and Merge under symmetry**: if a pick's partner is among the picks, picks and partners merge into one point on the plane; otherwise the picks and their partners merge separately. `alwaysMergeTwo` also joins the mirror pair of the two picks; a pick pair across the seam is one self-mirrored group. Mirror groups use the mirrored pick order for their representative. | §5.14 merge rows ("a merge group that is its own mirror is processed once … its merge centre is snapped onto the plane"). |
| M6A-B3-23 | **Target Weld**: chains s → g → h resolve to the final target; `center` welds at the midpoint of the dragged pair; edge-mode pairs weld endpoint to endpoint by proximity. | §5.12. |
| M6A-B3-24 | **Goldens** (`test/goldens/ops-core.json`): every §5.29 row of B3's ops plus one case per op and arg family and four seeded op sequences, each as V/E/F and the result's manifest id; the spec's own numbers live in `test/ops-core/goldens.ts` (`SPEC_COUNTS`), so `UPDATE_GOLDENS=1` can never move an oracle. Node keeps the file, Chromium compares against it (P6). | §3 rule 5, §5.29 ("JSON goldens", P6 "in Node and in Chromium"). |

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

## Tests

| File (`test/ops-core/`) | Covers |
|---|---|
| `oracles.test.ts` | §5.29 rows of B3's ops with positions (typed 0.5: cap along the normal, area 1 within 1e-6, face index kept; X-ring loops at x = ±0.2 / x = 0; apex at (0, 0.5, 0); target unmoved) |
| `goldens.test.ts`, `goldens.ts`, `../goldens/ops-core.json` | §5.29 counts from the spec, P6 manifests (M6A-B3-24) |
| `extrude.test.ts` | arg order (scale → rotate Rz·Ry·Rx → translate), world space through a placement, together vs individual, offset/thickness, clamp warning, zero extrude stays, border edges (frame, shared vertices, divisions), interior-edge refusal, H2 on faceted and smooth meshes, paint and UV of side faces, `adjust` bit-identical, `regionFrame`, inset behaviour |
| `ops.test.ts` | insert loop modes, termination at triangles and hidden faces, a seed between triangles, seed rules, H1, layer interpolation, `adjust`; offset loop (closed, open with/without `deleteEnds`); connect; merge (distance, pick order, `alwaysMergeTwo`, coincident, hidden, lamina), merge to center, H3, collapse, target weld (center, edges); delete (faces, border edge, winged vertex, border corner, hole); fill (both loops from one face, paint slot); bridge (refusals, open chains, two faces, twist/offset/taper, pick order, H2); every remaining refusal and warning code |
| `symmetry.test.ts` | P10 property over every expand/pointer op; extrude with reflected frames, self-mirrored and unmatched regions; Insert Edge Loop goldens (arm, waist, X-ring, multiple, equal, unmatched seed); the Target Weld seam table and an unpaired weld; Bridge's mirrored pair and a self-mirrored pair; the `READY.b2` cross-checks (M6A-B3-4) |
| `properties.test.ts` | P1–P7 per step through `runChecked` (validity, canonical links, dead slots, incremental revision, exact undo/redo on the same and rebuilt meshes, abort exactness), P2 χ (and for a bridge of two closed loops: χ kept, two boundary loops fewer), P3 closed manifolds, P4 winding and outward volume, P6 same step on a copy, P7-hard; single steps (600), sequences of 50–500 steps (8 runs), layered primitives (morph, bits, skin, paint, uv0 stay in their envelope), Bridge of two holes (random sides, offsets, divisions, twist, offset, taper: closed manifold, outward), synthetic soups (P1). `B3_PROPERTY_SCALE=10` multiplies the run counts locally |
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
write log (`record`, the per-target writers) and the Euler operators, not in B3's planning code.

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

## Open for the integration agent

- M6A-B3-12: `packages/mesh-core/test/descriptors.test.ts` (B0a's test) — the `LANDED` literal update; merge with
  B2's `LANDED` set (and B4's/B5's when they land) as their union.
- M6A-B3-13: move B3's gate to `packages/mesh-core/test/ready.ts` and set `b2`/`b3`.
- `src/stubs/frame.ts` (B0a's stub of `regionFrame`) is deleted; the barrel line points at `ops/extrude/frame.ts`.
