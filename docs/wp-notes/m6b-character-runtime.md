# M6b C1 — character runtime: build notes

Branch `m6b/character-runtime` (from `m6b/mvp` at `22b0e11`, `m6b/rig-contracts` merged in). Scope:
[M6B-SPEC §9.0 C1](../M6B-SPEC.md#c1--character-runtime) — §5.1 (characters from models, `skeletonFromDoc`,
`jointsFingerprint`, the `SkeletonDesc` rebuild rule, the registry hook through the lazy `character-runtime` chunk, the
debounced container rebuild), `measureSkinned`, the minimal `writeCharacter`, `SkinnedSurface`, §5.16 `updateAutoRig`
and `rig.autoRig.update`, CR-7. Decision IDs below are `M6B-C1-<n>`. READY flag `c1` is set in io, rig, editor-core and
mesh-core.

## What landed

| Item | Where |
|---|---|
| `measureSkinned` (typed-array core of the radii and the M2a foot support); `measureMeshes` delegates, outputs byte-identical | `io/src/skeleton/measure.ts`, `io/src/skeleton/radii.ts` (now a reader + delegation), `io/src/skeleton/support.ts` (u16 joints) |
| `skeletonFromDoc` measures the bound meshes (radii, support, mesh height) | `io/src/skeleton/fromDoc.ts` |
| Minimal character writer (joints 0…J−1, one skin, skinned and static meshes, palette materials, `VRMC_vrm` humanoid for `format: 'vrm'`), the display container, the export vertex layout | `io/src/character/index.ts` (behind `io/write` too), `io/src/character/vertices.ts` (`characterVertices`, no glTF Transform) |
| `updateAutoRig` rules 1–7 (ids, kind change, regenerated vs kept fields, prop/socket controls, visible new secondaries, removed bones, stale offsets); joint keys for model skeletons | `rig/src/autorig/{update.ts,model.ts,autoRig.ts,generic.ts,shapes.ts}` |
| The model-character hook (eager) and the runtimes (lazy) | `editor-core/src/characters/model.ts` (+ 3 lines in `registry.ts`, 1 line in `app/kernel.ts`), `characters/modelRuntime.ts`, `characters/modelInput.ts`, `characters/runtimeEntry.ts` |
| Debounced container rebuild | `editor-core/src/workflows/characterDisplay.ts` |
| Operators `mesh.importStatic`, `char.fromModel`, `char.adopt`, `rig.autoRig.update` (+ `createModelCharacter`, `prepareSources`, `adoptMeshes`, `prepareAutoRig`, `writeAutoRigUpdate` for C2/C4) | `editor-core/src/operators/builtin/rig/{character.ts,autorig.ts}` |
| CR-7: `mesh.primitive.set` refuses skinned meshes | `editor-core/src/operators/builtin/templates.ts` (`PRIMITIVE_SKINNED`) |
| `SkinnedSurface` (CPU skinning, `skinIndex`/`skinWeight` corner attributes, partial weight uploads, `cpuSkin`) | `mesh-view/src/skin/index.ts` |
| The Rig & Skin skinned display host (one `SkinnedSurface` per bound mesh of the active character) | `viewport/src/rig/skinned/index.ts`, exported from `viewport/src/rig/index.ts` (lazy) |
| Test API `skeleton`, `skeletonDesc`, `containerVersion`, `posedPositions` | `editor/src/test-api/m6b/character-runtime.ts` |
| Tests | `io/test/m6b/character-runtime/*`, `rig/test/m6b/autorig-update.test.ts`, `editor-core/test/m6b/character-runtime.test.ts`, `mesh-view/test/skinned.test.ts`, `viewport/test/m6b-skinned-display.test.ts`, `headless-tests/test/m6b.character.runtime.test.ts`; P-C6 rows of C1 turned `checked` in `editor-core/test/m6b/keys-hash.test.ts`; `foundation.test.ts` expects the landed polls |

## DoD checks (§9 C1)

| Gate | Test | Result |
|---|---|---|
| `skeletonFromDoc` of a records copy of Seed-san ≡ `skeletonFromGltf` on the joint subset | `io/test/m6b/character-runtime/from-doc.test.ts` | pass (M6B-C1-4) |
| `skeletonFromGltf(writeCharacter(records))` ≡ `skeletonFromDoc(records)` on the generated body (smooth, segmented) and the Cube Lad, also after renaming a mesh and adding a static mesh | same file; the production-kernel twin in `headless-tests/test/m6b.character.runtime.test.ts` | pass |
| `measureMeshes` byte-identical to M2a on the three fixtures | `io/test/m6b/character-runtime/measure.test.ts` (against a frozen copy of the M2a module) | pass |
| `char.fromModel` undo restores the scene meshes bit-equal; adopted meshes `generator: null` | `editor-core/test/m6b/character-runtime.test.ts` | pass |
| `updateAutoRig` keeps ids and curves when a knee moves, keeps `edited`, soft-deletes removed bones, visible `sec.*` for a new tail, `sock.*`/`prop.*` | `rig/test/m6b/autorig-update.test.ts`, the editor-core knee test | pass |
| P-J6 (renaming joints keeps every control id and the keys hash) | rig (fast-check over renames) and editor-core (keys hash) | pass |
| A weight edit neither rebuilds the SkeletonDesc nor recompiles | editor-core (`skeletonBuilds`, `compiles`, same `program`/`skeleton` objects) | pass |
| The `character-runtime` chunk loads in Animate for a model-sourced project and never on the first-visit route | headless (save → open in a fresh app, workspace `animate`); `check:size` lists "character runtime (model-sourced characters)" as a lazy group (13.9 kB gzip, budget 150 kB) and no boundary violation | pass |
| Container rebuild ≤ 300 ms (3k tris, 34 joints, with `ModelLoader`) | headless bench with a three.js loader in Node (annotation); editor-core bench without the loader | report-only, see Benches |
| SkinnedSurface pixel probe of a posed elbow | `mesh-view/test/skinned.test.ts` (local Chrome GPU) and the viewport host test | pass |
| C1 eager delta ≤ 512 B | `check:size` | +371 B (route +1,906 B over the MVP baseline; C0 recorded +1,535 B) |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6B-C1-1 | **`measureSkinned` input gains three optional fields**: `parents` (the ancestor fallback), `skinned` (the nodes of the skins; default: every node a vertex weights) and `feet` (the M2a lower-leg → foot regions); `NO_NODE = 0xffff` marks a slot whose joint is not a node. The §4.4 signature had no parents or humanoid, so M2a's outputs could not be reproduced through it. | §9.1 "measureMeshes delegates, outputs unchanged" is binding; additive optional fields keep the contract shape. |
| M6B-C1-2 | **`skeletonFromDoc(input, {vertices})`**: the radii are a nearest-rank percentile over *vertices*, and the writer splits points into vertices by normal, UV and material, so measuring points gives radii a few mm off the written file's (up to 3 mm on the generated body: outside the gate's 1e-4 H). The optional second argument takes each bound mesh's export vertices (`characterVertices`, the writer's own `meshToPrimitives` call); with it the radii equal skeletonFromGltf's on the written file. Without it the points are measured (≤ 1 % H apart, asserted). The runtime and `rig.autoRig.update` always pass the layout. | §5.1 equality gate (radii within 1e-4 H) with the writer as the reference. |
| M6B-C1-3 | **Segments of `skeletonFromDoc`**: humanoid chain child, else first joint child, else the point — never `JointRecord.tail` (glTF cannot carry it, so the read-back would differ). Every joint counts as skinned when a bound mesh exists (the writer's one skin lists every joint). Rest worlds compose the derived rest locals (as the rig does). | Same equality gate. |
| M6B-C1-4 | **The Seed-san records copy** (the gate's fixture, test code): eight finger roots sit under transform nodes (`robo_palm.*`), copied as helper joints (parents and rest locals compared against the glTF nodes of the same names; the radii of the helpers and of their parents are not compared, since a helper child ends the parent's segment where glTF ends it at the first *joint* child); a few Seed-san joints carry rest scales within 0.2 % of 1, which `JointRecord` cannot hold, so the fingerprint is compared with the file's rest scales set to 1; vertices are placed like skeletonFromGltf places them (dominant joint's rest world · inverse bind). | The copy is as faithful as records allow; nothing in the runtime depends on it. |
| M6B-C1-5 | **Minimal writer**: `VRMC_vrm` = `{specVersion: '1.0', humanoid}` spliced into the written JSON (no meta: C10 replaces the splice with the writer-side extension class and the meta, licence, thumbnail, clips, swatch shaders); palette materials for every mesh (asset-backed meshes' own materials are C10's); palette keys that name no live joint write joint 0; `prop` unused (no Attach Prop in the MVP). The display container is a plain GLB (`format: 'glb'`), so three-vrm never parses a meta-less VRM; the runtime maps nodes through its own SkeletonDesc. | §5.22 "C1 minimal; C10 full". |
| M6B-C1-6 | **No duplicated glTF Transform**: `writeCharacter`/`synthesizeContainer` are also exported from `io/write` (one line in `io/src/write.ts`, outside C1's dirs — INT to approve) and the runtime reaches them through `loadWritePath()`; `characterVertices` lives in `io/src/character/vertices.ts` without glTF Transform. The chunk no longer re-exports mesh-core's `readSkin` (it uses the loaded kernel's), which had pulled mesh-core code (and its size marker) into it. Result: character-runtime 13.9 kB gzip; glTF Transform only in the export-path chunk. | §2.1 "glTF Transform is shared with M6a's lazy author writer, not duplicated"; the first build had it in both chunks (46 + 55 kB). |
| M6B-C1-7 | **The registry hook**: `withModelCharacters(base, ctx)` (`characters/model.ts`, eager, ≈ 370 B) wraps the asset registry; the first time the document holds a model character it loads the chunk, whose `createModelCharacters` serves model characters and delegates the rest to the base registry. registry.ts changes: the wrapper call, the `app` getter in its context (and its import); kernel.ts passes `app: () => app` (one line). The chunk's entry function references `CHARACTER_RUNTIME_MARKER` itself (the importer's `typeof` check was constant-folded away, so no build carried the marker). | §9.1 "one-line hook"; §0.4.9 C1 allowance 512 B. |
| M6B-C1-8 | **Rebuild triggers** (per batch, `workOf`): joints of the skeleton, the skeleton record, a mesh whose binding (`MeshRecord.skin`) changes (bind, unbind, a bound mesh created or deleted) and the rig record (Update Control Rig re-measures) rebuild the SkeletonDesc and recompile; controls/constraints/solvers recompile; any change of the character's meshes or groups, palettes or swatches marks the container. A rebuild whose joint hierarchy (names, parents) changed rebuilds the container at once (the old display's node mapping no longer fits); otherwise on idle. Mesh data must be resident for a synchronous rebuild (the usual case); otherwise it waits for the runtimes. | §5.1 "When it runs". |
| M6B-C1-9 | **Display**: in Model the ModelLoader display is hidden (`root.visible = false`; mesh-view draws the character's meshes at bind pose there, shipped M6a behaviour for character-owned records), shown elsewhere. The Rig & Skin skinned host (`SkinnedCharacterDisplay`) is built and tested but **not mounted**: mounting belongs to the Rig & Skin shell (C7) or the weight display (C6) — `loadViewportRig().then((rig) => rig.attachSkinnedDisplay(app, vm, meshView, {theme}))`; while mounted it hides the ModelLoader display's skinned meshes (its static meshes stay). Until then Rig & Skin shows the kernel-posed ModelLoader display (weights refresh with the debounced container). | §5.1 Display; viewport mounting is outside C1's dirs. |
| M6B-C1-10 | **SkinnedSurface skins on the CPU** (positions and corner normals per pose version, ≈ 0.2 ms at 3k points) and writes per-corner `skinIndex`/`skinWeight` attributes for C6's display and a later GPU path; `setWeightDisplay` records the state and uploads nothing (C6 draws it under `skin/display/**`); `uploadedBytes` reports the last weight upload for the §5.25 gate. | §5.25 budgets hold on the CPU path; C6 owns the weight shader. |
| M6B-C1-11 | **`char.fromModel`**: the skeleton is created without joints (`preset: 'custom'` unless the caller passes one) and the rig empty (humanoid generator, `AUTORIG_VERSION`, the fingerprint of no joints, `EMPTY_FINGERPRINT`); C2's template/Quick Rig operators call `prepareSources` (prepare) and `createModelCharacter` (apply) and then write joints and run `writeAutoRigUpdate` in the same transaction. Adopted meshes keep `source` and asset materials, their pivot is carried by the freeze. Refusals carry codes `char.skinned-source` and `char.scale` (with Freeze Transformations as the failure's action). | §5.1, §6.1. |
| M6B-C1-12 | **`mesh.importStatic`**: scope `global`, workspaces Model and Rig & Skin (Create › Import Static Model…); one scene mesh per glTF mesh *instance* in scene order with its world placement (a skinned node: identity); `dropSkin` (CR-AR-6) is accepted as an untyped arg (`operators/args.ts` is closed); skinned files fail with `import.skinned`; `meshFromGltf`'s licence gate applies. | §5.1, §0.10. |
| M6B-C1-13 | **`rig.autoRig.update`**: params `ikLegs`/`ikArms`; without them the rig keeps its current limb IK (legs on, arms off for a rig without controls, Q-RIG-2); writes the difference (patches, puts for new records, restores, soft-deletes); warnings and stale offsets toasted once. `updateAutoRig` also keeps `locked` channels of existing controls (user state the rule list does not name). Prop controls of generic rigs have no `root` control to parent to (parent null); sides of prop/socket controls come from the joint names. | §5.16. |
| M6B-C1-14 | **CR-7** is a poll failure with `PRIMITIVE_SKINNED` ("Primitive parameters are frozen on a skinned mesh"; the refusal code `primitive.skinned` is the constant's name in the doc comment); no throw in `prepare` (the poll always runs first; eager bytes). | §0.4.1. |
| M6B-C1-15 | **New lazy files** under `editor-core/src/characters/` (`modelRuntime.ts`, `modelInput.ts`) beside the listed `model.ts`/`runtimeChunk.ts`; `modelInput.ts` is meant for C10's export (the same records → writer input). | Keeps the eager file small. |

## Benches (report-only; this machine, load average 11–30)

- `updateAutoRig`, Standard 33 (34 joints): 0.17 ms (budget 5 ms; rig test annotation).
- Container rebuild + three.js load in Node, generated body (494 tris, 34 joints): 4.6 ms per `redisplay` (budget
  300 ms; headless annotation). The browser's `ModelLoader` adds its GPU uploads; not measured here.

## Handoffs

- **C2**: `skel.template.create` / `skel.quickRig.commit` call `prepareSources` + `createModelCharacter`; every joint
  edit calls `prepareAutoRig()` in `prepare` and `writeAutoRigUpdate(app, tx, character, libs)` in `apply`; joint keys
  unique per skeleton (M6B-C0-23).
- **C4**: the first bind of a character without controls runs `writeAutoRigUpdate` in its transaction.
- **C6 / C7**: mount `attachSkinnedDisplay` in Rig & Skin; C6 draws the weight display from the surface's attributes
  and `weightDisplay`.
- **C10**: the export reuses `characters/modelInput.ts` and `writeCharacter`; replace the `VRMC_vrm` splice with the
  extension class and the meta; asset materials; clips; drop the C1 rows from `io/test/m6b/contracts.test.ts` if
  touched there.
- **INT**: approve the one-line `io/src/write.ts` export (M6B-C1-6) and the `kernel.ts`/`registry.ts` hook lines.

## Gates (local, real Chrome GPU; port 3161)

`EKZA_E2E_PORT=3161 pnpm run ci` on `496f272`: **exit 0**.

- format:check, lint, typecheck, check:deps, check:fixtures, check:licenses: pass.
- test (turbo): editor-core 1352, mesh-core 905, anim-core 671, editor 521 (+1 skipped), io 271, doc 263, viewport 244
  (+1 skipped), rig 242, curve-editor 209 (+3 skipped), headless 196, ui 94, doc-yjs 85, mesh-view 78, web 22, tooling.
  No skip added.
- build: pass. check:size: 891,480 B (gate 900,000 B); MVP eager delta +1,911 B (C0 recorded +1,535 B: C1 ≈ +376 B,
  allowance 512 B); `character runtime (model-sourced characters)` 13.9 kB lazy; no boundary in the initial route.
- test:e2e (project `chrome`): 219 passed, 23 skipped (the existing skips), 1.9 min. C1 owns no e2e scenario.
- The first run of the gate (`35db65f` + notes) failed one editor-core test under load average ≈ 43
  (`m6a/mesh-io.test.ts` "displays the rebuilt container…", a 30 s timeout; 2.4 s alone, green in the rerun).
- The 3161 server was Playwright's own and stopped with the run; the port is free.
