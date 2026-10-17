# WP-2 notes — `@ekza-animator/doc` and `packages/doc-yjs`

Builder notes for the integration agent: what landed, interpretations of MVP-SPEC v0.2, deviations, requested
contract changes and hand-offs to other work packages. Branch `wp/wp-2`.

## What landed

| Responsibility (§7 WP-2) | Where | Tests |
|---|---|---|
| Record validation, `TableDef` registry (built-ins as constants, `registerTable`, opaque unknown tables in `scene`) | `src/records/validate.ts`, `src/tables/registry.ts` | `test/records.test.ts` |
| Factories with documented defaults, `toAnimCurve`, channel helpers | `src/records/factories.ts`, `src/records/channels.ts` | `test/records.test.ts`, `test/time.test.ts` |
| Fractional indexing (adapted from `fractional-indexing` 4.0.0, CC0) | `src/records/order.ts` | `test/order.test.ts` (fast-check) |
| Scene time functions (§4.11.8) | `src/time/scene.ts` | `test/time.test.ts` (24/30 fps golden, rational rates, fast-check) |
| `MemoryDocumentStore`: partitions `open/close`, synchronous transactions with rollback, nested join, read-your-writes, `strictPut`, batches with `fields`, version counter, `applyChanges`, `load`, `snapshot` | `src/store/{memory,storage,journal,rows,diff,references}.ts` | conformance suite + `test/store.memory.test.ts` |
| `DocQueries` with incremental indexes, projection rules, `missingPartitions` | `src/queries/{engine,hierarchy}.ts` | conformance "queries and projection" + brute-force properties |
| `PreviewSession` with `conflicts` | `src/store/memory.ts` (`StorePreview`) | conformance "preview sessions", memory-store details |
| `PatchUndoManager` (local only, coalescing, per-merge-unit compare-before-restore, limit 500, selection snapshots) | `src/undo/patchUndo.ts` | conformance "undo and redo" |
| Snapshots (deterministic text, `tableVersions`, unknown tables/fields preserved, soft-deleted omitted) | `src/snapshot/serialize.ts` | `test/snapshot.test.ts` |
| Migrations framework (v1 baseline, `deriveMigratedId`, idempotence) | `src/migrations/{migrate,sha256}.ts` | `test/migrations.test.ts` |
| Conformance suite (non-replicating + replicating halves) | `src/testing/conformance/` | run by `test/conformance.memory.test.ts` and `doc-yjs/test/conformance.yjs.test.ts` |
| `createTestNetwork` (delay, drop, reorder, partition; `settle` = anti-entropy) | `src/testing/network.ts` | `test/network.test.ts` |
| `makeTestDocument` and scene builders | `src/testing/document.ts`, `src/testing/conformance/harness.ts` | `test/records.test.ts`, bench |
| `doc-yjs`: one `Y.Doc` per partition, record-merge tables as plain values, field-merge tables as one nested `Y.Map` per record; shared `PatchUndoManager`; `yjsHarness()` | `packages/doc-yjs/src/` | full conformance suite, `adapter.test.ts`, `convergence.property.test.ts` (fast-check) |

Test counts: `doc` 156 tests in 15 files, `doc-yjs` 69 tests. The memory store passes the non-replicating suite
(45 cases); `doc-yjs` passes the full suite (59 cases: the 45 plus 14 replicating cases: replication basics, H1–H5
goldens, per-field undo across replicas, partition-order application, unopened partitions, the fps golden, the
reparenting-cycle golden and a 150-run fuzz with shrinking).

Bench (`test/bench.test.ts`, reported as test annotations, Apple M4 Pro, other agents building in parallel): commit of
1,000 new keys **1.1 ms** (budget 4), undo **0.7 ms** (budget 5), redo 0.9 ms; drag of 1,000 existing keys: preview
update 1.9 ms, commit 0.5 ms; cold `keysOfCurve` over 336 curves / 30,240 keys 3.5 ms. Assertions only catch 10×
regressions.

## Requested contract changes (§4.2 / §4.11.0)

1. **Partition lookup for rig-scoped records** (§4.2 `TableDef.partition`, §7 `partitionOf`). Controls,
   constraints and solvers reference only their rig, and the rig's character decides their partition
   (§4.11.21: `char:<characterId>`). A record alone cannot answer that, so:
   ```ts
   export interface PartitionLookup { rigCharacter(rig: RigId): CharacterId | undefined }
   partition(record: { readonly id: string }, lookup?: PartitionLookup): Partition;            // TableDef
   export function partitionOf<T extends TableName>(table: T, record: RecordOf<T>, lookup?: PartitionLookup): Partition;
   ```
   Without a lookup, `partitionOf` throws `EkzaError('unsupported')` for those three tables; an unknown rig yields
   `scene` (provisional: the store re-resolves at commit, so a control written before its rig in one transaction
   still lands in `char:`). Stores keep a record's partition for life while its partition-determining field is
   unchanged (a deleted rig does not move its controls). The test kit's naive store (WP-0b) already does the same
   with its own lookup.
2. **Undo never orphans** (proposed sentence for §4.11.0 store rule 4): "Undo/redo does not hard-delete a record
   that a record outside the step still references (hidden and soft-deleted referrers included); that change is
   skipped with `changed-by-other`." Without it, undoing "create curve" after another writer (a peer, an `import`
   batch) keyed into that curve orphaned their keys (H2 by another route). Skipping one delete keeps its own
   references alive, so the check runs to a fixpoint (a clip, its layer and a curve all stay when a foreign key
   uses the curve). Single-user undo-all is unaffected (LIFO undoes dependants first). Covered by the conformance
   case "undo never hard-deletes a record that a record outside the entry still references".
3. **Clarifications only** (no shape change):
   - `DocQueries.curvesOfClip` / `curvesOfControl` list **only canonical curves** (smallest `CurveId` per
     `(clip, layer, control, channel)`); `keysOfCurve`/`hiddenKeys` of a non-canonical curve are `[]`. This answers
     WP-3's request 1 (its sampler is safe either way).
   - `missingPartitions()` is `[]` in the MVP because local writes that insert a character or clip also open the
     partition it owns, and `load` opens every character's and clip's partition (not only partitions that hold
     records). Remote batches never open partitions, so replicas report what they have not opened.
   - `ChangeBatch` with origin `load` is emitted by `store.load` **and** by partition visibility changes
     (`open`, `close`, and records revealed when a write opened their partition; that `load` batch comes right
     before the writing batch). `store.load` is the only one that clears the undo stacks — WP-7a already tells them
     apart this way (`session/loads.ts`). Labels: `Load`, `Open <partition>`, `Close <partition>`, `Open partitions`.

## Interpretations and deviations (proposed DECISIONS-OPEN entries)

| # | What | Why |
|---|---|---|
| D2-1 | Additional public exports from `@ekza-animator/doc`: `MemoryDocumentStore` (adapter hooks `observeCommits`, `entryOf`, `partitionFor`, and `applyChanges(changes, meta, { partitions })`), `PatchUndoManager` + `UndoHost`/`UndoWrite`, `PartitionLookup`, `isFractionalIndex`, `compareStrings`, `isSoftDeletable`, `mergeUnitOf`, `MemoryStoreOptions`, `CommitObserver`, `CommittedChange`, `ApplyChangesOptions`. From `/testing`: `checkProjections`, `newScene`/`seedScene`/`writeScene`/`Scene`, `makeTestControl`/`makeTestAsset`/`makeTestCharacter`/`makeTestRig`, `TEST_DOCUMENT_SEED`, `TestNetwork`, `Rng`, `checkSteps`, `PropertyOptions`. `doc-yjs` also exports `YjsDocumentStore`, `isYjsStore`. | The spec says `doc-yjs` reuses "the shared `PatchUndoManager`"; an adapter needs to observe committed changes with their partitions and to inject remote records into a given partition. The testing helpers are reused by both packages' tests and by other WPs' kit users. |
| D2-2 | Writes into an unopened partition open it (local, `import`, `cleanup`, `migration`); `remote` batches never do. | A new character or clip has nothing to load; the spec's "memory store resolves `open` at once" plus readers that tolerate missing partitions. |
| D2-3 | Reentrancy guards: `open`, `close`, `load`, `applyChanges`, undo/redo inside a transaction or preview-update callback throw `EkzaError('unsupported')`; async callbacks (a thenable result) are refused and rolled back; a `Tx` used after its transaction ended throws `unsupported`. | `transact` is synchronous and never awaited (§4.11.0 rule 1). |
| D2-4 | Validation on write: `put`/`patch` and non-remote `applyChanges` validate with `validateRecord`; only problems **introduced** by the write throw `invalid-record` (a stored record with pre-existing problems can still be patched). `remote` batches are not validated. `remove` refuses (`invalid-record`, `details.dependant`) while any record, hidden or soft-deleted included, references the target (reverse reference index, O(1)). | Convention 6: never throw on document content; refuse only new bad caller input. |
| D2-5 | Coalescing window is sliding (each merge restarts `coalesceMs`); any other committed batch (remote, import, undo, redo, an `undoable: false` commit) and `stopCapturing` break it. A merged entry keeps the first `txId`, label and `selectionBefore`, takes the latest `selectionAfter`, and is a **new entry object** (B-23); a merge that cancels out removes the entry. | Nudge bursts; a merged entry must never span foreign writes, or compare-before-restore would be wrong. |
| D2-6 | An undo/redo whose every change is skipped still moves the entry to the other stack and returns `applied: 0` with the skip report. | Research 06 §9 (skip and report); redo is symmetric. |
| D2-7 | Listener exceptions never undo or interrupt a commit; they are rethrown asynchronously (`queueMicrotask`). Batches emitted by listeners are queued and delivered in version order. The undo entry is recorded **before** subscribers see the local batch (WP-7a relies on it). | Robustness of the commit path. |
| D2-8 | `applyChanges` without a net change returns a batch with `changes: []` that is not emitted and does not bump `version`. | `version` "increments on every emitted batch". |
| D2-9 | `txId`s are per-store counters (`tx_0000000000000001`, …), not `newId('tx')`. | Deterministic and they do not consume the (seeded, `?e2e=1`) `IdSource`, so record IDs stay stable whatever the number of transactions. |
| D2-10 | Read-only when `minWriterVersion > SCHEMA_VERSION`, when a registered table's stored version is newer than its `TableDef.version`, or with `load(…, { readOnly: true })`. `remote` `applyChanges` still applies on a read-only store. | ADR 0011 §4; a read-only replica must keep following peers. |
| D2-11 | `createMemoryStore` defaults to `strictPut: true`. | §4.11.0 rule 3 ("default in tests and dev builds"); WP-8 may pass `strictPut: false` in production builds. |
| D2-12 | Queries: several live rigs for one character → the character's `rig` pointer wins, else the smallest `RigId`; `controlByKey` with duplicates → smallest id; hierarchy: a missing parent makes a root, cycles are detached at the smallest id; all lists exclude soft-deleted records and closed partitions. `toAnimCurve` resolves duplicate key times like the projection. | Research 06 R8/R9, deterministic on every replica. |
| D2-13 | `deepEqual`/`diffFields` follow JSON semantics: properties holding `undefined` count as absent, `NaN` equals `NaN`. `put`/`patch` store a normalized shallow copy without `undefined` fields (`patch({ f: undefined })` removes `f`). | Records are JSON; a stored `NaN` must not look changed forever. |
| D2-14 | Snapshot text: sorted keys at every level, 2-space indentation, leaf objects and primitive arrays inline up to 100 characters, `\n` line ends and a final newline; non-JSON values (`NaN`, `undefined`, functions) throw `invalid-record`. `tableVersions` lists every table (opaque ones keep their loaded version, default 1). | ADR 0011 §2 (deterministic, diffable). |
| D2-15 | `migrateSnapshot` repairs instead of rejecting: a record without a string `id` takes its key, a mis-keyed record moves to its `id` (sorted, so collisions resolve identically everywhere), non-object records are dropped; missing built-in tables are added. It throws `invalid-record` only for things that are not snapshots. A newer core `schemaVersion` is kept as is (no down-migration). | Convention 6; R11. |
| D2-16 | `deriveMigratedId(oldId, purpose)`: generated IDs keep prefix and body length (`crv_` + 16, `k_` + 12), SHA-256 asset IDs stay 64-hex, composite control IDs keep everything up to the last `:` and get a 16-character tail, anything else becomes 16 base62 characters. Synchronous SHA-256 in `src/migrations/sha256.ts` (migrations are synchronous; WebCrypto is async). | "same prefix" (§7). |
| D2-17 | Validation details the spec leaves open: clip tags are at most 32 characters each; key handles `inHandle.dt ≤ 0`, `outHandle.dt ≥ 0` (anim-core `Handle`); clip `range` integers with `start < end`; project `sceneRange.start ≤ end`; camera `far > near`; a control cannot parent or mirror itself. | Catch caller bugs early. |
| D2-18 | The conformance suite registers through the host runner's global `describe`/`it` (Vitest `globals: true`, which both packages set) and does **not** use fast-check: it ships in `src/testing` and fast-check is a devDependency. It has its own seeded `Rng` and a shrinking `checkSteps`; the fast-check properties live in the packages' own tests (`doc/test/properties.test.ts`: undo-all, brute-force queries, byte-identical histories; `doc-yjs/test/convergence.property.test.ts`: convergence). | Convention 3 (no dependency changes) and runner independence. |
| D2-19 | "Undo never touches another user's write" is checked per merge unit and by value: an undo/redo may overwrite a unit another user wrote last only if that user wrote back a value this replica itself wrote or edited (A→B→A); compare-before-restore cannot tell those apart and need not. | §4.11.0 rule 4 is value-based. |
| D2-20 | `doc-yjs` design: a `MemoryDocumentStore` core holds the materialized records (reads, queries, previews, undo); every committed change is mirrored into the partition `Y.Doc`s, one Y transaction per document; received updates re-materialize the touched records and enter the core as one `remote` batch with `user: 'remote'` (Yjs updates carry no author; M3 adds author metadata). A record present in two partition documents (concurrent moves) resolves to the smallest partition name; the mirror then leaves exactly one copy. Yjs client ids derive from `replicaId` (FNV-1a) so tie-breaks are reproducible. `close` keeps the `Y.Doc` (updates keep arriving). Previews never reach the wire. | ADR 0002 decision 6, research 06 R2/R3. |
| D2-21 | Documented outcome of the "fps change concurrent with key edit" golden: **keep frames** (only `clip.fps` changes) merges with the key edit; **keep seconds** (every key time rescaled) against a concurrent edit of one key keeps exactly one side's version of that key (whole-record LWW) — never both, never lost, never duplicated. Structural clip edits therefore need an exclusive claim (ADR 0002 §8, M3). | §7 WP-2 asks for the outcome to be documented. |

## Dependencies on other WPs

- None blocking. `doc` depends only on `anim-core` types and `EkzaError`; `doc-yjs` on `doc` and `yjs` 13.6.33.
  No dependency requests.

## Notes for other work packages

- **WP-7a / kernel**: undo entries are recorded before the local batch is emitted; coalescing keeps the entry's
  `txId` (new entry object). `load` batches also come from partition visibility changes (see request 3).
- **WP-3**: `curvesOfClip` lists canonical curves only (request 3); the memory store can replace the naive store in
  `rig.*` tests (only the factory changes).
- **WP-5**: `fractionalIndex(last, null)` is implemented (`view.copyViewToShot`).
- **WP-6t, WP-9**: `sceneToClipFrame`/`clipToSceneFrame`/`wrapClipFrame`, `defaultChannelValue` and
  `isRotationChannel` are implemented; the local fallbacks can go once WP-2 merges.
- **WP-8**: pass `strictPut: false` to `createMemoryStore` in production builds if desired (D2-11).
- **Everyone writing structural records**: `partitionOf` needs a `PartitionLookup` for controls, constraints and
  solvers; inside a store, partitions are resolved for you.
