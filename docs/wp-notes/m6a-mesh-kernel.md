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
| fast-check arbitraries, fixtures, state dumps, Euler step runner, golden runner | `src/testing/index.ts` (`@ekza-animator/mesh-core/testing`) |
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
| `joinFaceKillEdge(e)` | merges the two faces of a manifold edge that run it in opposite directions; **the smaller face index survives**; refuses border, non-manifold, same-face and same-direction edges | the survivor's face layers |
| `reverseFace(f)` | flips the winding; each corner keeps its vertex and values | — |

**Removal order** (M6A-B1-2): inside a transaction the elements of each domain stay partitioned as
[surviving pre-op elements][created elements]. Removing a pre-op element moves the last surviving pre-op element into
its hole and then the last created element into the freed slot; removing a created element moves the last element
into its hole. Every moved element comes from an index ≥ the removed one, so **removals in descending index order never
invalidate the indices still to be removed**; indices of created elements you hold can move when you remove a pre-op
element afterwards (remove first, then create, or re-read). `MeshDelta.remap` is exact: `forward` maps every pre-op
index (null when nothing was removed), and the created elements are exactly [createdFrom, count).

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
- `src/triangulate/triangulate.ts` — `isDegenerateNgon` (Mesh Check's `ngon-degenerate`, B5).
- `@ekza-animator/mesh-core/testing` — `cubeData`, `brokenMeshes`, `nonManifoldCorpus`, `storedState`, `diffStored`,
  `linkState`, `linkArray`, `firstDifference`, `signedVolume`, `vef`, `arbPrimitive`, `arbSoup`, `arbEulerStep`,
  `resolveEulerStep`, `goldenRunner`, `rounded`. `test/properties/harness.ts` shows the full per-op check (validity,
  canonical links, remap, dirty set, incremental revision, exact undo/redo) that op tests can copy.

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B1-1 | **Canonical cycle order** (ascending indices in disk and radial cycles, kept through every Euler operator and element move). | ADR 0014 §7 determinism: with history-dependent cycle order the same stored mesh could give different op results before and after a reload (P6). It also makes "edit links = f(stored arrays)" testable after every step. |
| M6A-B1-2 | **Removal keeps [survivors][created]** (the move rule above), instead of plain "last element into the hole". | §4.3 `DomainRemap.createdFrom` ("elements with index ≥ createdFrom … were created by the op") is only true with this order; plain swap-remove could move a created element below a survivor. |
| M6A-B1-3 | **`DirtySet`** lists every element whose stored arrays or layers were written (connectivity arrays included), with indices below max(count before, count after); a layer added or removed makes its domain `'all'`; `topology` is set by any count or connectivity write. | `writeRevision` uses it for incremental re-hashing across topology edits (§5.20: "re-hashes only chunks spanned by dirty indices (and changed tails)"); caches get the same set for both apply directions. |
| M6A-B1-4 | **Write log**: segments split at layer additions and removals; a target switches to a copy-on-write snapshot when its logged slots exceed a quarter of its live length at segment start (floor 64 slots); slots past the live length at both ends of a segment (created and removed again) are dropped; delta keys name layers, not layer objects, so a delta applies to any kernel mesh in the same state (a runtime rebuilt from its revision). Layer handles stay valid until their layer is removed (also by undo); re-read them with `layer(name)`. | ADR 0014 §5 "giant operations switch to copy-on-write snapshots"; the journal (B7) may outlive a runtime rebuild. |
| M6A-B1-5 | **`validateMesh`** checks §5.1 invariants 1–5 (edit links included) and 7 (finite floats in positions and every f32 layer; `skin.weights` non-negative and summing to 1 ± 1e-6). Invariant 6 is not a single-mesh check: a seam is derived from unequal values, so any stored mesh satisfies it; the P7 properties check that splits and cuts keep continuous attributes continuous and seams split. | §5.1 wording "seams are derived from inequality". |
| M6A-B1-6 | **`skin.weights` defaults to `[1, 0, 0, 0]`** (fully bound to joint 0), B0a had `[0, 0, 0, 0]`. | With zeros, a vertex no op gave weights — and the implicit default tail of a revision — breaks invariant 7. |
| M6A-B1-7 | **`groupLayer` mirror rule `'swap-side'`** (B0a had `'none'`). | §5.2 mirroring row: groups "swap by `.L`/`.R` name". |
| M6A-B1-8 | **Primitives**: cube/plane/cylinder keep B0a's vertex, face and corner order (their triangulation and normals are bit-identical to the reference goldens; only the manifests change, by `uv0`). UVs: cube sides each 0–1 (subdivisions share their side's square), plane 0–1 (u +X, v −Z), sphere cylindrical (u = 1 − angle/2π from the −Z seam so u grows to the right seen from outside, v bottom → top), cylinder/cone side band in v ∈ [0.5, 1] with the caps as discs centred (0.25, 0.25) and (0.75, 0.25), torus two angles; every face is counterclockwise in UV space and no face spans a seam. No `EDGE_SEAM` flags on primitives (seams are derived from the UV values). Layer order `paint`, `uv0`. | §5.16 names the projection per primitive, not the cap layout or the u direction; a mirrored atlas would read wrong seen from outside. |
| M6A-B1-9 | **Euler refusal code `mesh-euler`**; preconditions are checked before the first write, so a refused call leaves the transaction exactly as it was (the property harness checks this on every refusal). | §4.3 says "refuses … (EkzaError)" without a code. |
| M6A-B1-10 | **`joinFaceKillEdge` refuses two faces that run the edge in the same direction** (inconsistent winding) instead of reversing one. | Joining them needs a reversal first (a `reverseFace` the op decides on); the operator stays exact and local. |
| M6A-B1-11 | **Incremental derived data**: `triangulate(m, cache, dirtyFaces)` uses a face list only while the face layout is unchanged (a list after a topology edit, or a cache of another layout, falls back to a full run — pass `'all'` after topology edits); `computeNormals(m, cache, dirty)` updates the one-ring of a non-topology DirtySet and recomputes everything otherwise. | §5.4 "caches update only dirty faces (and the one-ring of dirty vertices for normals)". |
| M6A-B1-12 | **Browser-mode tests**: `mesh-core` gains the devDependencies `@vitest/browser-playwright` 4.1.11 and `playwright` 1.63.0 (the versions mesh-view uses, already in the lockfile: 6 lockfile lines), `tooling/check-deps.mjs` allows `BROWSER_TESTS` for mesh-core, and `.oxlintrc.json` lets mesh-core tests import `@vitest/browser-playwright`. These three files are the integration agent's (§9.1); the change is minimal and additive — **a request for INT to ratify**. `vitest.config.ts` runs two projects: `node` (every `*.test.ts`, the benches) and `chromium` (`*.browser.test.ts`: P1, P4, P5, P6). | §9 B1 Tests: "P1, P4, P5, P6 (Node + Vitest browser mode, Chromium)"; B0a's manifest had no browser runner. |
| M6A-B1-13 | **B0a's reference tests moved into B1's test dirs** (`test/reference/*` → `test/{core,revision,primitives,triangulate,normals}`) with literal updates only: primitives carry `uv0` (layer lists, the all-default corner layer of the revision fixtures is `uv1`), sphere/cone/torus exist, the Euler operators no longer refuse `not-implemented`; `test/goldens/reference-primitives.json` gave way to `primitives.json`; `test/descriptors.test.ts` scans B1's module dirs for the kernel marker instead of `src/reference`; `bench/reference.bench.ts` became `bench/kernel.bench.ts`. | §3 rule 9: literal updates in the commit that changes the contract; no assertion was weakened (the reference golden triangulation and normals are still asserted bit-equal for cube/plane/cylinder). |
| M6A-B1-14 | **`READY.b1`**: no package on this branch has a `test/ready.ts` with a `b1` flag (B6, B7 and B8 have not merged); each downstream package sets `b1: true` in its own `test/ready.ts` when it merges after B1. | §9 B1 DoD "downstream READY flag `b1` set". |
| M6A-B1-15 | **`KernelMesh` extras** (`dataView`, `handlesOf`, `layersOf`, `byteSize`, …) are implementation details; op packages use the §4.3 contract and the helpers above. `isDegenerateNgon` and the helper modules are kernel-internal exports (not in the barrel). | §3 rule 2: barrels change only their stub lines. |
| M6A-B1-16 | **Property-test sizes**: model-based `fc.commands` runs of up to 500 steps (`size: 'max'`) on primitives and soups, plus fixed-length 50–500-step sequences; a heavier one-off run (250 sequences of 100–400 steps) found nothing further. | §5.29 "sequences of 50–500 ops"; the committed runs stay ≈ 10 s on the shared machine. |

## Bugs the properties found (fixed before merge)

- `killEdge`/`killVert` bounded their loops by a count that shrinks as faces die, so an edge used by four faces kept
  one (soup property; now bounded by the initial cycle length).
- `joinEdgeKillVert` checked each corner's face length separately, so a face passing through the vertex twice dropped
  to two corners (soup property; now counts every corner a face loses; regression case in `test/euler`).

## Gates (local, real Chrome; port 3162)

On the code of `99b4cca` (the notes commit changes no code): `format:check`, `lint`, `typecheck`, `check:deps`,
`check:fixtures`, `check:licenses` green; `test` 15/15 green (turbo, `--concurrency=4`): anim-core 671, doc 233,
doc-yjs 78, ui 87, rig 202, **mesh-core 334 (330 Node + 4 Chromium)**, mesh-view 2, io 170, editor-core 793,
headless-tests 173, viewport 100 + 1 skipped, curve-editor 207 + 3 skipped, editor 359 + 1 skipped, web 10, tooling
14. The full e2e suite (`EKZA_E2E_PORT=3162`, `--workers=4`, chrome project): 109 passed, 10 skipped (the stretch
`test.fixme` entries and B0a's `b9` fixme) — B1 owns no E2E-MOD scenario (§10.1). A production `build` and
`check:size` green: **864,424 B** (B0a: 864,427 B; the eager route is unchanged), the `mesh-kernel` boundary holds
(kernel chunk 28.4 kB lazy; B0a's reference was 18.8 kB).

## Benchmarks (report only; Node 25.6, Apple M4 Pro; `pnpm --filter @ekza-animator/mesh-core bench`)

At 50k triangles (plane 158 × 158), debug validation off:

| Bench | Mean |
|---|---|
| `editMeshFrom` (edit links) | 1.8 ms (budget ≤ 40 ms incl. caches) |
| `editMeshFrom` + `triangulate` + `computeNormals` (kernel part of entering component mode) | 9.6 ms |
| `triangulate` full / incremental (faces around 100 moved points) | 2.2 ms / 0.08 ms |
| `computeNormals` full / incremental (100 moved points) | 5.4 ms / 0.68 ms |
| `topologyStats` | 2.5 ms |
| `validateMesh` (debug builds, every commit) | 9.4 ms |
| `writeRevision` full / incremental (100 moved points) / `readRevision` | 8.3 ms / 1.0 ms (commit budget ≤ 3 ms) / 0.26 ms |
| 1,000 `splitEdgeMakeVert` in one transaction + undo (incl. `editMeshFrom`) | 4.1 ms |
| 1,000 `splitFaceMakeEdge` / 1,000 `killFace` in one transaction (incl. `editMeshFrom`) | 4.0 ms / 4.6 ms |
| `primitive('sphere', 128 × 128)` (32k triangles) / its `editMeshFrom` | 5.7 ms / 1.1 ms |
