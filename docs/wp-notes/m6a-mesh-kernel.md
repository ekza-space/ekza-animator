# M6a B1 — Mesh kernel: build notes

Branch `m6a/mesh-kernel` (from `m6a/spec`, with `m6a/contracts-foundation` merged). Scope:
[M6A-SPEC §9 B1](../M6A-SPEC.md#b1--mesh-kernel). Decision IDs below are `M6A-B1-<n>`.

## What landed (by spec responsibility)

| B1 item | Where (`packages/mesh-core/…`) |
|---|---|
| SoA arrays with capacity growth (amortized doubling, `Math.fround` writes), edit links | `src/core/mesh.ts` (`KernelMesh`), `src/layers/arrays.ts` |
| `editMeshFrom` / `emptyMesh` (canonical links in O(V + E + C), no hashing) | `src/core/edit.ts` |
| Attribute layers, built-ins, `morphLayer`, `groupLayer`; the §5.2 rules inside the Euler operators | `src/layers/builtin.ts`, `src/layers/propagate.ts`, `src/euler/operators.ts` |
| Write log and `MeshDelta` (coalesced per slot, copy-on-write snapshots, exact `apply` both ways) | `src/log/log.ts`, `KernelMesh.end/abort/apply` |
| Euler operators | `src/euler/operators.ts` |
| `validateMesh` (§5.1 1–5 and 7), `topologyStats` | `src/validate/validate.ts`, `src/validate/stats.ts` |
| Revision writer/reader: implicit default tails, canonical tail trimming, incremental re-hashing | `src/revision/revision.ts` |
| The one triangulation and the one normals function (full and incremental) | `src/triangulate/triangulate.ts`, `src/normals/normals.ts` |
| Hard-flag helpers (H1–H4 checks, H2 dihedral rule) and `resolveSmoothingAngle` | `src/normals/hard.ts`, `src/normals/normals.ts` |
| Six primitives with both default sets and UVs (`humanoidBody` delegates to B13's generator) | `src/primitives/primitives.ts` |
| `robust-predicates` wrapper | `src/predicates/index.ts` |
| fast-check arbitraries, fixtures, state dumps, Euler step runner, golden runner | `src/testing/index.ts` (`@ekza-studio/mesh-core/testing`) |
| First benches | `bench/kernel.bench.ts` |
| B0a's reference kernel and its barrel lines replaced; `src/reference/**` deleted | `src/index.ts` (B1 lines only) |

## For the op packages (B2…B5): what the kernel guarantees

**Euler operators** (the only topology API; every one validates its arguments before its first write and refuses with
`EkzaError('mesh-euler')`, so a refused call leaves the transaction untouched; a bad index is `out-of-range`, a call
outside `begin`/`end` is `mesh-no-transaction`):

| Operator | Result and indices | Layers and flags |
|---|---|---|
| `makeVert(x, y, z)` | new vertex at the end | point layers at their defaults |
| `killVert(v)` | kills v, its edges and their faces | — |
| `makeEdge(a, b)` | the existing edge of the pair, else a new wire edge at the end | flags 0, edge layers default (apply H2 with `applySmoothingAngle` or set flags yourself) |
| `killEdge(e)` | kills e and every face using it | — |
| `makeFace(verts, {material, example})` | new face (and missing edges, flags 0) at the end; refuses < 3 vertices or a repeated consecutive vertex | material and face layers from `example`; each corner copies the example's corner at the same vertex (`'clear'` layers cleared), others default |
| `killFace(f)` | kills f and its corners; edges stay (wire where nothing else uses them) | — |
| `splitEdgeMakeVert(e, t)` | new vertex at t from `edgeVert(e, 0)`; e becomes (v0, new), a new edge (new, v1) at the end; one new corner per face side | point layers interpolated, corner layers interpolated per face side (seams kept), the new edge copies e's flags (H4) and edge layers |
| `joinEdgeKillVert(v)` | dissolves a valence-2 vertex; **the smaller-index edge survives** (its endpoint order kept); refuses another valence, an existing a–b edge, a face that would keep < 3 corners or turns back at v | flags OR-merged (H3) |
| `splitFaceMakeEdge(f, cA, cB)` | f keeps cA's side, a new face (end) takes cB's side; the existing a–b edge is reused | a new edge is hard iff every edge of f was hard (H1); the new face copies f's material, flags and layers; the two new corners copy the corners at their vertices |
| `joinFaceKillEdge(e)` | merges the two faces of a manifold edge that run it in opposite directions; **the smaller face index survives**; refuses border, non-manifold, same-face and same-direction edges, and two faces that share another edge (dissolve the shared run with `joinEdgeKillVert` first) | the survivor's face layers |
| `reverseFace(f)` | flips the winding; each corner keeps its vertex and values | — |

**Removal order** (M6A-B1-2): inside a transaction the elements of each domain stay partitioned as
[surviving pre-op elements][created elements]. Removing a pre-op element moves the last surviving pre-op element into
its hole and then the last created element into the freed slot; removing a created element moves the last element
into its hole. Every moved element comes from an index ≥ the removed one, so **removals in descending index order never
invalidate the indices still to be removed**; indices of created elements you hold can move when you remove a pre-op
element afterwards (remove first, then create, or re-read). `MeshDelta.remap` is exact: `forward` maps every pre-op
index (null when nothing was removed), and the created elements are exactly [createdFrom, count).

**Deltas replay on any mesh in the same state** (M6A-B1-4): undo after leaving and re-entering component mode (a
runtime rebuilt from the revision, §5.5 rules 4 and 8) is as exact as undo on the recording mesh, and so are `abort()`
and undo of transactions that mix removals, creations and layer events. Nothing for op code to do: write through the
Euler operators and the logged setters only.

**Canonical links** (M6A-B1-1): disk cycles list a vertex's edges in ascending index (`vertEdge` = the smallest), radial
cycles an edge's corners in ascending index (`edgeCorner` = the smallest). An edited mesh traverses exactly like
`editMeshFrom(snapshot())`, so an op's result never depends on the mesh's history (P6), and walkers can rely on the
order.

**Helpers** (import from the module, not the barrel):
- `src/layers/propagate.ts` — `copyPointAttributes`, `interpolatePointAttributes`, `mergePointAttributes` (`'target'`
  for weld, `'average'` for merge/collapse: linear average, group weights max, bits or, skin union top 4
  renormalized), `copyCornerAttributes`, `interpolateCornerAttributes`, `averageCornerAttributes` (fill),
  `clearCornerAttributes` (`normal.custom` on touched corners), `copyFaceAttributes`, `copyEdgeAttributes`,
  `defaultAttributes`, and the mirror helpers `mirrorPointAttributes` (morph axis negated into the `_L`/`_R` partner,
  joints through the palette's mirror pairs, side groups swapped), `mirrorCornerAttributes` (U flip with `flipUVs`,
  custom normals negated), `mirrorName`, `jointMirrorMap`.
- `src/normals/hard.ts` — `allEdgesHard` (H1), `dihedralAngle`, `isHardByAngle`, `applySmoothingAngle` (H2 on created
  side/strip edges, after the geometry is final), `mergeEdgeFlags` (H3), `isAllHard` (P7-hard checks).
- `src/predicates` — `orient2d`, `orient3d`, `incircle`, `segmentsCross2d` in right-handed, y-up conventions.
- `src/triangulate/triangulate.ts` — `isDegenerateNgon` (Mesh Check's `ngon-degenerate`, B5) and
  `dirtyTriangleFaces(m, dirty)`, the `dirtyFaces` argument of an incremental `triangulate` for a `DirtySet` (M6A-B1-11).
- `@ekza-studio/mesh-core/testing` — `cubeData`, `brokenMeshes`, `nonManifoldCorpus`, `storedState`, `diffStored`,
  `linkState`, `linkArray`, `firstDifference`, `signedVolume`, `vef`, `arbPrimitive`, `arbSoup`, `arbEulerStep`,
  `resolveEulerStep`, `goldenRunner`, `rounded`. `test/properties/harness.ts` shows the full per-op check that op tests
  can copy: validity, canonical links, canonical dead slots (`deadSlotProblem`), remap, dirty set, incremental revision
  after the op and after its undo, exact undo/redo on the same mesh and on rebuilt runtimes; `checkTransaction` runs
  many steps (layer events included) in one transaction, aborts it first and re-runs it.

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B1-1 | **Canonical cycle order** (ascending indices in disk and radial cycles, kept through every Euler operator and element move). | ADR 0014 §7 determinism: with history-dependent cycle order the same stored mesh could give different op results before and after a reload (P6). It also makes "edit links = f(stored arrays)" testable after every step. |
| M6A-B1-2 | **Removal keeps [survivors][created]** (the move rule above), instead of plain "last element into the hole". | §4.3 `DomainRemap.createdFrom` ("elements with index ≥ createdFrom … were created by the op") is only true with this order; plain swap-remove could move a created element below a survivor. |
| M6A-B1-3 | **`DirtySet`** lists every element whose stored arrays or layers were written (connectivity arrays included), with indices below max(count before, count after); a layer added or removed makes its domain `'all'`; `topology` is set by any count or connectivity write. | `writeRevision` uses it for incremental re-hashing across topology edits (§5.20: "re-hashes only chunks spanned by dirty indices (and changed tails)"); caches get the same set for both apply directions. |
| M6A-B1-4 | **Write log**: segments split at layer additions and removals; a target switches to a copy-on-write snapshot when its logged slots exceed a quarter of its live length at segment start (floor 64 slots); unchanged slots are dropped, every changed slot is kept. **Dead slots are canonical**: every slot past a count holds its target's dead value (0 in the stored arrays, −1 in the edit links, the layer default) — construction and capacity growth fill them, a removal writes them **through the log** into the slot it vacates (so the vacated element's content is in the delta), a re-attached layer fills its tail with defaults, and a snapshot's backward apply writes them into the slots its segment brought to life (a snapshot's `after` spans the larger of both live lengths). The arrays are thus a pure function of the live state; with delta keys naming layers, not layer objects, a delta applies exactly to any kernel mesh in the same state (a runtime rebuilt from its revision). Layer handles stay valid until their layer is removed (also by undo); re-read them with `layer(name)`. | ADR 0014 §5 "giant operations switch to copy-on-write snapshots"; the journal (B7) outlives a runtime rebuild (§5.5 rules 4 and 8). Fix round 1: before, removals left the vacated slot unlogged and the log dropped slots dead at both ends of a segment — undo on a rebuilt runtime, and abort/undo of a slot emptied, refilled after a layer event and emptied again, were not exact (below). |
| M6A-B1-5 | **`validateMesh`** checks §5.1 invariants 1–5 (edit links included) and 7 (finite floats in positions and every f32 layer; `skin.weights` non-negative and summing to 1 ± 1e-6). Invariant 6 is not a single-mesh check: a seam is derived from unequal values, so any stored mesh satisfies it; the P7 properties check that splits and cuts keep continuous attributes continuous and seams split. | §5.1 wording "seams are derived from inequality". |
| M6A-B1-6 | **`skin.weights` defaults to `[1, 0, 0, 0]`** (fully bound to joint 0), B0a had `[0, 0, 0, 0]`. | With zeros, a vertex no op gave weights — and the implicit default tail of a revision — breaks invariant 7. |
| M6A-B1-7 | **`groupLayer` mirror rule `'swap-side'`** (B0a had `'none'`). | §5.2 mirroring row: groups "swap by `.L`/`.R` name". |
| M6A-B1-8 | **Primitives**: cube/plane/cylinder keep B0a's vertex, face and corner order (their triangulation and normals are bit-identical to the reference goldens; only the manifests change, by `uv0`). UVs: cube sides each 0–1 (subdivisions share their side's square), plane 0–1 (u +X, v −Z), sphere cylindrical (u = 1 − angle/2π from the −Z seam so u grows to the right seen from outside, v bottom → top), cylinder/cone side band in v ∈ [0.5, 1] with the caps as discs centred (0.25, 0.25) and (0.75, 0.25), torus two angles; every face is counterclockwise in UV space and no face spans a seam. No `EDGE_SEAM` flags on primitives (seams are derived from the UV values). Layer order `paint`, `uv0`. | §5.16 names the projection per primitive, not the cap layout or the u direction; a mirrored atlas would read wrong seen from outside. |
| M6A-B1-9 | **Euler refusal code `mesh-euler`**; preconditions are checked before the first write, so a refused call leaves the transaction exactly as it was (the property harness checks this on every refusal). | §4.3 says "refuses … (EkzaError)" without a code. |
| M6A-B1-10 | **`joinFaceKillEdge` refuses two faces that run the edge in the same direction** (inconsistent winding) instead of reversing one. | Joining them needs a reversal first (a `reverseFace` the op decides on); the operator stays exact and local. |
| M6A-B1-11 | **Incremental derived data**: `triangulate(m, cache, dirtyFaces)` recomputes only the listed faces, and the list **must** name every face whose triangles can differ (moved vertex, changed flag, changed corner). After any topology edit callers **must pass `'all'`**: `DirtySet.faces` does not list a face whose corners were renumbered under it (a removal moves another face's corners into the freed slots without writing the face's own arrays), and the list path cannot detect that cheaply — it only falls back to a full run when a listed face's triangle count changed or the cache has another face count. `dirtyTriangleFaces(m, dirty)` derives the right argument from a `DirtySet` (`'all'` after a topology edit). `computeNormals(m, cache, dirty)` takes the DirtySet itself: it updates the one-ring of a non-topology DirtySet and recomputes everything otherwise. | §5.4 "caches update only dirty faces (and the one-ring of dirty vertices for normals)"; §4.3 fixes `triangulate`'s signature (a face list, not a DirtySet). Fix round 1: the notes claimed a list after a topology edit falls back to a full run; it does not. |
| M6A-B1-12 | **Browser-mode tests**: `mesh-core` gains the devDependencies `@vitest/browser-playwright` 4.1.11 and `playwright` 1.63.0 (the versions mesh-view uses, already in the lockfile: 6 lockfile lines), `tooling/check-deps.mjs` allows `BROWSER_TESTS` for mesh-core, and `.oxlintrc.json` lets mesh-core tests import `@vitest/browser-playwright`. These three files are the integration agent's (§9.1); the change is minimal and additive — **a request for INT to ratify**. `vitest.config.ts` runs two projects: `node` (every `*.test.ts`, the benches) and `chromium` (`*.browser.test.ts`: P1, P4, P5, P6). | §9 B1 Tests: "P1, P4, P5, P6 (Node + Vitest browser mode, Chromium)"; B0a's manifest had no browser runner. |
| M6A-B1-13 | **B0a's reference tests moved into B1's test dirs** (`test/reference/*` → `test/{core,revision,primitives,triangulate,normals}`) with literal updates only: primitives carry `uv0` (layer lists, the all-default corner layer of the revision fixtures is `uv1`), sphere/cone/torus exist, the Euler operators no longer refuse `not-implemented`; `test/goldens/reference-primitives.json` gave way to `primitives.json`; `test/descriptors.test.ts` scans B1's module dirs for the kernel marker instead of `src/reference`; `bench/reference.bench.ts` became `bench/kernel.bench.ts`. | §3 rule 9: literal updates in the commit that changes the contract; no assertion was weakened (the reference golden triangulation and normals are still asserted bit-equal for cube/plane/cylinder). |
| M6A-B1-14 | **`READY.b1`**: no package on this branch has a `test/ready.ts` with a `b1` flag (B6, B7 and B8 have not merged); each downstream package sets `b1: true` in its own `test/ready.ts` when it merges after B1. | §9 B1 DoD "downstream READY flag `b1` set". |
| M6A-B1-15 | **`KernelMesh` extras** (`dataView`, `handlesOf`, `layersOf`, `byteSize`, …) are implementation details; op packages use the §4.3 contract and the helpers above. `isDegenerateNgon` and the helper modules are kernel-internal exports (not in the barrel). | §3 rule 2: barrels change only their stub lines. |
| M6A-B1-16 | **Property-test sizes**: model-based `fc.commands` runs of up to 500 steps (`size: 'max'`) on primitives and soups, plus fixed-length 50–500-step sequences, one step per transaction; model-based runs of up to 12 transactions of 2–40 steps each (layer events included) on primitives and soups, and single transactions of 200–400 steps (these reach copy-on-write snapshots in later segments). The Chromium run repeats both kinds on smaller counts. Heavier one-off runs (300 + 300 transaction sequences, 40 transactions of 200–600 steps, 60 per-step sequences of 50–400 steps) found nothing further. | §5.29 "sequences of 50–500 ops"; the committed runs stay a few seconds on the shared machine. |
| M6A-B1-17 | **`joinFaceKillEdge` refuses two faces that share another edge** (`mesh-euler`). | Joining f0 = [0,1,2,3] and f1 = [2,1,0,4] across 0–1 gave one face running 1–2 twice (a spike at vertex 1) that `validateMesh` accepts (§5.1 forbids only consecutive repeats). The caller dissolves the shared run first (`joinEdgeKillVert` at its inner vertices), then joins. The three fixed Euler scripts of the P6 goldens skip refused steps, so their manifest ids changed (literal golden update; Node and Chromium agree). Faces that share only a vertex still join (a face visiting a vertex twice is valid). |

## Bugs the properties found (fixed before merge)

Fix round 1 (review findings; the new multi-step transaction property finds the first two within one or two runs on
the previous kernel, also with the dead-slot check switched off):

- **Removals did not log the slot they vacated.** Backward apply raised the count and assumed the slot still held the
  element — true only on the recording object. Undo of `killFace(0)` on `editMeshFrom(m.snapshot())`, or of
  `killVert(3)` on a runtime read back from its revision, produced an invalid mesh. Now the vacated slot's dead values
  are written through the log (M6A-B1-4); regression cases for every removing operator in `test/log`.
- **A slot emptied, refilled after a layer event and emptied again** was dropped by the later segment as dead at both
  ends, so the earlier segment could not restore it: `abort()` and undo on the same mesh were not exact (cube:
  `killFace(5)`, `addLayer(color0)`, `killFace(makeFace([0,2,4]))`; shrunk property case `killVert`, `addLayer`,
  `makeVert`, `killVert`). A variant lost a removed corner's `uv0` values when `uv0` was removed later in the same
  transaction. Fixed by the same change; the drop rule is gone.
- **The property harness ran one Euler step per transaction** and applied deltas only to the recording mesh, so it
  could not see either bug. It now runs multi-step transactions with layer events, aborts them, and applies every delta
  to rebuilt runtimes as well (M6A-B1-16), in Node and Chromium.
- `joinFaceKillEdge` joined faces sharing a second edge into a spike (M6A-B1-17); the triangulation notes overstated
  the list path's fallback (M6A-B1-11).

Before the first review:

- `killEdge`/`killVert` bounded their loops by a count that shrinks as faces die, so an edge used by four faces kept
  one (soup property; now bounded by the initial cycle length).
- `joinEdgeKillVert` checked each corner's face length separately, so a face passing through the vertex twice dropped
  to two corners (soup property; now counts every corner a face loses; regression case in `test/euler`).

## Gates (local, real Chrome; port 3162)

Fix round 1, on the code of `481a22a` (the notes commit changes no code), CI unset: `format:check`, `lint`,
`typecheck`, `check:deps` (15 packages), `check:fixtures`, `check:licenses` (176) green; `test` 15/15 green (turbo,
`--concurrency=4`): anim-core 671, doc 233, doc-yjs 78, ui 87, rig 202, **mesh-core 342 (337 Node + 5 Chromium)**,
mesh-view 2, io 170, editor-core 793, headless-tests 173, viewport 100 + 1 skipped, curve-editor 207 + 3 skipped,
editor 359 + 1 skipped, web 10, tooling 14. A production `build` and `check:size` green: **864,426 B** (≤ 900,000 B;
the eager route is unchanged), the `mesh-kernel` boundary holds (kernel chunk 28.6 kB lazy). The full e2e suite
(`EKZA_E2E_PORT=3162`, `--workers=4`): chrome project 109 passed, 10 skipped (the stretch `test.fixme` entries and
B0a's `b9` fixme), rc 0 — B1 owns no E2E-MOD scenario (§10.1).

First review, on the code of `99b4cca`: the same gates green; mesh-core 334 (330 Node + 4 Chromium); `check:size`
864,424 B (kernel chunk 28.4 kB); e2e chrome 109 passed, 10 skipped.

## Open for the integration agent

M6A-B1-12 and M6A-B1-13 touch files §9.1 gives to INT or that sit outside B1's Dirs; each change is minimal and
additive and **awaits INT ratification** (or INT moves it into a contract change before merge):

- `packages/mesh-core/package.json` — devDependencies `@vitest/browser-playwright` 4.1.11 and `playwright` 1.63.0;
  `pnpm-lock.yaml` — the six matching importer lines (no new packages: mesh-view already locks both).
- `tooling/check-deps.mjs` — mesh-core's devDependencies allow `BROWSER_TESTS` instead of `VITEST`.
- `.oxlintrc.json` — mesh-core tests may import `@vitest/browser-playwright`.
- `packages/mesh-core/vitest.config.ts` — the `node` and `chromium` projects.
- `packages/mesh-core/test/{descriptors.test.ts,raw.d.ts}`, `bench/reference.bench.ts` (deleted for
  `bench/kernel.bench.ts`) — M6A-B1-13.

## Benchmarks (report only; Node 25.6, Apple M4 Pro; `pnpm --filter @ekza-studio/mesh-core bench`; fix round 1)

At 50k triangles (plane 158 × 158), debug validation off:

| Bench | Mean |
|---|---|
| `editMeshFrom` (edit links) | 1.7 ms (budget ≤ 40 ms incl. caches) |
| `editMeshFrom` + `triangulate` + `computeNormals` (kernel part of entering component mode) | 9.3 ms |
| `triangulate` full / incremental (faces around 100 moved points) | 2.2 ms / 0.08 ms |
| `computeNormals` full / incremental (100 moved points) | 5.4 ms / 0.64 ms |
| `topologyStats` | 2.4 ms |
| `validateMesh` (debug builds, every commit) | 9.3 ms |
| `writeRevision` full / incremental (100 moved points) / `readRevision` | 8.1 ms / 1.0 ms (commit budget ≤ 3 ms) / 0.27 ms |
| 1,000 `splitEdgeMakeVert` in one transaction + undo (incl. `editMeshFrom`) | 4.4 ms |
| 1,000 `splitFaceMakeEdge` / 1,000 `killFace` in one transaction (incl. `editMeshFrom`) | 4.1 ms / 7.9 ms (was 4.6 ms: a removal now logs the dead values of the slots it vacates, M6A-B1-4) |
| `primitive('sphere', 128 × 128)` (32k triangles) / its `editMeshFrom` | 6.0 ms / 1.1 ms |
