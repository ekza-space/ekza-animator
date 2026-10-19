# M6a B7 — mesh runtime, document tables in use, BlobStore, undo budget, autosave, `.ekzanim`: build notes

Branch `m6a/mesh-runtime-doc` (from `m6a/spec` at `ec541b4`, with `m6a/contracts-foundation` merged). Scope:
[M6A-SPEC §9 B7](../M6A-SPEC.md#b7--mesh-runtime-document-tables-in-use-blobstore-undo-budget-autosave-ekzanim) with
§5.5, §5.13 (runner), §5.16 (`mesh.create.*`), §5.20 and the §9.1 rows B7 owns. Decision IDs below are `M6A-B7-<n>`.
B1 (kernel) has not merged: the runtime runs on B0a's reference kernel (value writes, no Euler operators), and the
cases that need real topology ops are behind `READY.b1` (`editor-core/test/mesh/ready.ts`, a probe that turns on when
`mesh.extrude` and `primitive('sphere')` stop answering `not-implemented`).

## What landed (by spec responsibility)

| B7 item | Where |
|---|---|
| §5.5 runtimes: lifecycle (one per live record with `data`), `loading`/`ready`/`error`, `data()` open or closed, triangulation and normals with dirty-face caches, `symmetry()` for the mesh's settings | `editor-core/src/mesh/runtime.ts` (`MeshRuntimeImpl`), `impl.ts` (`syncRecord`) |
| §5.5 rule 1 sessions: `beginOp`, `update` (the op's `adjust` fast path inside a kernel transaction, else revert + re-run), `cancel`, `base: 'before-last'` re-running on what the last op read and surviving the undo of its own step (the B11 hook), the take check of `commitOp` | `mesh/session.ts`, `mesh/input.ts`, `impl.ts` (`beginOp`, `sessionHost`, `commitOp`) |
| §5.5 rules 2–3, 9 commits: matching session or an atomic run, incremental `writeRevision` (`previous` + `dirty`), `BlobStore.put`, `tx.patch(data: {manifest, rev + 1, base, joints})` with `generator: null`, pending until the batch confirms (two-phase), the journal edge | `impl.ts` (`commitOp`), `runtime.ts` (`pending`, `confirm`, `revertPending`) |
| §5.5 rules 4–6 following: journal edge on the lineage, synchronous rebuild from resident chunks, async load through `BlobStore.get`, remote/import changes end sessions ("Changed by another user") | `runtime.ts` (`follow`, `applyEdge`, `load`), `impl.ts` (`onBatch`) |
| §5.13 MeshSetOp runner: N ref patches, `new:<n>` records with `derivedId('mesh', op.id, inputIds, seed, n)`, soft deletes, the op's writes into inputs aborted, pre-op MeshData of the last set-op, the record-set rule for adjusted re-runs | `mesh/setOps.ts`, `impl.ts` (`commitSetOp`) |
| §5.16 `mesh.create.<kind>`: kernel loaded in `prepare`, faceted authored scene meshes at the origin, live parameters (`low-poly`/`maya`), default palette, derived id kept by an adjusted re-run, unique names, selected, object mode, created into a selected template group with its symmetry | `editor-core/src/operators/builtin/create.ts`, `mesh/records.ts` |
| §5.20 GC: reference counts per manifest (live, history, runtimes, last-op edges) and pinned autosave blobs, deferred sweeps (microtask after the batch, ≤ 1 per 5 s), the undo byte budget (history-only bytes + journal + selection-snapshot bytes) with one toast, the journal cap keeping the last op's edges | `mesh/ledger.ts`, `mesh/journal.ts`, `impl.ts` (`enforceBudget`, `runDeferred`) |
| §5.20 BlobStore sources (lazy recovery) | `editor-core/src/services/blobs/index.ts` (`addSource`, `addBlobSource`) |
| §5.20 autosave: IndexedDB v2 with the `blobs` store (single owner), per-slot blob sets, in-transaction checks, idle collection, `read(slot).blob`; controller pins (in flight, last slot); recovery through the slot as a source | `editor/src/services/autosave.ts`, `editor-core/src/app/autosave.ts`, `operators/builtin/autosave.ts` |
| §5.20 `.ekzanim`: `blobs/<sha256>` (deflate 6), `images/<sha256>.<ext>` under the manifest key `images`, `PROJECT_LIMITS.maxBlobBytes`/`maxImageBytes`, verified on open; the JSON variant warning | `io/src/project/archive.ts`, `editor-core/src/workflows/project.ts` |
| §4.6 wrappers: `meshOperator`/`meshSetOperator` (default targets, kind, seed, recorded context, poll through the kernel op) | `mesh/operator.ts`, `mesh/seed.ts` |
| Reader rules: joint palette from the manifest, the dangling-joint fold (skin.skeleton only), morph names from the manifest | `mesh/skin.ts` |
| §4.8 test API (B7 group) | `editor/src/test-api/m6a/mesh-runtime-doc.ts` |
| Browser blob store and the `blobs` option | `editor/src/services/blobs.ts`, `browser.ts` |
| Conformance cases (`data` opaque) on memory and `doc-yjs` | `doc/src/testing/meshRefs.ts` (+ `meshRefForks`) |
| E2E-MOD-14 | `apps/web/e2e/m6a-14-autosave-mesh.spec.ts` (no gate: green) |
| Bench | `editor-core/bench/mesh-runtime.bench.ts` |

**READY flag `b7`** for the packages that gate on B7 (B10, B11, B13): probe that `app.meshes.commitOp`/`beginOp` no
longer throw `not-implemented` (they refuse with `op-refused`, or `mesh-loading` before the kernel loads).

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B7-1 | **The registry binds the app lazily**: `attachMeshes(app)` (idempotent) gives it the history (`onDrop`, `dropOldest`, steps for selection bytes), the session (symmetry/soft settings), prefs (budgets), the component selection service and the curve engine. Every B7 entry point calls it: `meshOperator`/`meshSetOperator`, `mesh.create.*`, `startAutosave` (so every browser page is attached at boot), the project workflows, `file.recover`, the test API. Unattached, the budget falls back to `UndoManager.evictOldest` with the default 256/64 MB. **Request for INT**: one additive line in `app/kernel.ts` after the history exists (`attachMeshes(app)` before `registerBuiltins`) would make it unconditional; `kernel.ts` is closed after B0a, so B7 did not touch it. | The factory (`createMeshes`) receives only `store`, `blobs`, `services`, `requestFrame` — B0a wired it before the history is created. |
| M6A-B7-2 | **Eager facade, lazy implementation** (§2): `app.meshes` is `mesh/facade.ts` (handles in `loading`, `open` intents, early pins, the attached app); `mesh/impl.ts` (commits, sessions, journal, ledger, set-op runner) loads in `loadMeshKernel()` together with mesh-core, and the facade then delegates. Handles stay the same objects and forward the runtime's events, so a subscriber sees `loading` → `ready`. Production `check:size`: **869,080 B** (B0a 864,427 B: **+4,653 B** for B7: facade, operators, autosave/project/blob plumbing, the IndexedDB store; fix round 1 added 10 B for the `reconcile` forwarder); the implementation is an **11.7 kB** lazy group (10.9 kB before fix round 1), the kernel group unchanged (17.6 kB). Before the split the route was +14.6 kB. | B0a's size note ("B7's runtime registry has to load lazily with the kernel; only a facade fits in the route") and the +20,480 B M6a eager allowance B0a already used most of. |
| M6A-B7-3 | **`close()` drops edit links from the caller's view** (`mesh` null, `isOpen` false, symmetry cache dropped) but keeps the EditMesh instance **dormant while the journal holds edges recorded on it**; it is released when no edge, pending commit or session needs it. Undo/redo of a closed mesh then stay O(\|delta\|), `edit.adjustLast` stays synchronous and a reopen is instant. | Kernel deltas may carry edit-link writes (§4.3 "exact for stored and edit arrays"), so they apply only to the instance they were recorded on (its *lineage*); dropping the instance would make "close keeps the journal" useless. |
| M6A-B7-4 | **Journal edges are lineage-bound**: a rebuild (no edge, remote change, load) replaces the EditMesh and drops the edges of the old instance; edges whose revisions no root references any more are pruned after history evictions. | Same as above; a step whose edge is gone undoes through the chunk rebuild (§5.20). |
| M6A-B7-5 | **Atomic multi-target commits**: one target refusing (or failing `validateMesh` under the debug switch) reverts every target and throws `EkzaError('op-refused', reason, {code, mesh})` (`invalid-mesh` passes through); a run that changes nothing writes nothing (no step). | §4.6 "throws on a refusal (no step)"; partial commits of a multi-mesh op would leave one undo step that only some meshes share. |
| M6A-B7-6 | **`CommitContext` widens `ctx`**: `{seed, kind?, selection?, settings?, adjusting?}`. `kind` defaults to the current mode (null for object-level ops), `selection` to the component selection service, `settings` to the session's symmetry/soft settings (Adjust Last passes `LastRun.context`), `adjusting` turns on the §5.13 record-set rule. The interface keeps `{seed}` callers (B12a's Freeze) valid. | Adjust Last re-runs on the recorded kind and context (§5.7) whatever the current mode. |
| M6A-B7-7 | **Default targets** of component ops are the hilited meshes **with a non-empty selection of the kind** (§4.6 `MeshOpArgs`); object-level ops take the selected mesh objects. B0a's wrapper took every hilited mesh (test literal update below). | §4.6 wording. |
| M6A-B7-8 | **Selections after a commit** go through `ComponentSelectionService.set`; while B10's writers throw `not-implemented` the runtime keeps them (`localSelection`, `select`) and `selectionFor` reads that fallback first. The fallback stands in for `TxMeta.selectionBefore/After`: an undo across a journal edge restores what that op read, a redo what it left; any other content change (remote, import, load, a rebuild without an edge) drops the mesh's fallback selection. It switches off as soon as `set` stores a selection. | §9 B7 "selection snapshots through `components` (B10) with a local fallback until `READY.b10`"; adjust-last (undo, then a re-run on the restored selection, §5.7) must work before B10. |
| M6A-B7-9 | **Symmetry**: for `symmetry: 'expand'` ops the runtime passes `expandSelection(sel, map)` and `ctx.symmetry` with the map built for the mesh's (or the recorded) settings; while B2's `buildSymmetryMap`/`expandSelection` are stubs the run is one-sided (`ctx.symmetry` null). Expansion is idempotent, so ops that expand again are unaffected. | §5.14 "run on the expanded selection". |
| M6A-B7-10 | **Last-op pins**: the edges of the last committed op are pinned (never evicted by the journal cap) and their two revisions count as roots (§5.20 (3)) **exactly while pinned**: the journal reports every pin change (`pinned`/`unpinned` hooks), including a pinned edge that goes with its runtime (deletion, undo of a create) or its lineage (a rebuild after a remote change, a refused `applyEdge`), and the registry releases the two roots then. `writeData`, `commitSetOp` and a no-change commit unpin (the last op has no edge). Leak check (unit test and GC fuzz): with the history cleared, the resident blobs are exactly the closure of the live revisions and the pinned edges. | §5.5 rule 5; §5.20 roots are derived, so a root must not outlive what derives it. |
| M6A-B7-11 | **History accounting by entry**: the ledger counts each doc undo/redo entry's `meshes` before/after manifests once per entry (by txId and entry identity), reconciled when `UndoManager.entries()` returns new views — O(entries) per stack change, O(changed manifests) in the ledger, never a chunk-level set difference. A coalesced or popped entry (never a mesh commit, M6A-B0A-27) is caught by the same reconcile. | §5.20 "incremental chunk refcounts". |
| M6A-B7-12 | **Budget enforcement** drops `history.dropOldest(1)` at a time from the deferred check until the retained bytes fit (or nothing is left), then sweeps; one toast per registry (session). Selection-snapshot bytes are the tagged bitsets of history selection parts and of the doc entries' `TxMeta` snapshots. | §5.20 "Above the budget, `history.dropOldest(n)`". |
| M6A-B7-13 | **Sweep scheduling**: commits, batches, `onEvict`, `onDrop` and history changes schedule one microtask check; a sweep runs at most once per 5 s (a timer catches up). `collect()` runs the check and a sweep at once (tests, the test API, benches). | §5.20 sweep rule. |
| M6A-B7-14 | **Blob sources**: `MemoryBlobStore.addSource` (`addBlobSource` for any store) lets `get` read missing blobs from a source, verify, keep them resident (fresh) and hand them out; `has`/`peek` stay resident-only, so runtimes go `loading` and read through `get`. `file.recover` registers the slot's `read(slot).blob` (replaced by the next recovery). | §5.20 "Recovery … loads manifests and chunks lazily through `read(slot).blob` into the BlobStore". |
| M6A-B7-15 | **Autosave roots**: the snapshot's manifests are pinned the moment the snapshot is taken, then its closure (after reading non-resident manifests through the sources) until `write` resolves; the written slot's closure stays pinned until the next write or the slot's removal. | §5.20 root (4). |
| M6A-B7-16 | **IndexedDB v2**: a `blobs` object store (`{id, bytes}`); slot rows gain `blobs` (absent in v1 rows: no blobs); a write stores missing blobs, re-checks the shared ones in its transaction (restart when one was collected meanwhile) and the slot's `bytes` include the new blobs; an idle pass after a write or removal deletes blobs no slot lists. | §5.20 autosave; one GC owner per store (S27). |
| M6A-B7-17 | **`.ekzanim` layout**: entries manifest.json, project.json, then `assets/`, `blobs/`, `images/`, each sorted by name (an M2a-shaped project keeps its exact bytes: no `images` key, no new entries); blobs are recognised by name (`blobs/<64 hex>`) and verified by hash (left out when wrong); images are listed and verified like assets (a corrupt image fails the open with `asset-corrupt`, as a corrupt model does). Saving reports missing blobs as a warning ("Mesh data is missing (n blobs) and was not included"); opening reports meshes whose manifest is not resident ("Some mesh data is missing from this file; those meshes cannot be shown"). | §5.20; deterministic archives (ADR 0011). |
| M6A-B7-18 | **M2a reader double**: `io/test/helpers/m2a-project-reader.ts` is the shipped M2a container reader (v0.2.0) with M2a's schema-2 read-only rule; it reports which entries it inflated. | §9 B7 "an M2a-reader double (the shipped `readProjectArchive`)". |
| M6A-B7-19 | **`mesh.create.*` details**: names are the kind's label ("Cube", "Cube 2" — the load repair's suffix rule), `material: {preset: 'unlit'}`, identity placement and pivot, the default palette only when `derivedId('palette', 'palette.default', [], '', 0)` exists, `selection.objects = [mesh]`, component mode `object`; a humanoid template group gives the mesh Object X symmetry with `prefs.modeling.symmetryTolerance`; sphere, cone and torus poll-fail "<Kind> is not available yet" until the kernel builds them (READY.b1). A derived id that already exists (a soft-deleted record) takes the next `seed:k`. | §5.16. |
| M6A-B7-20 | **Seeds**: an *adjusted re-run* is a run with `source: 'card'` of the operator `session.lastRun` names; it reuses `lastRun.seed` and `lastRun.context`. `runSeedOf(app)` returns the seed of the latest mesh run so B11's LastRun recorder can store it as `LastRun.seed`. | §3 rule 3, §5.7; the runner's recorder is B11's. |
| M6A-B7-21 | **Dangling-joint fold**: a palette joint without a live JointRecord folds onto its nearest live ancestor along the manifest's parents; with none, onto the first live palette root (else it stays). Merged influences add, the top 4 by weight (ties to the smaller index) are kept and renormalized; the read carries `skin.dangling-joint` with the count. Imported skins (`skin: {asset, skin}`) never fold; `MeshRef.joints` is the palette of `skin.skeleton` meshes only. | §4.2 `MeshRef.joints`, §9 B7 tests. |
| M6A-B7-22 | **Test API**: `shading()` counts edges with fewer than two faces as `borderEdges`, the others as hard or soft by `EDGE_HARD`; `meshLayer` of an unknown layer is `[]`; virtual `asset` rows use `derivedId('mesh', 'asset', [characterId], '', meshIndex)` and the glTF mesh name (else "Mesh <i>"). | §4.8. |
| M6A-B7-23 | **Perf tests**: the unit suite checks the journal (≤ 5 ms) and rebuild (≤ 40 ms) budgets at 50k triangles on the best of 10 samples (the gates run every package in parallel on a shared machine); the bench reports the full B7 rows. | §5.27 is report-only except its gates. |
| M6A-B7-24 | **What an op read travels with its edge.** `commitOp` records per target the `OpInput` the run read (the kind, null for object-level runs, and the selection of that kind *before* symmetry expansion; copies) and the selection the op left; the confirmed journal edge keeps both (their bitset bytes count with the edge's deltas). A `base: 'before-last'` session runs on the undone edge's input whatever the current mode (an explicit `opts.selection` still overrides), so after `3` back to object mode a card drag previews on the recorded face selection. `commitOp` takes an open session only when op, targets and args match **and** each target's input equals what the commit's own run would read (`readInput` with the commit's kind and selection); otherwise it cancels the session and runs. A committed session therefore always equals a fresh run. | §4.6 ("previews an adjust-last re-run from the pre-op mesh"), §5.7 (the re-run reads the restored selection of the recorded kind, whatever the current mode). Without it, an op whose result selection differs from its input (Extrude's cap, Bevel, Inset) previewed and committed on its own result. |
| M6A-B7-25 | **Sessions and batches**: only a batch that changes a target's `data` concerns an open session (§5.5 rule 6): a rename, a move or any other field keeps it, local or remote. A remote/import/load/migration change of `data` ends it ("Changed by another user"); a local one ends it ("The mesh changed") unless it lands on the session's base revision (the undo of the last op under a 'before-last' session). | §5.5 rule 6 names batches "that change data"; whether a local rename closes the card is B11's rule (§5.7), not the runtime's. |
| M6A-B7-26 | **Deviation: the revert after an aborted transaction is deferred.** The doc store's `Tx` has no abort hook (closed after B0a), so `commitOp` cannot undo its content change before the store rethrows. The runtime reverts at the first of: the next store batch, the microtask after the commit, or `KernelMeshRuntimes.reconcile()`. Between the throw and that point `data()`/positions still show the aborted content (never a ref: the store never saw it, and every commit path re-syncs to the transaction's ref first). **Request for B11**: call `app.meshes.reconcile()` in the operator runner after a run fails (outside the transaction, before reporting), so §5.5 rule 3's "before rethrowing" holds at the runner's boundary. | §5.5 rule 3 ("applies the delta backward before rethrowing"); the closed doc contract. |
| M6A-B7-27 | **Whole revisions are validated in debug builds**: `writeData`, `storeRevision` and every MeshSetOp output run `validateMesh` before anything is stored when the registry runs with the kernel debug switch (`services.kernelDebug`, which also turns the kernel's own switch on); a problem throws `EkzaError('invalid-mesh', "'<op id>' left an invalid mesh: …", {opId})` like `EditMesh.end` and nothing is written (the transaction aborts). The registry reads its own flag because mesh-core's barrel exports `setKernelDebug` but not `isKernelDebug` (B1's lines). | §5.5 rule 7, §3 rule 8 ("after every commit"). |

## Bench (Node 25, Apple silicon, kernel debug off; `pnpm --filter @ekza-animator/editor-core exec vitest bench --run`)

| Row (§5.27) | Budget | Measured |
|---|---|---|
| Commit (move 1,000 vertices of a 50k-tri mesh: hash dirty chunks, store, patch) | ≤ 3 ms | mean 1.27 ms (p75 1.2; p99 6.3 on the loaded shared machine) |
| Undo + redo through the journal | ≤ 5 ms | mean 0.26 ms for both |
| Undo by rebuild from resident chunks (open mesh) | ≤ 40 ms | ≈ 6 ms each (11.6 ms per redo + undo pair) |
| Memory per edited 50k-tri mesh | ≤ 40 MB | ≈ 8.1 MB (MeshData ×2, edit links, journal 710 KB with the edges' selections, resident blobs); a computed estimate, not a measured heap |
| 50 morph layers × 200 commits on a 10k-vertex mesh | ≤ 256 MB | peak 49.5 MB retained; a 4 MB budget dropped 186 steps and freed 725 blobs (16.7 MB) |

`vitest.config.ts` and `test/tsconfig.json` of editor-core include `bench/**` (like mesh-core). **Request for INT**: a
`bench` script in `editor-core/package.json` (manifests are the integration agent's).

## Minimal edits in files other packages own

All additive: `doc/src/testing/conformance/index.ts` (registers the mesh-ref cases), `doc/src/testing/index.ts`
(exports `meshRefForks`, `refsOfBatch`), `editor-core/src/index.ts` (the B7 exports), `editor-core/vitest.config.ts`
and `test/tsconfig.json` (bench). Not touched: `app/kernel.ts` (M6A-B7-1).

## Literal updates (B0a stub expectations that B7 replaces)

- `editor-core/test/m6a/mesh-runtime.test.ts`: missing blobs are read through `BlobStore.get` (`loading`, then
  `error`); default targets need a selection of the kind (M6A-B7-7); a kernel-op refusal fails with `op-refused`; the
  "B7 has not landed" case now checks that a stub op previews as its refusal and commits refuse.
- `editor-core/test/m6a/foundation.test.ts` and `apps/web/e2e/m6a-00-foundation.spec.ts`: the landed `mesh.create.*`
  are excluded from the "every M6a operator poll-fails" loops (the counts stay 42 + 77).
- `headless-tests/test/ops.m6a-foundation.test.ts`: `mesh.create.template` (B13, still a stub) stands in for
  `mesh.create.cube`.
- `editor/test/test-api.test.ts`: `meshFaces` of an unknown mesh throws "has no ready runtime" instead of B7's
  not-implemented.

## Handoffs

- **B10**: `app.meshes.open/close` on mode and hilite changes; the runtime reads selections through
  `ComponentSelectionService.get` once `set` stores them (the fallback, M6A-B7-8, then switches off, its undo/redo
  restore included); `remap` after topology commits is B10's. `TxMeta.selectionBefore/After` must restore exactly what
  the op read, or `commitOp` re-runs instead of taking an adjust-last session (still correct, only slower).
- **B11**: the runner's coercion (`coerceArgs(def.params, raw, {passThrough: def.extraArgs})`, tested on the
  wrappers), the LastRun recorder (`runSeedOf(app)` for `LastRun.seed`, `MeshOpOutcome`/`MeshCommitResult` for
  resolved args), card drags through `beginOp(…, {base: 'before-last'})` then `edit.adjustLast`, and `TxMeta`
  per-mesh selection snapshots through `components.snapshot()`. Card drags pass **no** `selection`: the session
  reads what the last op read from its journal edge (M6A-B7-24); `edit.adjustLast` passes `kind: lastRun.kind` and
  the session is taken only when the undo restored that same selection. After a failed run the runner calls
  `app.meshes.reconcile()` (M6A-B7-26).
- **B12a/B12b**: tools preview with `beginOp`/`update`/`cancel` and commit through the operator (the session is taken
  when op, targets and args match and the operator's run would read the session's selection, M6A-B7-24); Freeze
  calls `commitOp` on `mesh.applyTransform` (object-level, `kind` null).
- **B8**: `writeData` for Make editable (a whole revision; `refJointsOf` fills `MeshRef.joints`), `readSkin` and
  `morphNamesOf` for the display rebuild and exporters, `data()` of closed runtimes.
- **INT**: M6A-B7-1 (the attach line in `kernel.ts`), the `bench` script, and the eager-allowance record (M6A-B7-2).

## Gates (local, real Chrome; port 3168)

Fix round 1 (after `7c5209e`): `format:check`, `lint`, `typecheck`, `check:deps` green; `test` green with
`turbo run test test:tooling --force` (no cache; 15 tasks: anim-core 671, doc 235, doc-yjs 81, mesh-core 134,
mesh-view 2, io 176, rig 202, editor-core 857 + 2 skipped, curve-editor 207 + 3 skipped, viewport 100 + 1 skipped,
editor 366 + 1 skipped, headless-tests 173, ui 87, web 10, tooling); `build` green (`--force`), `check:size`
869,080 B (gate 900,000 B; `mesh-kernel` boundary green); own e2e (`m6a-14-autosave-mesh`, `m6a-00-foundation`):
7 passed, 1 skipped (the `b9` fixme), E2E-MOD-14 also `--repeat-each=3` green; the full e2e suite against one e2e
build served on 3168 (project `chrome`): **110 passed, 10 skipped** (the `b9` Model-tab fixme and the stretch specs),
0 failed. The new unit tests fail on the code before the fix (checked with the sources stashed).

**Turbo cache in worktrees**: `pnpm test` replayed logs that were not this branch's (other packages' test counts,
"FULL TURBO"); every gate number above comes from `turbo run … --force`.
