# M6a B5 — Bevel, Mesh Check, UV projections: build notes

Branch `m6a/mesh-bevel-check-uv` (from `m6a/spec`, with `m6a/mesh-kernel` merged). Scope:
[M6A-SPEC §9 B5](../M6A-SPEC.md#b5--bevel-mesh-check-uv-projections). Decision IDs below are `M6A-B5-<n>`.

## What landed (by spec responsibility)

| B5 item | Where (`packages/mesh-core/…`) |
|---|---|
| §5.9 `mesh.bevel`: Maya fraction semantics, absolute offset, 1–3 segments, chamfer/roundness, clamp, harden borders, fan corners, face mode through the faces' edges, refusals, selection′, the handle frame | `src/ops/bevel/{bevel.ts,attributes.ts,symmetry.ts,index.ts}` |
| §5.25 `checkMesh` with every code (B0a stub replaced; barrel line `checkMesh` only) | `src/check/index.ts`, `src/index.ts` (B5 line) |
| §5.25 `mesh.cleanup {fix, selectOnly}` and the fixes | `src/ops/cleanup/{index.ts,fixes.ts}` |
| §5.28 projections (`mesh.uv.planar`, `mesh.uv.box`, `mesh.uv.cylindrical`), seams, fit | `src/uv/project/index.ts`, `src/ops/uv/index.ts` |
| Tests: bevel oracles, fraction 0.3 = 0.15 m, clamp property (boxes and concave prisms), P1–P5, P7 (uv0 continuity and seams, skin, P7-hard), P10 and the self-mirror symmetrization | `test/ops/bevel/{bevel,concave,symmetry}.test.ts`, the op harness `test/ops/bevel/harness.ts` |
| Mesh Check on the synthetic corpus (one fixture per code), thresholds, visibility, clean primitives and bevels | `test/check/{corpus.ts,check.test.ts}` |
| Cleanup fixes (oracles, codes gone, P1/P5 on soups, P7-hard) | `test/ops/cleanup/cleanup.test.ts` |
| Projections: frames, cross-checks against the primitives' layouts, wrap, fit, seams, UV goldens | `test/uv/project/project.test.ts`, `test/ops/uv/{uv.test.ts,goldens.ts}`, `test/goldens/b5-uv.json` |
| P6: B5 determinism golden in Node and Chromium (Vitest browser mode) | `test/ops/bevel/{b5-determinism.ts,b5-determinism.test.ts,b5.browser.test.ts}`, `test/goldens/b5-determinism.json` |

B5 owns no E2E-MOD scenario (§10.1): E2E-MOD-07, -09 and -32 (B11) and -15 (INT) gate on `b5` and exercise these ops
through the UI. Downstream `READY.b5` probes turn on by themselves: `checkMesh` no longer throws `not-implemented` and
the five ops no longer refuse it.

## For the UI and lint packages (B8, B10, B11, B12b)

- **`checkMesh(m, {hidden, closedExpected, duplicateSlots})`** returns one `MeshProblem` per code (two for
  `loose-geometry`: `domain` `'point'` and `'edge'`), codes in the §5.25 table order, `elements` ascending, `message`
  with the count ("3 edges have more than two faces"). `duplicateSlots` is the set of palette slots two live swatches
  share (the caller derives it from the palette; faces without a `paint` layer count as slot 0). "Clean" (§5.25) is
  `checkMesh(m).length === 0`, or only `open-border` when `closedExpected` is passed for an open mesh.
- **`mesh.cleanup`**: `{fix: 'select'}` (the default) selects every problem element and changes nothing;
  `{fix, selectOnly: true}` (the default `selectOnly`) selects what that fix would touch; `{fix, selectOnly: false}`
  applies it as one undoable edit. The selection fills every kind it reports (`kind` = the first problem's domain).
  Warnings: `cleanup.found` (count), `cleanup.fixed` (count), `cleanup.clean`, `cleanup.non-manifold` (a collapse
  made an edge with three faces). Select-only codes (`non-manifold-*`, `ngon-degenerate`, `open-border`,
  `duplicate-slot`) have no fix; the panel's "select border" and "select swatch" are B10's.
- **Bevel result**: `selection` = the bevel faces (face mode: plus the shrunk original faces), `frame` = the handle
  frame (pivot at the mean centroid of the bevel faces, Z along their mean normal) for B12b, `resolvedArgs` with the
  resolved `smoothingAngle`, warnings `bevel.clamped`, `bevel.fan-corner` (`count`, `elements` = the vertices, message
  naming up to five) and `symmetry.unmatched-partner`.
- **Projections**: `camera` (planar from the camera) is a 'data' arg `{direction: [x, y, z], up: [x, y, z]}` — the pane
  camera's view direction and up in **world** space; the op maps it into mesh space through `ctx.placement`.
  Refusals `uv.no-faces`, `uv.no-camera`. Without a selection (object mode) every visible face is mapped and
  `selection′` is empty; with one, `selection′` = the mapped faces.

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B5-1 | **Bevel width**: `L` is the shortest edge at the bevelled vertex (all its edges); each new vertex slides along its adjacent unselected edge by `fraction × ½ × L` (absolute: `offset`). Where an edge is measured from both of its ends (slides from both sides, or selected edges bounding miters), the fraction is limited to 0.98 (`bevel.clamped`). On top, with Clamp on, **every width is scaled by the largest factor λ ≤ 1** that keeps every rebuilt face and strip oriented as before, every rebuilt face whose original is a simple polygon simple (no two of its edges that share no corner closer than ε, projected along its dominant axis), every new edge longer than ε, and no two vertices around a bevelled vertex coincident (same warning). | §5.9 names the 0.98 rule and "an empty result after clamping"; shrinking miters and fans can still fold faces at fraction ≤ 0.98 on short edges and acute corners, and a reflex miter can cross a thin arm's far side while the face's orientation still holds (fix round 1). The clamp property runs on random boxes (120 cases per CI run) and on concave prisms (`concave.test.ts`: L-, U- and star-shaped caps, 300 cases; 8,000 locally found nothing). |
| M6A-B5-2 | **Refusal codes beyond §6.1**: `bevel.no-selection` (poll: no visible edge or face), `bevel.too-wide` (Clamp off and a width past the next vertex, or one that folds faces over). `bevel.zero-width` is also reachable through the fraction path: **Roundness 1 with an even segment count** puts the middle profile point of every strip at the original corner, so a corner with two or more bevelled edges would get coincident vertices; the refusal says "(Roundness 1 meets at the corner)". | §6.1 lists `non-manifold`, `border-edge`, `zero-width`; a refusal with a reason beats coincident vertices (P1, the clamp property). |
| M6A-B5-3 | **Construction** (research 10 §4.3): a bevelled vertex's face fan classifies its edges (selected, *slide*: unselected sharing a face corner with a selected edge, *middle*: the rest). Slides split their edges (§5.2 split rules and H4 through `splitEdgeMakeVert`); a face whose two edges at the vertex are selected gets a *miter* point along the bisector — `x + d·(â + b̂)` at a convex corner, **`x − d·(â + b̂)` at a reflex one** (`(â × b̂)·n < 0` with â leaving and b̂ entering the corner in the face's winding, n its Newell normal: the meet of the strips' inward offset lines, so a concave n-gon is bevelled inside itself); runs of middle edges keep the vertex (one run) or get a vertex each moved along the run's mean direction (several runs). One selected edge: the strip's end runs through the rest of the cycle, so the opposite face gains a corner (cube 10/15/7); two selected edges with a two-token cycle share their end; otherwise a corner polygon (`segments` 1 or two selected edges) or a fan around a centre vertex (`segments` > 1 and three or more selected edges, `bevel.fan-corner`). The fan centre is the mean of the boundary points pushed along the vertex normal by Roundness × the mean bulge of the chords (none for a chamfer). | §5.9's valence rules; the general fan covers vertices with mixed selected and unselected edges. |
| M6A-B5-4 | **An in-line vertex at a strip's end stays** (a vertex whose unselected edges continue past the bevel, e.g. a partial chamfer on a subdivided box): with `segments` 1 the strip runs A → x → B there, with more segments the rows converge on x. On a fold that strip is a **non-planar n-gon**, and Mesh Check says so (`nonplanar-ngon`, often `ngon-degenerate`); Cleanup › Triangulate fixes it. | The alternative (a triangle cap) changes the counts by geometry; Mesh Check reporting the truth is the spec's design. `test/check` asserts both: clean results where every bevelled vertex is split, a report for the partial chamfer. |
| M6A-B5-5 | **Hardness** (§5.3): strip rows H2; the edges bounding the bevel faces hard with Harden Borders, else H2; fan spokes H1 over the fan (hard iff every rim edge of the fan is hard); the edges of a moved run vertex copy the flags and edge layers of the edge they replace. P7-hard holds for every segment count and profile. | §5.3 H1/H2/H4. |
| M6A-B5-6 | **Corner values of bevel faces**: rebuilt faces keep their corners (miter points blend the corner and the two far ends — a reflex miter with the weights `1 + tₐ + t_b, −tₐ, −t_b`, which extrapolates the face's affine map so a planar projection stays exact; its point layers copy the vertex's, since extrapolated skin or group weights would leave their range — profile points interpolate the face's own corners); strips take side A's values from the first face and side B's from the second; a profile point takes the value the rebuilt face across the strip's end has there, and a point two strips share keeps one value. Where the sides are continuous this is the plain interpolation; **across a UV seam** the jump stays on the seam (a strip across a seam takes one side's value where it touches it). The property "every uv0 jump after a bevel on or near the sphere's and cylinder's seams lies on the wrap or touches an edge that already jumped" checks it. Material, flags and face layers: rebuilt faces keep theirs, a strip takes its first face's, a corner polygon or fan the smallest-index face around its vertex. | §5.2 "lerp along the edge, per face side (keeps seams)"; the strip's interior values are not specified. |
| M6A-B5-7 | **Symmetry**: bevel and the projections expand the selection themselves (idempotent with the runtime's expansion) and warn `symmetry.unmatched-partner` with the lonely components, through local helpers (`ops/bevel/symmetry.ts`) because B2's `expandSelection` was a stub when B5 started. INT may switch them to B2's `expandSelection`/`selectionUnmatchedWarning` (same semantics). **Post-op symmetrization** (fix round 1): a region of selected edges that is its own mirror (it holds an edge's partner) gets its new vertices symmetrized — each with the vertex of its *partner token* (the token made from the partner edge, face and vertex; runs are keyed by their smallest edge), set to the mean of p and S·p(partner), a seam token projected onto the plane. A region whose mirror is another region keeps its positions. The mirror is B2's `MirrorSpace` (Object: the axis plane at `map.plane`; World: the world axis plane through the origin, mapped by `ctx.placement`), written locally (`mirrorOf`, `symmetrizeVertices`) so INT can swap in B2's helpers. On exactly symmetric input this changes positions by float noise only (≤ 1e-12 m: seam points land exactly on the plane); on a mesh symmetric within tolerance the region comes out exact (tested). P10 holds within 1e-6 on the stand-in map and on **B2's real maps** — verified by grafting `m6a/mesh-select`'s `src/symmetry/**` into this tree (every B5 test green, the two `READY.b2` cases included, plus a World-mode P10 with a rotated, non-uniformly scaled placement: 150 cases, and a perturbed self-mirror region exact within 1e-7; then reverted). | §5.14 bevel row ("processed once …, then its vertices are symmetrized"). |
| M6A-B5-8 | **Mesh Check details**: vertices of a non-manifold edge are reported only as that code; a face vertex with a wire edge is a `non-manifold-vertex` (its fan is not one clean disc); `lamina` lists every face of a group over the same vertex set except the smallest index (what the fix deletes); `zero-area-face` by height (2 × area / longest edge) or longest edge ≤ 1e-6 × the bounds diagonal; `nonplanar-ngon` when the farthest corner from the Newell plane through the centroid exceeds 1 % of the face's bounding diagonal; `concave-ngon` when a corner turns against the Newell normal by more than 1e-6 × the mesh diagonal (distance from the line through its neighbours, so a chamfer's straight runs stored in float32 are not reflex); quads are never n-gons; `stray-vertex` = valence 2 with edges within 1° of straight. | §5.25 gives one line per code; the thresholds are scale-relative so a fixture reports the same at 1e-4 and 1e4 scale (tested). |
| M6A-B5-9 | **Cleanup fixes**: `deleteLamina` deletes the larger-index faces; `collapse` joins a **cap** (zero-area face without a zero-length edge: its corners on one line) into the face across its longest edge — nothing moves, the neighbour keeps its material, flags and face layers — and merges zero-length edges (and a cap that cannot join, by its shortest edge) into centroids (point layers averaged, each face keeps its corners, H3), then removes the edges and vertices the merge left unused (§5.1 orphan cleanup; loose geometry that was already there stays for `deleteLoose`); `conform` makes each edge-connected component wind one way, outward for closed components (even when that reverses the majority), the majority's way otherwise; `triangulate` splits flagged n-gons along the one triangulation (H1); `dissolve` joins the edges of stray vertices (H3); `deleteLoose` deletes wire edges, then vertices left without edges. Hidden elements are neither reported nor fixed. | §5.25 says "collapse": merging a cap's three corners would pull far-apart vertices together. |
| M6A-B5-10 | **Projection conventions**: u right, v up seen from outside (`u × v` = the plane's outward normal), 1 UV unit = 1 m before the fit; box planes by the Newell normal's dominant axis (ties x, y, z), charts = edge-connected faces on the same plane; cylindrical around the local axis through the faces' bounding-box centre, wrap on −Z (−Y for the z axis), u in metres of arc at the mean radius, each face's corners on the branch nearest its centre's angle. Unfitted, box mapping of the unit cube is exactly the cube primitive's layout less ½, planar Y with the fit is the plane primitive's, and cylindrical u matches the cylinder band's — three independent cross-checks. | §5.28 fixes the wrap and charts; the primitives' UV conventions (M6A-B1-8) fix the orientation. |
| M6A-B5-11 | **Fit packs the charts**: several charts are laid out on shelves (tallest first, a gap of 2 % of the largest extent, rows about √(total area) wide), then one uniform scale makes the layout's larger side 1; one chart starts at (0, 0). Every chart keeps its aspect and relative size, all values lie in 0–1, and no two charts overlap (property-tested). | §5.28 "scale charts uniformly into 0–1 keeping aspect"; stacking every box chart at the origin would overlap them, unlike Maya's Automatic Mapping. |
| M6A-B5-12 | **Seams**: an edge with two or more faces gets `EDGE_SEAM` when its faces are in different charts, one is outside the run, or the values differ across it (the cylinder wrap); an edge inside one continuous chart loses it; border edges keep their flags. Hardness never changes. | §5.28 "set EDGE_SEAM on chart borders" plus clearing seams a new continuous chart covers. |
| M6A-B5-13 | **READY probes live in `test/ops/bevel/ready.ts`** (`b2`: `buildSymmetryMap` not `not-implemented`), not `test/ready.ts`: B2 and B4 each add their own `test/ready.ts` on their branches, and `test/ready.ts` is in no package's Dirs. INT folds the probes together. | §3 rule 4; avoids a three-way conflict on a file nobody owns. |
| M6A-B5-14 | **Literal update** (§3 rule 9, commit `60b681a`): `test/descriptors.test.ts` keeps asserting `not-implemented` for every op stub except the five B5 landed (`LANDED`), which must no longer refuse it. B0a's `src/stubs/check.ts` is deleted with the barrel's B5 line pointing at `src/check`. | The B0a stub test would otherwise fail by design; §3 rule 2 (only the stub line changes). |

## Bugs the properties found (fixed before handing over)

- The clamp did not see **coincident vertices** around a corner (Roundness 1 with even segments): three vertices at
  one point, which `validateMesh` cannot see (topology only). Now part of the λ search (M6A-B5-1/2).
- **Strip records of profile points** were interpolated in the end's orientation, not the chord's: on a flat grid the
  strip and the rebuilt face disagreed at the profile point (uv0 continuity property). Then, on UV seams, the strip's
  ends jumped away from any seam (seam property): fixed by M6A-B5-6.
- **Quadratic bevel**: the strip records and fan centres scanned every new polygon per strip; all 20k edges of a
  20k-triangle sphere with 2 segments took 30 s, now 1.2 s.
- `concave-ngon` flagged the straight runs a chamfer leaves on a face (float32 midpoints); now distance-based
  (M6A-B5-8).
- Fix round 1: with the reflex miter fixed, the concave-prism property found a **reflex miter crossing a thin arm**
  (L arms 0.25 thick, fraction 0.8: the miter reached the far corner, the cap stayed positively oriented); the clamp
  now keeps rebuilt faces simple (M6A-B5-1).

## Fix round 1 (review findings)

| Finding | Resolution |
|---|---|
| **Major — reflex miters** (§5.9 valence 2): at a face corner over 180° with both edges selected, `x + d·(â + b̂)` lay in the notch; an L-prism cap grew, its strip twisted and a convex bevel added material. | Reflex corners miter at `x − d·(â + b̂)` (M6A-B5-3), corner values extrapolate affinely (M6A-B5-6), and the clamp keeps rebuilt faces simple, which a reflex miter past a thin arm broke next (M6A-B5-1). `test/ops/bevel/concave.test.ts`: the reported L case (cap corner at (0.75, 0.75, 1), strips on y + z = 1.75 and x + z = 1.75, volume down), every L edge, face mode on the L cap (24/42/20), uv0 at the miter, the thin arm, and properties over L/U/star prisms: convex-only bevels never add material and keep rebuilt faces inside their originals, concave-only bevels never remove material, one-width chamfer rows on rectilinear prisms are planar. |
| Minor — the clamp and P1–P4 never saw a reflex corner. | The concave-prism properties above (300 + 80 + 150 cases per run). |
| Minor — `collapse` left wire edges and vertices when every face of a component collapsed. | `mergeGroups` removes the edges and vertices its merge leaves unused (M6A-B5-9); the repro is a test, a second one keeps loose geometry that was already there, and the soup property asserts a collapse never adds loose geometry. |
| Minor — no post-op symmetrization (§5.14). | Implemented (M6A-B5-7); a test on a mesh symmetric within tolerance. |

Two spec-conforming behaviours the concave properties exclude, worth an owner look: **the valence-1 slide rule at a
reflex corner** (§5.9 "new vertices on the neighbouring edges") slides along an edge that leaves the strip's face, so
the face across the strip's end grows into the notch (Blender's terminal-edge bevel does the same); the properties keep
every reflex corner with both or neither of its edges selected. **Roundness above 0.5** puts the profile's control
point `C′ = M + 2·roundness·(C − M)` past the original corner, so a profile leaves the original faces near its ends;
the material and inside checks run for chamfers and Roundness ≤ 0.5.

## Gates (local, real Chrome; port 3166)

On the code of `f3e494e` (the notes commits change no code), CI unset: `format:check`, `lint`, `typecheck`, `check:deps`
(15 packages), `check:fixtures`, `check:licenses` (176) green; `test` 15/15 green (turbo, `--concurrency=4`):
anim-core 671, doc 233, doc-yjs 78, ui 87, rig 202, **mesh-core 455 + 2 skipped** (the two `READY.b2` cases; Node and
Chromium, the B5 Chromium file 5), mesh-view 2, io 170, editor-core 793, headless-tests 173, viewport 100 + 1 skipped,
curve-editor 207 + 3 skipped, editor 359 + 1 skipped, web 10, tooling. The production build (inside the e2e run) and
`check:size` green: **865,792 B** (≤ 900,000 B), the `mesh-kernel` boundary holds (kernel chunk 44.3 kB, lazy). The
full e2e suite (`EKZA_E2E_PORT=3166`, `--workers=4`): chrome 109 passed, 10 skipped (the stretch and other packages'
`test.fixme` gates), rc 0. B5 owns no e2e spec (§10.1).

## Performance (report only; Node 25.6, Apple M4 Pro; debug validation off)

| Case | Time (best of 3) |
|---|---|
| Bevel 200 scattered edges, 2 segments, of a sphere with 512 / 2,048 / 10,100 faces (the last 20k triangles) | 18 / 24 / 27 ms |
| Bevel every edge (992 / 4,032 / 20,100) of those spheres, 1 segment | 37 / 114 / 512 ms |
| The same, 2 segments (the last: 130k faces out) | 67 / 253 / 1,314 ms |
| `checkMesh` on the 512 / 2,048 / 10,100-face spheres; on the 130k-face bevel result | 3 / 3 / 18 ms; 264 ms |
| `mesh.uv.box` on the 10,100-face sphere | 14–23 ms |

Times are the op's `run` without the commit (`end()`), which the kernel owns. Fix round 1's simple-face check in the
clamp costs 2–10 % on every-edge bevels (same-session before/after, 10,100-face sphere: 396 → 406 ms with 1 segment,
938 → 1,026 ms with 2).
No §5.27 budget names a B5 op (the "typical topology op ≤ 16 ms" is B3's extrude/loop bench); `checkMesh` runs on
demand in B10's panel.

## Open for the integration agent

- M6A-B5-13: fold `test/ops/bevel/ready.ts` into the merged `test/ready.ts` (or keep it).
- M6A-B5-7: optionally replace `ops/bevel/symmetry.ts` with B2's helpers once both are merged (`expandSelection`,
  `selectionUnmatchedWarning`, `mirrorSpaceOf` + `symmetrizeVertices`; same semantics).
- Known limits worth an owner look: bevel strips across a UV seam stretch over the seam (M6A-B5-6), partial chamfers on
  folds leave non-planar strips (M6A-B5-4), cylindrical mapping of caps around their own axis is a disc squashed into
  a band, the valence-1 slide at a reflex corner and Roundness above 0.5 (fix round 1 above). No `adjust` fast path (§4.3 optional): every card edit re-runs the op.
