# M7 G-a — the AI intake operators (`m7/ga-intake`)

Work package G-a of [MODELING-PLAN](../MODELING-PLAN.md) §7.2 (§3.11, §3.12, §7.3; [ADR 0017](../adr/0017-ai-generation-boundary.md)
decision 5; research [15](../research/15-ai-3d-generation.md) §5.9, [13](../research/13-mesh-kernel.md) §5.17). Branch
`m7/ga-intake` off `dev` `22b007b6`. The owner's goal (2026-10-24): prompt or picture → a 3D generator → Studio cleans the
model up "our own way if possible" → Auto-Rig → animate. G-a is the local, key-free clean-up: it works for any imported
GLB, generated or not, and needs no provider. Decisions: [DECISIONS-OPEN §U](../DECISIONS-OPEN.md#u-m7-g-a-the-ai-intake-operators-2026-10-24),
rows `M7-GA-1` … `M7-GA-14` and the contract rows `M7-GA-CONTRACT-1` … `-6` (the Halo Make stage, T8, builds against
them).

## What landed

| Part | Files | What |
|---|---|---|
| `@ekza-studio/mesh-wasm` (new, lazy) | `packages/mesh-wasm/src/{simplifier,reduce,meshdata,normalize,palette,colour,image,chain,worker,types}.ts` | meshoptimizer **1.3.0** (MIT; the registry's latest on 2026-10-24, published 2026-09-25) loaded on first use: the Decimator (`reduceMesh`), `normalizeMeshes`, the kernel's Quadrangulate on a whole mesh, the OKLab palette bake, a deterministic area downsample, the chain runner (`runIntakeJob`) and the worker's request handler (`./worker`) |
| The operators | `editor-core/src/operators/builtin/intake.ts` (Model chunk), `editor-core/src/intake/{types,load,client,run}.ts` | `mesh.normalize`, `mesh.reduce`, `mesh.paletteBake`, `mesh.textureDownsize`, `mesh.intake` (the preset); ParamDefs, polls with plain reasons, one undo step each, adjustable (undo + re-run from the original), aliases; the job builder (revisions, world matrices, decoded base colours) and the writer (revisions, placements, palette, colour fields) |
| The worker | `editor/src/workers/intake.worker.ts`, `editor/src/services/intakeWorker.ts`, `editor/src/host/StudioHost.tsx` | A module worker created on the first job (the skin worker's pattern); without workers (Node) the same chain runs through the lazy mesh-wasm chunk; the client copies jobs itself, so the worker path never loads mesh-wasm on the main thread |
| Decimate first | `editor-core/src/operators/builtin/rig/character.ts` | `mesh.importStatic`'s planner and record writer are shared (`prepareImport {maxTriangles}`, `putImportedMeshes`): `mesh.intake {bytes, name}` imports and cleans in **one** undo step and lifts Make editable's 200k gate for its own chain |
| io | `io/src/png/decode.ts`, `io/src/png/encode.ts` (`encodePng` RGBA), `io/src/glb/rewriteImages.ts`, `io/src/write.ts` | A PNG reader (the same pixels in Node and every browser; JPEG/WebP go through the browser's decoder), the RGBA PNG writer and the GLB image rewrite of the texture downsize (BIN laid out again, accessors untouched) |
| The test model | `io/src/testing/aiModel.ts` (`makeAiLikeGlb`) | A procedural stand-in for a generator's output (no network, no third-party asset): the `humanoidBody` template subdivided to 96,824 triangles (14²·494), Taubin-smoothed, hash-roughened, one 1024² texture on a 241-chart atlas (every chart border a UV seam), facing +X, one unit tall, centred |
| Surfaces | `editor-core/src/operators/builtin/modelMenus.ts`, `halo/src/manifest/{disclosure,labels,paramSurfaces}.ts`, `agent-tools/src/policy.ts` | Mesh menu › Intake…, Normalize…, Reduce…, Palette Bake…, Downsize Textures…; Halo More rows (Make) with plain labels; chips and Options surfaces (param-lint); agent policy rows (denied, like every modeling operator) |
| Gates | `tooling/check-deps.mjs`, `.oxlintrc.json`, `apps/web/scripts/check-size.mjs` | mesh-wasm's dependency and import rules (only `anim-core`, `mesh-core`, `meshoptimizer/simplifier`; editor-core reaches it through one lazy loader, types only elsewhere); the `mesh-wasm` lazy boundary on every route |
| Tests | `mesh-wasm/test/intake.test.ts`, `editor-core/test/m7/intake.test.ts`, `headless-tests/test/m7.intake.test.ts`, `apps/web/test/m7-mesh-wasm-size.test.ts`, `apps/web/e2e/m7-01-intake.spec.ts` | below |

## The algorithms

**Reduce** (`reduceMesh`). The mesh is triangulated (the kernel's one triangulation). Corners of one point with equal
material slot, `paint` slot, `uv0`, `uv1` and `color0` become one simplifier vertex (a *wedge*); corners that differ
become separate vertices at the bit-equal position, which meshoptimizer recognises as an attribute seam: a seam
collapses only along itself, so UV seams and material/palette borders never crack. Attributes: the UVs (`uvWeight`,
default 1), the smooth point normal (`normalWeight`, 0.5) and the vertex colour. `vertex_lock` = 1 on UV-seam points
(`lockSeams`, off by default, M7-GA-3) and on material/palette-border points (`lockPalette`, on). Flags: `Regularize`
for skinned meshes (`regularize: null` = auto), `LockBorder` and `Prune` on request; no error limit. The output is
index-only, so every kept vertex keeps its exact position, UVs, colours, skin weights and morph deltas; `normal.custom`
is dropped (the surface changed) and hard edges are re-derived at `hardAngle` (80°, M7-GA-17) plus the source's own hard
edges.

**Exact target by search.** meshoptimizer lands at the requested index count or a little under it; when under, a
bisection over the requested count (at most 10 runs) finds the largest result within the budget. A closed mesh loses
triangles in pairs, so an odd budget ends one under. In practice the first run hits the target (96,824 → 3,000 in one
run); the search runs for odd targets (2,999 → 2,998 in 3 runs) and when locks get in the way.

**Pinch repair.** meshoptimizer preserves the attribute topology, not the link condition of the welded mesh: where
hundreds of UV charts meet in one point (a UV sphere's pole with one UV per triangle) a collapse can pinch an edge
between two sheets (four faces on one edge). When a reduce creates such edges on a source without them, the one-ring
of the pinched points is locked and the search runs again (at most twice); the report says `reduce.non-manifold` if any
remain (none in the tests). Atlases with 3–12 charts per corner, the generator case, never pinched.

**Budget split.** One budget for all target meshes of a model, in proportion to their triangle counts (the same
reduction ratio everywhere, at least 4 triangles a part).

**Normalize.** The source frame (up, forward, unit) → +Y up, +Z forward, metres: a rotation whose rows are
`up × forward`, `up`, `forward`; a uniform scale to `height`; the origin at the bottom centre of the **combined** bounds
of the target meshes (the parts of one model keep their relative placement). The matrices are baked with the kernel's
`mesh.applyTransform` (Freeze's semantics: morph deltas, custom normals, winding under mirrors); placements become
identity in world (`localFromWorld`), pivots reset, and children that are not targets keep their world placement.

**Palette bake.** The base colour (texture × factor in linear light, or a palette mesh's swatch) is sampled at a fixed
R2-sequence pattern of points per triangle (6 by default), **pulled 25 % toward the triangle's centroid**, each sample
weighted by its triangle's area / samples. A texture sample reads the **nearest texel** (no bilinear blend: every
sample is a colour the image holds) and only texels **inside the atlas's charts** — rasterized from the UV triangles of
the meshes as imported (before the reduce) — that are not transparent (alpha ≥ 16): the background between charts
(black, transparent or a packer's padding) never votes (M7-GA-15). The valid samples of all target meshes are
histogrammed (OKLab quantized at 1/256) and clustered by weighted k-means in OKLab (greedy k-means++ seeding from the
heaviest bin, Lloyd until stable, ≤ 64 iterations); each face takes the cluster its samples cover most — its
**dominant** colour (M7-GA-6: the mean turned striped shirts pink); a face with no valid sample takes its nearest valid
neighbour's (breadth-first over shared edges). Clusters within OKLab 0.03 of a heavier one (texture-noise splits of one
colour) merge into it, clusters no face uses are left out, and the palette is ordered by covered area (M7-GA-16). One
new palette for the model; the meshes become palette-coloured, `material: {preset: 'unlit'}`, `source: null`
(paintable, M7-GA-7).

**Texture downsize** (`texture: 'keep'` in the preset, or `mesh.textureDownsize`). Images larger than the limit are
decoded, downsampled by an area filter in linear light (integer-indexed, the same bytes everywhere) and re-encoded as
PNG (RGB when opaque); the GLB's BIN is laid out again and the meshes' material slots point at the new model asset.

## Acceptance (MODELING-PLAN §7.3, the G-a part)

| Check | Result |
|---|---|
| A 50k–200k-triangle textured GLB, CC0 or procedural | `makeAiLikeGlb()`: **96,824** triangles, one 1024² texture, 241 UV charts (6,593 seam points) on a black atlas background with 2 texels of padding, facing +X, 1 unit tall; glTF-Validator 0 errors |
| ≤ 3,000 triangles | **3,000** exactly (headless and browser); 2,998 for an odd 2,999 |
| ≤ 16 colours | **8** swatches, every one used (the model's trousers, shirt, stripes, belt, shoes, skin and hair; noise splits merged, M7-GA-16); the eyes are too small to win a face at 3,000 triangles |
| No colour from the atlas background | the background samples are ignored (69 of 18,000 in the chain); on the same atlas with **no padding** (black right at the chart edge) **0 faces** take a colour further than OKLab 0.06 from every colour the charts hold (the old bake: 24 faces) |
| No cracks along UV seams | one closed shell before and after: `boundaryLoops 0`, `nonManifoldEdges 0`, `shells 1`; the kept corners' UVs are all source UVs |
| Normalized | 1.70 m tall (± 2 mm after the reduce pulls extreme points in; normalize itself is exact), standing on y = 0, centred, facing +Z, identity placement |
| One undo step | `Intake` (the import is its own step; `mesh.intake {bytes}` makes import + intake one) |
| Make editable / Auto-Rig accepts it | The result is an editable mesh record; `autorig.inspect`: centred, grounded, facing, upright, size ok; `skel.quickRig.start` places the markers, `autorig.rig` creates the skeleton and binds |
| Exports pass the validators | static GLB: glTF-Validator **0 errors**, no error lints; the rigged character's VRM 1.0 (`ekza/space-avatar-v1`): vrm-validator **0 errors** |
| Deterministic | two fresh apps, the same file and params: the same revision manifest id, the same palette, **byte-identical** static exports; the worker and the inline path give the same manifest |
| Decimate first | a 217,854-triangle file: `mesh.importStatic` refuses (`too-large`); `mesh.intake {bytes, preset: 'hero'}` imports and cleans it to ≤ 10,000 in one step, closed |

Screenshots (before: the AI-like import, facing +X with its texture; after: the intake preset, 3,000 triangles,
8 colours, facing +Z; after-arm: a close-up of the arm) are produced by `m7-01-intake.spec.ts` with
`EKZA_M7GA_SHOTS=<folder>` and attached to the test.

## Budgets (§3.12; report only; this machine: Apple M4 Pro, loaded)

| Scenario | Budget | Measured |
|---|---|---|
| **Worker: reduce 96,824 → 3,000** (Chrome, the intake worker) | — | **73–88 ms** (four runs) |
| Worker: the intake chain 96,824 → 3,000 (normalize 9–72, reduce 133–161, quadrangulate 17–24, palette bake 4–14 ms) | — | **197–271 ms** (197 ms with normalize's direct path) |
| Node, this thread: the same chain | — | 262 ms (normalize 116, reduce 113, quadrangulate 26, bake 7–10) |
| **AI post chain 505,856 → 3,000** (Node, this thread; `makeAiLikeGlb({subdivisions: 32})`, `mesh.intake {bytes}`) | **≤ 2 s** | **chain 874 ms** (normalize 36, reduce 798, quadrangulate 31, palette bake 9); the whole run with the import, the weld and the writes 1.8 s |
| Decimate first 217,854 → 10,000 (Node: import, weld and chain) | — | chain 0.71–0.76 s, run 0.85–0.92 s |
| meshoptimizer simplifier chunk | lazy | ≈ 20 kB gzip (the module embeds its WASM; loaded only in the worker) |

The reduce is faster alone (73–83 ms) than inside the chain (133–161 ms) because the chain's reduce runs right after the
WASM instantiates. The browser numbers above were taken before normalize got its direct path: it applies a proper
rotation and scale to the arrays without edit links or a write log, byte for byte what the kernel's Freeze writes
(tested), 74 → 22 ms at 100k triangles in Node; a mirror still goes through the kernel op.

**Reduce options on the AI-like model** (96,824 → 3,000, Node, quiet machine): default 3,000, relative error 0.0141;
`regularize: true` 3,000, error 0.0150 (+6 %, more even triangles for skinning); `lockPalette: false` identical (one
material, no palette); **`lockSeams: true` stops at 17,310** (15,667 wedges locked) with 11 pinched edges reported —
the measurement behind M7-GA-3.

## Quadrangulate in the intake chain (Q-MOD-K-9)

The kernel's `mesh.quadrangulate` (angle 30°, hard edges, UV seams and material borders kept) runs after the reduce,
on by default in the preset only. On the AI-like model at 3,000 triangles: **1,150 quads + 700 triangles** (62 % of the
faces are quads; 77 % of the triangles were paired); on the atlas-cut sphere 66 %. The rest stay triangles where a pair
would cross a UV seam (every chart border), a hard edge (80°) or a non-convex quad. The shape and the triangle count do
not change (each quad keeps the reduce's diagonal). Quality: good for selection and loops on large smooth areas;
edge flow follows the reduce, not the anatomy, so it is no substitute for retopology (below).

## "Our own retopology": an open-source quad remesher as WASM later (research, not built)

| Candidate | Licence | What it gives | Size and port | Verdict |
|---|---|---|---|---|
| **Instant Meshes** (Jakob, Tarini, Panozzo, Sorkine-Hornung, SIGGRAPH Asia 2015) | **BSD-3-Clause** (plus an "enhancements" paragraph that asks nothing of us); the core needs Eigen (MPL-2.0, header-only) and optionally TBB; the GUI (nanogui) is not needed | Field-aligned quad-dominant (4-RoSy/4-PoSy) or pure-quad output at a target vertex count, crease angle and boundary alignment; fast (seconds for 1M triangles natively); interactive field brushing in its GUI; the algorithm a commercial modeller ships for automatic retopology | ≈ 15k lines of C++11; single-threaded Emscripten build without TBB is plausible; estimate 0.4–0.8 MB WASM (unmeasured) | **Feasible, first choice.** Tolerates imperfect input better than flow-based methods; leaves some singularities and the occasional T-junction or hole on broken soup, so it would run after reduce/cleanup |
| **QuadriFlow** (Huang et al., SGP 2018) | **MIT**; bundled Boost and Lemon (BSL-1.0), Eigen (MPL-2.0; its LGPL sparse Cholesky is avoided with `BUILD_FREE_LICENSE=ON`), pcg32 (Apache-2.0) | Pure, manifold quad meshes with far fewer singularities than Instant Meshes (min-cost-flow quantization); optional sharp-edge preservation; `-sat` flip removal needs minisat | Needs a **manifold, watertight** triangle input (its authors point to a separate "Manifold" pre-pass); Boost graph code makes the WASM larger (estimate ~1 MB); single-threaded port plausible | **Feasible second step** for clean characters: run after a manifold pre-pass (meshoptimizer 1.3's experimental `remesh` or `manifold-3d`, both already planned) |
| **QuadWild** (+ Bi-MDF, Pietroni et al. 2021; Heistermann et al. 2023) | **GPL-3.0** (QuadWild; its CoMISo and vcglib are GPL-3.0 too); the original needs Gurobi | Best-in-class quad layouts (feature-aligned patches) | — | **Excluded**: GPL-3.0 cannot link into the MIT packages (ADR 0009); only as a separate process, never in the browser |
| libigl MIQ / CoMISo | libigl MPL-2.0, but MIQ needs CoMISo (**GPL-3.0**) | Mixed-integer quadrangulation | — | **Excluded** (CoMISo) |
| Geogram (Lévy) | **BSD-3-Clause** | Remeshing (isotropic/anisotropic triangles) and a global-parameterization quad-dominant path used by its Graphite front end (to verify in detail) | Large library; WASM builds exist for its demos | Possible, after Instant Meshes; worth a spike only if Instant Meshes' singularities are not good enough |
| A commercial auto-retopology plug-in | proprietary | — | — | Excluded |
| Provider retopology (Tripo P2 quads, Meshy Smart Topology, Rodin Quad) | provider terms | Quads or clean low-poly at generation time | — (G-c adapters) | The paid path the owner named ("otherwise via the provider's API"); G-c pins it |

**Verdict.** "Our own retopology" is feasible with Instant Meshes (BSD-3) compiled to WASM in `mesh-wasm` next to the
Decimator, behind the same lazy worker, with QuadriFlow (MIT) as the higher-quality pure-quad option once a manifold
pre-pass exists. Neither is needed for the G1 acceptance (≤ 3k triangles, palette, Auto-Rig); both are worth a spike in
G2 for "hero" characters that someone will hand-edit. Effort estimate: 3–4 agent-days for an Instant Meshes port with a
`mesh.retopologize {vertices, crease}` operator and its tests; +2 for QuadriFlow behind a manifold pre-pass.

Sources: <https://github.com/wjakob/instant-meshes> (LICENSE.txt: BSD 3-Clause), <https://github.com/hjwdzh/QuadriFlow>
(README: MIT, component licences, manifold input), <https://github.com/nicopietroni/quadwild> (GPL-3.0),
<https://github.com/cgg-bern/quadwild-bimdf>, <https://graphics.rwth-aachen.de:9000/CoMISo/CoMISo> (COPYING: GPL-3.0),
<https://github.com/BrunoLevy/geogram> (BSD-3-Clause). Sizes are estimates, not measured builds.

## Decisions (`M7-GA-*`, copied into DECISIONS-OPEN §U)

| ID | Decision | Why |
|---|---|---|
| M7-GA-1 | **meshoptimizer 1.3.0 pinned** (MIT), the registry's latest on 2026-10-24 (1.3.0 published 2026-09-25; 1.2.0 2026-06-30); only `meshoptimizer/simplifier` is imported, on first use | The plan named 1.3.0; checked against the registry today; the simplifier module embeds its WASM (≈ 20 kB gzip) |
| M7-GA-2 | **Wedges**: material slot, `paint` slot, `uv0`, `uv1`, `color0` split simplifier vertices; normals do not (they are recomputed) | meshoptimizer infers seams from coincident positions: a seam collapses only along itself, so no crack is possible; keying by normals would turn faceted meshes into all-seam meshes |
| M7-GA-3 | **`vertex_lock` on UV seams is an option, off by default; on palette/material borders it is on** | Locking every seam vertex of a 241-chart atlas (6,593 seam points of 48k) would forbid reaching 3k; seams are crack-free without the lock (M7-GA-2). Palette borders on authored meshes are the design: kept |
| M7-GA-4 | **Exact target by bisection** over the requested index count (≤ 10 runs), the largest result within the budget; the report warns `reduce.target-unreached` when locks stop it | "exact triangle target found by search" (§7.2); a closed mesh loses triangles in pairs |
| M7-GA-5 | **Pinch repair**: a result with new edges of > 2 faces locks the one-ring of the pinched points and searches again (≤ 2 rounds) | meshoptimizer keeps attribute topology, not the welded mesh's link condition (seen at a fan of 220 UV charts) |
| M7-GA-6 | **Palette bake = dominant colour**: area-weighted samples clustered (k-means in OKLab on a 1/256 histogram, deterministic seeding); each face takes the swatch its samples cover most | The mean of a striped face is a colour that is not in the model (pink shirts); the dominant swatch keeps the model's colours |
| M7-GA-7 | **A baked mesh becomes palette-coloured and paintable**: one new palette per run, `material: {preset: 'unlit'}`, `source: null`, `colourOutput: 'palette-texture'`; imported characters' made-editable meshes are refused | Imported meshes cannot be painted (`paintRules`), and a palette mesh exports through the palette writer; the surgeon still needs `source` on an asset character's meshes |
| M7-GA-8 | **Normalize bakes into the data** (identity world placement, pivot reset, non-target children keep their world) over the combined bounds of the targets; refuses skinned and character-owned meshes | The parts of one model must move together; after rigging a frame change belongs to the skeleton |
| M7-GA-9 | **The chain runs in a module worker** created on the first job; without workers the same function runs inline; one job at a time, a newer one supersedes; a worker that fails to load sends every later job inline | The skin worker's pattern (M6B-SPEC §5.9); the same bytes either way |
| M7-GA-10 | **Decimate first lives in `mesh.intake {bytes}`**: the import's 200k gate is lifted for its own chain (≤ 4M triangles), import + intake are one undo step; `mesh.importStatic` and Auto-Rig keep their refusal | Q-MOD-K-11: no > 200k record ever exists; Auto-Rig's refusal message and its e2e stay as specified until its shell offers the button (open item) |
| M7-GA-11 | **PNG decoding is ours** (`io/png/decode.ts`), JPEG/WebP through `createImageBitmap` without colour conversion; textures that cannot be read fall back to the material factor with a warning | The same pixels in Node tests and every browser; `sharp` stays banned |
| M7-GA-12 | **Texture downsize writes a new model asset** (images as PNG, the BIN laid out again) and repoints the meshes' material slots | Asset records are immutable by hash; accessors keep their views |
| M7-GA-13 | **Quadrangulate is on in the intake preset** (30°, seams, hard edges and materials kept), an option there, never automatic elsewhere | Q-MOD-K-9 as decided |
| M7-GA-14 | **The procedural AI-like model** (`io/testing` `makeAiLikeGlb`) is the acceptance input, its atlas on a black background with 2 texels of padding (both options); no binary fixture is committed | No CC0 50k–200k textured GLB exists in the fixtures; a generator in code is deterministic, licence-clean and 0 bytes in the repository |
| M7-GA-15 | **The palette bake never reads the atlas background**: samples inset 25 % toward the triangle's centroid, nearest texel, only texels inside the charts (rasterized from the UV triangles as imported) and not transparent (alpha ≥ 16); a face with no valid sample takes its nearest valid neighbour's slot | Review of `ga-after.png` (coordinator, 2026-10-24); the debug below |
| M7-GA-16 | **Clusters within OKLab 0.03 merge; unused clusters are dropped**: the palette holds only colours some face uses | Texture noise split each colour into two or three swatches (16 for 8 colours), and dominant voting left blend clusters unused |
| M7-GA-17 | **Hard edges above 80° after a reduce** (was 60°) | At 60° the reduced character carried ≈ 216 hard edges, drawn as dark lines along the limbs in Model; 80° keeps ≈ 48 (the creases) and a box prop's 90° edges stay hard |

The contract rows `M7-GA-CONTRACT-1` … `-6` (ids, parameter names, the outcome) are in DECISIONS-OPEN §U.

## Fix round 1: the palette bake and the atlas background (review of `ga-after.png`)

The coordinator saw dark, jagged specks and edge lines on the arms, shoulders and shirt edges, and red reaching the
skin at the shoulders, and suspected samples from the atlas's black gutter. The per-face debug (Node, the AI-like model
reduced to 3,000 triangles, 6 samples per triangle; coverage rasterized from the import's UV triangles):

| | Samples outside every chart (texel-centre test) | Faces with one | Faces on a colour the charts do not hold |
|---|---|---|---|
| Old bake, black gutter, no padding | 491 of 18,000 (2.7 %) | 424 of 3,000 | **24** (blue, red and skin darkened by black) |
| Old bake, black gutter, 2 texels of padding | 491 (2.7 %) | 424 | 1 |
| Old bake, the model as reviewed (cells filled with chart colour, no gutter) | — | — | 0 dark faces on the arms: the dark swatches sat on the hair (mean y 1.60 m), the shoes (0.04) and the belt (0.82) |
| **New bake**, black gutter, no padding | 65 (0.4 %, the inset) — all ignored | 52 — none decided by them | **0**; 1 face filled from a neighbour |

So the reviewed screenshot's dark lines were **not** baked colours: the arm close-up showed thin strokes along edges —
Model's hard-edge overlay (`hardEdges: true` in Model) on 215 edges that the reduce marked hard at 60° (M7-GA-17). The
gutter defect was real nevertheless, on any atlas with a background at the chart edge (24 faces above), and is fixed
(M7-GA-15). The red at the shoulders is the model's short sleeves (the shirt reaches |x| = 0.42 m), coarsened by
3,000 triangles. Dominant colour still avoids the pink stripes: no swatch of either test is a red/white blend (the
regression asserts every used swatch is within OKLab 0.06 of a chart colour), so it stays; the outlier-trimmed mean was
not needed. New tests: mesh-wasm (a 144-chart sphere atlas on a black and on a transparent gutter: no foreign colour, and
it fails on the old sampling, where faces used a 19,42,118 swatch — blue darkened by black; a face whose UVs sit on the background
is filled from its neighbours), headless (the AI-like model on black with no padding: 0 foreign faces, every swatch
used), e2e (`m7-01`: the bake saw and ignored background samples; `ga-after-arm.png`, the arm close-up).

## For G-d (the Generate panel) and the Halo Make stage (T8)

- **Run** `mesh.intake {bytes, name, preset, height?, colours?, forward}` on a downloaded artifact: one undo step, the
  import included, meshes over 200k decimated first. Pass `forward: '+x'` for Tripo's default export orientation (the
  adapter knows it), `'+z'` otherwise. The outcome carries `triangles {before, after}`, `colours`, `steps` (each with
  `ms` and facts: the reduce's error in metres, the quad share, the palette size) and `warnings` for the post-chain
  dialog's live budgets.
- **Provenance**: record `aiMarksMayBeAltered` from the outcome (true after reduce, palette bake or texture downsize;
  ADR 0017 decision 7) and the post steps (`steps[].kind`) in `AssetRecord.provenance`; G-a writes no provenance.
- **Adjust**: every operator is adjustable; the Last-op card / Echo chips re-run from the original (undo + re-run), so
  the panel can offer *Prop · Character · Hero* and *Colours* as chips after the run.
- **Texture instead of palette**: `texture: 'keep'` (and `textureSize`) in the preset.
- **Halo**: the five operators are More rows (Make › Clean up / Transform / Colour & surface) with plain labels; T8 may
  promote `mesh.intake` to a petal or a tray item and lower the `searchOnly` baseline accordingly; `poll` reasons are
  plain ("Select a mesh", "Already under the budget (N triangles)", "Normalize works before rigging: …").
- **Auto-Rig**: its too-heavy refusal can offer *Decimate first* by re-running the intake through `mesh.intake
  {bytes}` (not wired: the Auto-Rig shell's UI is not this package's).

## Open items (integration agent / owner)

1. **Contract files.** `OperatorMap` (`editor-core/src/operators/args.ts`) gained the five rows of M7-GA-CONTRACT-*;
   the M7 spec should copy them. The intake operators are editor operators, not kernel `MeshOp`s: they run a worker
   job in `prepare`, and M6A-SPEC §6.1's descriptor table (pinned by `mesh-core/test/descriptors.test.ts`) stays as it
   is; `editor-core/test/m6a/foundation.test.ts` and `registration.test.ts` list them as M7 rows (literal updates).
2. **Manifests and rules** for the new package: `packages/mesh-wasm/package.json`, mesh-wasm in the dependencies of
   editor-core, editor and headless-tests, `pnpm-lock.yaml`, `tooling/check-deps.mjs`, `.oxlintrc.json` (mesh-wasm's
   own rules; editor-core's lazy-only path rule; the editor workers, editor-core tests, headless tests and e2e specs
   may import it or `io/testing`), `apps/web/scripts/check-size.mjs` (the `mesh-wasm` boundary): additive, to ratify.
3. **Auto-Rig's *Decimate first*.** Its too-heavy refusal (AUTORIG-SPEC §6.2, Q-AR-11) can now offer a button that runs
   `mesh.intake {bytes, name, preset, forward}` (or a plain reduce to 200k); the shell's UI and its e2e (`ar-03`,
   `ar-as-07` assert the refusal text) are the Auto-Rig owner's.
4. **Tangents (Q-MOD-K-13).** meshoptimizer 1.3's tangent generator (`meshopt_tangents`, `Compatible` =
   MikkTSpace-compatible) is in the pinned package and mesh-wasm is its home; wiring it into the surgeon's export of
   edited primitives needs an injected generator (io cannot import mesh-wasm). Not needed by the intake: palette bakes
   carry no normal maps and the static writers write no `TANGENT`.
5. **FEATURES.md** rows for the five operators (Model › Mesh) belong to the release that ships them.
6. **The Model workspace chunk** reports 250–254 kB against its 250,000 B warning (report only, M6A-SPEC §5.27); the
   intake's chain is not counted there: the intake worker's chunk (118.8 kB gzip: kernel, mesh-wasm and the simplifier)
   holds the kernel's marker too, so `check:size` lists `mesh-wasm` before the kernel to label it as the intake chain.

## Eager route (SIZE-1: report only)

`check:size` (production build, gzip -9, first visit) against `dev`'s last gate (T7, `docs/wp-notes/halo-t7.md`):

| Route | `dev` (T7) | This branch | Delta |
|---|---|---|---|
| `/editor` | 897,211 B | 897,556 B | +345 B |
| `/autorig` | 657,809 B | 658,136 B | +327 B |
| `/app` | 715,694 B | 716,017 B | +323 B |

The eager part is the five operators' manifest entries (the Model chunk's proxies) and the worker installer; every
boundary holds, `mesh-wasm` included (its marker is in no route's initial scripts). The intake worker's chunk is
118.8 kB gzip (kernel, mesh-wasm, the simplifier with its WASM), the main-thread fallback chunk ≈ 102 kB; neither
loads before the first intake run, and the browser path loads only the worker's.

## Gates

`EKZA_E2E_PORT=3184 pnpm run ci` (local, real Chrome; the machine shared with other agents, load average 30–93):

| Run | Result |
|---|---|
| 1 | format, lint, typecheck, deps (23 packages), fixtures (25), licences (178) green; unit tests stopped by a crash of Playwright's own IPC in curve-editor's browser tests (`SyntaxError: Unexpected end of JSON input` in playwright-core); turbo stopped the rest. curve-editor alone: 220 passed |
| 2 | unit tests: three Halo tests and one editor-core compute-bound test timed out at load ≈ 93; alone: 14 + 26 passed |
| 3 | every unit test task green (24/24), build, `check:size` green (table above), e2e **470 passed, 99 skipped, 1 failed**: `m2a-01-leg-ik-holds-feet` ("Character 'Polybot' has no runtime yet", a runtime-load timing at load ≈ 45); alone, with `m7-01-intake`: 2 passed |
| 4 (`a5e7ec2c`, before fix round 1) | **green, exit 0**: format, lint, typecheck, deps (23 packages), fixtures (25), licences (178); unit tests 24/24 tasks — mesh-wasm 12, editor-core 1,824, io 494, headless-tests 232, editor 677 + 1 skipped, mesh-core 982, halo 178, agent-tools 263 + 8 skipped, curve-editor 220 + 3 skipped, web 110, tooling 37 (param-lint included); build; `check:size` (table above); e2e **471 passed, 99 skipped, 0 failed** (`m7-01-intake` included) |

Fix round 1 (`5bf177f4`): run 5 stopped on editor-core's `agent/keys` compute-bound timing (4.1 s against 3 s at load
≈ 35; alone: 26 passed), run 6 on `ops-ui/card-preview` (alone: 4 passed, three times); neither touches this package.
**Run 7: green, exit 0** — format, lint, typecheck, deps, fixtures, licences; unit tests 24/24 tasks (mesh-wasm 14,
editor-core 1,824, io 494, headless-tests 233, editor 677 + 1 skipped, halo 178, agent-tools 263 + 8 skipped, web 110,
curve-editor 220 + 3 skipped); build; `check:size` `/editor` 897,558 B, `/autorig` 658,136 B, `/app` 716,019 B; e2e
**471 passed, 99 skipped, 0 failed** (`m7-01`: 45 hard edges, 8 colours, 69 background samples ignored; the worker's
reduce 96,824 → 3,000 in 88.6 ms, the chain in 202.5 ms).
