# M6a B8 — Mesh IO: make editable, writers, surgeon step, marker v2, display rebuild, lints: build notes

Branch `m6a/mesh-io` (from `m6a/spec` at `ec541b4`, with `m6a/contracts-foundation` merged). Scope:
[M6A-SPEC §9 B8](../M6A-SPEC.md#b8--mesh-io-make-editable-writers-surgeon-step-marker-v2-display-rebuild-lints)
with §4.5, §5.19, §5.21–§5.25 and E2E-MOD-12. Decision IDs below are `M6A-B8-<n>`.

## What landed (by spec responsibility)

| B8 item | Where |
|---|---|
| Make editable (§5.21): licence gate, 200k-triangle refusal, `decode` hook for Draco/meshopt, concatenation (face material = primitive index), morph- and skin-aware weld, per-corner layers, skin palette meta, morph layers, hard edges, degenerate triangles, report | `io/src/mesh/{fromGltf,licence}.ts` (`meshFromGltf`, `editLicence`, `meshFacts`) |
| `meshToPrimitives` with the colour outputs A/C/D and `'asset'`, derived morph `NORMAL` deltas, the tangent refusal | `io/src/mesh/toPrimitives.ts`, `io/src/mesh/colour.ts` |
| Palette PNG writer `ekza-palette-v1` (deterministic) | `io/src/mesh/palette.ts`, `io/src/png/encode.ts` |
| Surgeon "replace primitives" and `rebuildContainer` | `io/src/surgeon/replacePrimitives.ts` |
| Marker v2 (v1 and v2 readers, rollback of geometry and clips together, re-bake with carried geometry) | `io/src/surgeon/marker.ts`, `io/src/surgeon/bakeIntoModel.ts` (`opts.geometry`) |
| Author writer for static models, `ekza_model_v1`, `ekza_handheld_v1` | `io/src/export/author/index.ts`, `io/src/provenance/model.ts` |
| Static export artifact, mesh lints, static read-back (`StaticReadBackReport`, `withThreeReadBack`) | `io/src/export/author/artifact.ts`, `io/src/lint/meshes.ts` |
| Lint table rows of §4.5, static byte lints, handheld rules | `io/src/lint/{rules,static,lintExport}.ts` |
| Handheld profile registered (tex.size an error), budget presets of §5.24 | `io/src/profiles/{handheld,builtin,budgets}.ts` |
| `mesh.makeEditable` (derived id, record, first revision, report for B13's dialog) | `editor-core/src/operators/builtin/makeEditable.ts`, lazy half in `workflows/exportModel.ts` |
| `file.exportModel` (roots, budgets, author writer, lints, read-back with the three.js half through `services.models`, host validator, download) | `editor-core/src/operators/builtin/exportModel.ts`, `workflows/exportModel.ts` (`threeReadBack`) |
| Bake into model with the character's edits (marker v2) | `editor-core/src/workflows/exportRun.ts` → `characterEdits` |
| Display rebuild (§5.23) and the registry's display hook | `editor-core/src/workflows/meshDisplay.ts`, `editor-core/src/characters/registry.ts` (`display`, `redisplay`) |
| Virtual `asset` rows of `meshes()` | `editor-core` `assetMeshRows`, used by `editor/src/test-api/m6a/mesh-runtime-doc.ts` |
| `fixtures/synthetic/prohibited-modification.vrm` | `tooling/make-synthetic-fixtures.mjs` (+ its test), handed to the integration agent |
| E2E-MOD-12 | `apps/web/e2e/m6a-12-make-editable-polybot.spec.ts` (the loop-and-export part `test.fixme('b3: …')`; a B8 browser check of `file.exportModel`'s three.js read-back and `lastExport()`, `test.fixme('b7: …')` until `mesh.create.cube` lands) |
| Tests | io: `mesh-from-gltf`, `mesh-to-primitives`, `palette`, `surgeon-geometry`, `author-writer` (+ `test/ready.ts`); editor-core: `m6a/mesh-io`; headless-tests: `mesh.io.{make-editable,bake,static,display}` |
| Benches | `packages/io/bench/mesh-io.bench.ts` (`npx vitest bench --run` in `packages/io`) |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B8-1 | **editor-core reaches io/mesh through io/write.** `@ekza-animator/io/write` exports `loadMeshIo()` (a dynamic import of `./mesh`), the surgeon and the author writer load the mesh entry the same way, so the write path (animation exports) never loads the kernel; `io/write` also exports `BAKE_MARKER_V2_KEY`, `exportStaticModel`, `readBackStatic`, the budget helpers and `manualModelProvenance`. | editor-core's import rules allow `io/write` but not `io/mesh` (§2 names only `io → mesh-core` from the two lazy entries); no lint or manifest change needed. |
| M6A-B8-2 | **Kernel values enter io through one module**, `io/src/mesh/kernel.ts` (one `oxlint-disable-next-line no-restricted-imports` with the reason). Only `io/mesh` (and the lazy imports of `io/write`) reach it; the size gate's `mesh-kernel` boundary stays green. | io's lint rule allows mesh-core types only (B0a); §4.5 says io/mesh imports the kernel. |
| M6A-B8-3 | **Weld and points**: the weld key is the bits of position, JOINTS_0/WEIGHTS_0 and every morph POSITION delta, with −0 keyed as +0 (an exporter's centre-line −0 would otherwise crack the mesh; fix round 1); a point is made only for vertices referenced by kept triangles, in first-vertex order. Hard edges where two faces' corner normals differ by more than ≈ 0.08° (dot < 1 − 1e-6) at either endpoint; a primitive without `NORMAL` is flat (its edges hard, no custom normals). Duplicate target names get ` 2`, ` 3`. | §5.21 steps 5–7; glTF's flat-normal rule for primitives without NORMAL. |
| M6A-B8-4 | **Skin palette meta** on `skin.joints`: `{ skin: <glTF skin index>, joints: [{ id: 'node:<n>', name, parent: <palette index or −1> }] }` from the first node that skins the mesh. | §4.3 leaves the meta shape to the writer ("{ joints: [{ id, parent }] }"). |
| M6A-B8-5 | **Material slots**: one `AssetMaterialRef` per primitive (`asset` = the container's sha256 = the AssetId); a primitive without `material` records `materials.length` (one past the list, i.e. the glTF default material), since validation needs an integer ≥ 0. Slot *i* is primitive *i* of the file the mesh was made editable from; the surgeon copies `material`, `mode`, `extras` and extensions from that primitive (`applyGeometry`'s templates), and a re-bake that rolls a v2 file back first takes the templates from the file **before** the rollback (fix round 1: after an earlier bake emptied a slot, the original primitives no longer line up with the slots). | The surgeon copies `material` from the primitive JSON, so the slot list is informational. |
| M6A-B8-6 | **Record placement**: identity for skinned meshes (glTF ignores their node transform), else the composed rest TRS of the first node using the mesh. | §4.2 `placement` relative to the character root; B6/B10 display it. |
| M6A-B8-7 | **"Edited" = revision past Make editable's** (`data.rev > 1`). A mesh made editable but not changed exports exactly as M2a did (marker v1, the same bytes; headless test) and keeps the original display. | §5.22 "Animation-only bakes still write v1 and stay byte-identical"; never re-encode untouched meshes (research 13 §10.1). |
| M6A-B8-8 | **Derived morph NORMAL deltas** use the geometric normals (custom normals left out) of base + Δ minus those of the base, so a made-editable mesh (custom normals on every corner) still gets the shape's own change; non-finite values become 0. `morphNormals` holds target names (with or without the `morph:` prefix). | §5.21 "the same function"; with custom normals the plain difference would be 0 everywhere. |
| M6A-B8-9 | **Replaced primitives** keep the original's attribute names (intersected with what the mesh produces) plus POSITION and NORMAL, write COLOR_0 as RGB when the original was VEC3, copy `material`, `mode` (only 4; strips and fans become lists), `extras` and every extension except Draco, and write targets when the original had them. bufferViews of vertex data carry `target` 34962, indices 34963. | §5.22; faithful to the source file. |
| M6A-B8-10 | **`replacePrimitives(…, {marker: true})` extends**: no rollback; the baseline comes from an existing v1/v2 marker (a v1 baseline is pre-geometry by construction), `replacedPrimitives` keeps the first original of each mesh. **A bake rolls back and re-applies**: geometry edited now is written from its data; meshes a previous bake replaced and nobody edits now are **carried** (their accessors re-appended byte for byte), so export → re-import → re-bake keeps the geometry over the original baseline (E2E-MOD-31's headless twin). | §5.22 "writes or extends"; "re-applies both". |
| M6A-B8-11 | **Palette grid**: `cols = width / 8` (8 for the 64 px sheet, 16 for 128 px), `rows = height / 8`; a slot without a live swatch samples slot 0's cell (else the first). | §5.19's "grid of 8 columns" describes the 64 × 64 sheet; research 12 §4.3 doubles to 128 × 64 and 128 × 128. |
| M6A-B8-12 | **Static writer**: skin layers are not written (static models), morph targets are (weights 0); `palette-texture` without a palette falls back to a plain white material; `roughnessFactor` 1 is the glTF default and is left out by glTF Transform. | §5.19, §4.5. |
| M6A-B8-13 | **Lint severities**: every code has the §4.5 table's local / Ekza severities, `mesh.nonplanar-faceted` and `mesh.ngon-concave` both info / warning (fix round 1; the first build read the combined row per code as research 12 §10.3 has it, a deviation from the binding table; a table-driven test pins every row now); budget lints fire above the budget (the message cites the "warn above" figure); handheld rules run only for the registry profile `handheld-glb-v1`; `tex.size` is an error there through the profile's rule override. | §4.5 table; §5.24 "advisory warnings, never export blockers". |
| M6A-B8-14 | **Static read-back**, two halves. io (`readBackStatic`): parse, per-mesh triangle counts in writer order, indices in range, finite positions, every palette-textured vertex at a cell centre (≤ 1e-3 texel) of a cell holding a live swatch (cells rank the live swatches row-major, by image index in the writer's palette order; a palette without swatches samples its first cell). It returns `StaticReadBackReport` (`kind: 'static'`, `meshes`, `primitives`, `triangles`, `maxPaletteUvErrorTexels`, `deadCellVertices`, `three`), a subtype of the closed `ReadBackReport` whose animation fields stay 0 on this path (fix round 1; the first build reused `channels` and `maxTranslationErrorM`). three.js (`threeReadBack` in the lazy workflow): the written bytes load through `services.models` (in the browser io/three's `GLTFLoader` with the VRM plugin and decoders), the handle's `root` is traversed duck-typed (editor-core cannot import three), and the meshes (one per glTF primitive) and triangles must equal io's counts (`withThreeReadBack`; a mismatch or load error is the blocking `export.read-back`). Skipped (`three: null`) without a display loader (Node), while the kernel's gated loader has no renderer (`hasRenderer` false: a load would wait), or for a handle without `root.traverse`. Node tests run the same path with `loadGltfInNode` as the loader. | §6.2 "read-back (three GLTFLoader in the browser, the io/testing harness in Node)"; `DisplayModel.kind` is `'three'` and io/three's handle is the loaded model. |
| M6A-B8-15 | **Display controller**: a commit that adds, changes or removes an **edited** character mesh marks the character; a 500 ms debounce, then `requestIdleCallback` (2 s timeout; a 0 ms timeout without it) rebuilds; leaving Model rebuilds at once. The registry loads a display from `display.containerFor(runtime)` only for characters with edits (others load exactly as before), keeps the previous display until the new one is ready, and lets the latest load win. | §5.23. |
| M6A-B8-16 | **`file.exportModel` poll** sees the request's shape until its lazy pipeline has loaded, then the full check; a refusal is therefore a cancelled poll or a failed run with the same reason. | Keeps the check off the eager route. |
| M6A-B8-17 | `ExportRequest` has no `dropTangents` (contract); the bake reads `(req as {dropTangents?}).dropTangents` leniently, and a run refused for tangents fails with code `tangents` and the M7 reason. | §5.21 "unless the export request sets dropTangents". |

## Minimal edits in files other packages own (each additive)

- `editor-core/src/workflows/exportRun.ts`: the bake passes the character's edits (`opts.geometry`).
- `editor-core/src/index.ts`: exports of the B8 helpers.
- `tooling/make-synthetic-fixtures.mjs` and `tooling/test/make-synthetic-fixtures.test.mjs` (integration agent): the
  binary fixture, `--check` comparing bytes.
- Literal updates (§3 rule 7): `io/test/lint.test.ts` (rule-id pattern allows sub-namespaced codes; the profile list
  gains the handheld profile), `io/test/m6a-foundation.test.ts` (the landed entries instead of their stubs),
  `editor-core/test/m6a/foundation.test.ts` (`LANDED`: landed operators cancel with their own reasons).

### Contract notes for INT (files closed after B0a or owned by another package)

Each edit is additive and is the smallest that wires a B8 responsibility the B0a contract left without a slot. INT
accepts them into §9.1 or moves them.

| File (owner) | Lines | Why |
|---|---|---|
| `editor-core/src/app/kernel.ts` (closed after B0a) | the import of `createMeshDisplay`; `const meshDisplay = createMeshDisplay({ store, session, app: () => app, redisplay })` before `createCharacterRegistry`; `display: meshDisplay` in its context; `meshDisplay.dispose()` in `dispose` | §9.1 gives B8 "the display hook in `registry.ts`", but the registry's context has no session, mesh runtimes or app, which the §5.23 controller needs (leaving Model, the edited meshes' revisions). No B8-owned factory can reach them; a `factories/meshDisplay.ts` would still need the same three call sites in `kernel.ts`. |
| `editor/src/shell/createShell.ts` (B9) and `editor/src/test-api/createTestApi.ts` (closed after B0a) | `op === 'file.export' \|\| op === 'file.exportModel'` in the result branch of the UI run wrapper and of the test API's `run` (fix round 1, commits `feat(editor): lastExport() reports static-model exports`) | §4.8 "`lastExport()` also reports static-model exports"; the recorder fills lints and read-back only from those two branches (the download alone records bytes with empty lints and `readBack: null`). |
| `editor/src/test-api/m6a/mesh-runtime-doc.ts` (B7) | `meshes()` appends the virtual `asset` rows from editor-core's `assetMeshRows(app)` after the records | §4.8 puts the rows in B7's `meshes()`; B0a's notes: "the virtual asset rows are B7/B8's". B8 provides `assetMeshRows`; **B7 keeps these lines when it fills the file** (E2E-MOD-12 reads the rows). |

## Open items for the integration agent / owner

1. **In-app validator** (§1.1 row 12 "lazy glTF-Validator at export", `StaticExportRequest.validate` default true):
   `file.exportModel` validates through `services.validate`, which the browser services leave `null` (B7's
   `editor/src/services/browser.ts`), so static exports carry `validation: null` in the app (Node tests and e2e
   validate with the host validator). B8 cannot wire it in its own files: ARCHITECTURE §3's import rules allow
   `gltf-validator` in `editor/src/workers/**` only (`.oxlintrc.json`, a dynamic `import()` included), io never imports
   it, and editor-core has no dependency on it. Two routes, each an INT/owner decision:
   - the designed one (MVP-SPEC M1-stretch): `editor/src/workers/index.ts` (an empty placeholder today) calls
     `serveGltfValidator(self, await import('gltf-validator'))` from `@ekza-animator/io/worker`; `browser.ts` wraps
     `opts.createValidatorWorker` (already an `EditorProps` option, unused) with `createValidatorClient(worker)` and
     sets `validate: (bytes) => client.validate(bytes)`; `apps/web/app/editor/EditorIsland.tsx` passes
     `createValidatorWorker={() => new Worker(new URL(…, import.meta.url), { type: 'module' })}` (needs an editor
     subpath export for the worker entry and `@ekza-animator/io/worker` in the workers' import list);
   - or a main-thread lazy import in `browser.ts`, which needs `gltf-validator` added to `editor/src/**`'s import list.
   Either way `services.validate` is shared with `file.export`, whose M2a app path has no validator (bake into model
   would validate the source and the output on every export): the owner decides whether animation exports get it
   too. B8's side is done and tested (`mesh.io.static`: `validation.errors` 0 with a host validator).
2. **Compressed meshes in the browser**: io accepts `opts.decode`; editor-core has no decoder service to pass, so
   Draco/meshopt meshes are refused (`compressed`) by Make editable in the app (§5.21 step 3 wants the browser's
   decoders). It needs an `EditorServices` contract field (types.ts is closed), e.g. `decodeMesh` backed by io/three's
   `DRACOLoader`/`MeshoptDecoder` (whose import rules allow three), passed by `prepareMakeEditable` to
   `meshFromGltf(…, { decode })`. The io half is tested with an injected decoder (`mesh-from-gltf`).
3. **READY flag `b8`** for other packages: e.g. `!notImplemented(() => app.operators.poll('mesh.makeEditable', …))`
   (the poll no longer answers "not available yet"), or `writePaletteTexture([])` through `loadMeshIo()`.
4. The **eager route** grows by B8's share below; the M6a allowance decision (B0a notes) is still open.
5. INT un-fixmes `m6a-12`'s two gated tests: the loop-and-export part (`b3`) and the browser static export (`b7`,
   which needs `mesh.create.cube`; it asserts `readBack.three` and `lastExport()`; once item 1 lands it can also
   assert `validation`).

## Fix round 1 (review findings)

| Finding | Resolution |
|---|---|
| Re-bake after an emptied material slot put faces on the wrong material (major) | Fixed: the bake keeps the pre-rollback primitives of the meshes edited now as slot templates (M6A-B8-5). Regression: io `surgeon-geometry` (Seed-san head, [2, 3, 4] → A [2, 4] → re-imported, edited, re-baked: still [2, 4], faces per material kept, the marker still holds [2, 3, 4]) and its headless twin in `mesh.io.bake`; both fail without the fix. |
| In-app validator, browser three.js read-back, `lastExport()` for static exports (major) | Read-back: done in B8's lazy workflow through `services.models` (M6A-B8-14), tested in editor-core (every branch) and headless (a real three.js loader in Node). `lastExport()`: contract edit in `createShell.ts` (above), browser check `test.fixme('b7')`. Validator: needs ARCHITECTURE §3 import rules and the owner's decision on `file.export`; open item 1 gives both routes. |
| Draco/meshopt decoder not wired in the app (minor) | Open item 2 (an `EditorServices` contract field). |
| Edits in the closed `kernel.ts` and B7's test-API file (minor) | Contract notes above, with why no B8-owned factory can hold the wiring; B7 keeps the `assetMeshRows` lines. |
| `mesh.nonplanar-faceted` / `mesh.ngon-concave` severities deviated from §4.5 (minor) | Fixed to info / warning both; a table-driven test pins every §4.5 row (M6A-B8-13). |
| −0 did not weld with +0 (minor) | Fixed in the weld key (positions, weights, morph deltas); unit test with −0 in all three and a 1e-30 control (M6A-B8-3). |
| Static read-back reused the animation fields; "live swatch cell" was only a cell-centre check (minor) | `StaticReadBackReport` with dedicated fields; vertices on a cell without a live swatch fail the read-back (unit test) (M6A-B8-14). |
| `allEdgesHard` rebuilt the edge map per n-gon (minor) | The edge-flag map is built once per mesh in `meshCheckLints`. |

## Eager route

`check:size` (production build, gzip -9, first visit): B0a `864,427 B` → this branch **867,250 B (+2,823 B)**, gate
900,000 B. B8's eager code: the display controller and the registry hook (`workflows/meshDisplay.ts`), the two
operator registrations with their polls (`makeEditable.ts`, `exportModel.ts`), and the §4.5 lint rows (part of
`BUILTIN_EXPORT_PROFILES`). Everything else is lazy: the static export, the character edits, the display container and
Make editable's record (`workflows/exportModel.ts`), io/mesh, the kernel, the author writer and the surgeon step. A
first build had +4,366 B; moving those parts into the lazy chunk and compacting the lint rows saved 1.5 kB.

## Benchmarks (report only; Node 25, shared machine under load)

| Budget (§5.27) | Measured |
|---|---|
| Make editable ≤ 150 ms | Polybot body 1.4 ms; Seed-san head (10,550 triangles, 43 targets) 14.8 ms |
| Export one edited mesh ≤ 50 ms | Polybot body, `meshToPrimitives` + replace primitives: 18 ms |
| Rebuild ≤ 300 ms (Seed-san) | `rebuildContainer` + three.js load in Node: 147 ms |

## Gates (local, real Chrome; port 3169)

Fix round 1 (after its commits): `format:check`, `lint`, `typecheck`, `check:deps`, `check:fixtures`,
`check:licenses` green; `test` (turbo, `--force --concurrency=3`) 15/15 tasks: anim-core 671, doc 233, doc-yjs 78,
mesh-core 134, mesh-view 2, rig 202, **io 231 + 6 skipped** (the READY.b5 Mesh Check lint fixtures), **editor-core
802**, curve-editor 207 + 3 skipped, **headless-tests 191 + 1 skipped** (the READY.b7 `.ekzanim` round trip), viewport
100 + 1 skipped, editor 359 + 1 skipped, ui 87, web 10, tooling 16; `build` (`--force`) and `check:size` green
(**866,959 B**, the `mesh-kernel` boundary lazy); `m6a-12-make-editable-polybot.spec.ts` 1 passed + the `b3` and `b7`
fixmes; the full e2e suite (`EKZA_E2E_PORT=3169`, `--workers=4`) **110 passed, 12 skipped** (the `b9`, `b3` and `b7`
fixmes and the stretch entries). A throwaway browser run (not committed: a local patch let the made-editable Polybot
body export as a static model, since `mesh.create.cube` is B7's) showed the browser path end to end: `readBack.three`
= 1 primitive, 2,130 triangles (io's count), `lastExport()` with lints and read-back, glTF-Validator 0 errors.

First build: the same gates green at `6f6ed3c` (io 226, editor-core 800, headless-tests 189; `check:size` 867,245 B;
e2e 110 passed, 11 skipped). An earlier `test` run at `--concurrency=4` on the shared machine (load average ≈ 88)
timed out 12 editor browser tests; the editor suite alone and the final run were green.
