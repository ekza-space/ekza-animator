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

**Fix round 1** (review of the first build): incremental corner normals after edge-flag and corner edits
(M6A-B6-21), picking per pane through the display (hidden objects, object isolate, face isolate; M6A-B6-13), character
meshes hosted only in Model (M6A-B6-13), inputs compared by content and sets of another topology dropped
(M6A-B6-19), the picker module's size marker, the linear-scan deviation recorded (M6A-B6-20), stronger tests (an
incremental-equals-rebuild property test over arrays and pixels, x-ray for edges and face dots, depth order with the
candidate behind, isolate and hidden objects in picking) and the bench selecting a face before its idle check.

**Fix round 2** (second review): camera-based picks are occluded by the other meshes a pane draws, hilited or not
(M6A-B6-22; it was the one DoD blocker: a component behind another mesh could be hovered, clicked and
marquee-selected); back faces follow `backfaces` alone in every shading and wire shading picks faces by their dot only
(M6A-B6-7); a World symmetry mode without a partner map draws the world plane (M6A-B6-15); `setHover` requests a frame
only on a change and `EditMeshView.update` no longer allocates per call (M6A-B6-24); the cost of panes with different
face isolate sets is measured and recorded (M6A-B6-23).

## What landed (by spec responsibility)

| B6 item | Where |
|---|---|
| `EditMeshView` draw list (research 13 K-8, §7.1): per-corner surface with a `state` byte, edges (1 px wire, 2 px hard, 3 px selected/hovered/mirrored), vertex squares at constant pixel size, face-centre dots, face and vertex normals, face orientation, triangulation diagonals, hard edges, Mesh Check markers, symmetry plane, soft ramp | `mesh-view/src/EditMeshView.ts`, `internal/{base,surface,lines,glyphs,shaders}.ts` |
| Halo rule (§8.9: 1 px `--comp-halo` around every glyph and overlay line) | line and glyph shaders (`internal/shaders.ts`); a line drawn in the halo colour itself (the plain wire) gets none |
| X-ray two-pass, occlusion | surfaces push back with a polygon offset; x-ray (and dimmed) surfaces draw at reduced opacity over a depth pre-pass, overlays draw an occluded pass (`GreaterDepth`, 35 %) then the visible pass |
| Incremental uploads | `internal/ranges.ts` (`addUpdateRange`, merged ranges, whole uploads as one range); `EditMeshView.update` touches only moved vertices' corners, incident edges, faces around them and the one-ring of normals |
| Per-pane `applyPane`, hidden and isolated elements, "Dim unhilited" | `applyPane` sets uniforms, materials, layers and visibility before each pane; `internal/topo.ts` `deriveVisibility` (shared with the picker) |
| `MeshSurface` (props, non-component display; an occluder for other meshes' picks) | `mesh-view/src/MeshSurface.ts` (stored form, no edit links; `occludes`) |
| `ComponentPicker` (hover, click, marquee with occlusion by its own mesh and the meshes around it, back faces, BVH refit/rebuild deferred, a pane's face isolate) | `mesh-view/src/ComponentPicker.ts` (three-mesh-bvh, indirect mode; `setOccluder`, `occludes`), `internal/occluder.ts` |
| Tokens → theme | `mesh-view/src/theme.ts` (`readMeshViewTheme(element)`, tokens.json fallbacks, checked against `packages/ui/tokens.json`) |
| Mirrored partners at 60 %, hover partner (§5.6) | `setState(…, mirrored)`, `mesh-view/src/mirror.ts` (`mirroredOf`, `partnerOf` over `SymmetryMap`) |
| Lazy loading of mesh-view and three-mesh-bvh from `viewport/src/mesh/**` with the marker (§2; the entry and the picker module both name it) | `viewport/src/mesh/index.ts` (`loadMeshView`, `loadMeshDisplay`, `meshPaneDisplay`), `display.ts`, `layers.ts`, `world.ts` |
| Hosting per workspace (§5.23) and picking per pane (§5.6), occluded by every other mesh the pane draws | `viewport/src/mesh/display.ts` (`MeshDisplay.pick/marquee/screenOf(…, paneId)`, `PaneOccluders`) |
| Tests (browser mode, real Chrome) | `mesh-view/test/{view,picker,topo,theme,skeleton,bench}.test.ts`, `viewport/test/m6a-mesh-display.test.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B6-1 | **Additive API beyond §4.4** (the §4.4 classes and signatures are unchanged): `EditMeshView.setIsolate(faces)` and `mode`; `MeshSurface.current`/`colours`; `ComponentPicker.screenOf(camera, viewport, kind, index, opts, t?)`, `setIsolate(faces)` (a pane's face isolate, the rule `EditMeshView.setIsolate` draws with), `isVisible`, `prepareBvh` (the idle hook), `bvhReady`, the static `marker`, `setOccluder(occluder)` and `occludes(from, to)` (M6A-B6-22); `MeshSurface.occludes(from, to)`; the picker's queries take `PickOptionsInput` = §4.4 `PickOptions` & `{ wire?: boolean }` (a wider type: every contract options object is valid; M6A-B6-7); exports `mirroredOf`, `partnerOf`, `emptySelection`, `PICK_RADIUS`, `NGON_CODES`, `MESH_VIEW_STYLE`, `DEFAULT_MESH_VIEW_THEME`, `MESH_VIEW_TOKENS`, `MESH_VIEW_SOFT_TOKENS`, `readMeshViewTheme`, `parseHexColour`, `VIEW_MARKER`, the types `PickOccluder` and `PickOptionsInput`. Contract PR suggestion: add `readonly wire?: boolean` to §4.4 `PickOptions`. | §9 B6 asks for isolated elements to be skipped and §4.8 for `screenOf*` (B10) and an idle BVH build (§4.4 comment); none has a §4.4 signature. §5.6's wireframe dot rule needs to know the pane draws no surface, which the frozen `PickOptions` cannot say. |
| M6A-B6-2 | **`--clay`**: `MeshViewTheme` has no clay field; the constructors accept `MeshViewThemeInput` = `MeshViewTheme & { clay?: number }` (a wider type, so every contract theme is valid) and fall back to the `--clay` token value. Contract PR suggestion: add `readonly clay: number` to §4.4 `MeshViewTheme`. | §4.7 draws `shaded` "a neutral clay" and §8.9 has `--clay`, but the frozen theme cannot carry it. |
| M6A-B6-3 | **Shadings**: `wire` = no surface, edges in `--wire-wiremode`; `shaded` = clay; `colours` = the palette colour of each face's `paint` slot (`setPaint`, sRGB 8-bit), clay for slots without a colour; `lit` = the same palette colours (mesh-view has no glTF materials; a character's own materials are the ModelLoader display outside Model, §5.23). All under one soft clay rig in view space (`LIGHT_RIG`: ambient 0.4, key 0.5, fill 0.15; back faces × 0.7), independent of the scene lights so pixel probes are exact. `flat` takes each drawn triangle's plane from screen-space derivatives (a non-planar quad shows its two triangles, which is what export ships). | §4.7 names the four modes; pixel-exact tests need a fixed rig. |
| M6A-B6-4 | **"60 % of `--comp-selected`"** = 60 % of the way from the component's unselected look to `--comp-selected` (linear light), i.e. the selected colour at 60 % opacity over the element's own glyph; face tints use 0.6 × the selected tint. Mirrored glyphs use the hot size like selected ones. | §5.6 / §4.4 comment; deterministic for pixel probes (no blending with whatever lies behind). |
| M6A-B6-5 | **Mode-dependent glyphs**: `setState`'s `sel.kind` is the component mode. Vertex mode draws vertices; edge mode highlights edges; face mode draws face dots and face tints; the other kinds' bitsets (per-mode memory) are not drawn. Edges are always drawn as wire in component mode; selected/hovered state only for the current kind. | §5.6 per-mode memory; Maya's display. |
| M6A-B6-6 | **Visibility rule** (one function for drawing and picking): a face is visible unless hidden (or outside the face isolate set); an edge unless hidden and, when it has faces, while one of them is visible; a vertex likewise through its edges. Hiding faces therefore takes the edges and vertices only they use along (Maya); a `HiddenSet` that already lists them changes nothing. Hidden faces neither draw nor occlude nor pick (the BVH holds visible triangles only). The picker applies the same rule with a pane's face isolate set (`setIsolate`), so what a pane does not draw it does not pick. | §5.6 "not drawn, not pickable"; the HiddenSet B10 writes may list faces only. |
| M6A-B6-7 | **Picking**: vertex = nearest projected vertex within 8 px, ties by NDC depth then index; edge = nearest projected segment within 6 px, `t` from the closest approach between the pick ray and the edge (exact under perspective), `point` on the edge; face, camera-based: the first ray hit, `null` when it is a back face without `backfaces` (it hides what lies behind it); face, `wire` (wire shading): the nearest face-centre dot within 8 px **only**; face, camera-based off without `wire` (x-ray): the nearest dot within 8 px first, else the ray. **Back faces** follow `backfaces` alone in every shading, for dots, rays, marquee and `screenOf`: the caller passes `backfaces = (xray ‖ Backfaces option) && !cull` (§5.6 "back faces are not pickable unless x-ray or `backfaces`"; research 16 §10.2: culled faces cannot be picked). Camera-based off without `backfaces`, the ray picks the first face whose front it meets (nothing occludes there). Occlusion (camera-based only): the element is visible when no visible triangle of its mesh is hit before 0.9999 × its distance, or the hit face contains it, and no other mesh the pane draws crosses that segment (M6A-B6-22). Marquee: vertices and face dots by their projected point, edges with both endpoints inside (Maya) and an unoccluded midpoint, faces also front-facing unless `backfaces`. Elements behind the camera (or beyond the far plane) are not pickable; an edge with one endpoint behind the camera is not pickable either (no screen-space near clipping). **x-ray keeps the dot first**: §5.6 names the dot for wireframe only and research 16 says whole-face picks in shaded; in x-ray the ray's first hit is always the nearest face, so the dots are how the faces behind it are clicked; a dot within 8 px therefore wins, as in wire. | §5.6, research 13 §7.2, research 16 §5.1 (face mode: "whole-face pick in shaded mode, centre dots in wireframe"). |
| M6A-B6-8 | **BVH maintenance**: built in indirect mode (the triangle order stays the triangulation's), refit after position commits (`setMesh(…, false)`; triangles whose quad diagonal flipped are rewritten first), rebuilt after topology commits and hidden-set changes; both deferred to the first pick or `prepareBvh()`. | §4.4 comment. |
| M6A-B6-9 | **Transparent surfaces** (x-ray and "Dim unhilited") draw their nearest layer only: a depth-only pre-pass (after the opaque objects) keeps the mesh's own back layers out and gives the x-ray occluded pass its depth. Transparent objects drawn later behind such a surface (another dimmed mesh, a character in x-ray) are hidden by the pre-pass. | A plain transparent double-sided surface blends its back layers and reads brighter than 35 %/50 % of itself. |
| M6A-B6-10 | **Mesh Check markers**: ◇ `--lint-ngon` for `nonplanar-ngon`, `concave-ngon`, `ngon-degenerate`; ✕ `--lint-error` for every other code; at face centroids, edge midpoints, vertices or corners by the problem's `domain` (inferred from the code when absent); drawn without depth test, only in panes with `meshCheck`. | §5.25 names the two glyphs, not the code split. |
| M6A-B6-11 | **Sizes** (`MESH_VIEW_STYLE`): vertices 5 px (7 px selected/hovered/mirrored), face dots 5/7 px, wire 1 px, hard 2 px, selected/hovered edges 3 px, normals 0.4 × the mean edge length, symmetry plane 12 % fill across the bounds + 15 % margin, markers 11 px. | Not in the spec; research 16 §10.3 sets colours and the halo only. |
| M6A-B6-12 | **Layers**: `MESH_LAYERS` = surface on `LAYER.mesh` (1), components 6, normals 7, lint 8, helpers 9 — §4.7's values, kept in `viewport/src/mesh/layers.ts` until B9 lands them in `layers.ts` (B9's file). Edges move to the surface layer in panes without component overlays, so wire on shaded follows the mesh layer. | §9.1: `layers.ts` is B9's. |
| M6A-B6-13 | **Hosting**: `MeshDisplay` (lazy, `viewport/src/mesh/display.ts`) keeps one host per ready runtime it shows (props, i.e. scene-owned meshes, in every workspace; character-owned meshes only in the Model workspace, at bind pose, so a character outside Model is drawn once, by ModelLoader on its rebuilt container; it re-syncs on workspace changes) and registers it through a `MeshLayerTarget` (`addMeshLayer` + `invalidate`), the shape of §4.7's `ViewportManager.addMeshLayer`; `MeshLayerHost` is declared there with the §4.7 shape (INT keeps one declaration if B9 adds its own). Outside component mode, and for meshes outside the hilite set, it shows `MeshSurface`; hilited open meshes in a component mode get an `EditMeshView` and a `ComponentPicker`. It follows runtime events, the selection service, the session (mode, hilite, symmetry, hidden objects, per-pane isolate) and the document (placements through groups, palettes); a pane render resyncs a host whose runtime was opened or changed without an event (`open` emits none). "Dim unhilited" applies only while a component mode is active. Face-mode isolate is pushed per pane (`setFaceIsolate`); hover, soft weights and lints are pushed by their owners. `pick`/`marquee`/`screenOf` take the pane id and run across the hilited meshes that pane draws (vertices/edges by screen distance then depth; faces camera-based by the nearest hit, otherwise by screen distance with a ray hit as 0 px, so wire's nearest dot wins across meshes; camera-based queries are occluded by every other mesh the pane draws, M6A-B6-22): hidden objects and meshes outside the pane's object isolate are skipped by the test `applyPane` uses, and the pane's face isolate set goes to each picker. | §4.7 "B6 registers mesh layers through addMeshLayer"; §5.23 "characters outside Model are displayed through one path … props display through MeshSurface in every workspace"; §5.6 hidden or undrawn components are not pickable. |
| M6A-B6-14 | **World placement**: a record's placement composed with its parents (groups or meshes of the same owner, cut at a missing, cross-owner or cyclic parent) and, for character-owned meshes, the root from `characterWorld` (identity when absent). `pivot` does not enter the matrix (it is a manipulator pivot, §5.15). | §4.2 `placement`/`parent`. |
| M6A-B6-15 | **Symmetry plane**: from the runtime's `SymmetryMap` (`axis`, `plane` in mesh-local units) when there is one. Without a map: Object X/Y/Z = the local plane through the origin (offset 0); World X/Y/Z = the world plane mapped into the mesh (`worldPlaneInLocal`: the one local axis the world coordinate depends on and the offset where it is 0, so a translated, scaled or quarter-turned mesh shows the plane at the world origin); hidden when the rotation leaves the world plane oblique to every local axis (no axis-and-offset plane exists; tolerance 1e-6 of the largest coefficient). | §4.3 `SymmetryMap.plane`; §5.14 "World: the world plane mapped into mesh-local space". B7's runtime returns no map yet. |
| M6A-B6-16 | **Skinned meshes** draw their stored positions (bind pose), no skinning. | §5.23 "in Model, skinned meshes render in bind pose through mesh-view". |
| M6A-B6-17 | **three-mesh-bvh stays 0.9.15** (M6A-B0A-1): 0.9.16 is still inside the 14-day `minimumReleaseAge` on 2026-10-19; manifests are the integration agent's. | §2, §9.1. |
| M6A-B6-18 | **Idle**: the views and the display never schedule a frame; every change calls `target.invalidate()` once, and `setHover` with an unchanged hover (B10 calls it on every pointer move) not at all. A test spies on `requestAnimationFrame`; a display test counts invalidations. | §5.27 idle gate. |
| M6A-B6-19 | **Inputs by content; other topologies dropped**: `EditMeshView.setState`/`setIsolate`, `ComponentPicker` (hidden and isolate sets) and `MeshDisplay.setFaceIsolate` keep their own copies and compare contents, so a selection, hidden set or isolate set mutated in place and passed again redraws. After a topology rebuild, a selection or mirrored selection whose sizes differ from the counts, a hidden set with a non-empty set of another size, and a face isolate set of another face count are dropped (their indices could name other elements); `setIsolate` ignores a set of another face count, and the display drops such face isolate sets on a topology commit. The owners (B10) push remapped sets after the commit. | §4.6 does not promise fresh objects; stale indices draw or pick the wrong elements. |
| M6A-B6-20 | **Deviation: no screen-space grid in the picker**. The §4.4 class comment (research 13 §7.2) names "a screen-space grid for vertices and edges"; the picker scans the projected vertices and edges linearly with bounding-box early-outs, over a projection cached per camera, viewport and mesh version. At 50k triangles that is vertex 0.04 ms, edge 0.16 ms (p95 0.3 ms) per hover on an idle machine; a reviewer's run under a parallel e2e load saw an edge p95 of 0.5 ms. A grid would make warm hovers cheaper but costs a build per camera change (bucketing every projected vertex and rasterizing every projected edge into cells, not measured here), which the first hover after an orbit pays on top of the projection the linear scan already costs. Re-measure in INT with B1 and the editor bench; add the grid (cell 16 px, edges rasterized per cell row) if the editor-level p95 exceeds the budget. | §5.27 hover ≤ 0.5 ms is met without it; report-only. |
| M6A-B6-21 | **Incremental corner normals**: `EditMeshView.update` rewrites the corner normals of every face around the vertices of the changed faces (moved points change the faces around them: one ring), of every face at both endpoints of edges whose flags changed (a hard flag splits or joins the smooth fans there) and of the faces of written corners (`normal.custom`); `edges`/`corners` = `'all'` rewrite all. The normals overlay is rebuilt on its next pane. This is a superset of what the kernel's incremental `computeNormals` recomputes, and the written values are the kernel's arrays, so the result equals a full rebuild (a property test compares every array and every pixel after random moves, flag toggles, custom normals and paint). | §4.3 `DirtySet`: flag writes log edges only, custom normals log corners only. |
| M6A-B6-22 | **Occlusion across meshes** (camera-based queries only). `MeshDisplay` collects, per query, every mesh the pane draws (`drawnIn`: not hidden, inside the pane's object isolate) except the one being queried, and hands them to the picker (`setOccluder`, cleared after the query): hilited meshes in component mode occlude through their own picker (`occludes`: visible triangles only, i.e. their hidden set and the pane's face isolate set, both sides; each is prepared for the pane on first use in the query); every other mesh through its `MeshSurface` (`occludes`: every face, both sides, the surface draws them all; dimmed meshes too, since they are drawn and their depth pre-pass hides the overlays behind them, M6A-B6-9). The picker tests a candidate's camera segment against its own BVH first, then against the occluders (world segment, 1e-4 relative margin at the candidate in each occluder's local units); a face hit is tested from the pick ray's near point to the hit. A surface builds its BVH lazily, on the first segment that reaches its bounding box (meshes off the line of sight never build one); a picker's BVH is the one it picks with. **Not occluders**: meshes the pane does not draw, characters drawn by ModelLoader (a character's glTF meshes that are not made editable, §5.21) and other scene objects (rig controls, image planes, helpers); **deferred to INT**: a `PickOccluder` over ModelLoader's meshes in Model (bind pose), added to the pane occluders, if characters stay on screen while modeling props. Panes with back-face culling still occlude with both sides (the picker cannot see `cull`; B10 passes `backfaces = false` there). Cost: see Budgets (the 15k-vertex marquee with a 50k-triangle neighbour). | §5.6 "Camera-based selection", "Marquee … selects every visible candidate"; research 10 §4.1 "a component is visible if a ray from the camera to it hits nothing closer"; Maya: "only components not hidden from the camera". |
| M6A-B6-23 | **Panes with different face isolate sets share one view and one picker**: `applyPane` switches the view's isolate set per pane (`setIsolate`: visibility re-derived, the index and every state rewritten and uploaded) and a query in another pane switches the picker's (a BVH rebuild). Measured at 50k triangles: 1.3 ms + 2.7 ms (frame with uploads) per view switch, so two switches per frame (one pane isolated, the others not) cost ≈ 8 ms per redraw at 50k (proportionally less on low-poly meshes; idle stays 0 frames); the picker's rebuild is 7.3 ms on the first query after the pointer crosses into the other pane. Kept: face isolate is a short-lived, mostly single-pane state. INT revisits with a per-pane cache (index and state attributes per isolate set, swapped instead of rewritten; a second BVH) if four-pane layouts with an isolated pane turn out common. | Review fix round 2 (performance hygiene); report-only. |
| M6A-B6-24 | **No allocation in the drag path**: `EditMeshView.update` keeps its working sets (edges and faces around moved vertices, faces whose normals change) in scratch `IndexSet`s sized per topology, and `Touched.flush` reuses its sorted copy and ranges; a drag frame allocates only a few fixed-size views, nothing proportional to the edit. | MVP-SPEC §3 (no allocation in per-frame paths). |

## Budgets (report-only, §5.27)

`packages/mesh-view/test/bench.test.ts`, local Chrome (GPU), Apple M-series, 1200 × 800 canvas, DPR 1, a wavy
158 × 158 quad grid = **49,928 triangles** (25,281 vertices), run on its own. The machine is shared with other
agents: fix round 2's figures are the range of two runs at moderate load; a third run under load average 10 is given
apart.

| Budget | Measured | Note |
|---|---|---|
| Enter component mode, 50k tris ≤ 40 ms | **over: 48.5–58.0 ms** median of 5: kernel 22.8–24.1 ms (B0a reference `editMeshFrom` + `triangulate` + `computeNormals`), overlays + first frame incl. GPU upload and a read-back 17.1–22.6 ms, BVH 9.1–9.3 ms (under load average 10: 93.8 ms; fix round 1: 51.6 ms) | mesh-view's share ≈ 26–32 ms (a probe split it: `setMesh` 4.6, `setState` 1.1, first render with the uploads 10.4, read-back 1.7, picker topology 0.8, BVH 9.4 ms); with research 13 §8.1's kernel figures (adjacency 1.8, normals 2.9, triangulation 0.6 ms) the total is ≈ 32–37 ms. Re-measure after B1 (INT); if mesh-view's share still dominates there, `prepareBvh` moves to an idle callback out of the enter path. |
| Hover ≤ 0.5 ms | vertex mean 0.037–0.042 / p95 0.10 ms; edge 0.16–0.17 / p95 0.2–0.4 ms; face 0.003 / < 0.1 ms; after a camera move (re-projection) median 0.10, p95 0.20 ms (under load: edge 0.25 / 0.4 ms) | 1,000 picks per kind; `performance.now()` is coarsened to 0.1 ms in the page, so p95 values are 0.1 ms steps; linear scans (M6A-B6-20) |
| Marquee 10k vertices with occlusion ≤ 16 ms | 15,262 vertices: first 12.5–13.6 ms, median 11.0–11.3 ms (under load: 18.3 ms) | ≈ 7.3 ms per 10k |
| — marquee with a 50k-tri neighbour as occluder (no budget) | 15,262 candidates, 7,629 left: first 33.7 ms (with the neighbour's lazy BVH build), median 18.1 ms (under load: 29.0 ms) | ≈ 11.9 ms per 10k when every visible candidate is also cast through the neighbour (M6A-B6-22) |
| — pane switch between face isolate sets (no budget) | view: `setIsolate` 1.3 ms + frame with uploads 2.7 ms; picker BVH rebuild 7.3 ms (under load: 2.0 + 2.3, 11.5 ms) | M6A-B6-23 |
| Idle 0 frames | 0 by construction (no frame requests; an unchanged hover requests none either) | the editor-level check is the gated bench and E2E-MOD-16 (INT) |

Changes made for the budget: the surface's per-corner face-normal attribute was dropped (flat via derivatives), the
vertex maps are built without per-element callbacks, and ranges are added only to attributes already on the GPU
(three keeps the ranges of a fresh attribute and would turn the next partial upload into a whole one).

## Hand-over to B9, B10, INT

- **B9**: `ViewportManager.addMeshLayer(host)` is the `MeshLayerTarget` with `invalidate()`; call
  `host.applyPane(meshPaneDisplay(pane.display), pane.id)` before each pane render (`meshPaneDisplay` maps
  `DisplayFlags`, `dimmed` = the pane's `dimUnhilited`). Hide the components layer per `DisplayFlags.components` if
  you like; mesh-view also hides its glyphs itself. Land `LAYER.meshComponents … helpers` = 6…9 (M6A-B6-12). The
  display reads `session.workspace`: character-owned meshes get hosts only in Model, props in every workspace
  (M6A-B6-13), so one `loadMeshDisplay` per viewport serves every workspace.
- **B10**: `const display = await loadMeshDisplay({ app, target: vm, theme: canvas })` once per viewport; open the
  hilited runtimes on entering a mode (the display follows); for the pane under the pointer,
  `display.pick(camera, ndc, viewport, kind, opts, paneId)` for hover and click, `display.marquee(camera, rect,
  viewport, kind, opts, paneId)`, `display.screenOf(mesh, camera, viewport, kind, index, opts, paneId, t?)` for
  `screenOfVertex/Edge/Face` (all three skip what the pane does not draw: hidden objects, its object isolate, its face
  isolate; `display.picker(mesh)` is the raw picker without that), `display.setHover`, `display.setLints`,
  `display.setFaceIsolate(paneId, mesh, faces)` (copied; after a topology commit push the remapped set, a set of the
  old face count is dropped, M6A-B6-19). The options are the caller's (`QueryOptions` = `PickOptionsInput` without
  `hidden`, which the display fills per mesh): `cameraBased` = Camera-based `auto` → on in shaded/colours/lit, off in
  wire and x-ray (§5.6); `backfaces` = `(xray ‖ session.model.backfaces) && !cull` (M6A-B6-7); `wire` = the pane's
  shading is `wire` (faces by their dot only). Camera-based queries are occluded by every other mesh the pane draws
  without further wiring (M6A-B6-22). `setHover` on every pointer move is free when nothing changed.
- **B12a**: `display.setSoftWeights(mesh, weights)` during soft drags; runtime `changed` events with a `DirtySet`
  update the view incrementally (`EditMeshView.update`).
- **INT**: turn on the bench's `test.fixme('b7, b9, b10')` (it selects a face before its idle check); re-measure the
  enter-component-mode row with B1 and decide the picker grid on the editor-level hover p95 (M6A-B6-20); add a
  `PickOccluder` over ModelLoader's character meshes to the pane occluders if characters stay on screen in Model
  (M6A-B6-22); a per-pane isolate cache if four-pane layouts with an isolated pane are common (M6A-B6-23); the §4.4
  contract PR for `PickOptions.wire` (M6A-B6-1).

## Shared files and other packages' paths

- `packages/viewport/src/index.ts` (no §9.1 owner): additive exports of the hosting API.
- `packages/viewport/test/m6a-mesh-display.test.ts`: a new file next to B9's viewport tests.
- `packages/mesh-view/test/skeleton.test.ts`: B0a's case "refuses to build views and pickers until B6 lands them"
  became "builds views and pickers (B6) and disposes them twice without error" (literal update, §4.4).
- Not touched: `packages/mesh-view/package.json`, `vitest.config.ts` (its `optimizeDeps` lists `earcut`, which
  mesh-view does not depend on; Vite prints "Failed to resolve dependency: earcut" once, harmless).

## Gates (local, real Chrome; port 3167)

Fix round 2, on the branch head: `format:check` (1117 files), `lint` (rc 0, no warnings), `typecheck`, `check:deps`
(15 packages) green; `test` green with `pnpm run test --concurrency=2` (15 of 15 tasks; every package whose inputs
changed re-ran: mesh-view 6 files / 64 tests, viewport 13 files / 114 tests + 1 skipped with `m6a-mesh-display` 14 of
14, editor 359 + 1 skipped, headless-tests 173, web 10; the 10 unchanged packages replayed from the turbo cache). The
new picker tests (occluders, the two-mesh oracle) and display tests (occlusion across meshes, hover invalidation,
the World plane, wire dots across meshes) fail against the previous sources (checked by reverting each fix) and pass
now. `build` green; `check:size` 864,427 B ≤ 900,000 B, unchanged. E2E: the full suite (`EKZA_E2E_PORT=3167 pnpm run
test:e2e`, chrome project) **109 passed, 10 skipped**, none failed; the B6 browser bench still lists as
`test.fixme('b7, b9, b10: …')`; port 3167 free afterwards.

Fix round 1, on the branch head: `format:check` (1116 files), `lint` (0 warnings), `typecheck`, `check:deps`
(15 packages) green; `test` green with `turbo run test test:tooling --concurrency=2` (15 of 15 tasks; mesh-view
6 files / 58 tests, viewport 13 files / 110 tests + 1 skipped with `m6a-mesh-display` 10 of 10, every other package
unchanged). The four new view tests and the three new display tests fail against the previous sources and pass now.
`build` green; `check:size` 864,427 B ≤ 900,000 B, unchanged (the hosting exports are tree-shaken until a consumer
loads them; the `mesh-view` boundary reports no marker anywhere, the kernel boundary is lazy as before). E2E: the full
suite (`EKZA_E2E_PORT=3167 pnpm run test:e2e`, chrome project) **109 passed, 10 skipped**, none failed (the shipped
stretch and gated `test.fixme` cases); B6 has no E2E-MOD scenario, and its browser bench
(`apps/web/e2e/bench/m6a-mesh-view.bench.ts`) lists under the bench config as `test.fixme('b7, b9, b10: …')`.

First build: the same gates, mesh-view 52 tests and viewport 107 + 1 skipped; a first `test` run at turbo's default
concurrency timed out in the editor's browser tests (and headless-tests) while every browser suite ran at once on the
shared machine, green on their own and at `--concurrency=2`.
