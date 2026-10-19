# M6a B6 — mesh-view: overlays and picking: build notes

Branch `m6a/mesh-view` (from `m6a/spec` with `m6a/contracts-foundation` merged). Scope:
[M6A-SPEC §9 B6](../M6A-SPEC.md#b6--mesh-view-overlays-and-picking) with the §4.4 contract, §4.7's `addMeshLayer`
hosting, §5.6 (picking, hilite, mirrored selection, hide/isolate), §5.27 (B6 budget rows) and §8.9 (tokens). Decision
IDs below are `M6A-B6-<n>` for DECISIONS-OPEN §H.

## Status

Built and tested. B1 (`m6a/mesh-kernel`) has not merged, so everything runs on B0a's reference kernel
(`editMeshFrom`, `triangulate`, `computeNormals`, `primitive('cube' | 'plane' | 'cylinder')`); mesh-view uses only the
§4.3 public API (no reference internals), so the B1 barrel switch needs no change here and no `READY.b1` gate (the
tests build meshes with `primitive`, which B1 keeps). No E2E-MOD scenario belongs to B6 (§10.1); the browser bench
`apps/web/e2e/bench/m6a-mesh-view.bench.ts` is `test.fixme('b7, b9, b10: …')` until mesh creation, the Model
workspace with `addMeshLayer`, and component modes exist. Nothing loads the display yet: B9 (manager) or B10 (modes)
calls `loadMeshDisplay` (see [Hand-over](#hand-over-to-b9-b10-int)).

## What landed (by spec responsibility)

| B6 item | Where |
|---|---|
| `EditMeshView` draw list (research 13 K-8, §7.1): per-corner surface with a `state` byte, edges (1 px wire, 2 px hard, 3 px selected/hovered/mirrored), vertex squares at constant pixel size, face-centre dots, face and vertex normals, face orientation, triangulation diagonals, hard edges, Mesh Check markers, symmetry plane, soft ramp | `mesh-view/src/EditMeshView.ts`, `internal/{base,surface,lines,glyphs,shaders}.ts` |
| Halo rule (§8.9: 1 px `--comp-halo` around every glyph and overlay line) | line and glyph shaders (`internal/shaders.ts`); a line drawn in the halo colour itself (the plain wire) gets none |
| X-ray two-pass, occlusion | surfaces push back with a polygon offset; x-ray (and dimmed) surfaces draw at reduced opacity over a depth pre-pass, overlays draw an occluded pass (`GreaterDepth`, 35 %) then the visible pass |
| Incremental uploads | `internal/ranges.ts` (`addUpdateRange`, merged ranges, whole uploads as one range); `EditMeshView.update` touches only moved vertices' corners, incident edges, faces around them and the one-ring of normals |
| Per-pane `applyPane`, hidden and isolated elements, "Dim unhilited" | `applyPane` sets uniforms, materials, layers and visibility before each pane; `internal/topo.ts` `deriveVisibility` (shared with the picker) |
| `MeshSurface` (props, non-component display) | `mesh-view/src/MeshSurface.ts` (stored form, no edit links) |
| `ComponentPicker` (hover, click, marquee with occlusion, back faces, BVH refit/rebuild deferred) | `mesh-view/src/ComponentPicker.ts` (three-mesh-bvh, indirect mode) |
| Tokens → theme | `mesh-view/src/theme.ts` (`readMeshViewTheme(element)`, tokens.json fallbacks, checked against `packages/ui/tokens.json`) |
| Mirrored partners at 60 %, hover partner (§5.6) | `setState(…, mirrored)`, `mesh-view/src/mirror.ts` (`mirroredOf`, `partnerOf` over `SymmetryMap`) |
| Lazy loading of mesh-view and three-mesh-bvh from `viewport/src/mesh/**` with the marker (§2) | `viewport/src/mesh/index.ts` (`loadMeshView`, `loadMeshDisplay`, `meshPaneDisplay`), `display.ts`, `layers.ts`, `world.ts` |
| Tests (browser mode, real Chrome) | `mesh-view/test/{view,picker,topo,theme,skeleton,bench}.test.ts`, `viewport/test/m6a-mesh-display.test.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B6-1 | **Additive API beyond §4.4** (the §4.4 classes and signatures are unchanged): `EditMeshView.setIsolate(faces)` and `mode`; `MeshSurface.current`/`colours`; `ComponentPicker.screenOf(camera, viewport, kind, index, opts, t?)`, `isVisible`, `prepareBvh` (the idle hook), `bvhReady`; exports `mirroredOf`, `partnerOf`, `emptySelection`, `PICK_RADIUS`, `NGON_CODES`, `MESH_VIEW_STYLE`, `DEFAULT_MESH_VIEW_THEME`, `MESH_VIEW_TOKENS`, `MESH_VIEW_SOFT_TOKENS`, `readMeshViewTheme`, `parseHexColour`, `VIEW_MARKER`. | §9 B6 asks for isolated elements to be skipped and §4.8 for `screenOf*` (B10) and an idle BVH build (§4.4 comment); none has a §4.4 signature. |
| M6A-B6-2 | **`--clay`**: `MeshViewTheme` has no clay field; the constructors accept `MeshViewThemeInput` = `MeshViewTheme & { clay?: number }` (a wider type, so every contract theme is valid) and fall back to the `--clay` token value. Contract PR suggestion: add `readonly clay: number` to §4.4 `MeshViewTheme`. | §4.7 draws `shaded` "a neutral clay" and §8.9 has `--clay`, but the frozen theme cannot carry it. |
| M6A-B6-3 | **Shadings**: `wire` = no surface, edges in `--wire-wiremode`; `shaded` = clay; `colours` = the palette colour of each face's `paint` slot (`setPaint`, sRGB 8-bit), clay for slots without a colour; `lit` = the same palette colours (mesh-view has no glTF materials; a character's own materials are the ModelLoader display outside Model, §5.23). All under one soft clay rig in view space (`LIGHT_RIG`: ambient 0.4, key 0.5, fill 0.15; back faces × 0.7), independent of the scene lights so pixel probes are exact. `flat` takes each drawn triangle's plane from screen-space derivatives (a non-planar quad shows its two triangles, which is what export ships). | §4.7 names the four modes; pixel-exact tests need a fixed rig. |
| M6A-B6-4 | **"60 % of `--comp-selected`"** = 60 % of the way from the component's unselected look to `--comp-selected` (linear light), i.e. the selected colour at 60 % opacity over the element's own glyph; face tints use 0.6 × the selected tint. Mirrored glyphs use the hot size like selected ones. | §5.6 / §4.4 comment; deterministic for pixel probes (no blending with whatever lies behind). |
| M6A-B6-5 | **Mode-dependent glyphs**: `setState`'s `sel.kind` is the component mode. Vertex mode draws vertices; edge mode highlights edges; face mode draws face dots and face tints; the other kinds' bitsets (per-mode memory) are not drawn. Edges are always drawn as wire in component mode; selected/hovered state only for the current kind. | §5.6 per-mode memory; Maya's display. |
| M6A-B6-6 | **Visibility rule** (one function for drawing and picking): a face is visible unless hidden (or outside the face isolate set); an edge unless hidden and, when it has faces, while one of them is visible; a vertex likewise through its edges. Hiding faces therefore takes the edges and vertices only they use along (Maya); a `HiddenSet` that already lists them changes nothing. Hidden faces neither draw nor occlude nor pick (the BVH holds visible triangles only). | §5.6 "not drawn, not pickable"; the HiddenSet B10 writes may list faces only. |
| M6A-B6-7 | **Picking**: vertex = nearest projected vertex within 8 px, ties by NDC depth then index; edge = nearest projected segment within 6 px, `t` from the closest approach between the pick ray and the edge (exact under perspective), `point` on the edge; face, camera-based: the first ray hit, `null` when it is a back face without `backfaces`; face, camera-based off (wire, x-ray): the nearest face-centre dot within 8 px first, else the first ray hit of either side. Occlusion: the element is visible when no visible triangle is hit before 0.9999 × its distance, or the hit face contains it. Marquee: vertices and face dots by their projected point, edges with both endpoints inside (Maya) and an unoccluded midpoint, faces also front-facing unless `backfaces`. Elements behind the camera (or beyond the far plane) are not pickable; an edge with one endpoint behind the camera is not pickable either (no screen-space near clipping). | §5.6, research 13 §7.2. |
| M6A-B6-8 | **BVH maintenance**: built in indirect mode (the triangle order stays the triangulation's), refit after position commits (`setMesh(…, false)`; triangles whose quad diagonal flipped are rewritten first), rebuilt after topology commits and hidden-set changes; both deferred to the first pick or `prepareBvh()`. | §4.4 comment. |
| M6A-B6-9 | **Transparent surfaces** (x-ray and "Dim unhilited") draw their nearest layer only: a depth-only pre-pass (after the opaque objects) keeps the mesh's own back layers out and gives the x-ray occluded pass its depth. Transparent objects drawn later behind such a surface (another dimmed mesh, a character in x-ray) are hidden by the pre-pass. | A plain transparent double-sided surface blends its back layers and reads brighter than 35 %/50 % of itself. |
| M6A-B6-10 | **Mesh Check markers**: ◇ `--lint-ngon` for `nonplanar-ngon`, `concave-ngon`, `ngon-degenerate`; ✕ `--lint-error` for every other code; at face centroids, edge midpoints, vertices or corners by the problem's `domain` (inferred from the code when absent); drawn without depth test, only in panes with `meshCheck`. | §5.25 names the two glyphs, not the code split. |
| M6A-B6-11 | **Sizes** (`MESH_VIEW_STYLE`): vertices 5 px (7 px selected/hovered/mirrored), face dots 5/7 px, wire 1 px, hard 2 px, selected/hovered edges 3 px, normals 0.4 × the mean edge length, symmetry plane 12 % fill across the bounds + 15 % margin, markers 11 px. | Not in the spec; research 16 §10.3 sets colours and the halo only. |
| M6A-B6-12 | **Layers**: `MESH_LAYERS` = surface on `LAYER.mesh` (1), components 6, normals 7, lint 8, helpers 9 — §4.7's values, kept in `viewport/src/mesh/layers.ts` until B9 lands them in `layers.ts` (B9's file). Edges move to the surface layer in panes without component overlays, so wire on shaded follows the mesh layer. | §9.1: `layers.ts` is B9's. |
| M6A-B6-13 | **Hosting**: `MeshDisplay` (lazy, `viewport/src/mesh/display.ts`) keeps one host per ready runtime and registers it through a `MeshLayerTarget` (`addMeshLayer` + `invalidate`), the shape of §4.7's `ViewportManager.addMeshLayer`; `MeshLayerHost` is declared there with the §4.7 shape (INT keeps one declaration if B9 adds its own). Outside component mode, and for meshes outside the hilite set, it shows `MeshSurface`; hilited open meshes in a component mode get an `EditMeshView` and a `ComponentPicker`. It follows runtime events, the selection service, the session (mode, hilite, symmetry, hidden objects, per-pane isolate) and the document (placements through groups, palettes); a pane render resyncs a host whose runtime was opened or changed without an event (`open` emits none). "Dim unhilited" applies only while a component mode is active. Face-mode isolate is pushed per pane (`setFaceIsolate`); hover, soft weights and lints are pushed by their owners. `pick`/`marquee` run across hilited meshes (vertices/edges by screen distance then depth, faces by the nearest hit). | §4.7 "B6 registers mesh layers through addMeshLayer"; §5.23 "props display through MeshSurface in every workspace". |
| M6A-B6-14 | **World placement**: a record's placement composed with its parents (groups or meshes of the same owner, cut at a missing, cross-owner or cyclic parent) and, for character-owned meshes, the root from `characterWorld` (identity when absent). `pivot` does not enter the matrix (it is a manipulator pivot, §5.15). | §4.2 `placement`/`parent`. |
| M6A-B6-15 | **Symmetry plane**: from the runtime's `SymmetryMap` (`axis`, `plane` in mesh-local units) when there is one, else the mode's axis at 0. | §4.3 `SymmetryMap.plane`. |
| M6A-B6-16 | **Skinned meshes** draw their stored positions (bind pose), no skinning. | §5.23 "in Model, skinned meshes render in bind pose through mesh-view". |
| M6A-B6-17 | **three-mesh-bvh stays 0.9.15** (M6A-B0A-1): 0.9.16 is still inside the 14-day `minimumReleaseAge` on 2026-10-19; manifests are the integration agent's. | §2, §9.1. |
| M6A-B6-18 | **Idle**: the views and the display never schedule a frame; every change calls `target.invalidate()` once. A test spies on `requestAnimationFrame`. | §5.27 idle gate. |

## Budgets (report-only, §5.27)

`packages/mesh-view/test/bench.test.ts`, local Chrome (GPU), Apple M-series, 1200 × 800 canvas, DPR 1, a wavy
158 × 158 quad grid = **49,928 triangles** (25,281 vertices), run on its own:

| Budget | Measured | Note |
|---|---|---|
| Enter component mode, 50k tris ≤ 40 ms | **51.7 ms** median of 5: kernel 21.8 ms (B0a reference `editMeshFrom` + `triangulate` + `computeNormals`), overlays + first frame incl. GPU upload and a read-back 19.1 ms, BVH 8.8 ms | mesh-view's share 27.9 ms; with research 13 §8.1's kernel figures (adjacency 1.8, normals 2.9, triangulation 0.6 ms) the total is ≈ 33 ms. Re-measure after B1. |
| Hover ≤ 0.5 ms | vertex mean 0.036 / p95 0.10 ms; edge 0.15 / 0.20 ms; face 0.002 / < 0.1 ms; after a camera move (re-projection) median 0.10, p95 0.20 ms | 1,000 picks per kind |
| Marquee 10k vertices with occlusion ≤ 16 ms | 15,262 vertices: first 11.8 ms, median 10.9 ms | ≈ 7.5 ms per 10k |
| Idle 0 frames | 0 by construction (no frame requests) | the editor-level check is the gated bench and E2E-MOD-16 (INT) |

Changes made for the budget: the surface's per-corner face-normal attribute was dropped (flat via derivatives), the
vertex maps are built without per-element callbacks, and ranges are added only to attributes already on the GPU
(three keeps the ranges of a fresh attribute and would turn the next partial upload into a whole one).

## Hand-over to B9, B10, INT

- **B9**: `ViewportManager.addMeshLayer(host)` is the `MeshLayerTarget` with `invalidate()`; call
  `host.applyPane(meshPaneDisplay(pane.display), pane.id)` before each pane render (`meshPaneDisplay` maps
  `DisplayFlags`, `dimmed` = the pane's `dimUnhilited`). Hide the components layer per `DisplayFlags.components` if
  you like; mesh-view also hides its glyphs itself. Land `LAYER.meshComponents … helpers` = 6…9 (M6A-B6-12).
- **B10**: `const display = await loadMeshDisplay({ app, target: vm, theme: canvas })` once per viewport; open the
  hilited runtimes on entering a mode (the display follows); `display.pick(camera, ndc, viewport, kind, opts)` for
  hover and click, `display.marquee(…)`, `display.picker(mesh)?.screenOf(…)` for `screenOfVertex/Edge/Face`,
  `display.setHover`, `display.setLints`, `display.setFaceIsolate`. Camera-based `auto` = on in shaded/colours/lit,
  off in wire and x-ray (§5.6) is the caller's `cameraBased`.
- **B12a**: `display.setSoftWeights(mesh, weights)` during soft drags; runtime `changed` events with a `DirtySet`
  update the view incrementally (`EditMeshView.update`).
- **INT**: turn on the bench's `test.fixme('b7, b9, b10')`; re-measure the enter-component-mode row with B1.

## Shared files and other packages' paths

- `packages/viewport/src/index.ts` (no §9.1 owner): additive exports of the hosting API.
- `packages/viewport/test/m6a-mesh-display.test.ts`: a new file next to B9's viewport tests.
- `packages/mesh-view/test/skeleton.test.ts`: B0a's case "refuses to build views and pickers until B6 lands them"
  became "builds views and pickers (B6) and disposes them twice without error" (literal update, §4.4).
- Not touched: `packages/mesh-view/package.json`, `vitest.config.ts` (its `optimizeDeps` lists `earcut`, which
  mesh-view does not depend on; Vite prints "Failed to resolve dependency: earcut" once, harmless).

## Gates (local, real Chrome; port 3167)

Final run on the branch head: `format:check`, `lint`, `typecheck`, `check:deps` green; `test` green with
`--concurrency=2` (15 of 15 tasks; mesh-view 6 files / 52 tests, viewport 13 files / 107 tests + 1 skipped, every
other package unchanged). A first `test` run at turbo's default concurrency timed out in the editor's browser tests
(and headless-tests) while every browser suite ran at once on the shared machine; both suites are green on their own
and in the final run. `build` green; `check:size` 864,427 B ≤ 900,000 B, unchanged from B0a (the hosting exports are
tree-shaken until a consumer loads them; the `mesh-view` boundary reports no marker anywhere, the kernel boundary is
lazy as before). E2E: the full suite (`EKZA_E2E_PORT=3167 pnpm run test:e2e`, chrome project) **109 passed,
10 skipped** (the shipped stretch and gated `test.fixme` cases); B6 has no E2E-MOD scenario, and its browser bench
(`apps/web/e2e/bench/m6a-mesh-view.bench.ts`) is listed by the bench config as `test.fixme('b7, b9, b10: …')`.
