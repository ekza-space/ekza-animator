# M6a B0a — contracts, schema v3, mesh-core interfaces + reference, undo eviction: build notes

Branch `m6a/contracts-foundation` (from `m6a/spec` at `ec541b4`). Scope:
[M6A-SPEC §9 B0a](../M6A-SPEC.md#b0a--contracts-schema-v3-mesh-core-interfaces--reference-undo-eviction-integration-agent-first)
with the shared-file roles of §9.1. Decision IDs below are `M6A-B0A-<n>`.

## What landed (by spec responsibility)

| B0a item | Where |
|---|---|
| (1) §4 types verbatim | `anim-core/src/params/types.ts` (§4.1), `doc/src/{ids,records,store}.ts` (§4.2), `mesh-core/src/types.ts` (§4.3), `mesh-view/src/types.ts` (§4.4), `io/src/types.ts` (§4.5), `editor-core/src/types.ts` and `editor-core/src/operators/args.ts` (§4.6, the §6 `OperatorMap` rows), `editor/src/test-api/types.ts` (§4.8). New contract files are excluded from formatting in `biome.json` like the shipped ones. |
| (1) stubs (`EkzaError('not-implemented', '<package>.<symbol>')`) | mesh-core `stubs/{op,select,soft,symmetry,check,subset,frame,templates}.ts` and every `ops/<dir>/index.ts` (run → `refuse('not-implemented', …)`); mesh-view classes (constructors throw); io `mesh/index.ts`, `surgeon/replacePrimitives.ts`, `export/author/index.ts`; editor-core `MeshRuntimeRegistry.beginOp/commitOp/commitSetOp`, the component selection writers, `NumericCaptureApi.arm/openCard`, `ExtrudeSessionApi.setManipSpace`; every test-API group function an owner has not landed |
| (2) schema v3 (one commit, `47a64bc`) | ids and `derivedId`; the seven tables with partition (joints through `PartitionLookup.skeletonCharacter`), merge unit, validation, repairs, `referencesOf`, queries; `CORE_MIGRATIONS[1]` (2 → 3); `requiredWriterVersion` 3 for live v3 content; `CharacterRecord.source` with every shipped `asset` read narrowed (character registry, `deps.loadModel`, import/export workflows, `AttributesPanel`); memory store and `doc-yjs` (inherits the core) |
| (3) undo eviction and history | `PatchUndoManager.entries()/onEvict/evictOldest/clearRedo` (doc, inherited by doc-yjs) and the editor-core naive store; `EditorHistory.recordSelection/onDrop/dropOldest`, selection-aware `isEmpty` and pruning, limit drops paired with `evictOldest`, doc evictions taking the doc part (`editor-core/src/history/history.ts`); `TxMeta.selectionBefore/After` as a superset of `SelectionSnapshot` (`session/selection.ts`) |
| (4) ParamDef helpers, SHA-256 | `anim-core/src/params/index.ts` (`paramDefaults`, `paramSchema`, `coerceArgs` with `passThrough`, `stripBound`, `primaryParam`, `assertParams`), `anim-core/src/hash/sha256.ts` (streaming, non-copying); io and doc keep their wrappers and results |
| (5) mesh-core | §4.3 types; `BitSet` (tagged encoding, the smaller of raw and runs); `selectionOf`; `refuse`/`isRefusal`; the reference kernel in `reference/**` (edit links and an exact write log, revision codec with canonical tails, triangulation, normals, `validateMesh`, `topologyStats`, cube/plane/cylinder); the `./descriptors` barrel with every §6.1 descriptor and `PRIMITIVE_PARAMS`; `MESH_OPS`/`MESH_SET_OPS` behind `KERNEL_MARKER` |
| (6) editor-core services | `workspaces` (Animate, `workspaces/index.ts`) and `markingMenus` registries; one factory file per service (`app/factories/{meshes,components,capture,extrude}.ts`); memory `BlobStore` (`services/blobs`); the stub `MeshRuntimeRegistry` over the reference kernel behind the one lazy loader (`mesh/index.ts`); `meshOperator`/`meshSetOperator` (`mesh/operator.ts`); the component selection stub (`selection/index.ts`); the no-op `LastRun` hook (`operators/runner.ts`); `RunContext.source` from the keyboard adapter (`'keyboard'`) and menus (`'menu'`) |
| (7) operators | every §6.1 op (`operators/builtin/mesh/index.ts`, from the descriptors) and every §6.2 operator in its stub file (`selectMesh`, `hide`, `mode`, `softSelect`, `symmetry`, `pivot`, `snap`, `extrudeSession`, `lastop`, `palette`, `imagePlane`, `create`, `templates`, `scene`, `makeEditable`, `exportModel`, `workspace`, `keymapShadows`; `edit.adjustLast`/`edit.repeatLast` in `edit.ts`), registered from `operators/builtin/index.ts`; each carries its final metadata (params, extraArgs, workspaces, flags, aliases) and poll-fails |
| (8) test API and URL parameters | `test-api/types.ts`, `test-api/index.ts`, `createTestApi.ts` spreading the owner files `test-api/m6a/{shell-workspaces,mesh-runtime-doc,model-select-ui,model-transform-tools,model-ops-ui,model-content,integration}.ts`; kernel-level functions `workspaces`, `resolveKey`, `meshes`, `meshInfo`, `meshNormals`, `history`, `blobs` and the `state()` additions; `ws=` (any build) and `platform=` (shipped) |
| (9) packaging, tokens, size | `mesh-core`/`mesh-view` manifests and subpaths, dependencies (earcut 3.2.4, robust-predicates 3.0.3 with its reviewed licence exception, three-mesh-bvh), `check-deps` allow-lists, oxlint layering, `transpilePackages`, project references; §8.9 tokens with 3:1 contrast rows against `--comp-halo`; the `mesh-kernel` and `mesh-view` BOUNDARIES of `check:size` |

## Working baselines (never throwing)

The migration and `requiredWriterVersion`; `referencesOf`; queries (including the mesh/group hierarchy cache);
`entries()`/`onEvict`/`evictOldest`/`clearRedo`; history selection parts; the reference `editMeshFrom`, revision codec,
triangulation, normals, `validateMesh`, `topologyStats` and three primitives (`setKernelDebug(true)` in the mesh-core,
editor-core and headless-tests setups, and `kernelDebug: true` in the fake services of every test app, runs the real
validator); the memory `BlobStore`; the Animate workspace definition; the shipped keyboard
scope chain (B0b extends it); `LastRun` recording as a no-op; `CharacterRegistry` ignoring model-sourced characters.
Beyond the list: `MeshRuntimeRegistry` runtimes reach `ready` for revisions in resident blobs and `writeData` works
(M6A-B0A-14); the component selection, capture and extrude stubs answer their "nothing stored / no session" reads.

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B0A-1 | **three-mesh-bvh 0.9.15**, not the spec's 0.9.16: the workspace's `minimumReleaseAge` (14 days) refuses 0.9.16 (10 days old on 2026-10-19). | The release-age rule is binding; B6 bumps when it is old enough. |
| M6A-B0A-2 | **B0a additions to §4.6** (marked "B0a addition" in `types.ts`): `recordSelection(part, label, opts?: { repeat?: boolean })`, `RunContext.repeat`, `OperatorContext.source`/`repeat`, `EditorServices.kernelDebug`. | §5.6 coalesces only auto-repeated parts, which the history cannot tell without the flag; §3 rule 8 needs the debug switch passed through `createBrowserServices`. |
| M6A-B0A-3 | **Repeat coalescing**: a part with `opts.repeat` merges into the top step only when that step is the selection-only step the previous `recordSelection` created (same kind; same gesture for 'select'), redo is empty and nothing was recorded or navigated since; the merged part keeps the first `before`. Every other part is a new step. A selection step clears redo in the history (`onDrop … 'redo-cleared'`) and in the doc (`UndoManager.clearRedo()`). | §5.6 "one step per gesture". |
| M6A-B0A-4 | **Drops**: every step leaving the history for good is reported to `onDrop` once, in one call per event: undo steps oldest first, then redo steps next redo first. Undo steps leaving through the step limit or `dropOldest` evict the doc entries up to the newest entry they own (`evictOldest(k)`), so no doc entry outlives its step (older doc entries owned by no step go with them; a step that evictOldest empties joins that drop's call). Entries the doc evicts on its own (`onEvict`) take the doc part from their steps; steps left without any part leave and are reported with the doc reason mapped: `limit` → 'limit', `budget` → 'budget', `redo-cleared` → 'redo-cleared', `clear` and `load` → 'clear'. A doc `redo-cleared` (a new transaction after an undo, or `clearRedo()`) takes the **whole** history redo with it, as the next `record` would. The other way round (§12 S20), a `record` that drops redo steps while the doc still has redo entries (an override-only step after undoing a doc step) calls `UndoManager.clearRedo()`, so no doc redo entry outlives its step; the doc redo is non-empty only right after navigation, when the doc is not capturing, so coalescing is unaffected. A document load reports the doc-only steps 'clear' and the kernel's capture then clears the rest ('clear' again). `HISTORY_LIMIT` stays 1,000 steps (shipped); the doc keeps 500 entries, so its own limit usually evicts first. `KernelHistory.steps()` reads both stacks (tests; `labels()` maps it). | §4.6 "steps leaving the history for good", §5.6, §5.20; the 1,000-step limit is shipped behaviour that no M6a row changes. |
| M6A-B0A-5 | **Selection snapshots** (`TxMeta.selectionBefore/After`): the stored value is `{kind: 'ekza.selection', controls, keys, channels, objects, componentMode, hilite, meshes}`, a superset of the shipped shape and of §4.6 `SelectionSnapshot`; shipped snapshots read as `objects: []`. Restoring sets controls, keys, channels and objects (live ones only); it never changes the component mode or the hilite; per-mesh selections go through `app.components.restore` (the stub reports them skipped). | §9 B0a (3) "the shipped snapshot shape is a subset … read compatibly". |
| M6A-B0A-6 | **Load-time repairs** run in `migrateSnapshot` (per-record repairs of the §4.2 rules table and the mesh/group hierarchy: dangling, cross-owner and mesh-of-group parents → null, cycles broken at the smallest id, unique live mesh names per owner). Writes still reject records that introduce problems; remote batches are applied as received (ADR 0011). | MVP-SPEC §3 rule 6 (repair, never reject) on load; write validation unchanged. |
| M6A-B0A-7 | **doc exports beyond §4.2**: `derivedId`, `assetMime`, `repairRecord`, `repairHierarchy`, `RepairResult`, `referencesOf`, `Reference`, `scopeFieldOf`; `doc/testing` gains the v3 record makers and `withSchemaV3`. | Implementation modules of §4.2 signatures; tests and B7/B8 need them. |
| M6A-B0A-8 | **Reference kernel scope**: triangulation implements the full §5.4 rules (quad diagonal rule and `FACE_FLIP_DIAGONAL`, fan for convex faces, earcut on the Newell plane otherwise), normals the full corner rule (angle weights, hard/border/non-manifold splits, custom normals); `validateMesh` checks attribute layer lengths (count × comps of their domain) under invariant 1 like the stored arrays; primitives carry the `paint` layer at slot 0; `color0` defaults to white `[1, 1, 1, 1]`. Euler operators throw `not-implemented`. | B6/B7/B8 build on real derived data until `READY.b1`; B1 replaces `reference/**`. |
| M6A-B0A-9 | **Descriptor encodings** (§6.1 rows): object-only rows have `kinds: 'object'` (with `flags.whole` where the op ignores the selection); "<kinds>, object" rows list their component kinds; selection- and pointer-bound params are hidden and nullable when they have no default; labels follow Maya (`mesh.transformComponents` "Move", "Spin Edge", "Assign Colour", "Apply Transform", "Replace Swatch"); `mesh.cleanup` fix codes are `select`, `deleteLamina`, `collapse`, `conform`, `triangulate`, `dissolve`, `deleteLoose`. A table-driven test checks every row against a transcription of §6.1. | §6.1 leaves these encodings to the contract author. |
| M6A-B0A-10 | **mesh-core file placement**: `bitset.ts`, `selection.ts`, `refusal.ts`, `paramKit.ts` (ParamDef shorthands), `primitiveParams.ts`, `constants.ts`, `stubs/*.ts`. | §4 placement rule: implementation modules, re-exported from the barrels. |
| M6A-B0A-11 | **io**: `writeProjectArchive` accepts the blob closure and ignores it, `readProjectArchive` returns `blobs: new Map()` (B7 writes and verifies `blobs/`); `PROFILE_OMOBA_HANDHELD` is exported data, not registered (B8). | §9.1: `io/src/project/**` is B7's, profiles B8's. |
| M6A-B0A-12 | **BlobStore `fresh`**: every `put` adds the id; a completed `sweep` frees what is neither reachable nor fresh and then clears `fresh`. `closure` reads manifest JSON (`layers[].chunks`) without the kernel. `get` re-hashes and rejects `blob-missing`/`blob-corrupt`. | §5.20 sweep rule: a sweep never frees what a commit in progress just stored. |
| M6A-B0A-13 | **Autosave**: editor-core passes the closure of every live mesh revision and a blob reader to `AutosaveStore.write`; the browser store ignores them until B7 and its `read` answers `blob: () => undefined`. | §9.1: autosave is B7's; the contract compiles from B0a on. |
| M6A-B0A-14 | **Stub runtime registry**: one runtime per live record with `data`; `loading` until the lazy kernel loads (the first record with data, a `mesh.*` poll, or `loadMeshKernel()`), then `ready` from resident blobs or `error` ("Mesh data is missing …"); triangulation and normals cached per version; `open`/`close` build and drop edit links; `writeData` writes a whole revision (blobs, `rev + 1`, `base`). `kernelDebug` is applied when the kernel loads. `settled()` lets tests wait for the load. | §9 B0a (6) "runtimes reach `ready` for revisions it can read". |
| M6A-B0A-15 | **Operator stubs**: category = the id's first segment; key scope `model` for Model-only operators, `global` for `workspace.set`, `view.shading`, `view.display.set`, `ui.*`, `edit.adjustLast`, `edit.repeatLast`, `file.exportModel`; `workspaces: ['model']` where §8 lists them only in Model. `model.animateOnly` carries its final reason ("Keys and poses are set in Animate", B0b adds the shadow rows); `select.mesh.pickWalk` poll-fails "Component pick-walk arrives later" (stretch). B9's `view.shading`, `view.display.set` and `ui.*` stubs live in `workspace.ts`. | §6.2 owner column; the registration test checks every row. |
| M6A-B0A-16 | **Runner**: `operatorContext` passes `source` and `repeat`; a `LastRunRecorder` hook (`deps.lastRun`, default `recordNoLastRun`) runs after every finished run with the step id it recorded. `coerceArgs` in the runner is B11's (§9 B11), so `params` are not coerced yet. | §9.1: runner is B11's after B0a. |
| M6A-B0A-17 | **Keyboard adapter**: dispatches carry `source: 'keyboard'` and `repeat: true` for auto-repeats; `isTapHoldKey` receives the scope chain and `{mod, shift, alt, ctrl}` (`mod` = Cmd on macOS); the keymap keeps answering only `Space` (B0b adds `KeyB`). Menu-bar runs carry `source: 'menu'`. | §4 intro: the `isTapHoldKey` change is B0a's to pay; §9 B0a (6). |
| M6A-B0A-18 | **`ws=<id>`** is read in any build (1–32 of `[a-z0-9-]`, starting with a letter); a registered, enabled workspace becomes `session.workspace` at boot (B9 routes it through `workspace.set` and the layout swap). Only Animate is registered until B9. | §4.8. |
| M6A-B0A-19 | **Kernel debug switch**: on in e2e mode (`EditorRoot`) and in development builds (`EditorIsland` passes `NODE_ENV !== 'production'` or the e2e build flag); in tests through the `test/setup.ts` of mesh-core, editor-core and headless-tests and through `createFakeServices()` (`kernelDebug: true`), so every test app's runtimes validate. | §3 rule 8 ("every test setup"). |
| M6A-B0A-20 | **Test API**: `resolveKey` resolves over the shipped `<panel>` → `global` chain (B0b replaces it with the §5.17 chain); `meshes()` lists records only (the virtual `asset` rows are B7/B8's); `blobs().historyBytes` is 0 until B7; `history()` reads `historyLabels(app.history)` (new editor-core export; `KernelHistory.labels()`). | §4.8 group owners. |
| M6A-B0A-21 | **Tokens**: the 19 §8.9 colours in `ui/tokens.json` (generated into `css/tokens.css`); 3:1 rows against `--comp-halo` for the 14 glyph colours (vertex, selected, hover, wire-mode wire, face/vertex normals, face front/back, symmetry plane, lint n-gon/error, soft 1–3). `--wire`/`--hard-edge` equal the halo; `--soft-4` (ramp end) and `--clay` (a surface) are not glyphs. | §8.9 "the tokens CI contrast check gains these rows". |
| M6A-B0A-22 | **Placeholder dialogs** for the new `UiDialog` names (`makeEditableReport`, `imagePlaneImport`) in `dialogs/PendingDialog.tsx`; B8/B13 replace them. | `DialogHost` maps every dialog name to a chunk. |
| M6A-B0A-23 | No per-package `lint` script for `mesh-core`/`mesh-view`: the repository lints with one root `oxlint --type-aware` run (no package has its own lint script). | §2 asks for scripts "like the other packages". |
| M6A-B0A-24 | **e2e**: `m6a-00-foundation.spec.ts` checks every §6.1/§6.2 operator, the M6a test API in Animate and `ws=`; the Model-tab test is declared `test.fixme('b9: …')` (the §3 rule 4 gate form, blocking id first) until B9 registers the Model workspace. | No E2E-MOD scenario belongs to B0a. |
| M6A-B0A-25 | **Pruning is not a drop**: a step that loses its last part outside a doc eviction disappears without `onDrop` — its doc entry taken over by a later step (store coalescing past an override-only step), its doc entry cancelled out by coalescing (capture outcome `removed`), `forgetDocEntries()`, `dropOverrides()`. Such a step holds no part (no doc entry, overrides or selection part), so nothing a drop listener counts or releases. `HistoryDropReason` has no member for it; adding one is a §4.6 contract change. | §4.6 lists four reasons; selection parts are never pruned. |
| M6A-B0A-26 | **`entries()` cost (deviation from §4.2 "O(1) to obtain")**: the two frozen views are cached and rebuilt on the first read after a stack change — O(n) once per change (n ≤ 500), O(1) for every further read until the next change. Incrementally maintained views would mean a second, reversed redo array updated at every stack operation. | Readers (B7's refcounts, GC, the budget check) read once per batch or sweep. |
| M6A-B0A-27 | **Coalescing is not an eviction (B7 must handle it)**: when a transaction coalesces into the top doc entry, `PatchUndoManager` replaces that entry by a merged one with the same `txId` (earliest `before`, latest `after`), and pops it when the edits cancel out. Neither is reported to `onEvict`, and `entries()` simply shows the new state. An intermediate `meshes.data` value written by the first transaction disappears from history this way. B7 either never sets `coalesceKey` on mesh commits (recommended: one commit per op), or re-counts the top entry when a local batch coalesces (capture's `classify`: same `txId`, new entry object = `coalesced`; top entry gone = `removed`). | §4.2 lists five eviction reasons; a coalesced entry has not left the manager. |

## Eager route (DoD: "grows by ≤ its share of the +20 kB budget and holds no kernel or view code")

Production builds, `check:size` (gzip -9, first visit): base `ec541b4` **845,267 B** → this branch **864,407 B**
(**+19,140 B**, of which fix round 1 added +243 B for the history's doc-eviction reporting; gate 900,000 B, headroom
35,593 B). The kernel and the view are lazy: the `mesh-kernel` boundary is an 18.8 kB lazy group and neither marker is
in the initial scripts (`mesh-view` has no code in the route yet). **The "no kernel or view code" half of the DoD is
met; the "≤ its share" half is not decided** (below).

Attribution (`ANIMATOR_SOURCE_MAPS=1`, `attribute-chunks.mjs`, base vs branch, first round): editor-core +9.1 kB
(operator stubs and registrations +3.7, `mesh/index.ts` +1.4, history +0.7, session +0.6, blob store +0.5, selection
stub +0.5, app wiring +0.5, workspaces +0.4, prefs +0.4), doc +4.6 kB (validation of the seven tables +1.5, repairs
+1.8, queries +0.7, undo and references +0.6), mesh-core descriptors +4.6 kB (31 descriptor files, `paramKit`,
`PRIMITIVE_PARAMS`), anim-core SHA-256 +1.3 kB against io/doc −1.7 kB (the moved digest core), editor +0.7 kB
(test-API placeholder entries, parameters, keyboard). A fix-round-1 attribution of the branch gives the same picture
(mesh-core 4.6 kB in the route, all of it descriptors, `paramKit` and `PRIMITIVE_PARAMS`).

### Decision requested (INT / owner): the M6a eager allowance

§5.27 allows every M6a package together **+20,480 B** over the M2a baseline (MODELING-PLAN R38: for B0a, B0b and B9),
and §9 B0a's DoD asks for "≤ its share", which neither document quantifies. B0a alone adds **+19,140 B (93 %)**.
About 13 kB of it is code §2 and §5.27 place on the eager side by design — descriptors and registrations (≈ 8.6 kB)
and schema v3 (≈ 4.6 kB; `store.load` is synchronous, so validation and repairs cannot load lazily) — and most of the
rest is contract plumbing that B7 and B10 replace (runtime registry, blob store and selection stubs ≈ 2.4 kB). No
builder-side trim brings B0a near a third of the allowance without a §2 change, and the remaining ≈ 1.3 kB cannot
hold B0b's keymap rows and B9's shell. Packages may not edit DECISIONS-OPEN or the spec (§9.1), so B0a records the
request here for INT to decide and copy into DECISIONS-OPEN §H:

| Option | What changes | Cost |
|---|---|---|
| A (recommended) | Raise the M6a eager allowance to **+40,960 B** over the M2a baseline (route ≤ 886,227 B, still under the 900,000 B gate) by a contract PR to §5.27, with an attribution report per package that adds eager code | Spends ≈ 75 % of the M2a headroom under the gate (54,733 B); M2b's planned cuts (M2A-INT-4: IK operator bodies, Dope Sheet controller, camera-controls) restore part of it |
| B | Keep +20,480 B, but count it from the B0a merge (baseline re-recorded at 864,407 B) as B0a's contract cost | The same total as A for B0b, B9 and later packages, without a number for the contract layer |
| C | Keep +20,480 B over M2a and move Model-only registrations and the descriptors to the first Model entry (a §2 change: `ws=model`, the palette, keymap rows and menus wait for the registration) | Saves ≈ 8 kB; touches B0b, B9, B11 and the foundation e2e, and is a contract PR during parallel builds |

Until INT decides, the 900,000 B gate and the two lazy BOUNDARIES are the hard gates and both are green.

## Minimal edits in files other packages own after B0a

Each is additive and small: `editor/src/input/keyboard.ts` (B0b: source, repeat, tap/hold arguments),
`editor/src/shell/MenuBar.tsx` (B9: `source: 'menu'`), `editor/src/panels/viewport/PaneView.tsx` (B9: the display
toggles list only boolean flags), `editor/src/panels/{dopesheet/DopeSheetView,graph/GraphCanvas}.tsx` (`ToolKeyEvent`
`ctrl`/`repeat`), `viewport/src/manager/ViewportManager.ts` (B9: Animate defaults of the new `DisplayFlags`),
`editor/src/dialogs/DialogHost.tsx`, `editor/src/services/autosave.ts` and `editor-core/src/app/autosave.ts` (B7:
M6A-B0A-13), `editor-core/src/edit/{channels,gesture}.ts` (snapshots with the model state),
`editor-core/src/operators/registry.ts` (`operatorContext`), `editor-core/src/keymap/manager.ts` (B0b: the
`isTapHoldKey` signature).

## Literal updates (§3 rule 9)

**Bisect note**: two contract commits are not green on their own, because their literal updates landed in later
commits of this branch: `47a64bc` (schema v3) needs `e596367` (the e2e `schemaVersion` 3 literal in
`m2a-00-foundation.spec.ts`), and `d1910f1` (editor-core contracts) needs `26fefcc` and `0566a1e` (the
`SelectionMask.groups` literals and their formatting). Squash each pair when merging (or treat the range
`47a64bc..e596367` as one unit when bisecting); unit tests are green from `0566a1e` on, the e2e suite from `e596367` on.

Every assertion kept; each commit names the test and the contract row. Schema v3 (`47a64bc`): doc schema-v2, snapshot,
records, store.memory and ids tests; io project test; editor-core assets, characters and create-editor-app tests and the
`waveDoc` fixture; editor autosave-store test; headless `ops.m2a-foundation` and `ops.project`; viewport fingers.
editor-core contracts (`d1910f1` and later): `Selection.objects` (editor-core session and clip tests, viewport picking,
operators, layout, manipulators and fingers tests), `SelectionMask.groups` (viewport meshPicking and picking tests,
editor commands test, editor-core session defaults), `Prefs.lastWorkspace/modeling` (editor-core prefs tests),
`isTapHoldKey` arguments (editor-core keymap test), `AutosaveStore` blobs (editor-core autosave fake store, editor
autosave-store test), `ToolKeyEvent.ctrl/repeat` (curve-editor dope sheet controller and test support), the
keyboard `RunContext.source` (editor input test), `EditorParams.ws` (editor test-api test), the registration table
(editor-core registration test: every M6a operator with its U column and key scope), the saved `schemaVersion` 3
(e2e `m2a-00-foundation.spec.ts`; `minWriterVersion` stays 1).

## Gates (local, real Chrome; port 3160)

Fix round 1 (after the commits of this round): `format:check`, `lint`, `typecheck`, `check:deps`, `check:fixtures`,
`check:licenses` green; `test` green with `turbo run test test:tooling --force` (15 tasks, 0 cached: anim-core 671,
doc 231, doc-yjs 77, mesh-core 134, mesh-view 2, io 170, rig 202, editor-core 792, curve-editor 207 + 3 skipped,
viewport 100 + 1 skipped, editor 359 + 1 skipped, headless-tests 173, ui 87, web 10, tooling 14); `build` and
`check:size` green (864,407 B); `m6a-00-foundation.spec.ts` 3 passed + the declared `b9` fixme; the full e2e suite
106 passed, 10 skipped (the stretch `test.fixme` entries and the `b9` fixme), `--workers=4`.

## Benchmarks (report only)

SHA-256 (anim-core, Node 25): ≈ 345 MB/s, a 64 KiB chunk in 0.19 ms. Reference kernel at 50k triangles
(`pnpm --filter @ekza-animator/mesh-core bench`): `editMeshFrom` 5.2 ms, `triangulate` 2.6 ms, `computeNormals` 10.7 ms,
`topologyStats` 2.1 ms, `writeRevision` 5.6 ms, `readRevision` 0.19 ms.

## Known issue outside B0a's files

`anim-core/test/curve/insert.test.ts` "never writes −0 into a handle" can fail by seed (`-657253700`): the arbitrary
generates an input key whose `outHandle.dv` is already −0 and the property counts rewritten neighbours as created keys.
The curve code and the test are unchanged by B0a; the rerun passed.
